import { describe, expect, it, vi } from "vitest";

import {
    type CodexHistoryJsonRpcClientLike,
    createCodexHistoryClient,
} from "../src";
import type { Thread } from "../src/protocol/app-server-protocol/v2/Thread";

type RequestRecord = { method: string; params?: unknown };
type MockHistoryJsonRpcClient = CodexHistoryJsonRpcClientLike & {
    requests: RequestRecord[];
    connectMock: ReturnType<typeof vi.fn>;
    disconnectMock: ReturnType<typeof vi.fn>;
    notificationMock: ReturnType<typeof vi.fn>;
};

function createMockClient(responses: unknown[]): MockHistoryJsonRpcClient
{
    const queue = [...responses];
    const requests: RequestRecord[] = [];
    const connectMock = vi.fn(() => Promise.resolve());
    const disconnectMock = vi.fn(() => Promise.resolve());
    const notificationMock = vi.fn(() => Promise.resolve());

    return {
        requests,
        connectMock,
        disconnectMock,
        notificationMock,
        connect: connectMock,
        disconnect: disconnectMock,
        notification: notificationMock,
        request: vi.fn((method: string, params?: unknown) =>
        {
            requests.push({ method, params });
            if (method === "initialize")
            {
                return Promise.resolve({});
            }

            if (queue.length === 0)
            {
                return Promise.reject(new Error(`unexpected method ${method}`));
            }
            return Promise.resolve(queue.shift());
        }) as CodexHistoryJsonRpcClientLike["request"],
    };
}

describe("CodexHistoryClient", () =>
{
    it("lists all thread pages with default thread/list params", async () =>
    {
        const first = thread({ id: "thread_1" });
        const second = thread({ id: "thread_2" });
        const mock = createMockClient([
            { data: [first], nextCursor: "cursor_1" },
            { data: [second], nextCursor: null },
        ]);
        const client = createCodexHistoryClient({
            clientInfo: { name: "test", version: "1.0.0" },
            createClient: () => mock,
        });

        await expect(client.listAllThreads({ archived: true })).resolves.toEqual([first, second]);

        expect(mock.connectMock).toHaveBeenCalledTimes(1);
        expect(mock.disconnectMock).toHaveBeenCalledTimes(1);
        expect(mock.notificationMock).toHaveBeenCalledWith("initialized");
        expect(mock.requests).toEqual([
            {
                method: "initialize",
                params: {
                    clientInfo: { name: "test", version: "1.0.0" },
                    capabilities: { experimentalApi: true },
                },
            },
            {
                method: "thread/list",
                params: {
                    limit: 100,
                    modelProviders: [],
                    sortKey: "updated_at",
                    sortDirection: "desc",
                    archived: true,
                },
            },
            {
                method: "thread/list",
                params: {
                    cursor: "cursor_1",
                    limit: 100,
                    modelProviders: [],
                    sortKey: "updated_at",
                    sortDirection: "desc",
                    archived: true,
                },
            },
        ]);
    });

    it("disconnects the logical client when connecting fails", async () =>
    {
        const mock = createMockClient([]);
        mock.connectMock.mockRejectedValueOnce(new Error("connection failed"));
        const client = createCodexHistoryClient({ createClient: () => mock });

        await expect(client.listThreads()).rejects.toThrow("connection failed");

        expect(mock.disconnectMock).toHaveBeenCalledTimes(1);
    });

    it("reads threads and lists full turn items by default", async () =>
    {
        const item = thread({ id: "thread_1" });
        const mock = createMockClient([
            { thread: item },
            { data: [{ id: "turn_1", items: [], itemsView: "full", status: "completed", error: null, startedAt: null, completedAt: null, durationMs: null }], nextCursor: null },
        ]);
        const client = createCodexHistoryClient({ createClient: () => mock });

        await expect(client.readThread("thread_1", { includeTurns: true })).resolves.toBe(item);
        await expect(client.listTurns("thread_1")).resolves.toEqual({
            data: [{ id: "turn_1", items: [], itemsView: "full", status: "completed", error: null, startedAt: null, completedAt: null, durationMs: null }],
            nextCursor: null,
        });

        expect(mock.requests).toEqual([
            expect.objectContaining({ method: "initialize" }),
            { method: "thread/read", params: { threadId: "thread_1", includeTurns: true } },
            expect.objectContaining({ method: "initialize" }),
            {
                method: "thread/turns/list",
                params: {
                    threadId: "thread_1",
                    limit: 100,
                    sortDirection: "desc",
                    itemsView: "full",
                },
            },
        ]);
    });

    it("forwards thread mutations and fork through app-server methods", async () =>
    {
        const forked = thread({ id: "thread_fork" });
        const mock = createMockClient([{}, {}, {}, {}, { thread: forked }]);
        const client = createCodexHistoryClient({ createClient: () => mock });

        await client.renameThread("thread_1", "Renamed");
        await client.archiveThread("thread_1");
        await client.unarchiveThread("thread_1");
        await client.deleteThread("thread_1");
        await expect(client.forkThread("thread_1", { ephemeral: true })).resolves.toBe(forked);

        expect(mock.requests).toEqual([
            expect.objectContaining({ method: "initialize" }),
            { method: "thread/name/set", params: { threadId: "thread_1", name: "Renamed" } },
            expect.objectContaining({ method: "initialize" }),
            { method: "thread/archive", params: { threadId: "thread_1" } },
            expect.objectContaining({ method: "initialize" }),
            { method: "thread/unarchive", params: { threadId: "thread_1" } },
            expect.objectContaining({ method: "initialize" }),
            { method: "thread/delete", params: { threadId: "thread_1" } },
            expect.objectContaining({ method: "initialize" }),
            { method: "thread/fork", params: { threadId: "thread_1", ephemeral: true } },
        ]);
    });
});

function thread(overrides: Partial<Thread> = {}): Thread
{
    return {
        id: "thread",
        extra: null,
        sessionId: "session",
        forkedFromId: null,
        parentThreadId: null,
        preview: "Prompt",
        ephemeral: false,
        modelProvider: "openai",
        createdAt: 1782777600,
        updatedAt: 1782777900,
        recencyAt: 1782777900,
        status: { type: "idle" },
        path: null,
        cwd: "/repo",
        cliVersion: "0.0.0",
        source: "appServer",
        threadSource: null,
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: null,
        turns: [],
        ...overrides,
    };
}
