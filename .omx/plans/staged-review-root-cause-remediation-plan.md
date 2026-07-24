# 暂存区审查阻断项根因修复计划

## 1. Requirements Summary

### 1.1 目标

修复本轮暂存区代码审查确认的阻断问题，并保证修复后的测试验证真实产品链路，而不是依靠生产代码中的测试开关、残缺 fixture、弱断言或客户端专用兜底制造绿灯。

最终结果必须同时满足：

1. Renderer 数据通道、用户停止意图、provider 模型流和 app-server turn 生命周期彼此分离。MessagePort 丢失不能取消权威 turn；只有用户明确停止或应用有界关闭流程才能请求 `turn/interrupt`。当前冲突位于 `desktop-app/src/main/codexChatRuntimeService.ts:716-726` 和 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:845-860`。
2. app-server 的 `threadId + turnId + canonical lifecycle/history` 是任务结果唯一真相。Main 必须先校验 lifecycle 身份，再向 Renderer 投递；无 session、无 canonical outcome 的流不能伪装为成功，Renderer 也不能为了兼容自定义测试 transport 把缺失 lifecycle 当作成功。当前问题位于 `desktop-app/src/main/codexChatRuntimeService.ts:569-582,837-842,1189-1203` 和 `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts:369-375`。
3. 每类协议事件只有一个明确所有者。真实 `dynamicToolCall` 不能同时由 dispatcher 和 event mapper 生成 UI call/result。当前双重入口位于 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/dynamic-tools.ts:163-279`、`desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:1002-1038` 和 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:478-494,602-624`。
4. 测试不得改变生产客户端的 sandbox、工具集、RPC 结果、调度顺序、MessagePort 或物理 app-server 连接。当前语义型测试开关位于 `desktop-app/src/main/e2eCheckpointGate.ts:14-45`、`desktop-app/src/main/codexChatRuntimeService.ts:647-652,860-865,921,1150,1293-1299`、`desktop-app/src/main/codexAspProvider.ts:54-58,65-106,145-167` 和 `desktop-app/src/main/index.ts:114-119`。
5. Renderer 本地存储只能保存有明确身份、容量和生命周期的 UI-only overlay；不得保存完整 prompt/reasoning/tool transcript 并与 app-server history 竞争。当前问题位于 `desktop-app/src/renderer/src/runtime/ConversationTranscriptRecoveryStore.ts:22-94` 和 `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:415-438,630-678`。
6. 普通 `queued` follow-up 在重启后仍为安全可发送状态；只有已经 claim 的 `sending/steering` 项才属于交付不确定状态。当前错误恢复位于 `desktop-app/src/main/followUps/ConversationFollowUpQueueStore.ts:103-112,167-199`。
7. 测试覆盖门禁必须读取本次真实测试运行结果和已执行断言证据；测试名存在、空测试或 skipped/fixme/fail/only 测试不能算覆盖。当前弱门禁位于 `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:240-309,328-349,390-394,462-465`。

### 1.2 硬边界

- 禁止修改 `codex/codex-rs/app-server/`。
- 禁止绕过 Codex app server 新建模型调用链路。
- 禁止新增依赖；优先使用 Vitest、Playwright 和 Node 现有 reporter/文件能力。
- 禁止为了维持旧测试通过而保留生产测试分支、伪造 canonical outcome、增加“遇到异常就吞掉”的兜底。
- 先以真实协议结构和目标行为写回归测试，再修改生产代码；fixture 必须适配生产协议，生产代码不能适配残缺 fixture。
- 本计划替代现有计划中与本轮审查结论冲突的部分，特别是把 MessagePort 故障当作 turn error/abort、把普通 queued 重启视为 uncertain、以及仅凭清单文字判定 covered 的规则。

### 1.3 不在本计划范围

- 不重写聊天 UI、模型目录或项目选择器。
- 不修改 app-server 协议或服务端持久化格式。
- 不扩大为通用事件溯源平台；只建立解决本轮 transcript/reconnect 问题所需的最小权威恢复边界。
- 不以代码风格重构替代功能修复；每个结构调整都必须对应下面的失败场景和验收标准。

## 2. 根因分组与目标设计

### 2.1 根因 A：一个 AbortSignal 同时承担了四种语义

当前 `ActiveConversationRun.abortController` 同时被用于 Renderer 通道故障、用户停止、provider 流释放和应用退出，导致数据面故障被升级为任务取消；`stop()` 又只 abort 并无限等待 `streamSettled`。证据位于 `desktop-app/src/main/codexChatRuntimeService.ts:716-789,960-969`。

目标状态机：

```text
running
  ├─ renderer-detached         -> turn 继续，Main 继续收集 canonical 结果
  ├─ stop-requested            -> 最多一次 turn/interrupt
  │    └─ canonical-settled    -> completed | interrupted | failed
  ├─ shutdown-requested        -> interrupt + 有界对账 + 本地强制释放
  └─ provider-fatal            -> history 对账或单一 failed

