# ai-sdk-provider-codex-asp API 文档

整理日期：2026-07-02

关联文档：`codex-app-server-official-notes.md`

## 1. 定位

`@janole/ai-sdk-provider-codex-asp` 是 dasCowork 桌面聊天链路中的 AI SDK provider 适配层。它把 AI SDK v6 / `LanguageModelV3` 的 `streamText()`、`generateText()`、tool、provider options 和 stream parts 映射到 Codex App Server Protocol 的 JSON-RPC 生命周期。

本 provider 不直接调用 OpenAI-compatible API、Responses API 或第三方 LLM SDK。真正的模型请求由 `codex-app-server` 根据 thread / turn 配置发起。

主要源码：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/index.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider-settings.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/*`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/*`

dasCowork 当前集成入口：

- `desktop-app/src/main/codexAspProvider.ts`
- `desktop-app/src/main/codexChatRuntimeService.ts`
- `desktop-app/src/main/codexAppServerLaunch.ts`

## 2. 包与导出

包名：`@janole/ai-sdk-provider-codex-asp`

当前版本：`0.4.15`

运行要求：Node.js `>=20`，peer dependency 为 `ai@^6.0.0`。

主导出：

```ts
import {
  createCodexAppServer,
  createCodexProvider,
  codexAppServer,
  codexCallOptions,
  CODEX_PROVIDER_ID,
  AppServerClient,
  StdioTransport,
  WebSocketTransport,
  PersistentTransport,
  CodexWorkerPool,
  ApprovalsDispatcher,
  DynamicToolsDispatcher,
  CodexEventMapper,
  mapCodexThreadTurnsToUiMessages,
} from "@janole/ai-sdk-provider-codex-asp";
```

说明：

- `createCodexAppServer()` 是主工厂函数。
- `createCodexProvider` 是兼容旧命名的别名。
- `codexAppServer` 是默认配置创建的单例 provider。
- `CODEX_PROVIDER_ID` 固定为 `@janole/ai-sdk-provider-codex-asp`，用于 AI SDK `providerOptions` 和 `providerMetadata`。
- `src/types.ts` 与 `src/stream.ts` 是早期脚手架残留，不是当前主路径 API。

## 3. Provider API

### 3.1 创建 provider

```ts
const codex = createCodexAppServer({
  defaultModel: "gpt-5.5",
  clientInfo: {
    name: "dascowork_desktop",
    title: "dasCowork Desktop",
    version: "1.0.0",
  },
  experimentalApi: true,
  transport: {
    type: "stdio",
    stdio: {
      command: "/path/to/codex-app-server",
      args: ["--listen", "stdio://"],
      cwd: "/path/to/codex/codex-rs",
      env: process.env,
    },
  },
});
```

### 3.2 Provider 对象

`createCodexAppServer()` 返回的 provider 同时是函数和对象：

```ts
const modelA = codex("gpt-5.5");
const modelB = codex.chat("gpt-5.5");
const modelC = codex.languageModel("gpt-5.5");

const models = await codex.listModels();
await codex.shutdown();
```

接口行为：

- `codex(modelId, settings?)`：返回 `CodexLanguageModel`。
- `chat(modelId, settings?)`：返回 `CodexLanguageModel`。
- `languageModel(modelId)`：返回 `CodexLanguageModel`。
- `listModels(params?)`：连接 app-server，执行 `initialize` / `initialized`，分页调用 `model/list`。
- `shutdown()`：关闭 persistent worker pool；非 persistent 模式下为空操作。
- `embeddingModel()` / `imageModel()`：显式抛 `NoSuchModelError`。

## 4. Provider 配置

主配置类型是 `CodexProviderSettings`。

### 4.1 顶层配置

```ts
type CodexProviderSettings = {
  defaultModel?: string;
  modelProvider?: string;
  customModelProviders?: Record<string, CodexModelProviderInfo>;
  mcpServers?: Record<string, McpServerConfig>;
  clientInfo?: { name: string; version: string; title?: string };
  experimentalApi?: boolean;
  transport?: {
    type?: "stdio" | "websocket";
    stdio?: StdioTransportSettings;
    websocket?: WebSocketTransportSettings;
  };
  transportFactory?: (context: TransportContext) => CodexTransport;
  defaultThreadSettings?: CodexThreadDefaults;
  defaultTurnSettings?: CodexTurnDefaults;
  compaction?: CodexCompactionSettings;
  tools?: Record<string, DynamicToolDefinition>;
  toolHandlers?: Record<string, DynamicToolHandler>;
  toolTimeoutMs?: number;
  interruptTimeoutMs?: number;
  approvals?: CodexApprovalCallbacks;
  debug?: CodexDebugSettings;
  persistent?: CodexPersistentSettings;
  emitPlanUpdates?: boolean;
  onSessionCreated?: (session: CodexSession) => void;
};
```

默认值：

- 未指定 transport 时使用 `StdioTransport`。
- stdio 默认命令是 `codex app-server --listen stdio://`。
- websocket 默认 URL 是 `ws://localhost:3000`。
- `toolTimeoutMs` 默认 `30_000`。
- `interruptTimeoutMs` 默认 `10_000`。
- `emitPlanUpdates` 默认 `true`。
- persistent 默认关闭；开启后默认 `scope: "provider"`、`poolSize: 1`、`idleTimeoutMs: 300_000`。

### 4.2 Thread 默认值

```ts
type CodexThreadDefaults = {
  cwd?: string;
  runtimeWorkspaceRoots?: string[];
  approvalPolicy?: AskForApproval;
  approvalsReviewer?: ApprovalsReviewer;
  sandbox?: SandboxMode;
  ephemeral?: boolean;
};
```

这些值用于 `thread/start`，也会在 resume 时用于 `thread/resume` 的对应覆盖字段。

### 4.3 Turn 默认值

```ts
type CodexTurnDefaults = {
  cwd?: string;
  runtimeWorkspaceRoots?: string[];
  approvalPolicy?: AskForApproval;
  approvalsReviewer?: ApprovalsReviewer;
  sandboxPolicy?: SandboxPolicy;
  model?: string;
  effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  summary?: "auto" | "concise" | "detailed" | "none";
};
```

这些值用于 `turn/start`，可被 per-call `codexCallOptions()` 覆盖。

### 4.4 Custom model provider

```ts
type CodexModelProviderInfo = {
  name?: string;
  base_url?: string;
  env_key?: string;
  env_key_instructions?: string;
  experimental_bearer_token?: string;
  wire_api?: "responses";
  query_params?: Record<string, string>;
  http_headers?: Record<string, string>;
  env_http_headers?: Record<string, string>;
  request_max_retries?: number;
  stream_max_retries?: number;
  stream_idle_timeout_ms?: number;
  websocket_connect_timeout_ms?: number;
  requires_openai_auth?: boolean;
  supports_websockets?: boolean;
};
```

provider 会把 `modelProvider` 与 `customModelProviders` 转成 app-server thread config：

```json
{
  "model_provider": "my_provider",
  "model_providers": {
    "my_provider": {
      "name": "my_provider",
      "base_url": "https://example.test/v1",
      "experimental_bearer_token": "...",
      "wire_api": "responses",
      "requires_openai_auth": false
    }
  }
}
```

dasCowork 当前从 admin backend model 生成该配置：

- `modelProvider = clientModel.provider`
- `base_url = clientModel.api_base_url`
- `wire_api = "responses"`
- `requires_openai_auth = false`
- `supports_websockets = false`
- `experimental_bearer_token = clientModel.api_key`，仅在 main process / provider / app-server 边界内流动

## 5. Per-call API

### 5.1 `codexCallOptions()`

`codexCallOptions()` 把 Codex 专属参数包装进 AI SDK `providerOptions`：

```ts
const result = streamText({
  model: codex.chat(modelId),
  messages,
  providerOptions: codexCallOptions({
    resumeThreadId: "thread_123",
    cwd: "/absolute/project",
    runtimeWorkspaceRoots: ["/absolute/project"],
    model: modelId,
    effort: "high",
    summary: "auto",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxPolicy: { type: "workspaceWrite" },
  }),
});
```

展开后形态：

```ts
{
  [CODEX_PROVIDER_ID]: {
    resumeThreadId?: string;
    cwd?: string;
    runtimeWorkspaceRoots?: string[];
    approvalPolicy?: AskForApproval;
    approvalsReviewer?: ApprovalsReviewer;
    sandbox?: SandboxMode;
    ephemeral?: boolean;
    effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
    model?: string;
    sandboxPolicy?: SandboxPolicy;
    summary?: "auto" | "concise" | "detailed" | "none";
    approvals?: CodexApprovalCallbacks;
  }
}
```

优先级：

1. per-call `codexCallOptions()`
2. provider `defaultThreadSettings` / `defaultTurnSettings`
3. app-server 默认配置

### 5.2 Thread continuation

provider 支持两种恢复 thread 的方式：

1. 显式传 `codexCallOptions({ resumeThreadId })`。
2. 从前一次 assistant message 或 content part 的 `providerOptions[CODEX_PROVIDER_ID].threadId` 中反推。

stream 输出会在 `providerMetadata[CODEX_PROVIDER_ID]` 放入：

```ts
{
  threadId?: string;
  turnId?: string;
  threadPath?: string;
}
```

dasCowork 主进程用这个 metadata 提取 `threadId` / `turnId`，同步 conversation 状态。

## 6. JSON-RPC 生命周期

### 6.1 常规 `streamText()` / `generateText()`

正常新 thread 的 RPC 顺序：

```text
connect transport
request      initialize
notification initialized
request      thread/start
request      turn/start
notifications turn/*, item/*, thread/*
notification turn/completed
disconnect transport
```

恢复已有 thread 的 RPC 顺序：

```text
connect transport
request      initialize
notification initialized
request      thread/resume
optional     thread/compact/start
request      turn/start
notifications turn/*, item/*, thread/*
notification turn/completed
disconnect transport
```

开启 persistent pool 时，同一个 worker 上后续调用会复用 `initialize` 结果，不再真实发送第二次 `initialize` / `initialized`。

### 6.2 `initialize`

请求：

```json
{
  "id": 1,
  "method": "initialize",
  "params": {
    "clientInfo": {
      "name": "dascowork_desktop",
      "title": "dasCowork Desktop",
      "version": "1.0.0"
    },
    "capabilities": {
      "experimentalApi": true
    }
  }
}
```

规则：

- `clientInfo` 来自 provider settings；未提供时使用 package name/version。
- 当 `experimentalApi: true` 或存在动态工具时，provider 会发送 `capabilities.experimentalApi = true`。
- provider 随后发送 `initialized` notification。

### 6.3 `thread/start`

provider 当前会构造：

```ts
{
  model,
  modelProvider,
  dynamicTools,
  developerInstructions,
  config,
  cwd,
  runtimeWorkspaceRoots,
  approvalPolicy,
  approvalsReviewer,
  sandbox,
  ephemeral,
}
```

来源：

- `model`：语言模型实例的 `modelId`，fallback 到 provider `defaultModel`。
- `modelProvider` / `config`：由 custom model provider 与 MCP 配置合并。
- `dynamicTools`：provider-level tools 与 AI SDK tools 的 schema。
- `developerInstructions`：AI SDK system messages 合并后生成。
- `cwd` / `runtimeWorkspaceRoots` / `approvalPolicy` / `approvalsReviewer` / `sandbox` / `ephemeral`：per-call 覆盖或 thread 默认值。

兼容性提示：

- 当前 provider 会把 `runtimeWorkspaceRoots` 也放到 `thread/start`。仓库内 official schema 的 `ThreadStartParams` 未列出该字段；对接目标 app-server 版本时需要确认是否接受。
- official schema 的 `ThreadStartParams` 还包含 `serviceName`、`baseInstructions`、`personality`、`sessionStartSource`、`threadSource` 等字段；provider 当前没有公开对应 settings。

### 6.4 `thread/resume`

provider 当前会构造：

```ts
{
  threadId,
  developerInstructions,
  modelProvider,
  config,
  cwd,
  runtimeWorkspaceRoots,
  approvalPolicy,
  approvalsReviewer,
  sandbox,
  model,
}
```

`thread/resume` response 中的 `thread.id` 是后续 `turn/start.threadId` 的来源。provider 也会读取 `thread.path`，写入 stream-start 的 `providerMetadata.threadPath`。

### 6.5 `thread/compact/start`

仅在 resume 后、`turn/start` 前触发。

配置：

```ts
compaction: {
  shouldCompactOnResume?: boolean | ((ctx) => boolean | Promise<boolean>);
  strict?: boolean;
}
```

行为：

- `shouldCompactOnResume` 为 true 或回调返回 true 时发送 `{ threadId }`。
- `strict: false` 或未设置时，压缩失败只记录 debug，不阻断本 turn。
- `strict: true` 时，压缩失败会让本次 AI SDK 调用失败。

### 6.6 `turn/start`

provider 当前会构造：

```ts
{
  threadId,
  input,
  cwd,
  runtimeWorkspaceRoots,
  approvalPolicy,
  approvalsReviewer,
  sandboxPolicy,
  model,
  effort,
  summary,
  outputSchema,
}
```

规则：

- `input` 由 AI SDK prompt 映射生成。
- `outputSchema` 来自 AI SDK `responseFormat.type === "json"` 时的 schema。
- `cwd`、`runtimeWorkspaceRoots`、`approvalPolicy`、`approvalsReviewer` 等 per-call 值会覆盖 provider 默认值。

### 6.7 Abort / cancel

当 AI SDK `abortSignal` 触发或 stream consumer cancel：

```json
{
  "method": "turn/interrupt",
  "params": {
    "threadId": "...",
    "turnId": "..."
  }
}
```

provider 会先关闭 consumer-facing stream，让 UI 尽快收到 abort，再后台等待 `turn/interrupt` 或超时并释放 worker。

## 7. Prompt 映射

### 7.1 System messages

所有 AI SDK system message 会 trim 后用空行拼接，作为 `thread/start` 或 `thread/resume` 的 `developerInstructions`。

### 7.2 User content -> `turn/start.input`

Codex App Server `UserInput` 形态：

```ts
type UserInput =
  | { type: "text"; text: string; text_elements: TextElement[] }
  | { type: "image"; url: string; detail?: ImageDetail }
  | { type: "localImage"; path: string; detail?: ImageDetail }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };
```

provider 当前映射规则：

- fresh thread：累积所有 user message 中的文本；遇到图片前 flush 文本，以保留图文顺序。
- resumed thread：只取最后一条 user message。
- text part：trim 后变为 `{ type: "text", text, text_elements: [] }`。
- text file：inline data 解码成 text；URL text file 不 fetch，只把 URL 字符串作为 text。
- image file URL：
  - `file:` URL -> `{ type: "localImage", path }`
  - `http(s):` URL -> `{ type: "image", url }`
- inline image data：先写入临时文件，再映射为 `localImage`；turn 结束后 best-effort 清理。
- 非 text / image 文件会被跳过。

## 8. Stream event 映射

provider 通过 `CodexEventMapper` 把 app-server notifications 映射为 AI SDK `LanguageModelV3StreamPart`。

| App Server 通知 | AI SDK stream part |
| --- | --- |
| `turn/started` | 确保发送 `stream-start`，记录 `turnId` |
| `item/started` + `agentMessage` | `text-start` |
| `item/agentMessage/delta` | `text-delta` |
| `item/completed` + `agentMessage` | 必要时补 `text-delta`，然后 `text-end` |
| `item/reasoning/textDelta` | `reasoning-start` / `reasoning-delta` |
| `item/reasoning/summaryTextDelta` | `reasoning-start` / `reasoning-delta` |
| `item/reasoning/summaryPartAdded` | `reasoning-delta`，内容为空行 |
| `item/plan/delta` | `reasoning-start` / `reasoning-delta` |
| `turn/plan/updated` | provider-executed `codex_plan_update` tool-call/tool-result |
| `item/started` + `commandExecution` | provider-executed `codex_command_execution` tool-call |
| `item/started` + `fileChange` | provider-executed `codex_file_change` tool-call |
| `item/started` + `mcpToolCall` | provider-executed `mcp:<server>/<tool>` tool-call |
| `item/started` + `collabAgentToolCall` | provider-executed `codex_collab_agent` tool-call |
| `item/completed` for tracked native tool item | matching `tool-result` |
| `item/mcpToolCall/progress` | preliminary `tool-result` with status message |
| `item/tool/callStarted` | `tool-input-start` |
| `item/tool/callDelta` | `tool-input-delta` |
| `item/tool/callFinished` | `tool-input-end` |
| `item/tool/call` 被路由进 mapper 时 | dynamic tool-call；主链路的 server request 由 tool dispatcher / cross-call handler 处理 |
| `thread/tokenUsage/updated` | cache latest usage for final `finish` |
| `item/completed` + `imageGeneration` | `file` part, `mediaType: "image/png"` |
| `turn/completed` | close open text/reasoning/tool parts, emit `finish` |

Finish reason mapping：

- `completed` -> `{ unified: "stop", raw: "completed" }`
- `failed` -> `{ unified: "error", raw: "failed" }`
- `interrupted` -> `{ unified: "other", raw: "interrupted" }`
- unknown -> `{ unified: "other" }`

故意忽略的通知：

- `codex/event/agent_reasoning`
- `codex/event/agent_reasoning_section_break`
- `codex/event/plan_update`
- `codex/event/web_search_begin`
- `codex/event/web_search_end`
- `codex/event/mcp_tool_call_begin`
- `codex/event/mcp_tool_call_end`
- `item/commandExecution/outputDelta`
- `item/fileChange/outputDelta`
- `turn/diff/updated`
- `codex/event/turn_diff`

原因：这些要么有 canonical item/turn 通知替代，要么体积较大，不适合直接塞进通用 stream part。

## 9. Dynamic Tools

provider 支持两类工具：

1. Provider-level tools：`CodexProviderSettings.tools`
2. AI SDK call-level tools：`streamText({ tools })`

### 9.1 Provider-level tools

```ts
const codex = createCodexAppServer({
  experimentalApi: true,
  tools: {
    lookup_ticket: {
      description: "Look up a support ticket.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      execute: async (args, context) => ({
        success: true,
        contentItems: [{ type: "inputText", text: "Ticket is open." }],
      }),
    },
  },
});
```

provider 会：

- 在 `thread/start.dynamicTools` 中广告 schema。
- 通过 `DynamicToolsDispatcher` 监听 app-server server request `item/tool/call`。
- 把 `params.arguments ?? params.input` 传给 handler。
- 返回 `CodexToolCallResult`。

结果形态：

```ts
type CodexToolCallResult = {
  success: boolean;
  contentItems: Array<
    | { type: "inputText"; text: string }
    | { type: "inputImage"; imageUrl: string }
  >;
};
```

### 9.2 AI SDK tools 与 cross-call

AI SDK `tools` 会被转换成 `dynamicTools` schema。若 app-server 请求 `item/tool/call`：

- provider 向 AI SDK stream 发 `tool-call`。
- provider 用 `finishReason: "tool-calls"` 结束当前 step。
- tool result 会在下一次 AI SDK step 的 prompt 里出现。
- persistent transport 按 `threadId` 找回同一个 worker，把 tool result 回写给 app-server。

因此：标准 AI SDK tool 流程要求开启 persistent transport，否则无法可靠跨 step 续接同一个 app-server worker。

### 9.3 Legacy `toolHandlers`

`toolHandlers` 只注册 handler，不会把 schema 广告给 Codex。新代码优先使用 `tools`。

## 10. Approvals / Elicitation

provider 通过 `ApprovalsDispatcher` 处理 app-server 发起的 JSON-RPC server request。

| App Server request | provider callback | 默认行为 |
| --- | --- | --- |
| `item/commandExecution/requestApproval` | `approvals.onCommandApproval` | `decline` |
| `item/fileChange/requestApproval` | `approvals.onFileChangeApproval` | `decline` |
| `item/tool/requestUserInput` | `approvals.onToolUserInput` | 每个问题选第一个 option |
| `item/permissions/requestApproval` | 无公开 callback | `{ permissions: {}, scope: "turn" }` |
| `mcpServer/elicitation/request` | `approvals.onElicitation` | `{ action: "accept", content: null, _meta: null }` |

Command approval handler 返回：

```ts
type CommandApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel"
  | "acceptWithExecpolicyAmendment";
```

File change approval handler 返回：

```ts
type FileChangeApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";
```

dasCowork 当前把这些 callback 转发到 `CodexApprovalBroker`，再由 renderer 审批面板回答。

注意：

- command / file 默认拒绝较安全。
- MCP elicitation 默认接受，集成 UI 应显式提供 `onElicitation`，避免副作用 tool 静默放行。
- `item/permissions/requestApproval` 当前没有 provider-level callback；如果后续 official app-server 对该 request 语义增强，需要补 adapter。

## 11. Session API

`onSessionCreated` 可以拿到本轮 active session：

```ts
type CodexSession = {
  readonly threadId: string;
  readonly turnId: string | undefined;
  isActive(): boolean;
  injectMessage(input: string | UserInput[]): Promise<void>;
  interrupt(): Promise<void>;
};
```

行为：

- `injectMessage()` 当前发送 `turn/start`，由 app-server 在 active turn 下路由成 steer input；没有直接使用 `turn/steer`。
- `interrupt()` 发送 `turn/interrupt`，需要已有 `turnId`。
- stream 完成、错误、abort 后 session 会标记 inactive。

## 12. Transport API

### 12.1 `CodexTransport`

```ts
type CodexTransport = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(message: JsonRpcMessage): Promise<void>;
  sendNotification(method: string, params?: unknown): Promise<void>;
  on(event, listener): () => void;
};
```

JSON-RPC message 不包含 `jsonrpc: "2.0"` 字段。

### 12.2 `StdioTransport`

配置：

```ts
type StdioTransportSettings = {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};
```

默认：

```text
command = "codex"
args = ["app-server", "--listen", "stdio://"]
```

传输规则：

- 每条 outbound JSON-RPC message 以 `JSON.stringify(message) + "\n"` 写入 stdin。
- stdout 按行解析 JSON。
- stderr 只缓存最近 64 KiB，用于进程非 0 退出时报错。

### 12.3 `WebSocketTransport`

配置：

```ts
type WebSocketTransportSettings = {
  url?: string;
  headers?: Record<string, string>;
};
```

默认 URL：`ws://localhost:3000`

传输规则：

- outbound message 直接 `socket.send(JSON.stringify(message))`。
- inbound 只处理 string message。
- 依赖 runtime 提供 `globalThis.WebSocket`。

### 12.4 Persistent transport

开启：

```ts
const codex = createCodexAppServer({
  persistent: {
    scope: "provider",
    poolSize: 1,
    idleTimeoutMs: 300_000,
  },
});
```

能力：

- 池化 app-server worker，减少每次启动进程成本。
- 缓存 initialize result；同一 worker 后续调用不重复真实 initialize。
- 保留 pending `item/tool/call`，支撑 AI SDK tools 跨 step 返回结果。
- worker acquisition 会优先按 pending tool call 的 `threadId` 做 affinity。

scope：

- `provider`：每个 provider 实例独占 pool。
- `global`：同 key 共享 pool；不同 `poolSize` / `idleTimeoutMs` 会报错。

## 13. Thread History Mapper

`mapCodexThreadTurnsToUiMessages()` 把 app-server `Turn[]` 转成 AI SDK UI messages，用于历史会话回放。

输入：

```ts
type CodexThreadHistoryMappingInput = {
  threadId?: string;
  threadPath?: string | null;
  turns: Turn[];
};
```

主要映射：

- `userMessage` -> `role: "user"`，支持 text/image/localImage/skill/mention。
- `agentMessage` -> text UI part。
- `reasoning` / `plan` -> reasoning UI part。
- `commandExecution` -> dynamic-tool `codex_command_execution`。
- `fileChange` -> dynamic-tool `codex_file_change`。
- `mcpToolCall` -> dynamic-tool `mcp:<server>/<tool>`。
- `dynamicToolCall` -> dynamic-tool `<tool>`。
- `collabAgentToolCall` -> dynamic-tool `codex_collab_agent`。
- `webSearch` -> dynamic-tool `codex_web_search`。
- `imageGeneration` -> file part，`mediaType: "image/png"`。

## 14. dasCowork 当前配置

`desktop-app/src/main/codexAspProvider.ts` 当前设置：

```ts
{
  clientInfo: {
    name: "dascowork_desktop",
    title: "dasCowork Desktop",
    version: "1.0.0",
  },
  experimentalApi: true,
  transport: {
    type: "stdio",
    stdio: {
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      env: sanitizedEnv,
    },
  },
  defaultThreadSettings: {
    cwd,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
  },
  defaultTurnSettings: {
    cwd,
    summary: "auto",
  },
  persistent: {
    scope: "provider",
    poolSize: 1,
    idleTimeoutMs: 300_000,
  },
  toolTimeoutMs: 120_000,
  interruptTimeoutMs: 10_000,
}
```

launch 解析顺序：

1. `CODEX_APP_SERVER_BIN`
2. packaged resources 下的 `codex-app-server`
3. dev `.bundle-resources`
4. `cargo run --quiet -p codex-app-server --bin codex-app-server -- --listen stdio://`

环境处理：

- 过滤 `CODEX_CI`、`CODEX_THREAD_ID`、`CODEX_INTERNAL_ORIGINATOR_OVERRIDE`。
- 自动把 `localhost`、`127.0.0.1`、`::1` 加入 `NO_PROXY` / `no_proxy`。
- debug packet logger 会递归 redacts `authorization`、`api_key`、`experimental_bearer_token`、`token`、`secret` 等字段。

聊天调用：

```ts
const providerOptions = codexCallOptions({
  model: modelId,
  summary: "auto",
  resumeThreadId: request.body?.threadId,
  cwd: executionTarget?.cwd,
  runtimeWorkspaceRoots: executionTarget?.runtimeWorkspaceRoots,
});

return streamText({
  model: provider.chat(modelId, customModelSettings),
  messages: modelMessages,
  system,
  abortSignal,
  providerOptions,
});
```

## 15. 对接 official app-server notes 的注意事项

1. provider 是 official app-server API 的子集 adapter，不是完整 app-server SDK。
2. provider 当前主路径只覆盖 chat language model、model/list、thread start/resume/compact、turn start/interrupt、动态工具、审批和通知映射。
3. official notes 中的 `thread/read`、`thread/list`、`thread/fork`、`review/start`、`command/exec`、`fs/*`、`account/*`、`skills/*`、`plugin/*` 等 API 不由 `CodexLanguageModel` 暴露；如 UI 需要这些能力，应直接用 `AppServerClient` 或新增 provider-facing helper。
4. provider 使用 hand-maintained protocol subset + 部分 generated types。升级 app-server 后应运行 provider 的 `npm run codex:generate-types`，再检查 runtime mapper 和测试。
5. `dynamicTools`、`process/*`、部分 provider capability 属于 experimental API；provider 会在有工具或显式配置时发送 `capabilities.experimentalApi = true`。
6. standard AI SDK tools 的跨 step 工作流依赖 persistent transport；桌面当前已开启 poolSize 1。
7. `thread/start` 的 `runtimeWorkspaceRoots` 字段需要按目标 app-server schema 复核。
8. app-server official response shape 常见为 `{ thread: { id } }`、`{ turn: { id } }`；provider 也兼容旧的 `{ threadId }`、`{ turnId }`。
9. MCP elicitation 默认接受，dasCowork 已接入审批 broker；后续新增入口时不要遗漏 `onElicitation`。
10. sensitive model provider fields 只能停留在 main process / provider / app-server 边界内，不应进入 renderer。

## 16. 验证命令

provider 层：

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test
```

desktop 层：

```bash
npm --prefix desktop-app run lint
npm --prefix desktop-app test
```

聊天链路 / 模型供应商：

```bash
npm --prefix desktop-app run test:e2e -- --reporter=line
```

## 17. 证据索引

- Provider 导出：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/index.ts`
- Provider 工厂与 `listModels()`：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider.ts`
- 主要 settings / call options：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider-settings.ts`
- AI SDK model + RPC 生命周期：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts`
- JSON-RPC client：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-client.ts`
- transport contract：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/transport.ts`
- stdio transport：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/transport-stdio.ts`
- websocket transport：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/transport-websocket.ts`
- persistent transport / worker pool：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/transport-persistent.ts`、`worker.ts`、`worker-pool.ts`
- prompt 映射：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/utils/prompt-file-resolver.ts`
- event mapper：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts`
- provider metadata：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/provider-metadata.ts`
- approvals：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/approvals.ts`
- dynamic tools：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/dynamic-tools.ts`
- session API：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/session.ts`
- history mapper：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/thread-history-mapper.ts`
- dasCowork provider settings：`desktop-app/src/main/codexAspProvider.ts`
- dasCowork chat runtime：`desktop-app/src/main/codexChatRuntimeService.ts`
- app-server launch：`desktop-app/src/main/codexAppServerLaunch.ts`
- official notes：`codex-app-server-official-notes.md`
