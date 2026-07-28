import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";

import type {
    CommandApprovalHandler,
    ElicitationHandler,
    FileChangeApprovalHandler,
    PermissionsApprovalHandler,
    ToolUserInputHandler,
} from "./approvals";
import type { CodexTransport } from "./client/transport";
import type { StdioTransportSettings } from "./client/transport-stdio";
import type { WebSocketTransportSettings } from "./client/transport-websocket";
import type { DynamicToolDefinition, DynamicToolHandler } from "./dynamic-tools";
import type { CodexExistingTurnRecoveryState } from "./protocol/event-mapper";
import type { CodexRenderableThreadItem } from "./protocol/shared-item-extractors";
import type {
    ApprovalsReviewer,
    AskForApproval,
    CodexThreadResumeResult,
    SandboxMode,
    SandboxPolicy,
} from "./protocol/types";
import type { CodexSession } from "./session";

export interface TransportContext {
    signal?: AbortSignal
    threadId?: string
}

/** Default settings applied when starting a new thread. */
export interface CodexThreadDefaults {
    /** Working directory for the thread. */
    cwd?: string
    /** Thread-scoped runtime workspace roots. Paths must be absolute. */
    runtimeWorkspaceRoots?: string[]
    /** Tool-use approval policy — `"never"` | `"on-failure"` | `"on-request"` | `"untrusted"` | `{ granular: … }`. See {@link AskForApproval}. */
    approvalPolicy?: AskForApproval
    /** Routes approval requests for the thread to `"user"` or `"guardian_subagent"`. */
    approvalsReviewer?: ApprovalsReviewer
    /** Sandbox mode — `"read-only"` | `"workspace-write"` | `"danger-full-access"`. See {@link SandboxMode}. */
    sandbox?: SandboxMode
    /** Start threads without writing rollout/session files. */
    ephemeral?: boolean
}

/** Default settings applied to every turn. */
export interface CodexTurnDefaults {
    /** Working directory for the turn (overrides thread-level `cwd`). */
    cwd?: string
    /** Turn-scoped runtime workspace roots. Paths must be absolute. */
    runtimeWorkspaceRoots?: string[]
    /** Tool-use approval policy for this turn. */
    approvalPolicy?: AskForApproval
    /** Routes approval requests for this turn to `"user"` or `"guardian_subagent"`. */
    approvalsReviewer?: ApprovalsReviewer
    /** Fine-grained sandbox policy — `{ type: "dangerFullAccess" }` | `{ type: "readOnly", … }` | `{ type: "workspaceWrite", … }` | `{ type: "externalSandbox", … }`. See {@link SandboxPolicy}. */
    sandboxPolicy?: SandboxPolicy
    /** Model to use for this turn (overrides provider-level `defaultModel`). */
    model?: string
    /** How much effort the model should spend on the response. */
    effort?: "minimal" | "low" | "medium" | "high" | "xhigh"
    /** Controls turn summary generation. */
    summary?: "auto" | "concise" | "detailed" | "none"
}

export interface CodexModelProviderInfo {
    /** Friendly display name for the provider. */
    name?: string
    /** Base URL for the provider's OpenAI-compatible Responses API. */
    base_url?: string
    /** Environment variable that stores the provider API key. */
    env_key?: string
    /** Instructions shown when the environment key is missing. */
    env_key_instructions?: string
    /** Bearer token sent to the provider. Prefer env_key when possible. */
    experimental_bearer_token?: string
    /** Wire protocol used by Codex app server. Current Codex builds support "responses". */
    wire_api?: "responses"
    /** Query parameters appended to the provider base URL. */
    query_params?: Record<string, string>
    /** Literal HTTP headers sent to the provider. */
    http_headers?: Record<string, string>
    /** HTTP headers whose values are read from environment variables. */
    env_http_headers?: Record<string, string>
    /** Maximum retries for non-streaming HTTP requests. */
    request_max_retries?: number
    /** Maximum retries for dropped streaming responses. */
    stream_max_retries?: number
    /** Streaming idle timeout in milliseconds. */
    stream_idle_timeout_ms?: number
    /** WebSocket connection timeout in milliseconds. */
    websocket_connect_timeout_ms?: number
    /** Whether Codex should require OpenAI auth before using this provider. */
    requires_openai_auth?: boolean
    /** Whether the provider supports Responses-over-WebSocket. */
    supports_websockets?: boolean
}

export interface CodexCustomModelProviderSettings {
    /** Provider id selected from customModelProviders. */
    modelProvider?: string
    /** Session-owned model providers injected into Codex app server thread config. */
    customModelProviders?: Record<string, CodexModelProviderInfo>
}

export type CodexAgentLifecycleKind = "started" | "updated" | "completed" | "closed";

/** Normalized sub-agent state projected from the active app-server stream. */
export interface CodexAgentLifecycleEvent {
    kind: CodexAgentLifecycleKind
    threadId: string
    turnId: string
    agentThreadId: string
    agentPath?: string
    status?: string
    toolCallId: string
    timestampMs?: number
}

