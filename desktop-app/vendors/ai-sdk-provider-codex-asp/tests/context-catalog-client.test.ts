import { describe, expect, it, vi } from "vitest";

import { JsonRpcError } from "../src/client/app-server-client";
import {
    CodexContextCatalogClient,
    type CodexContextCatalogJsonRpcClientLike,
} from "../src/context-catalog-client";

class CatalogMockClient implements CodexContextCatalogJsonRpcClientLike
{
    readonly requests: Array<{ method: string; params: unknown }> = [];
    readonly notifications: Array<{ method: string; params: unknown }> = [];
    private readonly notificationHandlers = new Map<string, Set<(params: unknown) => void | Promise<void>>>();
    connectCount = 0;
    disconnectCount = 0;

    constructor(private readonly handler: (method: string, params: unknown) => unknown) {}

    connect(): Promise<void>
    {
        this.connectCount++;
        return Promise.resolve();
    }

    disconnect(): Promise<void>
    {
        this.disconnectCount++;
        return Promise.resolve();
    }

    notification(method: string, params?: unknown): Promise<void>
    {
        this.notifications.push({ method, params });
        return Promise.resolve();
    }

    onNotification(method: string, handler: (params: unknown) => void | Promise<void>): () => void
    {
        const handlers = this.notificationHandlers.get(method) ?? new Set();
        handlers.add(handler);
        this.notificationHandlers.set(method, handlers);
        return () =>
        {
            handlers.delete(handler);
            if (handlers.size === 0)
            {
                this.notificationHandlers.delete(method);
            }
        };
    }

    request<T>(method: string, params?: unknown): Promise<T>
    {
        this.requests.push({ method, params });
        if (method === "initialize")
        {
            return Promise.resolve({} as T);
        }
        return Promise.resolve(this.handler(method, params) as T);
    }

    emitNotification(method: string, params: unknown): void
    {
        for (const handler of this.notificationHandlers.get(method) ?? [])
        {
            void handler(params);
        }
    }
}

function fuzzyFile(path: string)
{
    return {
        root: "/repo",
        path,
        match_type: "file" as const,
        file_name: path,
        score: 1,
        indices: null,
    };
}

function mcpStatus(name: string, overrides: Record<string, unknown> = {})
{
    return {
        name,
        serverInfo: {
            name,
            title: `${name} title`,
            version: "1.0.0",
            description: "private server description",
            icons: [{ src: "private-icon" }],
            websiteUrl: "https://private.example.invalid",
        },
        tools: {
            lookup: {
                name: "lookup",
                title: "Lookup",
                description: "private tool schema",
                inputSchema: {
                    type: "object",
                    properties: {
                        token: { type: "string" },
                    },
                },
            },
        },
        resources: [{ uri: "secret://resource", name: "secret resource" }],
        resourceTemplates: [{ uriTemplate: "secret://{id}", name: "secret template" }],
        authStatus: "oAuth",
        ...overrides,
    };
}

