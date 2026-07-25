# P0-02 活跃任务重连与本地恢复开发计划

## 1. 目标与结论

P0-02 的目标不是增加一个“重试”按钮，而是让同一次 Codex 运行在 renderer 刷新、页面切换、短暂断连后仍由 main process 持有，并让新页面能够重新订阅这次运行；如果底层运行已经不可续接，则必须恢复已落盘历史、明确标记中断原因，并且绝不静默重放用户输入或工具调用。

当前清单存在遗漏，也有一项未声明的前置依赖：

- 清单已覆盖刷新重连、失败原因、单轮渲染重试、thread resume 诊断、worktree 恢复和重复事件测试，但没有定义“同一次运行”的身份、事件断点、补发顺序、过期订阅和显式停止语义（`docs/codex-electron-conversation-gap-checklist.md:77-99`）。
- 当前 IPC 只有 `startChatStream()` 和 `abortChatStream()`，事件没有 `runId`、事件序号或恢复游标，因此只补上 `reconnectToStream()` 仍无法安全续接（`desktop-app/src/shared/codexIpcApi.ts:118-148`, `desktop-app/src/shared/codexIpcApi.ts:335-338`）。
- 当前 preload 在页面流关闭时直接删除本地 `MessagePort`，main 又只向最初的 port 推送输出；这正是刷新后无法接回的根因（`desktop-app/src/preload/chatStreamBridge.ts:19-78`, `desktop-app/src/main/codexChatRuntimeService.ts:231-449`）。
- `ConversationChatRegistry.destroy()` 会对所有 submitted/streaming 会话调用 `chat.stop()`；AI SDK 的可恢复流约定要求页面断开只关闭订阅，真正停止必须走独立的运行取消命令（`desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:328-338`, `desktop-app/node_modules/ai/docs/04-ai-sdk-ui/03-chatbot-resume-streams.mdx:255-265`）。
- 当前项目只保存 local、remote、projectless 等项目选择，没有“由应用管理的 worktree、分支、提交点、恢复路径”等快照元数据，所以无法兑现“Restore worktree”；这部分必须与 P0-03 的工作区生命周期先建立共同数据契约（`desktop-app/src/shared/projects/projectTypes.ts:1-38`, `desktop-app/src/main/projects/ProjectService.ts:238-317`）。

本计划按两个交付阶段实施：

1. **P0-02A：运行续接与诚实恢复**——完成 run 身份、事件补发、renderer 重连、失败诊断、待审批恢复和单轮渲染恢复。
2. **P0-02B：工作区恢复**——在 P0-03 提供 managed-worktree 元数据后，完成状态检查、恢复、失败降级和“新建本地任务继续”的入口。

### 2026-07-25 现状复核

结论：**P0-02A 已完成并验收：页面销毁不取消底层 turn、main-owned 基础消息快照与事件回放、待审批快照恢复、局部渲染重试，以及 thread 未绑定、已绑定含文本与工具、detach 期间 completed/failed/aborted/interrupted 的 E2E 回放均已通过。provider/main 现已接入专用 existing-turn recovery：仅 App Server transport 断开且 server 仍持有同一 active turn 时，`thread/resume` 读取权威快照、合并后续事件且不发送第二个 `turn/start`；若 child 重启且没有该 turn，保留历史并以 interrupted 收敛。P0-02B 已补齐 managed-worktree 契约、main-only 恢复服务、IPC、会话横幅和状态矩阵 E2E；但 P0-03 尚未产生可信的 managed-worktree 元数据，不能形成真实用户可达的 worktree 恢复闭环。因此 P0-02 总项仍保持 partial，不能验收 complete。**

| 验收项                                              | 当前判断         | 证据与缺口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer 刷新或短断线后重新连接仍在运行的任务       | 部分实现         | main 以 conversation/thread alias 保存活跃 run、有界事件日志和本轮开始的基础 UI messages；`codex-chat:get-active-snapshot` 让 thread 未绑定的新 renderer 先还原原始用户消息，再通过 `codex-chat:attach` 从 sequence 0 回放。`ElectronIpcChatTransport.reconnectToStream()` 和 C22 已接通刷新恢复。端口事件现使用 `runId + sequence + event` envelope，main 拒绝旧 runId 的 attach、按 `afterSequence` 回放；preload 会去重、拒绝序号缺口，并在 20,000 事件或 8 MiB journal 溢出时明确进入 resync-required。MessagePort 短断开会以最后已确认序号自动附加一次；旧 port 的迟到事件已由 preload 单测拦截，但尚未有真实浏览器断线夹具。                                                                                                                                    |
| 无法恢复时显示原因且不误报完成                      | 部分实现         | reconnect 失败现在按 transient-runtime、configuration、conversation-missing、workspace、authorization、unknown 显示脱敏动作；当前可见会话对短暂失败自动重试一次。main 现保留 terminal journal 5 分钟并允许只读重放；failed terminal 会保留已回放内容并落到 error，aborted terminal 即使缺少 lifecycle companion 也会结算为 interrupted。P002-E2E-06B 已验证 child 重启后没有 active turn 时保留历史并显示 interrupted，且不 replay。                                                                                                                                                                                                                                                                                                                                            |
| 单条回复渲染失败时局部重试                          | 已完成           | `ConversationTurnErrorBoundary` 仅重置发生异常的 render unit；其组件和 P002-E2E-09 浏览器测试确认重试不调用聊天 transport 或创建新 turn。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| thread resume 失败诊断                              | 部分实现         | renderer 已按 configuration、conversation-missing、transient-runtime、workspace、authorization、unknown 分类，并提供脱敏状态文案和一次短暂故障自动重试；provider 的 `resumeActiveTurn` 会在 snapshot 没有同一 active turn 时拒绝恢复，main 将其收敛为 interrupted，且不自动 replay 输入。P002-E2E-06B 已覆盖该路径。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| worktree 恢复、重试或本地继续                       | 部分实现         | `ManagedWorktreeMetadata` 保存应用管理标记、仓库根、worktree 路径、分支/ref、创建来源与恢复标志；`WorkspaceRecoveryService` 只以 main 保存的元数据检查和执行 `git worktree add`，并在恢复后重新校验仓库/分支。UI 严格区分 `checking-failed`、`restorable`、`gone`、`restore-failed`、remote/projectless；缺元数据绝不显示 Restore。P002-E2E-10 已执行状态矩阵；仍缺 P0-03 写入 metadata 的创建流程，故尚无用户可达的真实恢复闭环。 |
| 页面销毁不无条件终止后台任务                        | 已完成           | preload beforeunload 只 detach；`desktop-app/src/main/codexChatRuntimeService.ts` 不 interrupt；`desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts` 销毁时不再 stop。Stop 控制消息携带 runId，main 仅接受匹配 run 的取消；重新附加端口也注册该校验。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 刷新、重连、app-server 重启、恢复失败、重复事件 E2E | 已完成（P0-02A） | P002-E2E-01 至 P002-E2E-09、C22/C23 均已执行通过；P002-E2E-10 的状态矩阵也已通过。专项 13 项 Electron/Playwright 用例单次通过，并以 `--repeat-each=3` 完成 39 项稳定性回归。P002-E2E-06A/B 以持久 child + 可重启 stdio proxy 分别验证同 turn reattach 与 child 重启 interrupted；P002-E2E-07 验证未知 IPC 恢复故障的安全脱敏、保留已渲染内容及明确的不可自动恢复状态。 |