canonical-settled
  -> terminal-delivered-once
  -> resources-cleaned-once
```

设计约束：

- `handleChatStreamPortClosed()` 只标记数据通道不可用，并合法拒绝当前无法展示的审批；不得调用传给 provider 的 AbortSignal。
- `interruptConversation()` 和 shutdown 共用 `requestConversationInterrupt()`，但 shutdown 额外有可注入 deadline。
- matching `turn/completed` 或 matching history reconciliation 才能设置 canonical outcome。
- lifecycle 身份校验必须发生在 `port.postMessage()` 之前；旧 thread/turn、非单调事件直接丢弃并记录脱敏诊断。
- provider 在 session 创建前结束且没有明确 error/canonical completion 时返回稳定 error，不返回 `finish`。

### 2.2 根因 B：协议事件没有单一所有者

为动态工具建立显式所有权矩阵，禁止用事后“发现重复再去重”的补丁掩盖所有权冲突：

| 模式 | 执行责任 | UI call/result 唯一来源 | 禁止行为 |
| --- | --- | --- | --- |
| non-cross-call dynamic tool | dispatcher 调用 handler 并返回协议结果 | `event-mapper` 根据真实 `dynamicToolCall item/started + item/completed` 映射 | dispatcher 再直接 enqueue 相同 UI parts |
| cross-call continuation | cross-call coordinator/dispatcher | cross-call coordinator，mapper 保持 silent | mapper 和 dispatcher 同时输出 |
| app-server 原生工具 | app-server | `event-mapper` | dynamic dispatcher 介入 |

测试必须使用生成协议定义中的 `params.item` 结构；当前错误 fixture 位于 `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/dynamic-tools.test.ts:52-92`，真实结构可由 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/app-server-protocol/v2/ItemStartedNotification.ts:4-10` 和 `ThreadItem.ts:67-71` 约束。

### 2.3 根因 C：测试控制进入生产业务分支

测试只能在系统边界控制故障：

- MessagePort：通过 Renderer reload/window teardown 或测试直接持有的真实 MessageChannel 端关闭，不在 Main 中按环境变量主动关端口。
- steer rejection：provider 集成测试必须真的发出一次 `turn/steer`，由 scripted transport/mock app-server 返回 rejection；E2E 使用真实 turn 竞态或真实 server rejection，不允许 Main 预先抛错。
- app-server crash：通过既有 `CODEX_APP_SERVER_BIN` 测试 wrapper 或测试进程直接终止子进程，不能在 provider 公开 `terminatePhysicalTransportForTest()`。
- crash checkpoint：能从后端请求、磁盘 queue state 或真实 IPC 观察的边界由测试进程等待后直接 `crashApp()`；无法外部观察的极窄持久化竞态下沉为 store/service integration test，通过已有 I/O 依赖控制 promise，不再冒充全链路 E2E。
- release smoke：启动打包产物，使用正式 provider settings、正式 sandbox 计算和正式工具注册。工具场景在 disposable workspace 中调用真实只读工具并走真实审批，不注入 `read_thread_terminal` 假工具。

允许保留的测试配置只能选择外部资源，例如 userData 路径、mock backend 地址和临时 workspace；任何配置都不得改变客户端状态机、RPC 结果、工具目录或权限策略。

### 2.4 根因 D：Renderer recovery 与 app-server history 竞争

目标拆成两个互不越界的数据集合：

1. **Canonical transcript**：来自 app-server history 和 matching lifecycle，由 Main/provider 提供。
2. **Local overlay**：只保存 app-server 本身不持久化的 UI-only 附件展示数据，并带稳定 `{threadId, itemId/clientUserMessageId, baseRevision}`。

约束：

