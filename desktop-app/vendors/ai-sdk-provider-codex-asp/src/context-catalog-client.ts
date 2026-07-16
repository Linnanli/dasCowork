import { AppServerClient, JsonRpcError } from "./client/app-server-client";
import { StdioTransport } from "./client/transport-stdio";
import { WebSocketTransport } from "./client/transport-websocket";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./package-info";
import type { AppInfo } from "./protocol/app-server-protocol/v2/AppInfo";
import type { ConfigReadResponse } from "./protocol/app-server-protocol/v2/ConfigReadResponse";
import type { PluginInstalledResponse } from "./protocol/app-server-protocol/v2/PluginInstalledResponse";
import type { SkillMetadata } from "./protocol/app-server-protocol/v2/SkillMetadata";
import type { SkillsListResponse } from "./protocol/app-server-protocol/v2/SkillsListResponse";
import type { CodexInitializeParams, CodexInitializeResult } from "./protocol/types";
import type { CodexProviderSettings, TransportContext } from "./provider-settings";
import { stripUndefined } from "./utils/object";

export interface CodexContextCatalogJsonRpcClientLike
{
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    notification(method: string, params?: unknown): Promise<void>;
    request<T = unknown>(method: string, params?: unknown): Promise<T>;
}

export interface CodexContextCatalogClientSettings extends CodexProviderSettings
{
    createClient?: () => CodexContextCatalogJsonRpcClientLike;
}

export interface CodexAgentRoleListParams
{
    cwd: string;
    threadId?: string;
    pageSize?: number;
}

export interface CodexAgentRole
{
    roleName: string;
    description: string;
    nicknameCandidates: string[];
}

export interface CodexCatalogSkill
{
    name: string;
    description: string;
    shortDescription?: string;
    path: string;
    scope: SkillMetadata["scope"];
    enabled: boolean;
}

export interface CodexCatalogPlugin
{
    id: string;
    name: string;
    mentionName: string;
    displayName: string;
    description?: string;
    marketplaceName: string;
    sourcePath: string;
    mentionPath: string;
    enabled: true;
}

export interface CodexCatalogApp
{
    id: string;
    name: string;
    mentionName: string;
    description?: string;
    logoUrl?: string;
    logoUrlDark?: string;
    mentionPath: string;
    enabled: true;
    accessible: true;
}

export interface CodexAppsListParams
{
    threadId?: string | null;
    forceRefetch?: boolean;
    pageSize?: number;
}

export interface CodexAppsPage
{
    data: CodexCatalogApp[];
    nextCursor?: string;
}

interface AppsListResponse
{
    data: AppInfo[];
    nextCursor: string | null;
}

export class CodexContextCatalogClient
{
    private clientPromise: Promise<CodexContextCatalogJsonRpcClientLike> | undefined;

    constructor(private readonly settings: CodexContextCatalogClientSettings = {}) {}

    async listAgentRoles(params: CodexAgentRoleListParams): Promise<CodexAgentRole[]>
    {
        return this.withClient(async (client) =>
        {
            const response = await client.request<ConfigReadResponse>("config/read", {
                cwd: params.cwd,
                includeLayers: false,
            });
            return agentRolesFromConfig(response.config);
        });
    }

    async listSkills(params: { cwd: string; forceReload?: boolean }): Promise<CodexCatalogSkill[]>
    {
        return this.withClient(async (client) =>
        {
            const response = await client.request<SkillsListResponse>("skills/list", stripUndefined({
                cwds: [params.cwd],
                forceReload: params.forceReload,
            }));

            return response.data
                .flatMap((entry) => entry.skills)
                .filter((skill) => skill.enabled)
                .map(normalizeSkill);
        });
    }

    async listInstalledPlugins(params: { cwd: string }): Promise<CodexCatalogPlugin[]>
    {
        return this.withClient(async (client) =>
        {
            const response = await client.request<PluginInstalledResponse>("plugin/installed", {
                cwds: [params.cwd],
                installSuggestionPluginNames: [],
            });

            return response.marketplaces.flatMap((marketplace) =>
                marketplace.plugins.flatMap((plugin) =>
                {
                    if (!plugin.installed || !plugin.enabled || plugin.source.type !== "local")
                    {
                        return [];
                    }

                    const mentionId = plugin.id.includes("@")
                        ? plugin.id
                        : `${plugin.name}@${marketplace.name}`;
                    return [stripUndefined({
                        id: plugin.id,
                        name: plugin.name,
                        mentionName: plugin.name,
                        displayName: plugin.interface?.displayName ?? plugin.name,
                        description: plugin.interface?.shortDescription ?? undefined,
                        marketplaceName: marketplace.name,
                        sourcePath: plugin.source.path,
                        mentionPath: `plugin://${mentionId}`,
                        enabled: true as const,
                    })];
                }),
            );
        });
    }

    async listApps(params: CodexAppsListParams = {}): Promise<CodexCatalogApp[]>
    {
        return this.withClient(async (client) =>
        {
            const apps: CodexCatalogApp[] = [];
            let cursor: string | undefined;

            do
            {
                const response = await this.requestAppsPage(client, params, cursor);
                apps.push(...response.data);
                cursor = nextCursor(response.nextCursor, cursor, "app/list");
            }
            while (cursor);

            return apps;
        });
    }

    async listAppsPage(params: CodexAppsListParams & { cursor?: string } = {}): Promise<CodexAppsPage>
    {
        return this.withClient((client) => this.requestAppsPage(client, params, params.cursor));
    }