现有 `desktop-app/tests/e2e/fault-injection.e2e.ts` 的 C22/C23 必须保留为回归基线，但不能单独作为 P0-02 完成证据：

- **C22**：reload 关闭 MessagePort 后，main 继续持有 canonical turn；新 renderer 读取历史并附加原 run，在终态 gate 仍关闭时收到后续 live delta，且 provider 请求保持为 1。它仍未覆盖乱序/缺序、重复 attach 或审批恢复。
- **C23**：app-server 进程退出后显示失败，用户点击重试会创建新 turn。它没有恢复旧 active turn，且测试明确期待 provider 请求和 `turn/started` 从 1 增加到 2。

### existing-turn recovery 能力核验（2026-07-25）

- app-server 的公开 `thread/resume` 对仍在运行的 thread 会重入同一线程、自动建立 listener，并把内存中的 active turn 合并进 `ThreadResumeResponse.thread.turns`；同时也支持 `initialTurnsPage` 获取该快照。证据在 `codex/codex-rs/app-server/src/request_processors/thread_processor.rs:2603-3130`、`codex/codex-rs/app-server/src/request_processors/thread_lifecycle.rs:530-665` 和 `codex/codex-rs/app-server-protocol/src/protocol/v2/thread.rs:319-433`。
- 普通 provider continuation 在 `thread/resume` 后仍会执行 `turn/start`，因此不能用于 existing-turn recovery；现在新增 `resumeActiveTurn` 专用分支，只发送 `thread/resume`，从 response 中定位同一 `inProgress` turn，并先合并 snapshot 再释放缓冲事件（`desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts`）。
- 因此 P002-E2E-06 必须拆成两个结果：**仅 provider transport 失效、app-server 仍存活**时恢复同一 turn（`turn/start` 计数不增加）；**app-server 已重启且 active turn 不存在**时只读取权威持久历史并标记 interrupted，绝不重放 prompt、审批答案或工具调用。

禁止修改 `codex/codex-rs/app-server/`，也不在桌面聊天链路中绕过 app-server。实现范围限定在 shared、main、preload、renderer 和 provider fork；provider 只增加“恢复既有 turn 的快照/事件”能力，不建立第二套模型客户端，也不能用普通 `streamText()` continuation 冒充 reattach。

## 2. 参考项目对齐范围

按 `reference-projects/codex-electron-26.707.72221-beautified` 的逻辑和交互对齐，但不复制其构建产物代码：

- 参考项目在 webContents 销毁时只清理该窗口的监听和响应路由，不中断 turn；app-server notification 仍由 main 广播给存活窗口。这一生命周期边界是本计划“main 持有运行、renderer 只订阅”的直接依据（`reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:36331-36343`, `reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:39111-39250`）。
- 每一轮消息独立包裹错误边界；失败时显示 “This turn couldn’t render” 和 “Try again”，按钮只重置该轮 React 渲染，不重新发送消息（`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/local-conversation-thread-TggZ39FG.js:13242-13257`, `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/local-conversation-thread-TggZ39FG.js:13296-13338`）。
- 在输入框上方使用 `role="status"`、`aria-live="polite"` 显示 “Loading task…” 或 “Reconnecting…”；它是瞬时连接状态，不伪装成一条聊天消息（`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/local-conversation-thread-TggZ39FG.js:14382-14415`, `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/local-conversation-thread-TggZ39FG.js:15875-15974`）。
- thread 恢复只对可判定的短暂故障自动重试；配置错误和找不到 rollout 等永久问题直接给可操作诊断，并避免重复弹出同一错误（`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/local-conversation-thread-TggZ39FG.js:14534-14684`）。
- 恢复遵循 `needs_resume → resuming → resumed`，失败退回 `needs_resume`；先建立 live subscription，再读取 app-server 权威 thread 快照，避免订阅与读取之间漏事件（`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/local-conversation-thread-TggZ39FG.js:14548-14569`, `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~artifact-tab-content.electron~app-main~new-thread-panel-page~onboarding-page~pr~hoz4f1hh-Cy_DxrPd.js:49238-49777`）。
- 快照恢复期间缓存 notification/server request；快照落地后以 completed item 为准、裁掉快照已有的文本前缀，再按原顺序释放缺少的事件（`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~artifact-tab-content.electron~app-main~new-thread-panel-page~onboarding-page~pr~hoz4f1hh-Cy_DxrPd.js:48714-48824`, `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~artifact-tab-content.electron~app-main~new-thread-panel-page~onboarding-page~pr~hoz4f1hh-Cy_DxrPd.js:51980-51994`）。
- worktree UI 区分状态检查失败、可恢复、永久丢失和恢复失败；检查失败提供 Retry，可恢复提供 Restore worktree（`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/local-conversation-thread-TggZ39FG.js:12442-12654`）。
- 流错误显示重连次数、错误类别和可展开详情；本项目沿用该信息层次，但只展示经过 main 归一化和脱敏的诊断（`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:59354-59590`）。

不照搬参考项目的多窗口 owner/follower、完整 remote-host 编排、subagent 时间线、history tail 分页和实验开关。当前项目只实现 P0-02 所需的单 main-owned run、可恢复订阅、权威快照合并和对应 UI，避免把参考产品的旁支架构一起引入。

## 3. P0-02 清单遗漏分析

以下内容应补入 P0-02，或明确挂到同批 P0 项上：