- Renderer localStorage 不再保存整段 messages、reasoning、tool args/results 或 assistant text。
- 本地附件 overlay 只允许白名单字段，并且只能按稳定 message identity 合并；“文本相同/role 相同”不能作为长期身份。
- 默认依赖现有 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-mapper.ts:50-110` 恢复 reasoning、tool 和失败/中断状态，不再复制完整 transcript。
- overlay 对应的 canonical item 已包含同等 UI metadata 后立即删除；默认保留期 7 天、每 profile 上限 5 MiB、最多 100 个 conversation，按最旧记录淘汰。
- 旧 `ConversationTranscriptRecoveryStore` 数据迁移时只提取白名单附件 overlay，丢弃完整 transcript 副本并删除旧 key。
- 如果真实回归测试证明 app-server history 确实缺少必须跨重启保留的产品数据，停止本阶段并单独设计 Main-owned、可对账的 durable journal；不得在本计划中顺手新增另一个 transcript 真相源。

### 2.5 根因 E：queue recovery 不区分“未发送”和“已 claim”

恢复矩阵固定为：

| 持久化状态 | 重启后状态 | 原因 |
| --- | --- | --- |
| `queued` | `queued` | 尚未 claim，可安全恢复调度 |
| `editing` | `editing` | 用户本地编辑，不能自动发送 |
| `sending` / `steering` | `paused-recovery-uncertain` | 已 claim，必须按 `clientUserMessageId` 与 canonical history 对账 |
| `accepted` | 删除 | 已有 canonical 接受证据 |
| `paused-*` | 原状态 | 需要用户明确处理 |

删除 `pauseQueuedItems` 这类调用方补丁参数；状态本身必须包含足够信息决定恢复语义。

### 2.6 根因 F：coverage 清单自证

新的 coverage gate 由三类输入交叉验证：

1. `tests/test-plan-coverage.json`：声明场景、required layer 和稳定 assertion ID。
2. 本次 Vitest/Playwright/Node test 报告：证明完整测试名在本次运行中实际执行且 passed。
3. 测试专用 `planAssert(scenarioId, assertionId, assertionFn)` 证据：只有 assertion callback 成功返回后才记录 assertion ID；reporter 按 runId、test file、full test name 聚合。

门禁必须拒绝：

- report 中不存在、未运行、failed、skipped、fixme、expected-fail 或 only 运行的 evidence；
- 测试虽然 passed，但缺少 required assertion ID；
- 空测试、旧报告、不同 runId 报告、重复或来源不匹配的 assertion evidence；
- P0/P1 场景把失败证据改成 deferred/covered。

## 3. Acceptance Criteria

以下条件全部满足后才能解除 `REQUEST CHANGES`：

### 3.1 Task lifecycle 与 shutdown

1. 真实 MessagePort 在部分文本后关闭时，底层 app-server turn 收到 `turn/interrupt` 的次数为 0；matching canonical `completed` 仍被 Main 记录，Renderer 通过 fallback/reconnect 最多收到一个正式 terminal。
2. MessagePort 关闭后出现审批请求时，审批按正式 decline 路径结算；turn 可以继续失败或完成，不能因本地 Promise 泄漏永久挂起。
3. 用户明确停止最多发送一次 `turn/interrupt`；`turn/completed(completed)`、`interrupted`、`failed` 分别唯一映射为 `finish`、`aborted`、`error`。
4. lifecycle 事件的 threadId 或 turnId 与 active run 不匹配时，Main 和 Renderer 的接收计数均为 0；当前 ledger identity 不改变。
5. provider 在 `onSessionCreated` 前静默结束且没有明确 error 时，Main 只产生一个稳定 error；不得产生 `finish`。
6. runtime shutdown 对每个 active run 先执行 interrupt/对账；canonical notification 永久缺失时，使用可注入 deadline 在生产默认 10 秒内退出等待并完成 provider shutdown。单元测试用 fake timer，不使用真实 10 秒等待。
7. shutdown deadline 到达后，本地 stream、approval、follow-up claim、timer 和 active run registry 全部归零；应用退出不无限等待。

### 3.2 Provider 与 connection broker

8. 使用真实 `dynamicToolCall` `params.item` 结构时，每个 toolCallId 恰好产生一个 `tool-call` 和一个 `tool-result`，顺序固定，non-cross-call/cross-call 两种模式分别覆盖。
9. dynamic tool handler 抛错时仍只有一个 error result；重复/迟到 item notification 不能再次输出。
10. logical channel detach 后，属于该 channel 的 pending request 和 initialize waiter 数量立即为 0；其他 channel 和物理连接继续工作。
11. client request timeout 会显式通知 broker 取消对应 `{channel, localId}` route；迟到 response 被安全忽略，不保留 params。
12. physical transport fatal 时，全部 channel 的 pending route 一次性清零并各自得到一个失败结果。

### 3.3 测试隔离

13. `desktop-app/src` 中不再出现 `DASCOWORK_E2E_CHECKPOINT`、`DASCOWORK_E2E_FORCE_STEER_REJECTION`、`DASCOWORK_E2E_CLOSE_MESSAGE_PORT_AFTER_FIRST_TEXT_DELTA`、`DASCOWORK_E2E_CRASH_APP_SERVER_AFTER_FIRST_TEXT_DELTA`、`DASCOWORK_RELEASE_LLM_SMOKE` 的业务判断。
14. 删除 `e2eCheckpointGate.ts`、对应生产依赖和 `terminatePhysicalTransportForTest()`；测试目录可以拥有独立的 wrapper/gate，但生产 bundle 不引用它们。
15. steer rejection 集成测试断言：真实 `turn/steer` 请求次数为 1、server rejection 次数为 1、队列恢复/暂停次数为 1；不得断言 RPC 次数为 0。
16. MessagePort E2E 通过真实 reload/teardown 制造故障，并断言 app-server turn 最终 canonical completed；测试不能只断言 UI error。
17. release smoke 的 provider settings 与普通打包运行完全相同；正式 `codexAspProvider.ts` 不根据 smoke 环境变量改 sandbox 或 tools。
18. release 工具用例使用 disposable workspace、真实工具注册和真实审批 UI；如果产品没有安全的只读工具，则该用例标为缺口并修复正式工具配置，不能注入假工具。

### 3.4 Recovery 与 queue

19. localStorage 中不存在完整 assistant text、reasoning、tool args/result 或完整 messages snapshot；只存在版本化、白名单 local overlay。
20. app-server history 与 local overlay 冲突时，canonical item/outcome 100% 获胜；本地数据只能补充白名单附件 metadata，不能追加或替换 assistant/reasoning/tool item。
21. canonical history 已包含同等 metadata 后对应 overlay 立即删除；TTL、5 MiB 和 100 conversation 三个边界均有 `limit - 1 / limit / limit + 1` 测试。
22. 普通 `queued` 项重启后仍为 `queued`，scheduler 恢复后只发送一次；`turn/start` 或 `turn/steer` 计数为 1。
23. `sending/steering` 项重启后进入 uncertain 且无 lease；canonical 已含相同 `clientUserMessageId` 时删除，否则不自动重发。
24. `accepted` 项重启后删除，`editing` 和现有 paused 状态不被错误调度。

### 3.5 Coverage 与质量门禁

25. coverage validator 的空测试 fixture 必须失败；把 evidence 改成 `skip/fixme/fail/only` 必须失败。
26. 删除一个真实 `planAssert`、伪造旧 report、修改 runId 或让 evidence test 失败时，coverage gate 均非零退出。
27. 正常门禁只能消费本次命令生成的 test report 和 assertion evidence；全部 required assertion ID 实际执行并通过后才返回 0。
28. `git diff --check` 通过；当前 `.omx/evidence/test-plan2-u4-verification-ledger-2026-07-23.md` 的行尾空白必须清理。
29. `git diff --name-only -- codex/codex-rs/app-server` 输出为空。
30. Provider lint/typecheck/tests、Desktop lint/typecheck/unit/integration/mock E2E 全部通过；release smoke 在具备凭据和打包产物的发布门禁中通过。

## 4. Implementation Steps

### Phase 0 — 先替换错误 fixture 和假绿断言

涉及文件：

- `desktop-app/src/main/codexChatRuntimeService.test.ts:101-108,525-528,3592-3711`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/dynamic-tools.test.ts:52-92,367-410`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/event-mapper.test.ts:929-1080`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/app-server-connection.test.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/app-server-client.test.ts`
- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.test.ts`
- `desktop-app/src/main/followUps/ConversationFollowUpQueueStore.test.ts:142-199`

行动：

1. 把 provider fixtures 改成生成协议的真实 `params.item` shape；对 call/result 使用 `filter(...).toHaveLength(1)`，不得再用 `find()` 或“至少存在一个”。
2. Main stream fixture 必须调用真实顺序的 `onSessionCreated`、`turn-started` 和 `turn-completed`；删除通过生产代码兼容无 session fixture 的断言。
3. MessagePort 测试分开记录 `port terminal`、`IPC fallback terminal`、`turn/interrupt` 和 canonical lifecycle，先写出“端口断开但 turn completed”的失败测试。
4. shutdown 测试不能直接 `finished.resolve()` 证明退出；必须分别覆盖 canonical 正常到达和永久丢失后 deadline 释放。
5. queue 测试把 E12 目标改为普通 queued 安全恢复；保留 sending/steering uncertain 的独立断言。
6. 所有新增测试使用 deferred/fake timer/显式协议事件，不使用固定 sleep。

退出条件：

- 目标回归测试在生产代码修复前能够稳定暴露问题。
- 测试失败原因是产品语义不符合目标，不是 fixture 类型错误或超时。

### Phase 1 — 重建 Main 的权威 run lifecycle

涉及文件：

- `desktop-app/src/main/codexChatRuntimeService.ts:569-604,710-845,960-970,1189-1220`
- `desktop-app/src/main/index.ts:698-773,780-790`
- `desktop-app/src/preload/chatStreamBridge.ts`
- `desktop-app/src/shared/codexIpcApi.ts`
- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts:280-304`

