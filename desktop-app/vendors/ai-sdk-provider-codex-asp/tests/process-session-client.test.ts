import { describe, expect, it, vi } from "vitest";

import type { CodexCommandJsonRpcClientLike } from "../src/command-client";
import { CodexProcessSessionClient } from "../src/process-session-client";

class FakeJsonRpcClient implements CodexCommandJsonRpcClientLike
{
    readonly requests = vi.fn((method: string, _params?: unknown) =>
    {
        if (method === "initialize")
        {
            return Promise.resolve({ serverInfo: { name: "mock-codex", version: "1.0.0" } });
        }
        return Promise.resolve({});
    });
    private readonly notificationHandlers = new Map<string, Set<(params: unknown) => void | Promise<void>>>();
    private readonly terminationHandlers = new Set<(error: Error) => void>();

    connect = vi.fn(() => Promise.resolve());
    disconnect = vi.fn(() => Promise.resolve());
    notification = vi.fn(() => Promise.resolve());
    request<T = unknown>(method: string, params?: unknown): Promise<T>
    {
        return this.requests(method, params) as Promise<T>;
    }
    onNotification(method: string, handler: (params: unknown) => void | Promise<void>): () => void
    {
        const handlers = this.notificationHandlers.get(method) ?? new Set();
        handlers.add(handler);
        this.notificationHandlers.set(method, handlers);
        return () => handlers.delete(handler);
    }
    onTransportTermination(handler: (error: Error) => void): () => void
    {
        this.terminationHandlers.add(handler);
        return () => this.terminationHandlers.delete(handler);
    }
    async emit(method: string, params: unknown): Promise<void>
    {
        await Promise.all(
            [...(this.notificationHandlers.get(method) ?? [])].map(async (handler) => handler(params)),
        );
    }
    terminate(error: Error): void
    {
        for (const handler of this.terminationHandlers) {handler(error);}
    }
}

describe("CodexProcessSessionClient", () =>
{
    it("spawns a TTY, merges same-tick input, decodes split UTF-8, and routes exit", async () =>
    {
        const rpc = new FakeJsonRpcClient();
        const client = new CodexProcessSessionClient({ createClient: () => rpc });
        const session = await client.spawn({ command: ["/bin/sh"], cwd: "/workspace", cols: 120, rows: 40 });
        const spawn = rpc.requests.mock.calls.find(([method]) => method === "process/spawn");
        expect(spawn?.[1]).toMatchObject({
            command: ["/bin/sh"],
            cwd: "/workspace",
            tty: true,
            streamStdin: true,
            streamStdoutStderr: true,
            size: { cols: 120, rows: 40 },
        });

        const data = vi.fn();
        const exited = vi.fn();
        session.onData(data);
        session.onExit(exited);
        const firstWrite = session.write("echo ");
        const secondWrite = session.write("ok\\n");
        await Promise.all([firstWrite, secondWrite]);
        const writes = rpc.requests.mock.calls.filter(([method]) => method === "process/writeStdin");
        expect(writes).toHaveLength(1);
        expect(writes[0]?.[1]).toMatchObject({
            processHandle: session.processHandle,
            deltaBase64: Buffer.from("echo ok\\n").toString("base64"),
        });

        const euro = Buffer.from("€");
        await rpc.emit("process/outputDelta", {
            processHandle: session.processHandle,
            stream: "stdout",
            deltaBase64: euro.subarray(0, 2).toString("base64"),
            capReached: false,
        });
        await rpc.emit("process/outputDelta", {
            processHandle: session.processHandle,
            stream: "stdout",
            deltaBase64: euro.subarray(2).toString("base64"),
            capReached: false,
        });
        await rpc.emit("process/exited", {
            processHandle: session.processHandle,
            exitCode: 0,
            stdout: "",
            stderr: "",
            stdoutCapReached: false,
            stderrCapReached: false,
        });
        expect(data).toHaveBeenCalledWith("€");
        expect(exited).toHaveBeenCalledWith({ exitCode: 0 });
    });

    it("marks active sessions lost on transport termination and does not replay input", async () =>
    {
        const rpc = new FakeJsonRpcClient();
        const client = new CodexProcessSessionClient({ createClient: () => rpc });
        const session = await client.spawn({ command: ["/bin/sh"], cwd: "/workspace", cols: 80, rows: 24 });
        const lost = vi.fn();
        session.onConnectionLost(lost);

        rpc.terminate(new Error("connection closed"));
        await vi.waitFor(() => expect(lost).toHaveBeenCalledWith(expect.objectContaining({ message: "connection closed" })));
        expect(() => session.write("after-close")).toThrow("unavailable");
        await expect(client.spawn({ command: ["/bin/sh"], cwd: "/workspace", cols: 80, rows: 24 })).resolves.toBeDefined();
    });

    it("drops input queued behind a failed stdin request", async () =>
    {
        const rpc = new FakeJsonRpcClient();
        let rejectFirstWrite!: (error: Error) => void;
        let writeRequestCount = 0;
        rpc.requests.mockImplementation((method: string) =>
        {
            if (method === "initialize")
            {
                return Promise.resolve({ serverInfo: { name: "mock-codex", version: "1.0.0" } });
            }
            if (method === "process/writeStdin" && writeRequestCount === 0)
            {
                writeRequestCount += 1;
                return new Promise((_, reject) =>
                {
                    rejectFirstWrite = reject;
                });
            }
            if (method === "process/writeStdin")
            {
                writeRequestCount += 1;
            }
            return Promise.resolve({});
        });
        const client = new CodexProcessSessionClient({ createClient: () => rpc });
        const session = await client.spawn({ command: ["/bin/sh"], cwd: "/workspace", cols: 80, rows: 24 });

        const firstWrite = session.write("first");
        await vi.waitFor(() =>
            expect(rpc.requests.mock.calls.filter(([method]) => method === "process/writeStdin")).toHaveLength(1),
        );
        const queuedWrite = session.write("stale");
        const firstFailure = expect(firstWrite).rejects.toThrow("write failed");
        const queuedFailure = expect(queuedWrite).rejects.toThrow("write failed");
        rejectFirstWrite(new Error("write failed"));
        await Promise.all([firstFailure, queuedFailure]);

        await session.write("fresh");

        const writes = rpc.requests.mock.calls
            .filter(([method]) => method === "process/writeStdin")
            .map(([, params]) => Buffer.from((params as { deltaBase64: string }).deltaBase64, "base64").toString());
        expect(writes).toEqual(["first", "fresh"]);
    });
});