| 遗漏                                                        | 为什么必须补                                                                                                                                                                                                                                                                | 归属                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `runId`、单调递增 `sequence`、`afterSequence` 恢复游标      | 无法判断接回的是不是同一次运行，也无法去重或补发                                                                                                                                                                                                                            | P0-02A                               |
| thread 尚未绑定前的稳定身份                                 | 新会话可能在收到 `thread-bound` 前刷新；只靠 threadId 无法找回                                                                                                                                                                                                              | P0-02A                               |
| detach 与 cancel 分离                                       | 页面销毁、会话切换不应停止任务；Stop 必须只取消目标 run                                                                                                                                                                                                                     | P0-02A，并与 P0-05 对齐              |
| 重连期间的终态                                              | 断线时可能已经 finish、abort、error 或 interrupted；UI 不能一直显示 running                                                                                                                                                                                                 | P0-02A                               |
| 旧 port、重复 attach、乱序、缺序和缓冲溢出                  | 否则会出现重复文本、重复工具卡片或漏事件                                                                                                                                                                                                                                    | P0-02A                               |
| 新 renderer 的基础消息与“从本轮第一个事件开始”重放          | 新 `Chat` 没有旧 reducer 状态；只补 `text-delta` 而没有 `text-start` 会恢复失败                                                                                                                                                                                             | P0-02A                               |
| `needs_resume / resuming / resumed` 与失败回退              | “连接恢复”不等于“thread 已恢复”，混用会让 composer 过早可发送                                                                                                                                                                                                               | P0-02A                               |
| 权威快照与恢复期间事件的语义合并                            | 简单重放会重复文本、completed item、tool output 和审批请求                                                                                                                                                                                                                  | P0-02A，provider fork 负责协议层合并 |
| host/conversation 恢复 single-flight                        | app-server 重连与页面恢复同时发生时会重复 resume                                                                                                                                                                                                                            | P0-02A                               |
| 当前会话立即恢复、后台会话懒恢复                            | 一次 host 重连不能触发所有缓存会话同时 resume                                                                                                                                                                                                                               | P0-02A，并与 P0-05 对齐              |
| app-server/provider 重启后的语义                            | 运行中的 app-server 支持 `thread/resume` 重入并返回 active turn；但 provider 当前仍会继续发 `turn/start`。必须新增专用 reattach 路径，且进程重启后 active turn 消失时收敛为 interrupted，不能重放（`desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:1151-1327`） | P0-02A                               |
| 审批、结构化提问等待时的恢复                                | broker 目前只广播新请求，刷新后 pending 请求不会重新出现（`desktop-app/src/main/codexApprovalBroker.ts:19-55`）                                                                                                                                                             | P0-02A 与 P0-06 共同完成             |
| 单轮重试的副作用边界                                        | “Try again” 必须只重渲染，不能调用 regenerate、send 或 start IPC                                                                                                                                                                                                            | P0-02A                               |
| 错误分类、脱敏和可访问性                                    | 原始错误可能含路径或 provider 细节；用户还需要知道能否自动恢复                                                                                                                                                                                                              | P0-02A                               |
| managed worktree 的恢复元数据                               | 当前项目数据无法判断 restorable，也无法安全重建                                                                                                                                                                                                                             | P0-03 提供基础，P0-02B 消费          |
| local、remote、projectless、managed-worktree 的不同降级路径 | 不同执行目标不能统一显示“本地继续”                                                                                                                                                                                                                                          | P0-02B                               |
| 运行恢复的可观测数据                                        | E2E 需要证明没有重复 turn/tool；日志需要关联 run 和 reconnect generation                                                                                                                                                                                                    | P0-02A                               |
| 草稿、滚动位置、未读状态的保留规则                          | 恢复通信不应被误当成重新打开一条全新对话                                                                                                                                                                                                                                    | P0-02A                               |

### 对原清单第 83 项的修订建议

“worktree 丢失时提供恢复/重试/本地继续”不能作为一个无条件动作：

- `checking-failed`：可以原地 Retry。
- `restorable`：仅当 main 持有 managed-worktree 元数据时显示 Restore worktree。
- `gone`：不能承诺原任务继续；提供“选择本地项目并新建任务”，由 P0-03 的 fork/新任务流程承接。
- `remote-unavailable`：提供重试或重新选择远程环境，不自动改成本地 cwd。
- `projectless-missing`：可重新初始化空白工作区；失败后允许选择现有本地项目并新建任务。

这样既保留参考项目的恢复交互，也避免在同一个正在执行或已中断的 turn 中偷偷更换 cwd。

## 4. 目标协议与状态模型

### 4.1 主进程拥有运行

新增 main-owned 的运行记录，至少包含：

```ts
type CodexChatRunDescriptor = {
  runId: string;
  conversationId: string;
  threadId?: string;
  phase:
    | "starting"
    | "active"
    | "waiting-user"
    | "completed"
    | "aborted"
    | "interrupted"
    | "failed";
  lastSequence: number;
  createdAt: string;
  terminalAt?: string;
};

type CodexChatStreamEnvelope = {
  runId: string;
  sequence: number;
  event: CodexChatStreamEvent;
};

type CodexChatAttachRequest = {
  conversationId: string;
  threadId?: string;
  runId?: string;
  afterSequence: number;
};
```

- main 为每次 `turn/start` 分配唯一 `runId`；conversationId 在 thread 尚未绑定时仍可定位运行。
- run record 保存本轮开始前的基础 messages 和从本轮第一个 `text-start/tool-input-start/...` 起的完整事件；全页刷新后的新 `Chat` 必须从本轮第一个事件重放，不能只从最后 sequence 继续。
- 所有可见事件在 main 中先编号并写入有界 journal，再推给订阅者。
- attach 先冻结实时推送、按序补发 `(afterSequence, lastSequence]`，再切换到 live，保证补发与实时事件之间没有缝隙。
- `afterSequence > 0` 只用于仍保留本地 AI SDK reducer 状态的短断连；新 renderer、page reload 或 reducer 状态丢失时必须带 `afterSequence = 0`，并使用 recovery snapshot 中的基础 messages。
- attach 请求若同时带 runId 和 conversation/thread 身份，必须全部匹配；旧 run 的 Stop 或 attach 不得影响同会话的新 run。
- journal 建议上限为 20,000 个事件或 8 MiB，任一达到即停止可恢复补发并发出 `resync-required`。后台任务继续运行；renderer 显示“等待任务完成后重新载入”，不得伪造连续流。
- terminal run 保留 5 分钟，保证断线期间发生的 finish/error/abort 能在重开时准确落地；超时后只通过 thread history 恢复。