行动：

1. 把 run 状态拆成 renderer subscription、stop intent、canonical settlement 和 provider release 四个正交字段；禁止用 `abortController.signal.aborted` 推导用户取消。
2. `handleChatStreamPortClosed()` 只 detach 当前 subscription、设置可诊断的数据通道状态，并通过正式 approval decline 清理不可展示的审批；继续消费 provider stream。
3. 将 lifecycle 处理拆成同步 identity gate 和串行副作用 settlement。只有 gate 接受的事件才能发给 Renderer。
4. 删除 `!run.session && !fallback -> finish`；无 canonical completion 一律走稳定 error。
5. 实现 `settleRunForShutdown(run, deadline)`：发送最多一次 interrupt、等待 matching canonical、必要时立即 history reconciliation，deadline 后只强制释放本地 provider stream。
6. 把 `runtime.stop()` 的顺序固定为：停止接收新任务 → decline approvals → 并发结算 active runs → 有界释放未决本地流 → provider shutdown → 清理 registry/timer。
7. Renderer 对不匹配 thread/turn/generation 的 lifecycle 返回 no-op；不能用迟到事件改绑当前 ledger。
8. Renderer stream 结束但 active turn 没有 canonical outcome 时结算为稳定 error；删除 `ConversationTranscriptController.ts:369-375` 对“不提供 lifecycle 的测试/custom transport”的成功兼容，相关 transport fixture 必须补齐协议事件。