export type CodexTurnLifecycleEvent =
  | {
      type: "turn-started"
      sequence: number
      threadId: string
      turnId: string
  }
  | {
      type: "item-started" | "item-completed"
      sequence: number
      threadId: string
      turnId: string
      itemId: string
      itemType: string
      /**
       * Exact item payload received from the app server. The normalizer
       * supplies it; callers that construct legacy lifecycle test events may
       * omit it because the renderer projection never includes this payload.
       */
      item?: CodexRenderableThreadItem
      clientUserMessageId?: string
      compareKey?: string
  }
  | {
      type: "turn-completed"
      sequence: number
      threadId: string
      turnId: string
      outcome: "completed" | "interrupted" | "failed"
      /** Raw app-server failure detail. Consumers must sanitize before display. */
      error?: string
  };

/**
 * Per-call overrides passed via `providerOptions[CODEX_PROVIDER_ID]` in
 * `streamText()` / `generateText()`. Values here take precedence over
 * `defaultThreadSettings` and `defaultTurnSettings` from the provider.
 */
export interface CodexCallOptions {
    // — Thread-level (applied to thread/start and thread/resume) —

    /** Existing app-server thread id to resume before starting this turn. */
    resumeThreadId?: string
    /**
   * Reattach to an already-running turn after the provider transport failed.
   * This is not a normal continuation: it performs `thread/resume` only and
   * must never issue `turn/start`.
   */
    resumeActiveTurn?: boolean
    /** State already emitted before a transport boundary, used to merge the app-server snapshot. */
    existingTurnRecoveryState?: CodexExistingTurnRecoveryState
    /** Receives the latest item-based recovery cursor while the stream is live. */
    onExistingTurnRecoveryState?: (state: CodexExistingTurnRecoveryState) => void
    /**
   * Start a replacement app-server thread for a failed terminal retry. The
   * provider replays only prior user/assistant text as context, never tool
   * calls or results from the failed execution branch.
   */
    startFreshTerminalRetry?: boolean
    /** Working directory for this call. Also sent as turn-level `cwd`. */
    cwd?: string
    /** Runtime workspace roots for thread/start, thread/resume, and turn/start. Paths must be absolute. */
    runtimeWorkspaceRoots?: string[]
    /** Tool-use approval policy — `"never"` | `"on-failure"` | `"on-request"` | `"untrusted"` | `{ granular: … }`. See {@link AskForApproval}. */
    approvalPolicy?: AskForApproval
    /** Routes approval requests to `"user"` or `"guardian_subagent"`. */
    approvalsReviewer?: ApprovalsReviewer
    /** Sandbox mode — `"read-only"` | `"workspace-write"` | `"danger-full-access"`. See {@link SandboxMode}. */
    sandbox?: SandboxMode
    /** Start the thread without writing rollout/session files. Only applies to `thread/start`. */
    ephemeral?: boolean
    /**
   * Invoked after `thread/start` returns a new thread id and before the first
   * `turn/start` on that thread. The callback's returned promise is awaited so
   * host-side persistence can prepare local UI state before the first turn.
   */
    onThreadStarted?: (thread: { threadId: string; threadPath?: string }) => void | Promise<void>
    /**
   * Receives normalized live-agent lifecycle events from this call's active
   * app-server connection. Callback failures do not fail the model stream.
   */
    onAgentLifecycle?: (event: CodexAgentLifecycleEvent) => void | Promise<void>
    /**
   * Receives the ordered turn and item lifecycle observed on this call's
   * active app-server connection. Sequence numbers are monotonic within each
   * turn. Callback failures do not fail the model stream.
   */
    onTurnLifecycle?: (event: CodexTurnLifecycleEvent) => void | Promise<void>

    // — Turn-level —

    /** How much effort the model should spend on the response. */
    effort?: "minimal" | "low" | "medium" | "high" | "xhigh"
    /** Model to use for this turn. */
    model?: string
    /** Fine-grained sandbox policy — `{ type: "dangerFullAccess" }` | `{ type: "readOnly", … }` | `{ type: "workspaceWrite", … }` | `{ type: "externalSandbox", … }`. See {@link SandboxPolicy}. */
    sandboxPolicy?: SandboxPolicy
    /** Controls turn summary generation. */
    summary?: "auto" | "concise" | "detailed" | "none"
    /** Stable client-side user message id used to reconcile persisted history. */
    clientUserMessageId?: string
    /**
   * Called with the session created for this exact model call. When present,
   * this takes precedence over the provider-level compatibility callback.
   */
    onSessionCreated?: (session: CodexSession) => void
    /** Approval callbacks for this call; falls back to provider-level `approvals`. */
    approvals?: {
        onCommandApproval?: CommandApprovalHandler
        onFileChangeApproval?: FileChangeApprovalHandler
        onToolUserInput?: ToolUserInputHandler
        onElicitation?: ElicitationHandler
        onPermissionsApproval?: PermissionsApprovalHandler
    }
}