### 4.2 两级恢复与权威数据

恢复分为两级，不能混为一次普通重试：

1. **Renderer reattach**：main 和 provider run 仍存活时，直接使用 `runId + sequence journal` 补发当前 turn 的 UI chunks，不发送任何 app-server `thread/resume` 或 `turn/start`。
2. **Provider/app-server reconnect recovery**：原 provider transport 已失效、但 app-server 仍存活时，在 provider fork 内先建立新 transport 和事件缓冲，再以 `thread/resume` 重入同一 running thread，读取其 active-turn snapshot；只有 snapshot 仍报告同一 active turn 时才继续释放事件。当前 `model.ts` 的普通续聊路径在 `thread/resume` 后必然调用 `turn/start`，因此明确禁止复用该路径做 reattach（`desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:1151-1327`）。app-server 进程重启后没有 active turn 时，只能恢复权威持久历史并标记 interrupted。

恢复协调器必须满足：

- 同一个 provider connection/host 同时只有一个 reconnect recovery。
- 同一个 conversation 同时只有一个 resume；并发调用共享同一个 Promise。
- 先注册 live 事件缓冲，再请求权威 snapshot。
- 快照落地时，completed item 覆盖同 item 的旧 delta；文本只追加快照尚未包含的后缀；tool output、approval、elicitation 按稳定 ID 去重后保序释放。
- 当前可见会话立即恢复；后台会话只标记 `needs_resume`，用户切换到该会话时才恢复，避免恢复风暴。
- 如果 app-server 进程重启后没有可继续的 active turn，记录 `interrupted` 并恢复历史；不得自动重新发送旧 prompt、工具输入或审批答案。

### 4.3 生命周期语义

| 动作                                                         | 订阅                                     | 底层 run                                   |
| ------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------ |
| 切换会话、renderer unmount、刷新、窗口 renderer 崩溃         | detach                                   | 继续                                       |
| 用户点击 Stop                                                | detach 当前流，并调用 `cancelRun(runId)` | 取消准确的 run                             |
| main 窗口隐藏                                                | detach 或保持                            | 继续                                       |
| 应用真正退出                                                 | 关闭订阅                                 | 按现有 shutdown 流程取消并记录 interrupted |
| provider transport 短断开、app-server 进程仍持有 active turn | needs_resume，恢复后重订阅               | 继续；恢复失败仍保持 needs_resume          |
| app-server 进程重启且 active turn 已消失                     | 关闭订阅                                 | 标记 interrupted，不重放旧 prompt          |
| run 在无订阅时结束                                           | 保留 terminal journal 5 分钟             | completed/aborted/failed                   |

### 4.4 renderer 状态

恢复状态和运行状态分开保存，避免把“连接已建立”误当成“任务已恢复”。在现有 `loading | ChatStatus` 之外增加 `recoveryPhase`（`desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:21-38`）：

- `attached`
- `needs_resume`
- `resuming`
- `resumed`

失败从 `resuming` 回到 `needs_resume`，绝不转成 completed。由 `recoveryPhase + run phase` 派生用户可见状态：

- `loading-history`
- `connecting`
- `streaming`
- `waiting-user`
- `reconnecting`
- `resyncing`
- `recoverable-error`
- `interrupted`
- `ready`

错误至少归类为：

- `transient-runtime`：host connecting/restarting，单个恢复 generation 自动重试一次，延迟 750ms。
- `configuration`：例如配置文件解析或 provider 配置错误，显示可操作位置，不自动重试。
- `conversation-missing`：thread/rollout 不存在，停止自动重试。
- `workspace`：cwd/worktree 检查或恢复失败，交给工作区恢复 UI。
- `authorization`：审批超时或凭据问题，不自动无限重试。
- `unknown`：显示通用说明和脱敏详情，可手动重试。

## 5. 可测试验收条件

### 5.1 运行续接

1. 新会话在收到 `thread-bound` 前刷新，renderer 能以 conversationId 找回原 run；main 只发生一次 provider `turn/start`。
2. 已绑定 thread 的流式回复中刷新，新 renderer 从基础 messages 和本轮第一个 start event 完整恢复；文本和工具 UI 与未刷新结果完全一致，没有重复 chunk、缺少 `text-start`、重复工具卡片或缺失终态。
3. 会话切换、React unmount、页面刷新只 detach；`ConversationChatRegistry.destroy()` 不再调用底层 run 的取消命令。
4. Stop 使用 runId 取消准确运行；针对旧 runId 的迟到 Stop 不会取消同会话的新运行。
5. 断线期间发生 completed、aborted、failed 或 interrupted，重开后状态与 main terminal record 一致，不显示为 completed 的失败任务。
6. 重复 attach、旧 port 晚到、事件重复、乱序和缺序都不会重复写入 UI；检测到不可补齐缺口时进入 `resync-required`。
7. journal 超限后后台任务继续；页面显示明确的等待/重新载入状态，任务终止后从 `thread/read` 得到最终历史。
8. provider/app-server 重启导致旧 turn 丢失时，只恢复已持久化历史并显示 interrupted；不会自动调用 `thread/resume + turn/start` 重放用户输入、审批答案或工具调用。
9. app-server snapshot 恢复期间同时到达 delta、item completed、tool output 或 approval 时，snapshot 已包含的部分不会重复；只释放缺少的后缀和事件。
10. 同一 host/conversation 同时触发多个 recovery，只建立一个 reconnect、一个 resume；后台会话保持 `needs_resume`，直到被打开。

### 5.2 交互与诊断

11. 恢复时在 composer 上方显示 `role="status"`、`aria-live="polite"` 的 loading/reconnecting 文案；短暂重试不创建聊天消息。
12. `needs_resume`、`resuming` 和 `resumed` 显示不同状态；只有 snapshot 已落地并释放缓冲后 composer 才按 run 状态恢复可发送。
13. 同一错误 generation 最多自动重试一次；配置错误、conversation missing 和 workspace gone 不自动重试。
14. 永久失败显示用户可执行动作和脱敏详情；renderer 收不到 API key、provider headers 或完整模型配置。
15. 审批或结构化提问等待期间刷新，pending 请求重新出现一次，原 requestId 保持不变；回复一次后从 pending snapshot 消失。
16. 刷新和 reconnect 不清空当前草稿、滚动位置或后台会话未读标记；只有用户发送成功或主动清除时才改变对应状态。
17. 某一轮 React 渲染抛错时，其他轮和 composer 仍可用；“重试渲染”只重置该轮 error boundary，测试断言 chat start/send/regenerate 调用次数不增加。