退出条件：

- Acceptance Criteria 1-7 全部通过。
- MessagePort 故障、用户 stop、shutdown 和 provider fatal 四类测试能从计数和 outcome 上清楚区分。

### Phase 2 — 修复 provider 事件所有权和 broker 生命周期

涉及文件：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/dynamic-tools.ts:140-279`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:990-1038`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:450-624`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/connection-broker.ts:123-158,351-376`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-client.ts:150-190`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-connection.ts:40-91`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/transport.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/app-server-client.test.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/app-server-connection.test.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/persistent-transport.test.ts`

行动：

1. 按 2.2 的所有权矩阵删除重复 enqueue 路径；不要增加全局“已见 callId”集合来掩盖双 owner。
2. 将 non-cross-call 和 cross-call 模式写成明确分支/类型，保证每种 mode 恰好一个 UI emitter。
3. 给 logical transport 增加请求取消/route release 能力；AppServerClient timeout 或 disconnect 时通知 broker 删除 `{channel, localId}`。
4. broker detach 清理该 channel 的 pending request、initialize waiter、thread/turn ownership 和 continuation；不影响其他 channel。
5. pending route 只保存响应路由需要的最小 `{channel, localId, method, threadId?}`，不长期保留完整 params。
6. `CodexAppServerConnection.shutdown()` 增加可注入 deadline；deadline 到达时通知 logical channel termination、清零 lease/pending route，再关闭物理连接，不能无限等待 `activeLeaseCount`。
7. fatal physical disconnect 统一清理所有 route 和敏感 params；late response 只记脱敏诊断。
8. diagnostics 增加可测试的 pending channel/request/lease 数量，不暴露请求正文。

退出条件：

- Acceptance Criteria 8-12 全部通过。
- provider 真实协议 fixtures 下无重复 tool part、pending route 或跨 channel 回调。

### Phase 3 — 删除生产测试钩子，改用边界故障测试

涉及文件：

- 删除 `desktop-app/src/main/e2eCheckpointGate.ts`
- 删除/重写 `desktop-app/src/main/e2eCheckpointGate.test.ts`
- `desktop-app/src/main/index.ts:110-119,214-218,758-773`
- `desktop-app/src/main/codexChatRuntimeService.ts:186-239,289-323,647-696,860-865,921,1150,1293-1299`
- `desktop-app/src/main/codexAspProvider.ts:18-24,50-58,65-106,145-167`
- `desktop-app/src/preload/index.ts:38-47`
- `desktop-app/src/preload/chatStreamBridge.ts:150`
- `desktop-app/src/shared/codexIpcApi.ts:35,467-484`
- `desktop-app/scripts/run-dev-llm-smoke.mjs:8-14`
- `desktop-app/scripts/run-release-llm-smoke.mjs`
- `desktop-app/tests/e2e/fault-injection.e2e.ts:136-391`
- `desktop-app/tests/e2e/follow-up-queue-steer.e2e.ts:633-737`
- `desktop-app/tests/e2e/checkpoint-restart.e2e.ts:281-344`
- `desktop-app/tests/e2e/release-llm.e2e.ts:80-173`
- `desktop-app/tests/e2e/support/app.ts`
- `desktop-app/tests/e2e/support/mockBackend.ts:30-46,53-138`

行动：

1. 删除所有会改变生产状态机、RPC、工具、sandbox、端口或物理 transport 的环境变量分支及其 shared/preload 暴露；E2E-only diagnostics bridge 也移到测试进程，产品若保留通用诊断只能是只读且不改变行为。
2. MessagePort E2E 改为 partial output 后 reload/关闭 Renderer subscription；backend response gate 保持 turn 活跃，reload 后释放 gate并验证 canonical completion。
3. steer rejection 在 provider integration 中由 scripted transport 对真实 `turn/steer` 返回 JSON-RPC error；E2E 用 app-server 可真实产生的 inactive/race 场景，断言真实 RPC 次数，不伪造错误。
4. app-server crash 测试使用测试目录中的 wrapper executable 或测试进程外部终止子进程；生产 provider 不提供 test-only kill API。
5. checkpoint restart 用后端已收到请求、磁盘 queue state 或测试持有的 I/O promise 作为 gate。无法外部观察的阶段降级为明确标注的 integration test，并同步修改 coverage required layer，不能保留虚假 E2E 标签。
6. release smoke 删除假 `read_thread_terminal`；工具场景改为 disposable workspace 内的正式只读工具和真实审批。开发 smoke 也不再强制 smoke 专用生产配置。
7. 对 `desktop-app/src` 中所有 `DASCOWORK_E2E_*`/`DASCOWORK_RELEASE_*` 做审计；仅保留外部资源选择，记录保留理由。

退出条件：

- Acceptance Criteria 13-18 全部通过。
- production build 不包含语义型测试钩子字符串或 test-only API。

### Phase 4 — 收回 transcript 真相源并限制本地恢复

涉及文件：

- `desktop-app/src/renderer/src/runtime/ConversationTranscriptRecoveryStore.ts`
- `desktop-app/src/renderer/src/runtime/ConversationTranscriptRecoveryStore.test.ts:40-118`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:415-438,630-678`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.test.ts:151-184`
- `desktop-app/src/main/conversations/ConversationApiService.ts`
- `desktop-app/src/main/conversations/AppServerThreadClient.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-mapper.ts:50-110`

行动：

1. 删除基于“server history 是 local prefix”“parts 更多就获胜”的完整 transcript merge。
2. 把附件等 Renderer-only 数据改成白名单 overlay，键必须包含稳定 message identity；没有稳定 identity 时不合并。
3. 由现有 history mapper 恢复 canonical reasoning/tool/失败状态；如果回归测试发现 mapper 缺项，修复 provider history mapping，而不是复制 Renderer transcript。
4. 实现 canonical-wins、attachment-metadata-only、TTL、容量、条数和立即清理规则。
5. 迁移旧 localStorage schema：仅提取白名单 overlay，成功后删除旧完整 transcript key；迁移失败只丢弃缓存，不影响 app-server history。
6. quota/parse/migration 失败写脱敏诊断，不能静默吞掉并让 UI 误以为恢复成功。

退出条件：

- Acceptance Criteria 19-21 全部通过。
- Renderer 不再决定 app-server history 与本地 transcript 谁获胜。

### Phase 5 — 修正 follow-up queue 重启语义

涉及文件：

- `desktop-app/src/main/followUps/ConversationFollowUpQueueStore.ts:103-112,167-199`
- `desktop-app/src/main/followUps/ConversationFollowUpQueueStore.test.ts:124-199`
- `desktop-app/src/main/followUps/ConversationFollowUpQueueService.ts`
- `desktop-app/tests/e2e/conversation-state.e2e.ts:148-255`
- `desktop-app/tests/test-plan-coverage.json` 的 E12/E14/E17 证据
- `docs/test-plan.md` 对应恢复规则

行动：

1. 删除 `pauseQueuedItems`，恢复逻辑只根据持久化状态和 lease/identity 决策。
2. 普通 queued 保持 queued；scheduler 恢复后沿用原队列顺序和原 `clientUserMessageId` 发送一次。
3. sending/steering 清 lease 并暂停，随后由 canonical history 对账决定删除或等待用户重试。
4. accepted 删除；editing 和已暂停项保持不变。
5. 重写 E12 E2E：正常重启后 queued 最终发送一次，不再断言 `paused-recovery-uncertain`。
6. manifest 先标记旧证据 invalid/partial，只有新行为测试真实通过后才能恢复 covered。

退出条件：

- Acceptance Criteria 22-24 全部通过。

### Phase 6 — 将 coverage gate 接到真实执行结果

涉及文件：

- `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:240-465`
- `desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs:23-29,324-334`
- `desktop-app/scripts/verify-test-plan-coverage.mjs`
- `desktop-app/tests/test-plan-coverage.json`
- `desktop-app/package.json:8-18`
- 新增 test-only evidence helper/reporter

行动：

1. 删除“扫描源码找到测试名即算 evidence”的主判定；源码扫描最多用于提示，不参与 covered。
2. 为 Vitest、Playwright 和 Node tests 生成带唯一 runId 的实际结果文件；记录 file、full test name、status、duration、modifier。
3. 新增 test-only `planAssert()`，断言 callback 成功后记录 `{runId, scenarioId, assertionId, file, fullTestName}`；生产 bundle 不导入该 helper。
4. validator 交叉校验 manifest、test report 和 assertion evidence，拒绝旧 run、空 assertion、失败/跳过/only/fixme/fail evidence。
5. 重写 validator 自测：空测试默认失败；只有真实执行并记录全部 assertion ID 的 fixture 才通过。
6. `npm run test:plan-coverage` 先运行要求的 evidence tests 并生成临时 artifacts，再验证；验证完成后清理临时 artifacts，不把旧报告当输入。
7. 不为了快速全绿把 required assertions 合并成一个笼统 ID；每个行为结果、RPC 次数、UI 状态和持久化状态保持独立 ID。

退出条件：

- Acceptance Criteria 25-27 全部通过。
- coverage gate 的绿灯可以追溯到本次实际通过的测试和执行过的 assertion。

### Phase 7 — 集成验证、清理和文档收口

涉及文件：

- `docs/test-plan.md`
- `desktop-app/tests/test-plan-coverage.json`
- `.omx/evidence/test-plan2-u4-verification-ledger-2026-07-23.md`
- 本计划涉及的全部 tests 和 production files

行动：

1. 删除被新架构替代的旧 helper、环境变量、测试说明和证据；不保留兼容分支。
2. 更新测试计划中的 MessagePort、queued restart、release smoke 和 coverage 定义，使文档与真实产品语义一致。
3. 重新生成本次测试证据；旧的假绿 evidence 不得沿用。
4. 执行完整质量门禁和 `git diff --check`，确认 app-server 无改动。
5. 做一次新的独立代码审查，重点复查：是否出现新的双真相源、after-the-fact 去重、测试专用生产分支、吞错兜底或 fixture 驱动的生产判断。

退出条件：

- Acceptance Criteria 28-30 全部通过。
- 独立 code review/architect/test-integrity 三个检查均不再给出阻断结论。

## 5. 执行依赖与拆分建议

1. Phase 0 是全部实现的前置条件。
2. Phase 1 和 Phase 2 可在 Phase 0 后并行，但 Phase 3 必须等它们的真实边界稳定后再改 E2E。
3. Phase 4 和 Phase 5 可独立实施，但都必须在 Phase 6 前产生真实 assertion evidence。
4. Phase 6 必须最后接入全部新测试，避免 validator 再次围绕旧测试名称构建假绿。
5. Phase 7 只做收口，不允许在此阶段新增补丁式行为分支。

建议按独立提交分组：

1. regression tests and protocol-real fixtures
2. authoritative run lifecycle and bounded shutdown
3. dynamic tool ownership and broker cleanup
4. production test-hook removal and boundary fault E2E
5. canonical recovery and queue restart semantics
6. executed-evidence coverage gate
7. docs/evidence/quality cleanup

## 6. Risks and Mitigations

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| MessagePort detach 后出现 approval | 无 Renderer 可交互，turn 卡住 | Main 通过正式 approval decline 响应；不 abort turn，不泄漏 Promise |
| shutdown deadline 过短 | canonical outcome 迟到 | 生产默认 10 秒、测试可注入；deadline 前主动 interrupt + history reconciliation |
| dynamic tool owner 切换丢事件 | UI 看不到工具状态 | 用真实生成协议 fixtures 覆盖 non-cross-call/cross-call，并断言 exactly once |
| 删除 checkpoint 后 crash E2E 难以稳定 | 恢复测试变 flaky | 只使用后端/磁盘/真实 IPC 可观察边界；无法外部观察的阶段诚实下沉 integration |
| 删除完整 transcript cache 后发现 history mapper 缺项 | F16 体验退化 | 先修 provider history mapping；若 app-server 本身不持久化必要数据，暂停并单独做架构决策，不能立即加第二真相源 |
| queued 重启自动发送造成重复 | 用户消息重复 | 只有无 lease queued 自动恢复；sending/steering 必须 canonical 对账 |
| test reports 并发串线 | coverage 假绿/假红 | 每次命令生成唯一 runId、独立临时目录，validator 拒绝混合 run |
| release tool smoke 有副作用 | 污染开发机器 | disposable workspace、正式只读操作、真实审批，测试后删除临时目录 |
| 大范围暂存改动产生交叉冲突 | 修复难审 | 按根因提交，禁止 Phase 7 才混合功能修复；每阶段单独跑目标测试 |

## 7. Verification Steps

### 7.1 静态边界

```bash
git diff --check
git diff --name-only -- codex/codex-rs/app-server
rg -n 'DASCOWORK_E2E_(CHECKPOINT|FORCE_STEER_REJECTION|CLOSE_MESSAGE_PORT_AFTER_FIRST_TEXT_DELTA|CRASH_APP_SERVER_AFTER_FIRST_TEXT_DELTA)|DASCOWORK_RELEASE_LLM_SMOKE|terminatePhysicalTransportForTest|e2eCheckpointGate' desktop-app/src
```

预期：

- 前两条分别无格式错误、无 app-server 文件。
- `rg` 对生产 `desktop-app/src` 返回 1（无匹配）；测试/脚本中的外部资源开关另行审计。

### 7.2 Provider

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test -- tests/dynamic-tools.test.ts tests/event-mapper.test.ts tests/model.stream.test.ts
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test
```

