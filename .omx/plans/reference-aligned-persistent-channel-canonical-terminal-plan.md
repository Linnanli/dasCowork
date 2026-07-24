# 参考项目对齐的常驻 App-Server 通道与 Canonical Terminal 竞态修复计划

## Requirements Summary

### 目标

按照 `reference-projects/codex-electron-26.707.72221-beautified` 的核心方案，消除“用户停止、模型自然完成、transport 关闭和 app-server `turn/completed` 乱序到达”造成的终态竞态，使桌面端只依据 app-server 的权威 turn outcome 提交正式终态。

目标行为必须同时具备：

1. 一个 desktop host 只维护一个长期存活的 app-server 物理连接；chat、history、catalog 和控制请求在该连接上多路复用，而不是占用单 worker 串行等待。当前共享入口位于 `desktop-app/src/main/index.ts:121-159`，但 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-connection.ts:11-32` 仍通过 `poolSize: 1` 串行逻辑客户端。
2. 用户停止只是 `stopRequested` 意图；`turn/interrupt` RPC response 也不是 turn 终态。正式终态必须来自匹配 `threadId + turnId` 的 `turn/completed`，或在通知缺失时来自同一 app-server 连接上的历史对账。协议依据为 `codex/codex-rs/app-server/README.md:922-934`。
3. UI 可以立即进入“正在停止”并停止展示新文本，但 Provider、Main 和 preload 必须继续处理 lifecycle notification，直到 canonical outcome 完成结算。
4. canonical outcome 的映射固定为：`completed -> finish`、`interrupted -> aborted`、`failed -> error`。用户 stop intent、AbortSignal、interrupt RPC 成功和 MessagePort 关闭都不得直接推导 `interrupted`。
5. interrupt 失败、超时、`no active turn` 或连接中断时必须进行对账；无法确认时提交单一脱敏 error，不能伪装成已中断。
6. 不修改 `codex/codex-rs/app-server`，不绕过 Codex app server，不新增独立 LLM client。所有改动限制在 provider fork、`desktop-app/` 和测试/文档。

### 参考实现证据

- 参考项目通过常驻连接的 `sendInternalRequest` 管理全局 pending response 和 timeout，而不是为每次操作独占物理连接：`reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:37305-37344`。
- 参考项目的 interrupt 是显式 RPC，错误不会被静默当作成功：`reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:36954-36967`。
- 参考项目把所有 app-server notification 先交给内部订阅者，再广播到窗口：`reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:38863-38949`。
- 参考项目停止活跃 turn 时等待 `turn/interrupt`，只有 `no active turn` 才做受限本地兜底：`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~artifact-tab-content.electron~app-main~new-thread-panel-page~onboarding-page~pr~hoz4f1hh-Cy_DxrPd.js:50336-50378`。
- 参考项目以 `turn/completed` 更新 turn status、广播 snapshot 并发出 turn-completed event：同一 bundle 的 `53214-53327`；历史缓存也由该 notification 更新：同一 bundle 的 `54719-54737`。
- app-server 在 `TurnAborted` 路径先响应 pending interrupt，再发送 interrupted completion，因此“interrupt RPC 已成功”和“客户端已收到 canonical terminal”必须是两个状态：`codex/codex-rs/app-server/src/bespoke_event_handling.rs:1169-1185`。

### 当前问题基线

- Main 收到 MessagePort abort 后立即调用本地 `AbortController.abort()`：`desktop-app/src/main/codexChatRuntimeService.ts:391-395`；流结束时又直接从 signal 合成 `aborted`：同文件 `580-592`。
- Provider 先关闭消费流，再后台执行 `turn/interrupt`，并吞掉中断错误：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:698-726,821-860`。
- Provider 在 `closed` 后忽略迟到 notification，导致真实 `turn/completed` 不能进入 `TurnLifecycleNormalizer`：同文件 `1043-1057`。
- Main 虽然会在 lifecycle callback 中记录 `run.turnOutcome`，但只在 notification 未被丢弃时有效：`desktop-app/src/main/codexChatRuntimeService.ts:977-1002`。
- E2E 诊断仍允许从本地 terminal 反推 outcome：`desktop-app/src/main/codexChatRuntimeService.ts:774-785`。
- Renderer 在 AbortSignal 已触发时直接把 turn 写成 interrupted，即使 canonical outcome 可能是 completed：`desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts:345-367`。
- preload 已具备可复用的正确基础：stop 后抑制普通 chunk，但仍转发 lifecycle 和 terminal：`desktop-app/src/preload/chatStreamBridge.ts:99-120,143-148`。
- 当前 R05 已通过真实 `thread/read` 轮询验证持久化 `interrupted`：`desktop-app/tests/e2e/release-llm.e2e.ts:116-153,340-373`；该断言必须保留，但它现在只是检测竞态，不是产品终态的来源。