### 5.3 工作区恢复

18. `checking-failed` 显示 Retry，重试成功后 banner 消失。
19. 只有带完整 managed-worktree 元数据的 `restorable` 状态显示 Restore worktree；恢复成功后重新校验 cwd 并刷新会话状态。
20. 恢复失败显示可重试错误和脱敏详情，不把任务标记 completed。
21. `gone` 不允许在活跃 turn 中换 cwd；仅允许“选择项目并新建任务”。
22. remote、projectless、managed-worktree 分别显示正确的恢复动作，不能统一降级到本地目录。
23. 没有 managed-worktree 元数据时永远不显示虚假的 Restore worktree。

### 5.4 边界与质量

24. `codex/codex-rs/app-server/` 没有改动；聊天仍经过 renderer → preload → main → provider → app-server。
25. renderer 只提交 conversation/thread/run/sequence 等非敏感身份；cwd 和项目归属仍由 main 校验和解析。
26. shared schema、main、preload、renderer、provider fork 的单元/集成测试以及桌面 E2E 全部通过，lint/typecheck 无新增错误。

## 6. 实施步骤

### 步骤 1：先固定现有失败行为和生命周期边界

涉及文件：

- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.test.ts:285-389`
- `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts:1-340`
- `desktop-app/src/preload/chatStreamBridge.test.ts:50-161`
- `desktop-app/src/main/codexChatRuntimeService.test.ts:1001-1117`

工作内容：

1. 记录当前 destroy 会 abort、`reconnectToStream()` 返回 null、main 只支持单 port 的基线；把测试契约改成目标行为后先确认测试失败，再开始实现。
2. 为新旧 run 竞争、thread-bound 前刷新、断线终态、旧 port 晚到、重复/缺序、Stop 旧 run 等场景建立测试夹具。
3. 增加 provider 能力门测试：新 transport 对同一 app-server 调用不创建 turn 的 snapshot/recovery 时，若还能观察到同一 active turn 则允许续接；若 active turn 已消失，期望结果必须是 interrupted，且 `turn/start` 计数保持不变。
4. 不修改当前工作区中与本计划无关的已有未提交改动；实施时先重新检查 `git status`，对重叠测试文件采用最小增量编辑。

完成标准：测试能分别证明 detach、attach、cancel 是三种不同动作，并能捕获“重复 turn”回归。

### 步骤 2：扩展 shared 协议和安全校验

涉及文件：

- `desktop-app/src/shared/codexIpcApi.ts:92-148`
- `desktop-app/src/shared/codexIpcApi.ts:323-355`
- `desktop-app/src/shared/codexIpcApi.test.ts`（若不存在则新建相邻 schema 测试）

工作内容：

1. 增加 `CodexChatRunDescriptor`、`CodexChatStreamEnvelope`、`CodexChatAttachRequest`、`CodexChatRecoverySnapshot`、结构化 `CodexChatRecoveryError` 和 Zod schema；snapshot 包含安全的基础 UI messages、完整重放起点和当前 run 状态。
2. 将 API 拆为 `startChatStream`、`attachChatStream`、`detachChatStream`、`cancelChatRun`、`getChatRunSnapshot`。
3. 保留 `thread-bound-ack` 的现有防竞态职责，但将 ack 绑定到 runId 和 subscription generation。
4. attach/cancel payload 禁止 renderer 传 cwd、sandbox、provider 设置或项目凭据；main 根据已注册 run 和项目存储解析。

完成标准：畸形 runId、负 sequence、身份不一致、附带执行配置的 payload 都被 schema 或 main 拒绝。

### 步骤 3：把活跃运行从原始 MessagePort 中解耦

涉及文件：

- `desktop-app/src/main/codexChatRuntimeService.ts:76-81`
- `desktop-app/src/main/codexChatRuntimeService.ts:231-470`
- `desktop-app/src/main/codexChatRuntimeService.ts:479-517`
- 新建 `desktop-app/src/main/chatRuns/CodexChatRunRegistry.ts`
- 新建 `desktop-app/src/main/chatRuns/CodexChatEventJournal.ts`
- 新建 `desktop-app/src/main/chatRuns/CodexConversationRecoveryCoordinator.ts`
- 新建对应 `.test.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:993-1020`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:1146-1167`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/worker.ts:31-85`

工作内容：

1. 让 `streamText()` 和 provider worker 的生命周期归 main-owned run registry 管理，不归某个 renderer port 管理。
2. run registry 维护 conversationId/threadId/runId 别名、本轮基础 messages、phase、AbortController、订阅 generation、事件 journal 和 terminal TTL。
3. 输出路径改为“生成 envelope → 写 journal → 广播订阅者”；无订阅者时仍继续消费 provider 输出。
4. attach 使用单一临界区完成历史补发和 live 切换；较旧 generation 的 port 消息直接忽略。新 renderer 从 sequence 0 完整重放，保留 reducer 的短断连才允许使用 afterSequence。
5. cancel 先比对 runId，再调用 AbortController；detach 只移除 subscriber。
6. `stop()`/app shutdown 将非终态 run 记为 interrupted，并按既有应用退出流程关闭 provider（`desktop-app/src/main/appShutdown.ts:5-30`）。
7. recovery coordinator 分别对 provider connection/host 和 conversation 做 single-flight；连接恢复时把缓存会话标记 `needs_resume`，只立即恢复当前可见会话。
8. provider fork 增加专用的 existing-turn recovery 入口：只在新 transport 仍能从 app-server 读到同一 active turn 时，先缓冲 raw notification/server request，再读取权威 thread/active-turn snapshot，按 item id、completed 优先和文本前缀规则合并，最后恢复输出。
9. existing-turn recovery 入口不得调用普通 `doStream()` continuation；如果 snapshot 不含可继续 active turn，则只返回 interrupted snapshot。
10. thread-bound 状态先进入 main run record/journal 再通知 renderer；ACK 只确认 UI 别名同步，不能阻塞 provider 输出。
11. provider transport 短断开可以尝试 existing-turn recovery；app-server 进程真正重启且 active turn 消失时只生成一次 interrupted/failed 终态，不自动发新 `turn/start`。

完成标准：main 单测在没有 renderer port 的情况下仍能消费完整输出，并可在后续 attach 时按序补发；provider 测试证明 snapshot/delta 合并不重复、并发 resume 只发一次、每个 run 只出现一个终态。

### 步骤 4：增加 attach IPC 和 preload 订阅生命周期

涉及文件：

- `desktop-app/src/main/index.ts:519-545`
- `desktop-app/src/preload/index.ts:62-68`
- `desktop-app/src/preload/chatStreamBridge.ts:19-78`
- `desktop-app/src/preload/chatStreamBridge.test.ts`

工作内容：

1. 新增 `codex-chat:attach`、`codex-chat:snapshot`、`codex-chat:cancel-run` IPC；start 和 attach 都通过 MessageChannel 返回 envelope。
2. preload 的 streamId 改为本地 subscriptionId，不把它等同于底层 runId。
3. `ReadableStream.cancel()`、port close 和页面卸载只 detach；显式 Stop 另调 `cancelChatRun(runId)`。
4. main 对 attach 身份进行交叉校验，并把 structured clone 后的安全 descriptor 返回 renderer。

完成标准：preload 单测证明 close/detach 不触发 AbortController，显式 cancel 才取消 run。

### 步骤 5：接通 AI SDK `resumeStream()` 与会话注册表

涉及文件：

- `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts:72-202`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:21-38`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:106-185`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:328-423`
- `desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts:63-123`