必须额外检查测试输出中的 exact-once 断言和 broker pending count，不以“测试文件通过”代替行为证据。

### 7.3 Desktop unit/integration

```bash
npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
npm --prefix desktop-app run test -- src/main/codexChatRuntimeService.test.ts src/main/followUps/ConversationFollowUpQueueStore.test.ts src/renderer/src/runtime/ConversationTranscriptController.test.ts src/renderer/src/runtime/ConversationTranscriptRecoveryStore.test.ts src/renderer/src/runtime/ConversationChatRegistry.test.ts
npm --prefix desktop-app run test
```

### 7.4 Mock E2E 与恢复稳定性

```bash
npm --prefix desktop-app run test:e2e -- --grep '(@terminal-failure|@recovery|@approval-retry)'
npm --prefix desktop-app run test:e2e:stability
```

每个故障用例必须同时断言 UI、canonical turn、真实 RPC 数量、queue/approval 清理和 active run 数量。

### 7.5 Coverage evidence

```bash
npm --prefix desktop-app run test:plan-coverage:validator
npm --prefix desktop-app run test:plan-coverage
```

在正式通过前，额外执行三次反向验证：

1. 临时将一个 evidence test 标为 skip，门禁必须失败。
2. 临时删除一个 required `planAssert`，门禁必须失败。
3. 给 validator 传入上一轮 runId 的报告，门禁必须失败。