## Target Architecture

### 1. Host-scoped App-Server Connection Broker

将 `CodexAppServerConnection` 从“单 worker 租赁池”改为真正的 host 级 JSON-RPC broker：

- broker 独占一个 `StdioTransport`/`WebSocketTransport` 和一次 initialize 生命周期；physical transport 直到应用退出、明确 host 重连或 fatal termination 才关闭。
- `createTransport(context)` 保持现有 provider API 兼容，但返回轻量 virtual channel；virtual `connect()/disconnect()` 只注册/注销 logical channel，不连接或关闭 physical transport。
- broker 为每个 outbound client request 分配全局唯一 wire request ID，并保存 `{channelId, localRequestId}` 映射；response 回到原 channel 前恢复 local ID。必须覆盖多个 `AppServerClient` 都从本地 ID `1` 开始的碰撞。
- notification 由 broker fan-out；logical channel 再按 thread/turn/filter 处理。一个 channel 的关闭不得移除其他 channel 或 broker 的 notification listener。
- server request 根据 broker 维护的 `{threadId, turnId -> owning channel}` 路由到唯一 active turn channel，防止 command/file/tool/elicitation 被多个客户端重复响应。
- 新 thread 在创建前没有 threadId：broker 从 `thread/start` response、`turn/started` notification 或 provider 显式 bind 中更新 ownership；resume thread 使用 `TransportContext.threadId` 预绑定。当前 context 定义位于 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider-settings.ts:11-15`。
- cross-call tool parking 从 physical worker 状态迁移为 broker 内按 threadId 保存的 logical continuation 状态；不要依赖 `transport instanceof PersistentTransport`。当前耦合位于 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:879-910`，pending tool 状态位于 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/worker.ts:29-41`。
- fatal physical connection termination 一次性拒绝全部 pending client requests、通知所有 logical channel、清空 ownership/continuation，并允许下一次操作建立全新的 physical connection。

该结构与参考项目的“一个连接、全局请求表、内部通知订阅、窗口广播”一致，同时保留当前 provider 的 `transportFactory` 兼容面。禁止只把当前 pool size 调大；那会重新创建多个 app-server 进程，不能解决同一状态目录和终态订阅问题。

### 2. Stop Intent and Canonical Outcome State Machine

每个 `ActiveConversationRun` 增加明确状态，不再用一个 AbortSignal 同时表达用户停止、transport failure 和 runtime shutdown：

```text
running
  -> stop-requested
  -> interrupt-rpc-settled
  -> canonical-completed | reconciliation-required
  -> terminal-delivered
  -> cleaned