工作内容：

1. `ElectronIpcChatTransport.reconnectToStream()` 调用 attach API，并将 envelope 去重、验序后还原为 `ReadableStream<UIMessageChunk>`；AI SDK 会在 `Chat.resumeStream()` 中消费该流（`desktop-app/node_modules/ai/src/ui/chat.ts:461-466`, `desktop-app/node_modules/ai/src/ui/chat.ts:620-674`）。
2. registry 为每个 entry 保存 runId、lastSequence、reconnectGeneration 和 `attached | needs_resume | resuming | resumed`；conversationId 作为 thread-bound 前的稳定键。
3. 打开会话时先建立 dormant live subscription 并缓冲事件，再读取 thread history/run snapshot；新 renderer 使用 snapshot 的基础 messages 并从本轮 sequence 0 交给 `chat.resumeStream()`，最后释放缓冲，避免“读历史—订阅”窗口漏事件。
4. 对 snapshot 与缓冲 event 做语义去重：completed 覆盖旧 delta、文本裁掉已存在前缀、tool/approval 依稳定 ID 去重。
5. renderer 只在 active generation 接收事件；旧 attach 返回或旧 port 事件不能覆盖新状态。
6. 当前 entry 自动恢复，后台 entry 只置 `needs_resume`，激活时再恢复。
7. `destroy()` 改为 detach 所有本地订阅，不调用 `chat.stop()`；UI Stop 先调用 `cancelChatRun(runId)`，再停止本地 reader。
8. 处理 journal gap：进入 `resyncing`，重新读 thread history；若底层仍 active 但 journal 已不可续接，显示“任务仍在后台运行，完成后自动重新载入”。
9. recovery 只更新连接/run 状态，不清除 `ConversationDraftStore`、conversation scroll snapshot 或后台 unread；维持现有按会话隔离存储（`desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:16-38`, `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:416-430`）。

完成标准：刷新、切换会话、切后台再返回都接回同一 run；AI SDK message reducer 没有重复 chunk。

### 步骤 6：实现参考项目式恢复状态和错误诊断

涉及文件：

- `desktop-app/src/renderer/src/App.tsx:660-750`
- 新建 `desktop-app/src/renderer/src/components/conversation/ConversationRecoveryStatus.tsx`
- 新建 `desktop-app/src/renderer/src/runtime/classifyConversationRecoveryError.ts`
- `desktop-app/src/renderer/src/App.test.tsx`

工作内容：

1. 在 composer 上方渲染 loading、reconnecting、resyncing、interrupted 状态，使用 `role="status"` 与 `aria-live="polite"`。
2. transient-runtime 每个 generation 750ms 后自动重试一次；成功或用户切换会话后清理 timer。
3. configuration、conversation-missing、workspace、authorization、unknown 显示不同标题和动作；同一错误 fingerprint 不重复弹出。
4. 详情默认折叠，只显示 main 提供的脱敏 code/message；绝不在 renderer 解析原始 provider config。
5. interrupted 提供“重新载入历史”和“继续发送新消息”，但明确说明旧任务没有被续接。

完成标准：组件测试覆盖所有状态、ARIA 属性、单次自动重试和永久错误不重试。

### 步骤 7：恢复 pending 审批和结构化提问

涉及文件：

- `desktop-app/src/main/codexApprovalBroker.ts:8-79`
- `desktop-app/src/main/codexChatRuntimeService.ts:530-565`
- `desktop-app/src/shared/codexIpcApi.ts:150-173`
- `desktop-app/src/preload/index.ts:42-58`
- `desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts:88-108`

工作内容：

1. pending map 保存已脱敏的 `CodexApprovalRequest`，增加只读 `listPendingApprovals()`。
2. renderer 启动时先订阅 live request，再读取 snapshot，并按 requestId 去重，避免“订阅与读取之间”的竞态。
3. pending 请求与 runId/threadId 关联；已终止 run 的陈旧请求被 main 清理或明确 decline。
4. 该步骤复用 P0-06 的审批/提问组件，不在 P0-02 再建第二套交互。

完成标准：等待审批时刷新，原请求只出现一次且仍能正常响应；响应后刷新不再出现。

### 步骤 8：增加单轮渲染错误边界

涉及文件：

- `desktop-app/src/renderer/src/App.tsx:1050-1129`
- `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx:716-737`
- 新建 `desktop-app/src/renderer/src/components/conversation/ConversationTurnErrorBoundary.tsx`
- `desktop-app/src/renderer/src/App.test.tsx`

工作内容：

1. 按消息/turn 包裹本地 error boundary，resetKey 使用稳定 message id；不依赖新的第三方包。
2. fallback 显示“这条回复暂时无法显示”“重试渲染”；按钮只增加本地 reset generation。
3. 捕获错误时记录 messageId、render-unit kind 和安全 error code，不记录正文、路径或工具敏感输入。
4. 永久渲染失败时允许重复手动重试，但不会重新发送消息或重新执行工具。

完成标准：故意让一条 assistant message 抛错，其他消息、composer、Stop 和会话切换仍可用；重试前后 main start 调用数不变。

### 步骤 9：建立工作区恢复契约并接入 P0-03

