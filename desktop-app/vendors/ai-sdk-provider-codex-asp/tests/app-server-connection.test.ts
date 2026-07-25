import { describe, expect, it } from "vitest";

import { AppServerClient } from "../src/client/app-server-client";
import { CodexAppServerConnection } from "../src/client/app-server-connection";
import type { JsonRpcMessage } from "../src/client/transport";
import { MockTransport } from "./helpers/mock-transport";

class ScriptedTransport extends MockTransport
{
    override async sendMessage(message: JsonRpcMessage): Promise<void>
    {
        await super.sendMessage(message);
        if (!("id" in message) || message.id === undefined || !("method" in message))
        {
            return;
        }

        if (message.method === "initialize")
        {
            this.emitMessage({ id: message.id, result: { serverInfo: { name: "codex" } } });
            return;
        }

        if (message.method === "thread/list")
        {
            this.emitMessage({ id: message.id, result: { data: [], nextCursor: null } });
        }
    }
}

class BrokerTransport extends MockTransport
{
    disconnectCalls = 0;
    readonly deferredRequests: JsonRpcMessage[] = [];

    override async disconnect(): Promise<void>
    {
        this.disconnectCalls += 1;
        await super.disconnect();
    }

    override async sendMessage(message: JsonRpcMessage): Promise<void>
    {
        await super.sendMessage(message);
        if (!isRequest(message))
        {
            return;
        }
        if (message.method === "initialize")
        {
            this.emitMessage({ id: message.id, result: { serverInfo: { name: "codex" } } });
            return;
        }
        if (message.method === "thread/list")
        {
            this.emitMessage({ id: message.id, result: { data: [], nextCursor: null } });
            return;
        }
        if (message.method === "turn/start")
        {
            this.emitMessage({ id: message.id, result: { turnId: "turn-owner" } });
            return;
        }
        this.deferredRequests.push(message);
    }
}

function isRequest(message: JsonRpcMessage): message is { id: string | number; method: string; params?: unknown }
{
    return "id" in message && message.id !== undefined && "method" in message;
}

async function connectAndInitialize(client: AppServerClient): Promise<void>
{
    await client.connect();
    await client.request("initialize", { clientInfo: { name: "test", version: "1.0.0" } });
    await client.notification("initialized");
}