```

建议字段：

- `stopRequestedAt?: number`
- `interruptPromise?: Promise<void>`
- `canonicalOutcome?: completed | interrupted | failed`
- `canonicalOutcomeSource?: notification | history-reconciliation`
- `transportFailure?: string`
- `terminalDelivered: boolean`
- `cleanupPromise?: Promise<void>`

状态规则：

1. 同一 turn 的 stop 请求幂等，最多发送一次 `turn/interrupt`。
2. stop 早于 session/turnId 可用时只登记意图；`onSessionCreated` 或 `turn/started` 后立即补发一次 interrupt。
3. interrupt RPC response 只更新控制请求状态，不提交 terminal。
4. 匹配的 `turn/completed` 永远优先于 stop intent、transport close 和本地 stream 状态。
5. canonical `completed` 与用户 stop 同时发生时必须显示完成；只有 canonical `interrupted` 才显示取消。
6. terminal、follow-up settlement、approval cleanup、port close 和 broker channel release 均为幂等且只执行一次。

### 3. UI Data Plane and Control Plane Separation

- Renderer 仍可通过当前 AbortSignal 触发 `chatStreamBridge.abortChatStream()`，但该 signal 只负责提交 stop intent，不决定 transcript outcome。当前入口为 `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts:83-105`。
- preload 保持 `abortRequested` 后抑制新 chunk、继续接收 lifecycle/terminal 的行为，不主动关闭 ReadableStream。
- Main 收到 `{type: 'abort'}` 后调用异步 `requestConversationInterrupt(run)`，不调用传给 `streamText()` 的 transport AbortController。
- Main 的 transport AbortController 仅用于 app shutdown、不可恢复的 MessagePort/transport failure 等真正需要终止数据面的情况；命名上应与 user stop intent 区分。
- Renderer `ConversationTranscriptController.stop()` 可立即把状态切为可见的 stopping/submitted 状态，但必须等待 Main terminal：`finish` 保留完成、`aborted` 写 interrupted、`error` 写 failed。

### 4. Reconciliation and Unknown Outcome

- 等待 canonical notification 使用可注入 deadline；默认复用现有 `interruptTimeoutMs = 10_000` 的量级，单元测试用 fake timer，不使用真实 sleep。配置位置为 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider-settings.ts:267-270`。
- interrupt rejected、timeout、`no active turn`、或 RPC response 后未收到 matching completion 时，由仍存活的 broker connection 执行 `thread/read(includeTurns: true)`，必要时补 `thread/turns/list` 定位准确 turnId。现有 history API 位于 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-client.ts:116-137`。
- 对账结果只接受同一 threadId + turnId 的 `completed/interrupted/failed`；旧 turn、最新 turn 猜测和 UI recovery cache 均不能作为证据。
- 对账仍是 `inProgress`、turn 缺失或请求失败时，提交单一 `error`，文案固定为“停止结果无法确认，请重新打开任务检查状态”，并保留 threadId/turnId 供恢复；不得提交 `aborted`。
- 对账后如果 physical connection 状态不可信，隔离并重建 broker connection，不能把它作为健康连接继续复用。

### 5. Approval and Cleanup Ordering

参考项目在 interrupt 前会 decline/dismiss 活跃 approval、user-input 和 elicitation。当前 Main 主要通过 reject 本地 Promise 清理：`desktop-app/src/main/codexChatRuntimeService.ts:632-637`。

调整为：

1. stop intent 到达后，逐类生成合法的协议响应：command/file approval 使用 decline，tool user input 使用空答案，elicitation 使用 decline。
2. 等待这些响应完成或到达独立的短 deadline，再发送 `turn/interrupt`；cleanup 错误记录但不得覆盖已经收到的 canonical outcome。
3. background terminal cleanup 保持独立操作；普通 turn interrupt 不隐式终止后台 shell，遵循 `codex/codex-rs/app-server/README.md:934`。
4. 收到 canonical terminal 后再注销 turn owner、dynamic tool/approval handler、logical channel；physical broker 继续存活。

## Acceptance Criteria

1. **Interrupt response 不是 terminal**：单元测试 gate 住 `turn/completed`，先返回 `turn/interrupt` result；在 gate 释放前 Main、preload、Renderer 均不得收到正式 terminal，active run 和 broker turn ownership 仍存在。
2. **Canonical interrupted**：释放 `turn/completed(status: interrupted)` 后 1 秒内只产生一个 `aborted`；UI 显示一个 cancelled 单元，Composer 恢复，active run、approval、turn owner 和 logical channel 均清零。
3. **Completion wins race**：自然 `turn/completed(status: completed)` 与 stop 同 tick 或先于 stop 到达时，只产生一个 `finish`；UI 不显示 cancelled，历史为 completed。
4. **Failure wins race**：`turn/completed(status: failed)` 与 stop 竞态时只产生一个脱敏 `error`，不得产生 `aborted`。
5. **Unknown is not interrupted**：interrupt timeout/rejection 且 history 无法确认时，只产生一个“停止结果无法确认”的 `error`；E2E diagnostic 的 outcome source 不得标为 canonical interrupted。
6. **History reconciliation**：notification 被测试故意丢弃，但 `thread/read` 返回相同 turnId 的 interrupted 时，terminal 为 `aborted`，诊断 `outcomeSource` 为 `history-reconciliation`。
7. **One physical connection, concurrent logical requests**：chat turn 保持 active 时，`thread/list`、`thread/read` 和 catalog request 可在 1 秒内完成；测试断言仅创建一个 physical transport、只发送一次 initialize，且 history 请求没有等到 chat 释放 channel。
8. **Request ID isolation**：至少两个 logical `AppServerClient` 同时发送 local request id `1`，response 均回到正确 client；没有交叉 resolve、timeout 或重复 callback。
9. **Server request ownership**：command/file/tool/elicitation 只投递给匹配 threadId/turnId 的 active turn channel；其他 channel 接收次数为 0。
10. **Logical disconnect isolation**：关闭 history/catalog channel 不影响 active chat notification；关闭 chat channel不关闭 physical transport；只有 broker shutdown/fatal termination 才关闭 physical transport。
11. **Cross-call continuity**：现有 provider cross-call tool 测试继续通过；pending tool call 按 threadId 恢复，其他 thread 不得领取该 continuation。
12. **Stop before turn binding**：在 `turn/start` response 前点击停止，turnId 可用后只发送一次 interrupt，最终以 matching canonical outcome 结算，不泄漏 queued stop。
13. **Duplicate/late events**：重复 `turn/completed`、late chunk、late transport close 和重复 abort 都不能改变已提交 terminal，terminal callback、history settlement 和 cleanup 各执行一次。
14. **R05 release gate**：`desktop-app/tests/e2e/release-llm.e2e.ts:116-153` 在 packaged artifact 上通过；原始 `thread/read` 明确找到相同 turnId 的 interrupted，重载后仍显示 cancelled，无错误卡、工具和审批面板。
15. **Diagnostics are authoritative**：删除 `run.turnOutcome ?? terminalOutcome(terminal)` 这类本地推导；每条 E2E terminal record 必须包含真实 `outcome` 和 `outcomeSource: notification | history-reconciliation`，未知结果归类 failed/error。
16. **No app-server changes**：`git diff --name-only -- codex/codex-rs/app-server` 输出为空。
17. Provider lint、typecheck、全部 provider tests，Desktop lint、typecheck、相关 unit/integration/Mock E2E 和 R05 release E2E 全部通过；任何未运行项必须在实施报告中明确原因。

## Implementation Steps

### Phase 0 — 先锁定协议顺序和失败基线

涉及文件：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/app-server-connection.test.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/model.stream.test.ts:1923-2017`
- `desktop-app/src/main/codexChatRuntimeService.test.ts`
- `desktop-app/src/preload/chatStreamBridge.test.ts`
- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.test.ts`

行动：

1. 把当前“stream 在 interrupt settle 前关闭”的测试改为 reference-aligned gate：interrupt response 先到、completion 后到，断言 terminal 只能在 completion 后出现。
2. 增加 completed-vs-stop、failed-vs-stop、interrupt rejection、notification 丢失后 reconciliation、stop-before-turnId 和重复 stop 测试。
3. 给 Main 增加 terminal arbiter 的纯函数/状态机测试，覆盖 canonical > transport failure > unresolved stop intent 的优先级。
4. 给 Renderer 增加“stop 后等待 terminal，不从 AbortSignal 推断 outcome”的测试。

退出条件：新测试能稳定暴露当前提前 `aborted` 和 notification 丢失问题，且不依赖真实时间。

### Phase 1 — 将共享连接改造成多路复用 broker

涉及文件：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-connection.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-client.ts:56-150`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/transport.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/transport-persistent.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/worker.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/worker-pool.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider-settings.ts:11-15,250-270`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/app-server-connection.test.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/persistent-transport.test.ts`