describe("CodexContextCatalogClient", () =>
{
    it("leases and releases a client for each catalog operation when sharing a host connection", async () =>
    {
        const clients: CatalogMockClient[] = [];
        const client = new CodexContextCatalogClient({
            connectionLifecycle: "per-operation",
            createClient: () =>
            {
                const next = new CatalogMockClient(() => ({ data: [], nextCursor: null }));
                clients.push(next);
                return next;
            },
        });

        await Promise.all([client.listApps(), client.listApps()]);

        expect(clients).toHaveLength(2);
        expect(clients.map((item) => item.connectCount)).toEqual([1, 1]);
        expect(clients.map((item) => item.disconnectCount)).toEqual([1, 1]);
        await client.shutdown();
    });

    it("normalizes enabled skills and installed local plugins", async () =>
    {
        const mock = new CatalogMockClient((method) =>
        {
            if (method === "skills/list")
            {
                return {
                    data: [{
                        cwd: "/repo",
                        errors: [],
                        skills: [
                            {
                                name: "slides",
                                description: "Create slides",
                                shortDescription: "Slides",
                                interface: { displayName: "Slides UI" },
                                path: "/skills/slides/SKILL.md",
                                scope: "user",
                                enabled: true,
                            },
                            {
                                name: "disabled",
                                description: "Disabled",
                                path: "/skills/disabled/SKILL.md",
                                scope: "user",
                                enabled: false,
                            },
                        ],
                    }],
                };
            }

            return {
                marketplaceLoadErrors: [],
                marketplaces: [{
                    name: "local-market",
                    plugins: [
                        {
                            id: "sample",
                            name: "sample",
                            installed: true,
                            enabled: true,
                            source: { type: "local", path: "/plugins/sample" },
                            interface: { displayName: "Sample Plugin", shortDescription: "A sample" },
                        },
                        {
                            id: "remote",
                            name: "remote",
                            installed: true,
                            enabled: true,
                            source: { type: "remote" },
                            interface: null,
                        },
                    ],
                }],
            };
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });

        await expect(client.listSkills({ cwd: "/repo" })).resolves.toEqual([{
            name: "slides",
            displayName: "Slides UI",
            description: "Create slides",
            shortDescription: "Slides",
            path: "/skills/slides/SKILL.md",
            scope: "user",
            enabled: true,
        }]);
        await expect(client.listInstalledPlugins({ cwd: "/repo" })).resolves.toEqual([{
            id: "sample",
            name: "sample",
            mentionName: "sample",
            displayName: "Sample Plugin",
            description: "A sample",
            marketplaceName: "local-market",
            sourcePath: "/plugins/sample",
            mentionPath: "plugin://sample@local-market",
            enabled: true,
        }]);
        expect(mock.connectCount).toBe(1);
        await client.shutdown();
        expect(mock.disconnectCount).toBe(1);
    });

    it("auto-pages apps and filters inaccessible or disabled entries", async () =>
    {
        const mock = new CatalogMockClient((method, params) =>
        {
            expect(method).toBe("app/list");
            const request = params as { cursor?: string; threadId?: string | null };
            expect(request.threadId).toBeNull();
            const cursor = request.cursor;
            return cursor
                ? {
                    data: [{
                        id: "disabled",
                        name: "Disabled",
                        description: null,
                        logoUrl: null,
                        logoUrlDark: null,
                        isEnabled: false,
                        isAccessible: true,
                        pluginDisplayNames: [],
                    }],
                    nextCursor: null,
                }
                : {
                    data: [{
                        id: "github",
                        name: "GitHub",
                        description: "Repositories",
                        logoUrl: "https://example.com/github.png",
                        logoUrlDark: null,
                        isEnabled: true,
                        isAccessible: true,
                        pluginDisplayNames: ["GitHub Plugin"],
                    }],
                    nextCursor: "page-2",
                };
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });

        await expect(client.listApps({ threadId: null, pageSize: 1 })).resolves.toEqual([{
            id: "github",
            name: "GitHub",
            mentionName: "github",
            pluginDisplayNames: ["GitHub Plugin"],
            description: "Repositories",
            logoUrl: "https://example.com/github.png",
            mentionPath: "app://github",
            enabled: true,
            accessible: true,
        }]);
    });

    it("normalizes app mention names and falls back to the app id", async () =>
    {
        const mock = new CatalogMockClient(() => ({
            data: [
                {
                    id: "enterprise",
                    name: "  GitHub ++ Enterprise!  ",
                    description: null,
                    logoUrl: null,
                    logoUrlDark: null,
                    isEnabled: true,
                    isAccessible: true,
                },
                {
                    id: "fallback-app",
                    name: "!!!",
                    description: null,
                    logoUrl: null,
                    logoUrlDark: null,
                    isEnabled: true,
                    isAccessible: true,
                },
            ],
            nextCursor: null,
        }));
        const client = new CodexContextCatalogClient({ createClient: () => mock });

        await expect(client.listApps()).resolves.toMatchObject([
            {
                id: "enterprise",
                name: "  GitHub ++ Enterprise!  ",
                mentionName: "github-enterprise",
                mentionPath: "app://enterprise",
            },
            {
                id: "fallback-app",
                name: "!!!",
                mentionName: "fallback-app",
                mentionPath: "app://fallback-app",
            },
        ]);
    });

    it("lists MCP server status with tools-and-auth detail and returns safe summaries", async () =>
    {
        const mock = new CatalogMockClient((method, params) =>
        {
            expect(method).toBe("mcpServerStatus/list");
            expect(params).toEqual({
                limit: 25,
                detail: "toolsAndAuthOnly",
                threadId: "thread-1",
            });
            return {
                data: [
                    mcpStatus("connected-server"),
                    mcpStatus("auth-only-server", {
                        serverInfo: null,
                        tools: {},
                        resources: [],
                        resourceTemplates: [],
                        authStatus: "notLoggedIn",
                    }),
                ],
                nextCursor: null,
            };
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });

        const result = await client.listMcpServerStatus({ threadId: "thread-1", pageSize: 25 });

        expect(result).toEqual([
            {
                name: "connected-server",
                connected: true,
                authStatus: "oAuth",
                toolCount: 1,
            },
            {
                name: "auth-only-server",
                connected: false,
                authStatus: "notLoggedIn",
                toolCount: 0,
            },
        ]);
        expect(Object.keys(result[0] ?? {})).toEqual([
            "name",
            "connected",
            "authStatus",
            "toolCount",
        ]);
        expect(JSON.stringify(result)).not.toContain("private");
        expect(JSON.stringify(result)).not.toContain("secret://");
    });

    it("auto-pages MCP server status and advances cursors", async () =>
    {
        const mock = new CatalogMockClient((method, params) =>
        {
            expect(method).toBe("mcpServerStatus/list");
            const request = params as { cursor?: string; limit?: number; detail?: string };
            expect(request.limit).toBe(1);
            expect(request.detail).toBe("toolsAndAuthOnly");
            return request.cursor
                ? {
                    data: [mcpStatus("second", {
                        serverInfo: null,
                        tools: { second_tool: { name: "second_tool" } },
                        authStatus: "bearerToken",
                    })],
                    nextCursor: null,
                }
                : {
                    data: [mcpStatus("first", {
                        tools: {},
                        authStatus: "unsupported",
                    })],
                    nextCursor: "page-2",
                };
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });

        await expect(client.listMcpServerStatus({ pageSize: 1 })).resolves.toEqual([
            {
                name: "first",
                connected: true,
                authStatus: "unsupported",
                toolCount: 0,
            },
            {
                name: "second",
                connected: true,
                authStatus: "bearerToken",
                toolCount: 1,
            },
        ]);
        expect(mock.requests
            .filter(({ method }) => method === "mcpServerStatus/list")
            .map(({ params }) => (params as { cursor?: string }).cursor)).toEqual([
            undefined,
            "page-2",
        ]);
    });

    it("rejects MCP server status pagination when the cursor does not advance", async () =>
    {
        const mock = new CatalogMockClient(() => ({
            data: [],
            nextCursor: "same-cursor",
        }));
        const client = new CodexContextCatalogClient({ createClient: () => mock });

        await expect(client.listMcpServerStatus()).rejects.toThrow(
            "mcpServerStatus/list returned the same pagination cursor twice.",
        );
        expect(mock.requests
            .filter(({ method }) => method === "mcpServerStatus/list")
            .map(({ params }) => (params as { cursor?: string }).cursor)).toEqual([
            undefined,
            "same-cursor",
        ]);
    });

    it("recreates the catalog connection after a transport request fails", async () =>
    {
        const clients: CatalogMockClient[] = [];
        const client = new CodexContextCatalogClient({
            createClient: () =>
            {
                const attempt = clients.length;
                const mock = new CatalogMockClient((method) =>
                {
                    expect(method).toBe("skills/list");
                    if (attempt === 0)
                    {
                        throw new Error("transport closed");
                    }
                    return { data: [] };
                });
                clients.push(mock);
                return mock;
            },
        });

        await expect(client.listSkills({ cwd: "/repo" })).rejects.toThrow("transport closed");
        await expect(client.listSkills({ cwd: "/repo" })).resolves.toEqual([]);
        expect(clients).toHaveLength(2);
        expect(clients[0]?.disconnectCount).toBe(1);
        expect(clients[1]?.connectCount).toBe(1);
    });

    it("uses a reusable app-server fuzzy file search session and notification updates", async () =>
    {
        const mock = new CatalogMockClient((method, value) =>
        {
            if (method === "fuzzyFileSearch/sessionStart")
            {
                expect(value).toMatchObject({ roots: ["/repo"] });
                return {};
            }
            if (method === "fuzzyFileSearch/sessionUpdate")
            {
                return {};
            }
            if (method === "fuzzyFileSearch/sessionStop")
            {
                return {};
            }
            throw new Error(`unexpected method: ${method}`);
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });
        const updated: Array<{ query: string; path: string }> = [];
        const completed: string[] = [];
        const session = await client.createFuzzyFileSearchSession({
            roots: ["/repo"],
            onUpdated: (files, query) => updated.push({ query, path: files[0]?.path ?? "" }),
            onCompleted: (query) => completed.push(query),
        });

        await session.update("one");
        await session.update("two");
        const sessionId = (mock.requests.find(({ method }) =>
            method === "fuzzyFileSearch/sessionStart")?.params as { sessionId: string }).sessionId;
        mock.emitNotification("fuzzyFileSearch/sessionUpdated", {
            sessionId,
            query: "two",
            files: [fuzzyFile("two.ts")],
        });
        mock.emitNotification("fuzzyFileSearch/sessionCompleted", { sessionId });
        await session.stop();
        await session.update("ignored");

        expect(updated).toEqual([{ query: "two", path: "two.ts" }]);
        expect(completed).toEqual(["two"]);
        expect(mock.requests.map(({ method }) => method)).toEqual([
            "initialize",
            "fuzzyFileSearch/sessionStart",
            "fuzzyFileSearch/sessionUpdate",
            "fuzzyFileSearch/sessionUpdate",
            "fuzzyFileSearch/sessionStop",
        ]);
        expect(mock.requests.filter(({ method }) => method === "fuzzyFileSearch")).toHaveLength(0);
        expect(mock.requests[2]?.params).toMatchObject({
            sessionId,
            query: "one",
        });
        expect(mock.requests[3]?.params).toMatchObject({
            sessionId,
            query: "two",
        });
    });

    it("keeps one leased connection for a fuzzy file search session with per-operation lifecycle", async () =>
    {
        const clients: CatalogMockClient[] = [];
        const client = new CodexContextCatalogClient({
            connectionLifecycle: "per-operation",
            createClient: () =>
            {
                const mock = new CatalogMockClient((method) =>
                {
                    if (
                        method === "fuzzyFileSearch/sessionStart" ||
                        method === "fuzzyFileSearch/sessionUpdate" ||
                        method === "fuzzyFileSearch/sessionStop"
                    )
                    {
                        return {};
                    }
                    throw new Error(`unexpected method: ${method}`);
                });
                clients.push(mock);
                return mock;
            },
        });
        const updated = vi.fn();
        const completed = vi.fn();
        const session = await client.createFuzzyFileSearchSession({
            roots: ["/repo"],
            onUpdated: updated,
            onCompleted: completed,
        });

        await session.update("needle");
        const mock = clients[0];
        const sessionId = (mock?.requests.find(({ method }) =>
            method === "fuzzyFileSearch/sessionStart")?.params as { sessionId: string }).sessionId;
        mock?.emitNotification("fuzzyFileSearch/sessionUpdated", {
            sessionId,
            query: "needle",
            files: [fuzzyFile("needle.ts")],
        });
        await session.stop();

        expect(clients).toHaveLength(1);
        expect(mock?.connectCount).toBe(1);
        expect(mock?.disconnectCount).toBe(1);
        expect(mock?.requests.map(({ method }) => method)).toEqual([
            "initialize",
            "fuzzyFileSearch/sessionStart",
            "fuzzyFileSearch/sessionUpdate",
            "fuzzyFileSearch/sessionStop",
        ]);
        expect(updated).toHaveBeenCalledWith([
            expect.objectContaining({ path: "needle.ts" }),
        ], "needle");
        expect(completed).not.toHaveBeenCalled();
    });

    it("falls back to legacy fuzzyFileSearch when session methods are unsupported", async () =>
    {
        const mock = new CatalogMockClient((method) =>
        {
            if (method === "fuzzyFileSearch/sessionStart")
            {
                throw new JsonRpcError({
                    code: -32601,
                    message: "method not found: fuzzyFileSearch/sessionStart",
                });
            }
            if (method === "fuzzyFileSearch")
            {
                return { files: [fuzzyFile("needle.ts")] };
            }
            throw new Error(`unexpected method: ${method}`);
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });
        const updated = vi.fn();
        const completed = vi.fn();
        const session = await client.createFuzzyFileSearchSession({
            roots: ["/repo"],
            onUpdated: updated,
            onCompleted: completed,
        });

        await session.update("needle");
        await session.stop();

        expect(updated).toHaveBeenCalledWith([
            expect.objectContaining({ path: "needle.ts" }),
        ], "needle");
        expect(completed).toHaveBeenCalledWith("needle");
        expect(mock.requests.map(({ method }) => method)).toEqual([
            "initialize",
            "fuzzyFileSearch/sessionStart",
            "fuzzyFileSearch",
        ]);
        expect(mock.requests.at(-1)?.params).toMatchObject({
            query: "needle",
            roots: ["/repo"],
            cancellationToken: "vscode-fuzzy-file-search",
        });
    });

    it("reconnects, restarts the fuzzy session, and replays an update after transport loss", async () =>
    {
        const clients: CatalogMockClient[] = [];
        const client = new CodexContextCatalogClient({
            createClient: () =>
            {
                const attempt = clients.length;
                const mock = new CatalogMockClient((method) =>
                {
                    if (method === "fuzzyFileSearch/sessionStart")
                    {
                        return {};
                    }
                    if (method === "fuzzyFileSearch/sessionUpdate")
                    {
                        if (attempt === 0)
                        {
                            throw new Error("transport closed");
                        }
                        return {};
                    }
                    throw new Error(`unexpected method: ${method}`);
                });
                clients.push(mock);
                return mock;
            },
        });
        const updated = vi.fn();
        const completed = vi.fn();
        const session = await client.createFuzzyFileSearchSession({
            roots: ["/repo"],
            onUpdated: updated,
            onCompleted: completed,
        });

        await session.update("needle");
        const sessionId = (clients[1]?.requests.find(({ method }) =>
            method === "fuzzyFileSearch/sessionStart")?.params as { sessionId: string }).sessionId;
        clients[1]?.emitNotification("fuzzyFileSearch/sessionUpdated", {
            sessionId,
            query: "needle",
            files: [fuzzyFile("needle.ts")],
        });
        clients[1]?.emitNotification("fuzzyFileSearch/sessionCompleted", { sessionId });

        expect(clients).toHaveLength(2);
        expect(clients[0]?.disconnectCount).toBe(1);
        expect(clients[1]?.requests.map(({ method }) => method)).toEqual([
            "initialize",
            "fuzzyFileSearch/sessionStart",
            "fuzzyFileSearch/sessionUpdate",
        ]);
        expect(updated).toHaveBeenCalledWith([
            expect.objectContaining({ path: "needle.ts" }),
        ], "needle");
        expect(completed).toHaveBeenCalledWith("needle");
    });

    it("propagates fuzzy search protocol errors without reconnecting around them", async () =>
    {
        const mock = new CatalogMockClient((method) =>
        {
            if (method === "fuzzyFileSearch/sessionStart")
            {
                return {};
            }
            throw new JsonRpcError({ code: -32602, message: "invalid roots" });
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });
        const session = await client.createFuzzyFileSearchSession({
            roots: ["/repo"],
            onUpdated: () => undefined,
            onCompleted: () => undefined,
        });

        await expect(session.update("needle")).rejects.toMatchObject({
            code: -32602,
            message: "invalid roots",
        });
        expect(mock.disconnectCount).toBe(0);
        expect(mock.requests.filter(({ method }) => method === "fuzzyFileSearch/sessionUpdate")).toHaveLength(1);
    });

    it("suppresses fuzzy session notifications after catalog shutdown", async () =>
    {
        const mock = new CatalogMockClient((method) =>
        {
            if (
                method === "fuzzyFileSearch/sessionStart" ||
                method === "fuzzyFileSearch/sessionUpdate" ||
                method === "fuzzyFileSearch/sessionStop"
            )
            {
                return {};
            }
            throw new Error(`unexpected method: ${method}`);
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });
        const updated = vi.fn();
        const completed = vi.fn();
        const session = await client.createFuzzyFileSearchSession({
            roots: ["/repo"],
            onUpdated: updated,
            onCompleted: completed,
        });

        await session.update("needle");
        const sessionId = (mock.requests.find(({ method }) =>
            method === "fuzzyFileSearch/sessionStart")?.params as { sessionId: string }).sessionId;
        await client.shutdown();
        mock.emitNotification("fuzzyFileSearch/sessionUpdated", {
            sessionId,
            query: "needle",
            files: [fuzzyFile("needle.ts")],
        });
        mock.emitNotification("fuzzyFileSearch/sessionCompleted", { sessionId });

        expect(updated).not.toHaveBeenCalled();
        expect(completed).not.toHaveBeenCalled();
        expect(mock.requests.map(({ method }) => method)).toEqual([
            "initialize",
            "fuzzyFileSearch/sessionStart",
            "fuzzyFileSearch/sessionUpdate",
            "fuzzyFileSearch/sessionStop",
        ]);
        expect(mock.disconnectCount).toBe(1);
    });

    it("searches threads with the reference parameters and normalizes results", async () =>
    {
        const mock = new CatalogMockClient((method) =>
        {
            expect(method).toBe("thread/search");
            return {
                data: [{
                    snippet: "matching history",
                    thread: {
                        id: "thread-1",
                        name: "Task title",
                        preview: "preview",
                        cwd: "/repo",
                        updatedAt: 1_700_000_000,
                        gitInfo: { branch: "feature/search" },
                        source: "appServer",
                        threadSource: "desktop",
                        parentThreadId: null,
                    },
                }],
                nextCursor: null,
                backwardsCursor: null,
            };
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });

        await expect(client.searchThreads({ query: "needle" })).resolves.toEqual([{
            threadId: "thread-1",
            name: "Task title",
            preview: "preview",
            snippet: "matching history",
            cwd: "/repo",
            updatedAt: "2023-11-14T22:13:20.000Z",
            branch: "feature/search",
            source: "appServer",
            threadSource: "desktop",
            archived: false,
        }]);
        expect(mock.requests.at(-1)).toEqual({
            method: "thread/search",
            params: {
                searchTerm: "needle",
                limit: 50,
                sortKey: "updated_at",
                sortDirection: "desc",
                archived: false,
            },
        });
    });
});
