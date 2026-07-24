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

    request<T>(method: string, params?: unknown): Promise<T>
    {
        this.requests.push({ method, params });
        if (method === "initialize")
        {
            return Promise.resolve({} as T);
        }
        return Promise.resolve(this.handler(method, params) as T);
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

    it("binds out-of-order fuzzy responses to the query that issued each request", async () =>
    {
        type SearchResponse = {
            files: Array<{
                root: string;
                path: string;
                match_type: "file";
                file_name: string;
                score: number;
                indices: null;
            }>;
        };
        const pending = new Map<string, (response: SearchResponse) => void>();
        const mock = new CatalogMockClient((method, value) =>
        {
            expect(method).toBe("fuzzyFileSearch");
            const query = (value as { query: string }).query;
            return new Promise<SearchResponse>((resolve) => pending.set(query, resolve));
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });
        const updated: Array<{ query: string; path: string }> = [];
        const completed: string[] = [];
        const session = await client.createFuzzyFileSearchSession({
            roots: ["/repo"],
            onUpdated: (files, query) => updated.push({ query, path: files[0]?.path ?? "" }),
            onCompleted: (query) => completed.push(query),
        });

        const first = session.update("one");
        const second = session.update("two");
        await vi.waitFor(() => expect(pending.size).toBe(2));
        pending.get("two")?.({ files: [fuzzyFile("two.ts")] });
        await second;
        pending.get("one")?.({ files: [fuzzyFile("one.ts")] });
        await first;
        await session.stop();
        await session.update("ignored");

        expect(updated).toEqual([
            { query: "two", path: "two.ts" },
            { query: "one", path: "one.ts" },
        ]);
        expect(completed).toEqual(["two", "one"]);
        expect(mock.requests.filter(({ method }) => method === "fuzzyFileSearch")).toHaveLength(2);
        expect(mock.requests.at(-1)?.params).toMatchObject({
            query: "two",
            roots: ["/repo"],
            cancellationToken: null,
        });
    });

    it("reconnects and replays a fuzzy request after transport loss", async () =>
    {
        const clients: CatalogMockClient[] = [];
        const client = new CodexContextCatalogClient({
            createClient: () =>
            {
                const attempt = clients.length;
                const mock = new CatalogMockClient((method) =>
                {
                    expect(method).toBe("fuzzyFileSearch");
                    if (attempt === 0)
                    {
                        throw new Error("transport closed");
                    }
                    return { files: [fuzzyFile("needle.ts")] };
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

        expect(clients).toHaveLength(2);
        expect(clients[0]?.disconnectCount).toBe(1);
        expect(clients[1]?.requests.map(({ method }) => method)).toEqual([
            "initialize",
            "fuzzyFileSearch",
        ]);
        expect(updated).toHaveBeenCalledWith([
            expect.objectContaining({ path: "needle.ts" }),
        ], "needle");
        expect(completed).toHaveBeenCalledWith("needle");
    });

    it("propagates fuzzy search protocol errors without reconnecting around them", async () =>
    {
        const mock = new CatalogMockClient(() =>
        {
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
        expect(mock.requests.filter(({ method }) => method === "fuzzyFileSearch")).toHaveLength(1);
    });

    it("suppresses a pending fuzzy response after catalog shutdown", async () =>
    {
        let resolveSearch: ((response: { files: ReturnType<typeof fuzzyFile>[] }) => void) | undefined;
        const mock = new CatalogMockClient((method) =>
        {
            expect(method).toBe("fuzzyFileSearch");
            return new Promise<{ files: ReturnType<typeof fuzzyFile>[] }>((resolve) =>
            {
                resolveSearch = resolve;
            });
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });
        const updated = vi.fn();
        const completed = vi.fn();
        const session = await client.createFuzzyFileSearchSession({
            roots: ["/repo"],
            onUpdated: updated,
            onCompleted: completed,
        });

        const update = session.update("needle");
        await vi.waitFor(() => expect(resolveSearch).toBeTypeOf("function"));
        await client.shutdown();
        resolveSearch?.({ files: [fuzzyFile("needle.ts")] });
        await update;

        expect(updated).not.toHaveBeenCalled();
        expect(completed).not.toHaveBeenCalled();
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