行动：

1. 让 broker 直接拥有 physical transport、initialize cache、wire request counter、pending route map、logical channel registry 和 thread/turn ownership。
2. virtual transport 重写/恢复 request ID；disconnect 只注销当前 channel并拒绝该 channel 的 pending request。
3. fan-out notification，唯一投递 server request；增加 owner bind/unbind API 或等价的自动绑定机制。
4. 将 pending tool call/buffer 从 physical worker 迁移到 thread-scoped continuation store，并抽取 capability interface，替换 `instanceof PersistentTransport`。
5. 保留 fatal reconnect、idle shutdown 和 app shutdown 的确定性清理；删除不再需要的 pool 串行租赁分支前，先迁移全部调用方和测试。

退出条件：Acceptance Criteria 7-11 全部通过，且 active chat 不再阻塞 history/catalog。

### Phase 2 — 迁移所有 Desktop 消费者到同一 broker

涉及文件：

- `desktop-app/src/main/codexAspProvider.ts:33-73`
- `desktop-app/src/main/index.ts:121-159,748-757`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-client.ts:78-137,185-206`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/context-catalog-client.ts:112-125,405-431`
- `desktop-app/src/main/conversations/AppServerThreadClient.ts`

行动：

1. chat provider、history client 和 context catalog client 共用同一 host broker；logical client 可以独立 connect/disconnect，但不独占 physical transport。
2. app shutdown 先停止新 logical channel，再结算/中断 active turns，最后关闭 broker；shutdown 必须等待全部 cleanup promise，但不得等待永不返回的普通 lease。
3. 增加集成测试证明 sidebar refresh、conversation open 和 catalog refresh 能在 active chat 期间完成。