async function flushMessages(): Promise<void>
{
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function listThreads(connection: CodexAppServerConnection): Promise<void>
{
    const client = new AppServerClient(connection.createTransport());
    try
    {
        await client.connect();
        await client.request("initialize", { clientInfo: { name: "test", version: "1.0.0" } });
        await client.notification("initialized");
        await client.request("thread/list", { limit: 1 });
    }
    finally
    {
        await client.disconnect();
    }
}

describe("CodexAppServerConnection", () =>
{
    it("shares one initialized transport across concurrent logical clients", async () =>
    {
        const transports: ScriptedTransport[] = [];
        const connection = new CodexAppServerConnection({
            transportFactory: () =>
            {
                const transport = new ScriptedTransport();
                transports.push(transport);
                return transport;
            },
            idleTimeoutMs: 0,
        });

        try
        {
            await Promise.all([listThreads(connection), listThreads(connection)]);

            expect(transports).toHaveLength(1);
            const methods = transports[0]!.sentMessages
                .filter((message): message is { method: string } => "method" in message)
                .map((message) => message.method);
            expect(methods.filter((method) => method === "initialize")).toHaveLength(1);
            expect(methods.filter((method) => method === "thread/list")).toHaveLength(2);
            expect(connection.getDiagnostics()).toEqual({
                generation: 0,
                physicalConnectionActive: true,
                logicalChannelCount: 0,
                pendingRequestCount: 0,
                threadOwnerCount: 0,
                turnOwnerCount: 0,
                continuationCount: 0,
                activeLeaseCount: 0,
            });
        }
        finally
        {
            await connection.shutdown();
        }
    });

    it("allows history requests to complete while an active chat request remains pending", async () =>
    {
        const transports: BrokerTransport[] = [];
        const connection = new CodexAppServerConnection({
            transportFactory: () =>
            {
                const transport = new BrokerTransport();
                transports.push(transport);
                return transport;
            },
            idleTimeoutMs: 0,
        });
        const chat = new AppServerClient(connection.createTransport({ threadId: "thread-chat" }));
        const history = new AppServerClient(connection.createTransport());

        try
        {
            await Promise.all([connectAndInitialize(chat), connectAndInitialize(history)]);
            const activeTurn = chat.request("thread/read", { threadId: "thread-chat" });
            const listed = await history.request<{ data: unknown[] }>("thread/list", { limit: 1 });

            expect(listed).toEqual({ data: [], nextCursor: null });
            expect(transports).toHaveLength(1);
            expect(transports[0]!.sentMessages.filter(isRequest).map((message) => message.method)).toEqual(
                expect.arrayContaining(["thread/read", "thread/list"]),
            );

            await chat.disconnect();
            await expect(activeTurn).rejects.toThrow("Client disconnected");
        }
        finally
        {
            await history.disconnect();
            await connection.shutdown();
        }
    });

    it("rewrites colliding local request ids before sending them on the physical transport", async () =>
    {
        const physical = new BrokerTransport();
        const connection = new CodexAppServerConnection({
            transportFactory: () => physical,
            idleTimeoutMs: 0,
        });
        const first = new AppServerClient(connection.createTransport());
        const second = new AppServerClient(connection.createTransport());

        try
        {
            await Promise.all([connectAndInitialize(first), connectAndInitialize(second)]);
            const firstRequest = first.request<{ owner: string }>("thread/read", { threadId: "thread-one" });
            const secondRequest = second.request<{ owner: string }>("thread/read", { threadId: "thread-two" });
            await flushMessages();

            const [firstWire, secondWire] = physical.deferredRequests.filter(isRequest);
            expect(firstWire).toBeDefined();
            expect(secondWire).toBeDefined();
            expect(firstWire!.id).not.toBe(secondWire!.id);

            physical.emitMessage({ id: secondWire!.id, result: { owner: "two" } });
            physical.emitMessage({ id: firstWire!.id, result: { owner: "one" } });
            await expect(firstRequest).resolves.toEqual({ owner: "one" });
            await expect(secondRequest).resolves.toEqual({ owner: "two" });
        }
        finally
        {
            await first.disconnect();
            await second.disconnect();
            await connection.shutdown();
        }
    });

    it("routes app-server requests only to the owning active turn channel", async () =>
    {
        const physical = new BrokerTransport();
        const connection = new CodexAppServerConnection({
            transportFactory: () => physical,
            idleTimeoutMs: 0,
        });
        const chat = new AppServerClient(connection.createTransport({ threadId: "thread-owner" }));
        const history = new AppServerClient(connection.createTransport());
        const chatRequests: unknown[] = [];
        const historyRequests: unknown[] = [];

        try
        {
            await Promise.all([connectAndInitialize(chat), connectAndInitialize(history)]);
            chat.onToolCallRequest((params) =>
            {
                chatRequests.push(params);
                return { success: true, contentItems: [] };
            });
            history.onToolCallRequest((params) =>
            {
                historyRequests.push(params);
                return { success: true, contentItems: [] };
            });
            await chat.request("turn/start", { threadId: "thread-owner", input: [] });

            physical.emitMessage({
                id: 999,
                method: "item/tool/call",
                params: { threadId: "thread-owner", turnId: "turn-owner", callId: "call-owner" },
            });
            await flushMessages();

            expect(chatRequests).toHaveLength(1);
            expect(historyRequests).toHaveLength(0);
            expect(physical.sentMessages).toContainEqual({
                id: 999,
                result: { success: true, contentItems: [] },
            });
        }
        finally
        {
            await chat.disconnect();
            await history.disconnect();
            await connection.shutdown();
        }
    });

    it("routes command, file, tool, and elicitation requests only to their active turn owner", async () =>
    {
        const physical = new BrokerTransport();
        const connection = new CodexAppServerConnection({
            transportFactory: () => physical,
            idleTimeoutMs: 0,
        });
        const chat = new AppServerClient(connection.createTransport({ threadId: "thread-owner" }));
        const history = new AppServerClient(connection.createTransport());
        const methods = [
            "item/commandExecution/requestApproval",
            "item/fileChange/requestApproval",
            "item/tool/call",
            "mcpServer/elicitation/request",
        ];
        const deliveredToChat: string[] = [];
        const deliveredToHistory: string[] = [];

        try
        {
            await Promise.all([connectAndInitialize(chat), connectAndInitialize(history)]);
            for (const method of methods)
            {
                chat.onRequest(method, () =>
                {
                    deliveredToChat.push(method);
                    return { owner: "chat" };
                });
                history.onRequest(method, () =>
                {
                    deliveredToHistory.push(method);
                    return { owner: "history" };
                });
            }
            await chat.request("turn/start", { threadId: "thread-owner", input: [] });

            for (const [index, method] of methods.entries())
            {
                physical.emitMessage({
                    id: 1_000 + index,
                    method,
                    params: { threadId: "thread-owner", turnId: "turn-owner" },
                });
            }
            await flushMessages();

            expect(deliveredToChat).toEqual(methods);
            expect(deliveredToHistory).toEqual([]);
            for (const [index] of methods.entries())
            {
                expect(physical.sentMessages).toContainEqual({
                    id: 1_000 + index,
                    result: { owner: "chat" },
                });
            }
        }
        finally
        {
            await chat.disconnect();
            await history.disconnect();
            await connection.shutdown();
        }
    });

    it("does not close the physical transport when one logical channel disconnects", async () =>
    {
        const physical = new BrokerTransport();
        const connection = new CodexAppServerConnection({
            transportFactory: () => physical,
            idleTimeoutMs: 0,
        });
        const chat = new AppServerClient(connection.createTransport({ threadId: "thread-chat" }));
        const history = new AppServerClient(connection.createTransport());

        await Promise.all([connectAndInitialize(chat), connectAndInitialize(history)]);
        await chat.disconnect();
        expect(physical.disconnectCalls).toBe(0);
        await expect(history.request("thread/list", { limit: 1 })).resolves.toEqual({
            data: [],
            nextCursor: null,
        });

        await history.disconnect();
        await connection.shutdown();
        expect(physical.disconnectCalls).toBe(1);
    });

    it("clears detached-channel routes while other logical channels remain usable", async () =>
    {
        const physical = new BrokerTransport();
        const connection = new CodexAppServerConnection({
            transportFactory: () => physical,
            idleTimeoutMs: 0,
        });
        const detached = new AppServerClient(connection.createTransport());
        const survivor = new AppServerClient(connection.createTransport());

        try
        {
            await Promise.all([connectAndInitialize(detached), connectAndInitialize(survivor)]);
            const pending = detached.request("thread/read", { threadId: "thread-detached" });
            void pending.catch(() => undefined);
            await flushMessages();
            expect(connection.getDiagnostics().pendingRequestCount).toBe(1);

            await detached.disconnect();
            expect(connection.getDiagnostics()).toMatchObject({
                logicalChannelCount: 1,
                pendingRequestCount: 0,
                activeLeaseCount: 1,
            });
            await expect(survivor.request("thread/list", { limit: 1 })).resolves.toEqual({
                data: [],
                nextCursor: null,
            });
        }
        finally
        {
            await survivor.disconnect();
            await connection.shutdown();
        }
    });

    it("releases pending routes when a logical client disconnects and ignores its late response", async () =>
    {
        const physical = new BrokerTransport();
        const connection = new CodexAppServerConnection({
            transportFactory: () => physical,
            idleTimeoutMs: 0,
        });
        const client = new AppServerClient(connection.createTransport());
        const healthy = new AppServerClient(connection.createTransport());

        try
        {
            await Promise.all([connectAndInitialize(client), connectAndInitialize(healthy)]);
            const pending = client.request("thread/read", { threadId: "thread-detached" });
            await flushMessages();
            const wireRequest = physical.deferredRequests.find(isRequest);
            expect(connection.getDiagnostics().pendingRequestCount).toBe(1);

            await client.disconnect();
            await expect(pending).rejects.toThrow("Client disconnected");
            expect(connection.getDiagnostics().pendingRequestCount).toBe(0);

            physical.emitMessage({ id: wireRequest!.id, result: { id: "thread-detached" } });
            await expect(healthy.request("thread/list", { limit: 1 })).resolves.toEqual({
                data: [],
                nextCursor: null,
            });
        }
        finally
        {
            await healthy.disconnect();
            await connection.shutdown();
        }
    });

    it("releases the broker route when a client request times out", async () =>
    {
        const physical = new BrokerTransport();
        const connection = new CodexAppServerConnection({
            transportFactory: () => physical,
            idleTimeoutMs: 0,
        });
        const client = new AppServerClient(connection.createTransport(), { requestTimeoutMs: 0 });

        try
        {
            await connectAndInitialize(client);
            const request = client.request("thread/read", { threadId: "thread-timeout" });
            await expect(request).rejects.toThrow("Request timed out: thread/read");
            expect(connection.getDiagnostics().pendingRequestCount).toBe(0);
        }
        finally
        {
            await client.disconnect();
            await connection.shutdown();
        }
    });

    it("clears a parked cross-call continuation when its logical channel detaches", async () =>
    {
        const physical = new BrokerTransport();
        const connection = new CodexAppServerConnection({
            transportFactory: () => physical,
            idleTimeoutMs: 0,
        });
        const first = connection.createTransport({ threadId: "thread-tool" });
        const second = connection.createTransport({ threadId: "thread-tool" });

        try
        {
            await first.connect();
            first.parkToolCall({
                requestId: 77,
                callId: "call-tool",
                toolName: "tool_name",
                args: {},
                threadId: "thread-tool",
            });
            await first.disconnect();

            physical.emitMessage({
                method: "item/completed",
                params: { threadId: "thread-tool", turnId: "turn-tool", item: { id: "item-tool" } },
            });
            await second.connect();

            expect(second.getPendingToolCall()).toBeNull();
            expect(second.drainBufferedMessages()).toEqual([]);
            await expect(second.respondToToolCall({ success: true, contentItems: [] }))
                .rejects.toThrow("No pending tool call to respond to.");
        }
        finally
        {
            await second.disconnect();
            await connection.shutdown();
        }
    });

    it("rejects every logical client on fatal transport termination and reconnects cleanly", async () =>
    {
        const transports: BrokerTransport[] = [];
        const connection = new CodexAppServerConnection({
            transportFactory: () =>
            {
                const transport = new BrokerTransport();
                transports.push(transport);
                return transport;
            },
            idleTimeoutMs: 0,
        });
        const first = new AppServerClient(connection.createTransport());

        try
        {
            await connectAndInitialize(first);
            const pending = first.request("thread/read", { threadId: "thread-fatal" });
            await flushMessages();
            transports[0]!.emitError(new Error("simulated transport failure"));
            await expect(pending).rejects.toMatchObject({
                code: "app_server_transport_terminated",
                message: "App Server transport terminated unexpectedly.",
            });
            await first.disconnect();

            const recovered = new AppServerClient(connection.createTransport());
            await connectAndInitialize(recovered);
            await expect(recovered.request("thread/list", { limit: 1 })).resolves.toEqual({
                data: [],
                nextCursor: null,
            });
            expect(transports).toHaveLength(2);
            expect(connection.getDiagnostics().generation).toBe(1);
            await recovered.disconnect();
        }
        finally
        {
            await connection.shutdown();
        }
    });

    it("waits for active logical leases before closing the shared worker", async () =>
    {
        const connection = new CodexAppServerConnection({
            transportFactory: () => new ScriptedTransport(),
            idleTimeoutMs: 0,
        });
        const transport = connection.createTransport();

        await transport.connect();
        let closed = false;
        const shutdown = connection.shutdown().then(() =>
        {
            closed = true;
        });

        await Promise.resolve();
        expect(closed).toBe(false);

        await transport.disconnect();
        await shutdown;
        expect(closed).toBe(true);
    });

    it("forces local channel release when shutdown reaches its deadline", async () =>
    {
        const physical = new BrokerTransport();
        let triggerDeadline: (() => void) | undefined;
        const connection = new CodexAppServerConnection({
            transportFactory: () => physical,
            shutdownTimeoutMs: 10,
            scheduleTimeout: (callback) =>
            {
                triggerDeadline = callback;
                return {} as ReturnType<typeof setTimeout>;
            },
            clearScheduledTimeout: () => undefined,
        });
        const transport = connection.createTransport();

        await transport.connect();
        const shutdown = connection.shutdown();
        await Promise.resolve();
        expect(connection.getDiagnostics().activeLeaseCount).toBe(1);
        expect(triggerDeadline).toBeDefined();

        triggerDeadline?.();
        await shutdown;

        expect(physical.disconnectCalls).toBe(1);
        expect(connection.getDiagnostics()).toMatchObject({
            logicalChannelCount: 0,
            pendingRequestCount: 0,
            activeLeaseCount: 0,
        });
    });

    it("waits for queued leases handed off during shutdown", async () =>
    {
        const connection = new CodexAppServerConnection({
            transportFactory: () => new ScriptedTransport(),
            idleTimeoutMs: 0,
        });
        const first = connection.createTransport();
        const second = connection.createTransport();

        await first.connect();
        const secondConnect = second.connect();
        let closed = false;
        const shutdown = connection.shutdown().then(() =>
        {
            closed = true;
        });

        await first.disconnect();
        await secondConnect;
        expect(closed).toBe(false);

        await second.disconnect();
        await shutdown;
        expect(closed).toBe(true);
    });

    it("forces logical leases closed when the shutdown deadline expires", async () =>
    {
        let expireShutdown: (() => void) | undefined;
        const physical = new BrokerTransport();
        const connection = new CodexAppServerConnection({
            transportFactory: () => physical,
            idleTimeoutMs: 0,
            shutdownTimeoutMs: 10,
            scheduleTimeout: (callback, timeoutMs) =>
            {
                expect(timeoutMs).toBe(10);
                expireShutdown = callback;
                return 1 as unknown as ReturnType<typeof setTimeout>;
            },
            clearScheduledTimeout: () => undefined,
        });
        const transport = connection.createTransport();

        await transport.connect();
        const shutdown = connection.shutdown();
        expect(connection.getDiagnostics().activeLeaseCount).toBe(1);

        expireShutdown?.();
        await shutdown;

        expect(physical.disconnectCalls).toBe(1);
        expect(connection.getDiagnostics()).toMatchObject({
            activeLeaseCount: 0,
            logicalChannelCount: 0,
            pendingRequestCount: 0,
            physicalConnectionActive: false,
        });
    });
});
