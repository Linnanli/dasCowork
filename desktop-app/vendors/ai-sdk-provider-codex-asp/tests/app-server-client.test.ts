import { describe, expect, it, vi } from "vitest";

import { AppServerClient, JsonRpcError } from "../src/client/app-server-client";
import { MockTransport } from "./helpers/mock-transport";
import { planAssertionsForTest } from "./helpers/plan-assertion";

describe("AppServerClient", () =>
{
    it("sends request and resolves response", async () =>
    {
        const transport = new MockTransport();
        const client = new AppServerClient(transport, { requestTimeoutMs: 1000 });

        await client.connect();

        const promise = client.request<{ ok: boolean }>("initialize", { a: 1 });

        const request = transport.sentMessages[0];
        if (!request || !("id" in request))
        {
            throw new Error("Expected request message with id");
        }

        transport.emitMessage({ id: request.id, result: { ok: true } });

        await expect(promise).resolves.toEqual({ ok: true });
    });

    it("rejects request on JSON-RPC error", async () =>
    {
        const transport = new MockTransport();
        const client = new AppServerClient(transport, { requestTimeoutMs: 1000 });

        await client.connect();

        const promise = client.request("initialize", {});

        const request = transport.sentMessages[0];
        if (!request || !("id" in request))
        {
            throw new Error("Expected request message with id");
        }

        transport.emitMessage({
            id: request.id,
            error: {
                code: -32000,
                message: "boom",
            },
        });

        await expect(promise).rejects.toBeInstanceOf(JsonRpcError);
    });

    it("releases the transport route when a request times out", async () =>
    {
        vi.useFakeTimers();
        try
        {
            const transport = new MockTransport() as MockTransport & {
                cancelRequest: ReturnType<typeof vi.fn>
            };
            transport.cancelRequest = vi.fn();
            const client = new AppServerClient(transport, { requestTimeoutMs: 10 });

            await client.connect();
            const pending = client.request("thread/read", { threadId: "thread-timeout" });
            const request = transport.sentMessages.at(-1);
            if (!request || !("id" in request))
            {
                throw new Error("Expected request message with id");
            }

            const rejected = expect(pending).rejects.toThrow("Request timed out: thread/read");
            await vi.advanceTimersByTimeAsync(10);
            await rejected;
            expect(transport.cancelRequest).toHaveBeenCalledWith(request.id);
        }
        finally
        {
            vi.useRealTimers();
        }
    });

    it("releases transport routes for outstanding requests during disconnect", async () =>
    {
        const transport = new MockTransport() as MockTransport & {
            cancelRequest: ReturnType<typeof vi.fn>
        };
        transport.cancelRequest = vi.fn();
        const client = new AppServerClient(transport, { requestTimeoutMs: 1000 });

        await client.connect();
        const pending = client.request("thread/read", { threadId: "thread-disconnect" });
        const request = transport.sentMessages.at(-1);
        if (!request || !("id" in request))
        {
            throw new Error("Expected request message with id");
        }

        const rejected = expect(pending).rejects.toThrow("Client disconnected.");
        await client.disconnect();
        await rejected;

        expect(transport.cancelRequest).toHaveBeenCalledWith(request.id);
    });

    it("bounds a successful teardown wait when an RPC response never arrives", async () =>
    {
        vi.useFakeTimers();
        try
        {
            const transport = new MockTransport();
            const client = new AppServerClient(transport, { requestTimeoutMs: 1_000 });
            await client.connect();
            const pending = client.request("turn/steer", { expectedTurnId: "turn_1" });

            const drained = client.waitForPendingRequests(10);
            await vi.advanceTimersByTimeAsync(10);

            await expect(drained).resolves.toBe(false);
            const rejected = expect(pending).rejects.toThrow("Client disconnected.");
            await client.disconnect();
            await rejected;
        }
        finally
        {
            vi.useRealTimers();
        }
    });

    it("handles inbound JSON-RPC requests and responds", async () =>
    {
        const transport = new MockTransport();
        const client = new AppServerClient(transport, { requestTimeoutMs: 1000 });

        await client.connect();

        client.onRequest("item/tool/call", (params) => ({ ok: true, params }));

        transport.emitMessage({
            id: 99,
            method: "item/tool/call",
            params: { tool: "x" },
        });
        await Promise.resolve();

        const response = transport.sentMessages.at(-1);
        expect(response).toEqual({
            id: 99,
            result: { ok: true, params: { tool: "x" } },
        });
    });

    it("does not let later notifications overtake synchronous listeners", async () =>
    {
        const transport = new MockTransport();
        const client = new AppServerClient(transport, { requestTimeoutMs: 1000 });
        const calls: string[] = [];

        await client.connect();
        client.onNotification("item/started", () =>
        {
            calls.push("specific:item/started");
        });
        client.onAnyNotification((method) =>
        {
            calls.push(`mapper:${method}`);
        });

        transport.emitMessage({ method: "item/started", params: { item: { id: "item_1" } } });
        transport.emitMessage({
            method: "item/agentMessage/delta",
            params: { itemId: "item_1", delta: "hello" },
        });

        await vi.waitFor(() =>
            expect(calls).toEqual([
                "specific:item/started",
                "mapper:item/started",
                "mapper:item/agentMessage/delta",
            ]),
        );
    });

    it("processes a replayed pending inbound request only once", async () =>
    {
        const transport = new MockTransport();
        const client = new AppServerClient(transport, { requestTimeoutMs: 1000 });
        let resolveRequest!: (result: { ok: true }) => void;
        const requestResult = new Promise<{ ok: true }>((resolve) =>
        {
            resolveRequest = resolve;
        });
        const handler = vi.fn(() => requestResult);

        await client.connect();
        client.onRequest("item/tool/call", handler);

        const request = {
            id: 77,
            method: "item/tool/call",
            params: { callId: "call-replayed", tool: "lookup" },
        };
        transport.emitMessage(request);
        transport.emitMessage(request);
        await Promise.resolve();

        expect(handler).toHaveBeenCalledTimes(1);
        resolveRequest({ ok: true });
        await vi.waitFor(() =>
            expect(
                transport.sentMessages.filter((message) => "id" in message && message.id === 77),
            ).toEqual([{ id: 77, result: { ok: true } }]),
        );
    });

    it("emits packet debug callbacks for inbound and outbound packets", async () =>
    {
        const transport = new MockTransport();
        const packets: Array<{ direction: "inbound" | "outbound"; message: unknown }> = [];
        const client = new AppServerClient(transport, {
            requestTimeoutMs: 1000,
            onPacket: (packet) => packets.push(packet),
        });

        await client.connect();

        const promise = client.request<{ ok: boolean }>("initialize", { a: 1 });

        const request = transport.sentMessages[0];
        if (!request || !("id" in request))
        {
            throw new Error("Expected request message with id");
        }

        transport.emitMessage({ id: request.id, result: { ok: true } });
        await promise;

        expect(
            packets.some(
                (packet) =>
                    packet.direction === "outbound" &&
          typeof packet.message === "object" &&
          packet.message !== null &&
          "method" in packet.message &&
          packet.message.method === "initialize",
            ),
        ).toBe(true);

        expect(
            packets.some(
                (packet) =>
                    packet.direction === "inbound" &&
          typeof packet.message === "object" &&
          packet.message !== null &&
          "result" in packet.message,
            ),
        ).toBe(true);
    });

    it("C23 converts an active transport error and close into one fatal termination", async () =>
    {
        const assertC23 = planAssertionsForTest("C23");
        const transport = new MockTransport();
        const client = new AppServerClient(transport, { requestTimeoutMs: 1000 });
        const terminations: Array<Error & { code?: unknown }> = [];

        await client.connect();
        client.onTransportTermination((error) => terminations.push(error));

        const pendingRequest = client.request("turn/start", {});
        transport.emitError(new Error("socket lost"));
        transport.emitClose(null, "SIGTERM");

        await assertC23("无自动重试、额外请求或迟到事件应用", () =>
            expect(pendingRequest).rejects.toThrow("App Server transport terminated unexpectedly."),
        );
        await assertC23("terminal 只结算一次且 Composer 恢复", () =>
            expect(terminations).toHaveLength(1),
        );
        await assertC23("保留可见内容并显示单一终态", () =>
            expect(terminations[0]?.message).toBe("App Server transport terminated unexpectedly."),
        );
        expect(terminations[0]?.code).toBe("app_server_transport_terminated");
    });

    it("C23 codes an unexpected transport close separately from generic termination", async () =>
    {
        const transport = new MockTransport();
        const client = new AppServerClient(transport, { requestTimeoutMs: 1000 });
        const terminations: Array<Error & { code?: unknown }> = [];

        await client.connect();
        client.onTransportTermination((error) => terminations.push(error));

        const pendingRequest = client.request("turn/start", {});
        transport.emitClose(1, null);

        await expect(pendingRequest).rejects.toMatchObject({
            code: "app_server_transport_closed",
            message: "App Server transport closed unexpectedly (code 1).",
        });
        expect(terminations).toHaveLength(1);
        expect(terminations[0]?.code).toBe("app_server_transport_closed");
    });

    it("does not report intentional disconnects as transport failures", async () =>
    {
        const transport = new MockTransport();
        const client = new AppServerClient(transport);
        const onTermination = vi.fn();

        await client.connect();
        client.onTransportTermination(onTermination);
        await client.disconnect();

        expect(onTermination).not.toHaveBeenCalled();
    });
});