退出条件：所有 Desktop app-server 调用路径只创建一个 physical connection，且无历史查询饥饿。

### Phase 3 — Provider 保留 canonical lifecycle 直到 turn 结算

涉及文件：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:668-726,758-870,1043-1081`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/session.ts:73-83,296-313`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/turn-lifecycle.ts:17-104`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:1015-1077`

行动：

1. 拆分 `uiOutputClosed`、`turnSettled` 和 `channelReleased`；UI 停止输出后仍先执行 `notifyTurnLifecycle()`，再决定是否 enqueue UI part。
2. generic provider AbortSignal 仍发送一次 interrupt，但不在 matching completion 前释放 logical channel；desktop 用户 stop 优先通过 `CodexSession.interrupt()` 控制面，不触发 provider transport abort。
3. interrupt error 不再吞掉；向 Main 暴露 typed interrupt/reconciliation failure，确保 unknown 不会映射 interrupted。
4. matching `turn/completed` 到达后再 mark session inactive、detach approval/tool handler、cleanup file resolver 和 release logical channel。

退出条件：Acceptance Criteria 1-6、12-13 的 provider 部分通过。

### Phase 4 — Main 建立唯一 terminal arbiter

涉及文件：

- `desktop-app/src/main/codexChatRuntimeService.ts:89-119,391-395,503-625,632-650,977-1002`
- `desktop-app/src/main/index.ts:672-718`
- `desktop-app/src/shared/codexIpcApi.ts`
- `desktop-app/src/main/codexApprovalBroker.ts`

行动：

1. 将 user stop、transport abort、interrupt request、canonical outcome、reconciliation 和 delivered terminal 分字段记录。
2. MessagePort abort 与 `interruptConversation()` 统一调用幂等的 `requestConversationInterrupt()`；如果 session 尚未创建则登记 pending stop。
3. `observeTurnLifecycle(turn-completed)` 解析 canonical outcome并触发 terminal arbiter；stream loop 的 finish/error 只能作为证据输入，不直接越过 canonical outcome。
4. terminal arbiter 按 `canonical -> reconciled -> transport failure -> unknown error` 结算；删除从本地 `AbortSignal` 直接生成 aborted 的路径。
5. follow-up queue settlement、approval settlement、E2E record 和 port terminal 全部使用同一个 arbiter result。
6. 为 interrupt 前的 approval/user-input/elicitation 生成合法负响应，避免 app-server 卡在 server request。