前置条件：P0-03 提供 managed workspace 元数据，至少包括 `workspaceKind`、repo root、worktree path、branch/ref、创建来源和可恢复标记。没有这些字段时，本步骤只允许报告 `gone`，不能报告 `restorable`。

涉及文件：

- `desktop-app/src/shared/projects/projectTypes.ts:1-38`
- `desktop-app/src/main/projects/ProjectStore.ts:20-34`
- `desktop-app/src/main/projects/ProjectService.ts:112-159`
- `desktop-app/src/main/projects/ProjectService.ts:238-317`
- 新建 `desktop-app/src/main/projects/WorkspaceRecoveryService.ts`
- 新建 `desktop-app/src/renderer/src/components/conversation/WorkspaceRecoveryBanner.tsx`

工作内容：

1. 定义 `available | checking-failed | restorable | restoring | gone | init-failed | restore-failed | remote-unavailable` 安全状态。
2. main 用已保存 assignment 检查 cwd；renderer 不传任意恢复命令或 git 参数。
3. managed worktree 恢复必须在 main 中根据可信元数据执行，并在成功后重新校验目录、repo/ref 和 thread assignment。
4. `gone` 只能选择项目并进入 P0-03 的“新建任务/任务分支”流程；不修改活跃 run 的 cwd。
5. remote 和 projectless 走各自恢复路径；UI 文案和动作与状态严格对应。
6. 恢复成功后使 conversation/project snapshot 失效并重新读取，避免 sidebar 仍显示旧路径。

完成标准：每种状态都有 main 单测和 renderer 组件测试；缺少元数据时 Restore worktree 按钮不可见。

2026-07-25 实施记录：已新增 `ManagedWorktreeMetadata`、`WorkspaceRecoveryService`、`WorkspaceRecoveryBanner` 与 `codex:projects:get-workspace-recovery` / `restore-workspace` IPC。main 单测覆盖 ordinary missing、remote/projectless、metadata 校验、已有 worktree、恢复成功和恢复失败；renderer 测试覆盖动作白名单。P0-03 仍需在创建分叉 worktree 时写入该 metadata，随后才能形成真实用户可达的恢复闭环。

### 步骤 10：补齐 E2E、故障注入和清单文档

涉及文件：

- 新建 `desktop-app/tests/e2e/active-task-reconnect.e2e.ts`
- `desktop-app/tests/e2e/fault-injection.e2e.ts:26-276`
- `desktop-app/tests/e2e/support/mockBackend.ts`
- `desktop-app/tests/e2e/support/app-server-process-wrapper.mjs`
- `docs/test-plan.md`
- `desktop-app/tests/test-plan-coverage.json`
- `docs/codex-electron-conversation-gap-checklist.md:77-99`
- `docs/ai-sdk-provider-codex-asp-api.md:343-372`

工作内容：

1. 保留 C22/C23 作为“detach 不取消”和“崩溃后诚实失败”的回归用例；新增独立 P0-02 场景 ID，避免 `desktop-app/tests/test-plan-coverage.json` 把 C22/C23 的 `covered` 误读为 active reattach 已覆盖。
2. 在 E2E mock app-server/provider 中加入可控的 pause、MessagePort disconnect、process restart、duplicate、out-of-order、sequence gap、snapshot-prefix overlap、pending approval、terminal while detached 和 worktree 状态；测试设施只能从测试目录注入，不得在生产 main/renderer 添加 test-only 分支。
3. 新增以下 P0-02A E2E 矩阵：

| 场景                                           | 必须证明                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P002-E2E-01` thread-bound 前刷新              | **已完成**：只凭 conversationId 从 main snapshot 还原原始用户消息并 attach 原 run；终态 gate 保持关闭时，新 renderer 已能收到后续 delta；provider 请求、`turn/start` 均为 1。                                                                                                     |
| `P002-E2E-02` 已绑定流中刷新                   | **已完成**：刷新前后文本、pending approval 和最终 assistant message 各为 1；同一 tool call 的 provider output 恰为 1。                                                                                                                                                            |
| `P002-E2E-03` 短暂 MessagePort 断线            | **已完成**：不刷新页面时向当前 port 注入 `messageerror`，bridge 自动 attach；最终只有一条 assistant 回复，provider 请求和 `turn/start` 均为 1。                                                                                                                                    |
| `P002-E2E-04` 乱序、缺序和 journal gap         | **已完成（可补齐路径）**：renderer 发现 sequence gap 后从最后确认序号重新 attach；main journal 重放缺失事件，最终 transcript 不重复且不创建新 turn。journal 不可补齐仍返回既有 `resync-required` 安全终态。                                                                    |
| `P002-E2E-05` detach 期间终态                  | completed、aborted、failed、interrupted 各只落一个终态；failed/interrupted 不得显示 completed。                                                                                                                                                                                   |
| `P002-E2E-06` transport 断线与 app-server 重启 | **已完成**：A 仅关闭 desktop-facing proxy，真实 child 保持存活；`thread/resume` 恢复同一 active turn、provider 请求和 `turn/start` 均为 1。B 重启 child；provider 以恢复配置读取权威 thread，但没有 active turn 时 main 显示 interrupted、保留部分历史，且 provider 请求和 `turn/start` 均不增加。 |
| `P002-E2E-07` 恢复失败诊断                     | **已完成**：主进程 `get-active-run` IPC 故障注入模拟未知恢复错误；已断言不会泄露原始 IPC 文本、会保留部分内容并进入安全的不可自动恢复状态。稳定错误码的分类与动作由 main/preload/renderer 单元测试覆盖。 |
| `P002-E2E-08` pending 审批/提问刷新            | 原 requestId 只出现一次并仍可响应；响应后 pending snapshot 清除；不得因 detach 自动 decline。                                                                                                                                                                                     |
| `P002-E2E-09` 单轮渲染异常                     | **已完成**：单元测试强制子 render throw；浏览器测试驱动同一条回复的局部 Error Boundary 进入失败状态，确认其他会话内容和 composer 可用，点击“重试渲染”不新增 provider 请求或 `turn/start`。                                                                                           |

4. P0-03 提供可信 managed-worktree 元数据后新增 P0-02B E2E：

| 场景                            | 必须证明                                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P002-E2E-10` worktree 状态矩阵 | **已完成（状态矩阵）**：测试目录 IPC 注入 `checking-failed`、`restorable`、`gone`、`restore-failed`、`remote-unavailable`、`not-applicable`；已断言严格的按钮白名单、无第二次 provider 请求和无 pageerror。main 单测单独验证真实 git 恢复决策；仍待 P0-03 生成 metadata 后执行真实用户路径闭环。 |