反向验证只在临时工作区或测试 fixture 中完成，不修改最终生产代码/manifest。

### 7.6 Release gate

```bash
npm --prefix desktop-app run build:unpack
npm --prefix desktop-app run test:e2e:release-llm
```

发布门禁必须证明：

- 使用 packaged app 和 packaged app-server；
- provider settings、sandbox 和工具目录未被 smoke 标志改写；
- 工具用例真的经过正式工具注册和审批；
- terminal、Composer 恢复、thread history 和 tool record 全部正确。

## 8. 已验证的门禁缺口与修复方式

以下是计划编写时已经用真实命令确认的缺口。它们不是“把断言放宽”或“延长超时”可以解决的问题。

1. `npm --prefix desktop-app test` 当前会让 Vitest 扫入 `codex/sdk/typescript/tests` 的 Jest 用例，以及不属于当前测试项目的 renderer 路径；因此出现 `@jest/globals`、`jest is not defined` 和 `@/...` alias 解析失败。修复应收紧 desktop Vitest 的 `root/include/exclude`，或拆为明确的 test projects。不得为让该命令变绿给 desktop 安装 Jest、复制 alias、或在被误扫的测试中加 skip。
2. 同一全量入口还会以错误 cwd 执行 provider 的 `transport-stdio.test.ts`，使其 fixture 路径无法按 package 根目录解析并在 5 秒后超时。修复应由 provider package 自己的 test script 运行，或让该测试的 fixture 以 `import.meta.url` 定位；不得仅提高 timeout，也不得在 transport 生产实现中添加 test-only cwd fallback。
3. `tests/e2e/support/terminalScenario.ts` 当前会把“历史与已显示内容保留”“不能重复 claim 或自动重发”等 assertion ID 绑定到“一个错误卡片存在”或“queue snapshot 非空”等泛化检查；这不能证明对应行为。重构为一项 assertion ID 对应一项显式 predicate：无法由 terminal helper 固有观察到的（history、revision、lease、exact RPC count）必须在具体 E2E 中用独立 `planAssert` 断言。M09 必须显式断言 canonical failed history、重启后的文本恢复、queue revision/item 精确值，以及两次 provider/turn 的精确计数。
4. 当前环境启动 Electron E2E 时会 SIGABRT，release smoke 还依赖打包产物和凭据。两项保持 release/E2E gate 的失败状态，待可启动的 Electron 环境和发布凭据具备后执行；不得在 renderer/Main 加检测环境后跳过或伪造 app-server 终态。
5. 当前 provider 工作区差异有大量行尾空白（包括 CRLF 被 `git diff --check` 当作 trailing whitespace 报出）。在功能改动完成后，单独进行无语义的 LF/格式化收口并复跑 provider lint；该提交不得包含重命名、条件分支或行为变化，且 `git diff --check` 与 `git diff --cached --check` 必须各自独立返回 0。

## 9. Stop Conditions

计划执行在以下任一条件出现时停止当前阶段并回到根因分析，不能继续叠加兜底：

1. 为让测试通过需要在 `desktop-app/src` 新增 test-only 环境变量或 fake tool。
2. 需要从 Renderer/localStorage 猜测 canonical turn outcome。
3. 需要同时保留两个 dynamic tool UI emitter，再靠 callId 集合去重。
4. 需要把普通 queued 统一暂停来避免重复，而不是修复 claim/identity。
5. coverage gate 仍无法证明 evidence 在本次运行中实际执行并通过。
6. 任何修改触及 `codex/codex-rs/app-server/`。