退出条件：Main 的所有竞态排列测试只产生一个可解释 terminal，且诊断标记 outcome source。

### Phase 5 — Renderer 只消费权威 terminal

涉及文件：

- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts:95-111,190-193,345-374`
- `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts:75-120`
- `desktop-app/src/preload/chatStreamBridge.ts:90-148`
- `desktop-app/src/renderer/src/App.tsx`

行动：

1. `stop()` 只发送 stop intent并保持当前 active turn ledger；不得调用本地 `settleActiveTurn(... interrupted)`。
2. stop 后 suppress 新 chunk，但继续消费 `turn-lifecycle` 和最终 terminal。
3. Renderer 依据 terminal/canonical lifecycle更新：finish 正常完成、aborted interrupted、error failed；删除 AbortSignal 优先规则。
4. 保留即时交互反馈：停止按钮禁用或显示“正在停止”，但不得提前写入可持久化 cancelled metadata。
5. 确认 conversation navigation/reload 不会用 local recovery 把 unknown/completed 覆盖成 interrupted。

退出条件：Acceptance Criteria 1-5、12-14 的 renderer/preload 部分通过。

### Phase 6 — Reconciliation、诊断和连接隔离

涉及文件：

- `desktop-app/src/main/codexChatRuntimeService.ts`
- `desktop-app/src/main/conversations/ConversationApiService.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-client.ts`
- `desktop-app/src/shared/codexIpcApi.ts`
- `desktop-app/tests/e2e/diagnostics.e2e.ts`
- `desktop-app/tests/e2e/release-llm.e2e.ts:301-373`
- `docs/ai-sdk-provider-codex-asp-api.md:513-525`

行动：

1. 实现严格 threadId + turnId reconciliation；来源记录为 `notification` 或 `history-reconciliation`。
2. outcome 未知时输出固定脱敏错误；记录 interrupt 请求状态、canonical wait、对账结果和 connection generation，不记录 prompt、token、header、URL credential。
3. 移除 E2E snapshot 中 `terminalOutcome(terminal)` 的成功式 fallback；diagnostic 必须能区分 stop intent 和 canonical interrupted。
4. 对 fatal/uncertain connection 执行 generation 隔离和重连；旧 generation 的迟到 response/notification 不得进入新 run。
5. 更新 provider API 文档，删除“先关闭 consumer stream、后台 best-effort interrupt”的旧契约，明确 stop intent、interrupt RPC 和 canonical `turn/completed` 的顺序与 unknown-outcome 语义。

退出条件：Acceptance Criteria 5-6、13、15 通过，脱敏测试覆盖错误路径。

### Phase 7 — 集成、Mock E2E 和真实 R05 验证

涉及文件：

- `desktop-app/tests/e2e/release-llm.e2e.ts:116-153,340-373`
- `desktop-app/tests/e2e/conversation-state.e2e.ts`
- `desktop-app/tests/e2e/chat.e2e.ts`
- `desktop-app/tests/e2e/support/mockBackend.ts`
- `desktop-app/tests/test-plan-coverage.json`
- `docs/test-plan.md:27-30,292`

行动：

1. Mock backend 增加独立 gate：interrupt response、turn/completed、history visibility 和 transport close，可枚举全部竞态顺序。
2. 增加 active chat 期间并发 sidebar/history/catalog 的 E2E，证明 broker 是多路复用而非串行 worker。
3. 保留 R05 packaged、零工具、canonical history 和 reload 断言；追加 outcome source 断言。
4. 竞态 Mock E2E 以单 worker/单 browser `--repeat-each=20` 运行；每轮检查 terminal count、active run、broker channel、pending RPC、approval 和子进程计数均归零。
5. 更新覆盖清单和测试计划证据，只有全部必需断言通过后才能保持 R05 `covered`。

退出条件：全部 Acceptance Criteria 通过并收集验证输出。

## Risks and Mitigations

1. **JSON-RPC ID 冲突或错误路由**：多个 `AppServerClient` 都从 1 计数。缓解：broker 强制 wire ID namespacing，加入并发碰撞、timeout 和迟到 response 测试。
2. **Server request 被多个 channel 响应**：notification 可以 fan-out，但 approval/tool request 只能有一个 owner。缓解：thread/turn ownership 表、未知 owner fail-closed、所有请求类型的唯一投递测试。
3. **cross-call tool 回归**：当前 pending tool call 依赖 worker affinity。缓解：先抽取 thread-scoped continuation capability，再删除 worker affinity；运行全部 cross-call/dynamic-tool tests。
4. **停止 UI 变慢**：等待 canonical terminal 可能比本地 abort 多几十到数百毫秒。缓解：立即显示“正在停止”和停止 chunk 展示，但不提前持久化终态；canonical deadline 可注入并有 unknown error。
5. **history reconciliation 与 active stream 相互等待**：当前 pool size 1 会形成等待。缓解：Phase 1 先完成真正 multiplex broker，再启用同连接 reconciliation。
6. **旧 notification 污染重连后的 run**：缓解：connection generation + channelId + threadId + turnId 四重关联，旧 generation 一律丢弃并写脱敏诊断。
7. **已完成 turn 被 stop 覆盖**：缓解：canonical outcome 一旦记录不可覆盖；加入 completed-before-stop、same-tick 和 completed-after-interrupt-response 三组测试。
8. **错误清理破坏 background terminal**：缓解：turn interrupt 与 `thread/backgroundTerminals/clean` 分离，不在普通 stop 中隐式调用清理。
9. **dirty worktree 冲突**：当前连接和 R05 文件已有未提交改动。缓解：实施前逐文件核对 diff，只修改本计划列出的相关区域，不覆盖无关用户变更。
10. **参考 bundle 不可直接复制**：beautified 产物缺少源码和 sourcemap。缓解：只借鉴状态机和连接职责，用本项目类型、provider API 和测试重新实现，不复制压缩代码。

## Verification Steps

### Provider targeted

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test -- tests/app-server-connection.test.ts tests/persistent-transport.test.ts tests/app-server-client.test.ts tests/model.stream.test.ts tests/cross-call-tools.test.ts
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
```