5. 所有新 E2E 统一断言：provider 请求数、`turn/start` 数、稳定 turnId、tool call id 次数、assistant message 数、terminal 次数、页面 `pageerror/unhandledrejection`、恢复状态 ARIA 文案以及敏感信息缺失。任何同一 run 出现第二次 `turn/start` 或同一 tool call 执行两次都直接失败。
6. `P002-E2E-06` 已由 `persistent-app-server-relay.mjs` 与 `persistent-app-server-proxy.mjs` 覆盖：A 只关闭 proxy 的 desktop-facing stdio，再由第二个 proxy 连接原 child；B 终止 child 并启动空的新 child，证明没有 active turn 时 main 只结算 interrupted。现有 `app-server-process-wrapper.mjs` 仍用于 C23 基线。
7. 更新 P0-02 清单，补上本计划“遗漏分析”中的协议和状态要求；把 managed-worktree 前置项链接到 P0-03，把 pending 交互链接到 P0-06。
8. 在 provider API 文档中明确区分“thread continuation（会创建新 turn）”和“renderer reattach（不会创建新 turn）”。

完成标准：

- `P002-E2E-01` 至 `P002-E2E-09` 全部通过后，P0-02A 才可验收；C22/C23 单独通过不能替代。
- `P002-E2E-10` 通过且 P0-03 managed-worktree 元数据契约落地后，P0-02B 才可验收。
- 专用套件至少执行一次 `--repeat-each=3`，证明 attach/terminal 竞态没有明显不稳定；全量 E2E 再执行一次作为发布门禁。
- E2E 证明逻辑链路仍为 renderer → IPC → main → provider → app-server，并能用计数器证明没有重复执行。

## 7. 验证步骤

按从小到大的顺序运行：

```bash
npm --prefix desktop-app test -- src/main/chatRuns
npm --prefix desktop-app test -- src/main/codexChatRuntimeService.test.ts
npm --prefix desktop-app test -- src/preload/chatStreamBridge.test.ts
npm --prefix desktop-app test -- src/renderer/src/lib/ElectronIpcChatTransport.test.ts
npm --prefix desktop-app test -- src/renderer/src/runtime/ConversationChatRegistry.test.ts
npm --prefix desktop-app test -- src/renderer/src/App.test.tsx
npm --prefix desktop-app run lint
npm --prefix desktop-app test
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test
npm --prefix desktop-app run test:e2e -- --reporter=line
```

额外人工/故障注入检查：

1. 在 assistant 文本流一半时刷新，确认内容连续且 main 日志中同一 run 只有一个 `turn/start`。
2. 在工具等待审批时刷新，确认同一 requestId 只出现一次。
3. 在 snapshot 读取期间注入 delta、completed、tool output 和 approval，确认快照已有内容不会重复。
4. 在断线期间让任务完成，重新打开后确认显示 completed 而不是 reconnecting。
5. 强制重启 provider/app-server，确认旧输入没有自动重放；有可恢复 active turn 时从 snapshot 收敛，没有时显示 interrupted 和已恢复历史。
6. 同时触发 host reconnect、页面 resume 和重复打开会话，确认 single-flight 生效。
7. 模拟 journal gap，确认不拼接不完整事件，任务完成后再从 thread history 收敛。
8. 模拟 worktree checking-failed、restorable、gone、restore-failed，确认按钮与状态匹配。
9. 比较实施前后 `git diff -- codex/codex-rs/app-server`，必须为空。

## 8. 风险与缓解

| 风险                                                                 | 缓解                                                                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| attach 补发与 live 事件交错导致重复或漏消息                          | main 单一临界区、sequence 去重、generation 丢弃旧订阅；用乱序和旧 port 测试证明                                            |
| 页面 Stop 错杀新 run                                                 | cancel 必须带 runId，并与当前 conversation/thread 全部匹配                                                                 |
| 事件 journal 占用过多内存                                            | 20,000 事件/8 MiB 双上限、5 分钟 terminal TTL；超限进入诚实 resync，不无限缓存                                             |
| app-server 重启后重复执行工具                                        | 将 restart 标记 interrupted；严禁把 provider 的 thread continuation 当作旧 turn reattach                                   |
| 当前 app-server/provider 无法在 transport 重建后继续同一 active turn | 先用能力门测试判定；不支持时收敛到 interrupted + 权威历史，不扩大为自动重放                                                |
| 历史读取和 live replay 产生重复 assistant 内容                       | 顺序固定为先订阅缓冲 → 权威 snapshot → completed/prefix/id 语义合并 → 释放 live；gap 时不盲目混合两套来源                  |
| pending 审批在刷新后丢失或重复                                       | 先订阅后 snapshot，按 requestId 去重，broker 保留安全 request                                                              |
| 原始异常泄露路径或凭据                                               | main 分类与脱敏，renderer 只接收 code、用户文案和安全 detail                                                               |
| worktree 恢复误删或覆盖用户目录                                      | 只恢复 `managedByApp` 且元数据完整的 worktree；目标路径非空或 repo/ref 不匹配时拒绝并提示                                  |
| P0-02 与 P0-03/P0-05/P0-06 重复造状态                                | shared 只定义一个 run descriptor、一个 workspace recovery descriptor、一个 pending approval snapshot；各 P0 消费同一数据源 |
| 当前未提交测试改动发生冲突                                           | 实施前记录 dirty files；只做增量 patch，不 reset/checkout 用户改动；冲突时拆分新测试文件                                   |

## 9. 交付顺序与停止条件

建议顺序：

1. 步骤 1–5：先打通 main-owned run、attach 和 AI SDK resume。
2. 步骤 6–8：完成用户可见状态、审批恢复和单轮错误边界。
3. 步骤 10 中除 worktree 外的 E2E 通过后，P0-02A 可独立验收。
4. P0-03 workspace 元数据合入后执行步骤 9，再补齐 worktree E2E，完成 P0-02B。

停止条件：

- P0-02A 必须满足验收条件 1–17、24–26；不能因为“多数刷新能接回”而忽略 app-server restart、snapshot/event 合并、审批等待或重复事件。
- P0-02B 必须满足验收条件 18–23；如果 P0-03 尚未提供可信 worktree 元数据，P0-02 总项只能保持 partial，不能宣称 complete。
- 任一自动恢复路径只要存在重复 `turn/start` 或重复工具调用，就必须停止发布并回到协议层修复。