    private async requestAppsPage(
        client: CodexContextCatalogJsonRpcClientLike,
        params: CodexAppsListParams,
        cursor: string | undefined,
    ): Promise<CodexAppsPage>
    {
        const response = await client.request<AppsListResponse>("app/list", stripUndefined({
            cursor,
            limit: params.pageSize ?? 100,
            threadId: params.threadId,
            forceRefetch: params.forceRefetch,
        }));

        return stripUndefined({
            data: response.data
                .filter((app) => app.isEnabled && app.isAccessible)
                .map(normalizeApp),
            nextCursor: response.nextCursor ?? undefined,
        });
    }

    private async withClient<T>(
        callback: (client: CodexContextCatalogJsonRpcClientLike) => Promise<T>,
    ): Promise<T>
    {
        const client = await this.connectedClient();
        try
        {
            return await callback(client);
        }
        catch (error)
        {
            if (!(error instanceof JsonRpcError))
            {
                await this.invalidateClient(client);
            }
            throw error;
        }
    }

    private async invalidateClient(client: CodexContextCatalogJsonRpcClientLike): Promise<void>
    {
        const connected = this.clientPromise;
        if (!connected || await connected !== client)
        {
            return;
        }
        this.clientPromise = undefined;
        await client.disconnect().catch(() => undefined);
    }

    /** Keep one initialized app-server connection for the cached desktop catalog. */
    private connectedClient(): Promise<CodexContextCatalogJsonRpcClientLike>
    {
        if (this.clientPromise)
        {
            return this.clientPromise;
        }

        const client = this.createClient();
        const connecting = (async () =>
        {
            await client.connect();
            try
            {
                await client.request<CodexInitializeResult>("initialize", this.initializeParams());
                await client.notification("initialized");
                return client;
            }
            catch (error)
            {
                await client.disconnect();
                throw error;
            }
        })();
        this.clientPromise = connecting;
        void connecting.catch(() =>
        {
            if (this.clientPromise === connecting)
            {
                this.clientPromise = undefined;
            }
        });
        return connecting;
    }

    async shutdown(): Promise<void>
    {
        const connected = this.clientPromise;
        this.clientPromise = undefined;
        if (!connected)
        {
            return;
        }
        await (await connected).disconnect();
    }

    private createClient(): CodexContextCatalogJsonRpcClientLike
    {
        if (this.settings.createClient)
        {
            return this.settings.createClient();
        }

        const transport = this.settings.transportFactory
            ? this.settings.transportFactory({} satisfies TransportContext)
            : this.settings.transport?.type === "websocket"
                ? new WebSocketTransport(this.settings.transport.websocket)
                : new StdioTransport(this.settings.transport?.stdio);

        return new AppServerClient(transport);
    }

    private initializeParams(): CodexInitializeParams
    {
        return stripUndefined({
            clientInfo: this.settings.clientInfo ?? {
                name: PACKAGE_NAME,
                version: PACKAGE_VERSION,
            },
            capabilities: { experimentalApi: this.settings.experimentalApi ?? true },
        });
    }
}

export function createCodexContextCatalogClient(
    settings: CodexContextCatalogClientSettings = {},
): CodexContextCatalogClient
{
    return new CodexContextCatalogClient(settings);
}

function normalizeSkill(skill: SkillMetadata): CodexCatalogSkill
{
    return stripUndefined({
        name: skill.name,
        description: skill.description,
        shortDescription: skill.shortDescription,
        path: skill.path,
        scope: skill.scope,
        enabled: skill.enabled,
    });
}

function normalizeApp(app: AppInfo): CodexCatalogApp
{
    return stripUndefined({
        id: app.id,
        name: app.name,
        mentionName: appMentionName(app),
        description: app.description ?? undefined,
        logoUrl: app.logoUrl ?? undefined,
        logoUrlDark: app.logoUrlDark ?? undefined,
        mentionPath: `app://${app.id}`,
        enabled: true as const,
        accessible: true as const,
    });
}

function appMentionName(app: AppInfo): string
{
    const mentionName = app.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, "");
    return mentionName || app.id;
}

const AGENT_SETTINGS = new Set([
    "max_threads",
    "max_depth",
    "job_max_runtime_seconds",
    "interrupt_message",
]);

function agentRolesFromConfig(config: Record<string, unknown>): CodexAgentRole[]
{
    const agents = recordValue(config["agents"]);
    if (!agents)
    {
        return [];
    }

    return Object.entries(agents)
        .flatMap(([roleName, value]) =>
        {
            if (AGENT_SETTINGS.has(roleName))
            {
                return [];
            }

            const role = recordValue(value);
            if (!role)
            {
                return [];
            }

            const description = stringValue(role["description"]);
            const nicknameCandidates = stringArrayValue(
                role["nickname_candidates"] ?? role["nicknameCandidates"],
            );
            return [{
                roleName,
                description: description ?? "",
                nicknameCandidates,
            }];
        })
        .sort((left, right) => left.roleName.localeCompare(right.roleName));
}

function recordValue(value: unknown): Record<string, unknown> | null
{
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function stringValue(value: unknown): string | null
{
    if (typeof value !== "string")
    {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function stringArrayValue(value: unknown): string[]
{
    if (!Array.isArray(value))
    {
        return [];
    }
    return value.flatMap((entry) =>
    {
        const text = stringValue(entry);
        return text ? [text] : [];
    });
}

function nextCursor(
    next: string | null | undefined,
    current: string | undefined,
    method: string,
): string | undefined
{
    if (!next)
    {
        return undefined;
    }
    if (next === current)
    {
        throw new Error(`${method} returned the same pagination cursor twice.`);
    }
    return next;
}