export interface CodexCompactionSettings {
    /**
   * Trigger `thread/compact/start` before `turn/start` when resuming a thread.
   * Off by default.
   */
    shouldCompactOnResume?: CodexCompactionOnResumeDecision
    /**
   * When false (default), compaction errors are ignored and the turn continues.
   * When true, compaction errors fail the request.
   */
    strict?: boolean
}

export interface CodexCompactionOnResumeContext {
    threadId: string
    resumeThreadId: string
    resumeResult: CodexThreadResumeResult
    prompt: LanguageModelV3CallOptions["prompt"]
}

export type CodexCompactionOnResumeDecision =
  | boolean
  | ((context: CodexCompactionOnResumeContext) => boolean | Promise<boolean>);

export type McpServerConfig =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { type: "http"; url: string; bearerToken?: string; headers?: Record<string, string> };

/** Settings for the Codex provider, passed to `createCodexAppServer()`. */
export interface CodexProviderSettings extends CodexCustomModelProviderSettings {
    /** Model ID used when none is specified per-call (e.g. `"o4-mini"`). */
    defaultModel?: string
    /** MCP servers to make available to Codex. */
    mcpServers?: Record<string, McpServerConfig>
    /** Identifies the client application to the Codex server. */
    clientInfo?: {
        name: string
        version: string
        title?: string
    }
    /** Enable experimental / unstable API features. */
    experimentalApi?: boolean
    /** Transport layer configuration (stdio or websocket). */
    transport?: {
        type?: "stdio" | "websocket"
        stdio?: StdioTransportSettings
        websocket?: WebSocketTransportSettings
    }
    /** Defaults applied when starting a new thread (can be overridden per-call via `codexCallOptions()`). */
    defaultThreadSettings?: CodexThreadDefaults
    /** Defaults applied to every turn (can be overridden per-call via `codexCallOptions()`). */
    defaultTurnSettings?: CodexTurnDefaults
    /** Controls automatic thread compaction on resume. */
    compaction?: CodexCompactionSettings
    /** Custom factory for creating transport instances (advanced). */
    transportFactory?: (context: TransportContext) => CodexTransport
    /** Tools with schema (description + inputSchema) advertised to Codex + local handlers. */
    tools?: Record<string, DynamicToolDefinition>
    /** Legacy: handler-only tools, not advertised to Codex. Use `tools` for full schema support. */
    toolHandlers?: Record<string, DynamicToolHandler>
    /** Max time (ms) to wait for a dynamic tool call to complete. */
    toolTimeoutMs?: number
    /** Max time (ms) to wait for `turn/interrupt` response on abort. */
    interruptTimeoutMs?: number
    /** Callbacks invoked when Codex requests approval for commands, file changes, or MCP tool prompts. */
    approvals?: {
        onCommandApproval?: CommandApprovalHandler
        onFileChangeApproval?: FileChangeApprovalHandler
        /** Called when Codex requests elevated permissions. Defaults to no permissions for the current turn. */
        onPermissionsApproval?: PermissionsApprovalHandler
        /** Called when a tool sends a `requestUserInput` prompt (legacy fallback path). Defaults to auto-selecting the first option per question. */
        onToolUserInput?: ToolUserInputHandler
        /** Called when an MCP server sends an elicitation request (the primary MCP tool approval path). Defaults to `accept`. */
        onElicitation?: ElicitationHandler
    }
    /** Diagnostic logging options. */
    debug?: {
    /** Log all JSON-RPC packets exchanged with Codex. */
        logPackets?: boolean
        /** Optional packet logger (defaults to console.debug for inbound packets). */
        logger?: (packet: { direction: "inbound" | "outbound"; message: unknown }) => void
        /** Log dynamic tool registration, calls, and responses. */
        logToolCalls?: boolean
        /** Optional dynamic tool logger (defaults to console.debug). */
        toolLogger?: (event: { event: string; data?: unknown }) => void
    }
    /** Keep Codex processes alive across calls for faster subsequent turns. */
    persistent?: {
    /** Number of worker processes to keep in the pool. */
        poolSize?: number
        /** Time (ms) before an idle worker is shut down. Set to `0` to disable (worker stays alive indefinitely). */
        idleTimeoutMs?: number
        /** `"provider"` = pool per provider instance; `"global"` = shared across all instances. */
        scope?: "provider" | "global"
        /** Custom key for pool deduplication (only with `scope: "global"`). */
        key?: string
    }
    /** Emit plan updates as tool-call/tool-result parts. Default: true. */
    emitPlanUpdates?: boolean
    /**
   * Compatibility fallback called when a streaming session is created.
   * Prefer the per-call callback to associate concurrent runs precisely.
   */
    onSessionCreated?: (session: CodexSession) => void
}
