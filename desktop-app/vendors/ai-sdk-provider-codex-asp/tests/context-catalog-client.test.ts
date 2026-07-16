import { describe, expect, it } from "vitest";

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

describe("CodexContextCatalogClient", () =>
{
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
                    }],
                    nextCursor: "page-2",
                };
        });
        const client = new CodexContextCatalogClient({ createClient: () => mock });

        await expect(client.listApps({ threadId: null, pageSize: 1 })).resolves.toEqual([{
            id: "github",
            name: "GitHub",
            mentionName: "github",
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
});