### Desktop targeted

```bash
npm --prefix desktop-app test -- src/main/codexChatRuntimeService.test.ts src/preload/chatStreamBridge.test.ts src/renderer/src/lib/ElectronIpcChatTransport.test.ts src/renderer/src/runtime/ConversationTranscriptController.test.ts
npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
```

### Mock E2E

```bash
npm --prefix desktop-app run test:e2e -- --reporter=line --repeat-each=20
```

如果全量 E2E 时间过长，实施阶段先使用包含新增 canonical-terminal、connection-multiplexing 和 conversation-state 用例的 grep 运行；最终完成前仍必须运行一次全量 Mock E2E。

### Packaged release R05

```bash
npm --prefix desktop-app run test:e2e:release-llm -- --grep "R05"
```

必须保留失败附件，且只输出脱敏后的 threadId/turnId、terminal、outcome source、connection generation、pending request/channel 计数和测试截图。

### Boundary and hygiene

```bash
npm --prefix desktop-app run test:plan-coverage
git diff --check
git diff --name-only -- codex/codex-rs/app-server
```

最后一条必须无输出。

## Stop Condition

计划只有在以下条件同时满足时才完成：

- 用户 stop 不再直接触发本地 `aborted`；正式 terminal 均可追溯到 canonical notification 或严格 history reconciliation。
- 一个 host 只有一个 physical app-server connection，且 active chat 不阻塞 history/catalog/control request。
- completion/interruption/failure/unknown 的全部竞态排列有确定性测试，并且 terminal/cleanup 均 exactly once。
- Provider、Desktop、Mock E2E、packaged R05、覆盖清单和边界检查全部通过。
- `codex/codex-rs/app-server` 没有任何改动。
