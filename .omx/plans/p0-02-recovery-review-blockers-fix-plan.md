# P0-02 恢复链路审查阻断项修复计划

状态：`IMPLEMENTATION READY`

日期：2026-07-25

输入证据：

- 暂存区代码审查结论：`REQUEST CHANGES`
- 架构状态：`BLOCK`
- 上游计划：`.omx/plans/p0-02-active-task-reconnect-and-local-recovery.md`

## 1. Requirements Summary

本计划只处理本轮代码审查确认的恢复阻断项，不扩大到新的恢复功能：

1. attach 失败、run 消失、runId 不匹配和 journal 不可补发必须保持为可区分的失败状态，不能合成 `finish` 或 `ready`。
2. “查询时本来就没有 active run”仍是正常空结果；“已经查询到 run，随后 attach 被拒绝”必须是恢复失败。这两个结果不能继续共用 `null/finish/ready` 表达。
3. provider/main 的 existing-turn recovery 必须使用结构化错误码控制流程，不能匹配英文异常文案。
4. renderer 必须保留已回放内容，同时把没有权威终态的恢复失败显示为 `needs_resume/error`，不能因正常关闭 `ReadableStream` 而吞掉错误。
5. 回归测试先于实现落地，且必须通过真实生产函数暴露当前错误；不得把 mock 返回值、测试钩子或宽松断言改成“看起来通过”。
6. 禁止修改 `codex/codex-rs/app-server/`，禁止绕过 Codex app server，禁止在 `desktop-app/src/` 添加 test-only 分支或环境开关。
7. 不新增依赖；复用当前 Zod、Vitest、Playwright 和 provider 错误体系。

范围边界：managed worktree 创建、元数据写入和恢复尚未形成可达的产品链路，因此不属于本轮恢复阻断项。相关契约、实现和测试统一留给 P0-03；本计划不以 worktree 恢复作为解除当前 `REQUEST CHANGES` 的条件。

## 2. Confirmed Root Causes

### 2.1 attach 拒绝被伪装为成功终态

- `CodexChatRuntimeService.attachChatStream()` 只返回 boolean，无法区分 run 不存在与 runId 不匹配，见 `desktop-app/src/main/codexChatRuntimeService.ts:812-824`。
- IPC handler 在 boolean 为 false 时主动发送 `{type: "finish"}`，见 `desktop-app/src/main/index.ts:767-777`。
- preload 在已有 MessagePort 发生故障后，如果重新查询不到 active run，也发送 `finish`，见 `desktop-app/src/preload/chatStreamBridge.ts:115-150`。
- `finish` 会走成功终态回调，因此 run/journal 的未知状态被错误转换成任务完成。

### 2.2 renderer 的“正常关闭以保留已排队 chunk”缺少失败优先级

- reconnect error 为保留 error 前已入队的 replay chunk，调用 `onStreamError` 后正常关闭 `ReadableStream`，见 `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts:195-210`。
- `ConversationTranscriptController.resumeStream()` 消费完正常关闭的 stream 后，先判断 `!activeStreamAccepted` 并收敛到 `ready`，没有先检查 `recoveryError`，见 `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts:247-267`。
- registry 再根据 controller 的返回值和 error 推导 `recoveryPhase`，见 `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:570-600`；上游错误一旦被 controller 清掉，UI 就显示为已附加。

### 2.3 provider 恢复依赖英文文案

- main 通过 `"app server transport"`、`"closed"`、`"terminated"` 子串决定是否恢复 active turn，见 `desktop-app/src/main/codexChatRuntimeService.ts:2463-2480`。
- active turn 不存在通过完整英文句子匹配，见 `desktop-app/src/main/codexChatRuntimeService.ts:2483-2486`。
- provider 已有 `CodexProviderError`，但没有稳定 code，见 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/errors.ts:1-9`。
- transport close/termination 与 active-turn-unavailable 都在 provider 内创建普通 `CodexProviderError`，见：
  - `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-client.ts:118-132,359-374`
  - `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/connection-broker.ts:355-370,564-584`
  - `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:1202-1214`

## 3. Architecture Decisions

### 3.1 用一个共享的结构化 failure contract 贯穿 main → preload → renderer

在 `desktop-app/src/shared/codexIpcApi.ts:151-214` 定义：

- `CodexChatStreamFailureCode`
- `CodexChatStreamFailure`
- error terminal 携带 `{code, message}`，不再只传裸字符串
- attach 结果使用判别联合：
  - `attached`
  - `run-unavailable`
  - `run-mismatch`
  - `journal-unavailable`

语义固定为：

1. 在发起 attach 前查询不到 run：正常 no-op，bridge 返回 `null`，renderer 保持历史的 ready 状态。
2. 查询到具体 `runId` 后 attach 被拒绝：发送结构化 recovery failure，禁止发送 `finish`。
3. run 存在但 journal 已溢出：保留 `resync-required/journal-unavailable`，禁止降级成普通 provider error。
4. `finish` 只能来自该 run 的权威 terminal journal 或实时 terminal event。

`CodexChatRuntimeService.attachChatStream()` 返回带原因的结果；`desktop-app/src/main/index.ts` 只转发该结果，不自行猜测终态。

### 3.2 renderer 使用显式恢复状态机，不从 stream close 推断成功

`ConversationTranscriptController.resumeStream()` 按以下优先级收敛：

1. `stream === null`：attach 前已确认无 active/recent run，正常 no-op。
2. 收到结构化 recovery failure：保留 replay chunk，状态为 `error`，`recoveryPhase` 为 `needs_resume`。
3. 收到 `aborted/interrupted`：保留 partial transcript，状态 ready，turn metadata 为 interrupted。
4. 收到 failed terminal：保留 partial transcript，状态 error。
5. 收到 completed terminal：状态 ready。
6. stream 已创建但未收到 accepted event、terminal 或 failure 就关闭：视为未知恢复失败，不能设为 ready。

`ReadableStream` 仍可正常 close 以保留已排队 chunk；正确性由显式 failure/terminal 状态决定，不再依赖 close/error 机制承载业务语义。

`classifyConversationRecoveryError.ts:1-44` 先按稳定 code 分类和决定是否允许一次自动重试；只对没有 code 的旧/通用错误保留显示层 fallback，fallback 不得触发 existing-turn recovery。

### 3.3 provider 错误码是 main 恢复决策的唯一依据

扩展 `CodexProviderError`：

- `app_server_transport_closed`
- `app_server_transport_terminated`
- `active_turn_unavailable`

在 `toUIMessageStream({onError})` 中保留原始 error/code，再生成脱敏文本；main 的恢复分支只读取 code：

- transport closed/terminated + threadId + turnId + existing recovery state → 尝试一次 `resumeActiveTurn`
- active_turn_unavailable → canonical outcome 收敛为 interrupted
- 无 code 的相同英文文本 → 普通失败，不触发恢复

删除 `canResumeActiveTurnAfterTransportError(..., message)` 和 `isExistingTurnUnavailableError()` 的文案匹配实现。

### 3.4 managed worktree 延后到完整链路设计

本轮不修改 `ManagedWorktreeMetadata`、`WorkspaceRecoveryService`、恢复提示 UI 或对应测试，也不为尚不可达的恢复分支补局部契约。

P0-03 必须把以下内容作为一个完整功能共同设计和验证：

1. managed worktree 的创建时机与用户入口。
2. 元数据的生产写入、更新和失效规则。
3. 丢失 worktree 后的检查、恢复和 revision 身份校验。
4. 从真实创建到真实恢复的端到端测试。

在上述链路完成前，P0-02B 保持 partial；这表示功能尚未交付，不表示本轮要修复一个用户可触发的 worktree 缺陷。

## 4. Acceptance Criteria

以下条件全部满足才能解除 `REQUEST CHANGES`：

### 4.1 Attach and renderer recovery

1. main 找不到 conversation/run 时返回 `run-unavailable`；runId 不匹配时返回 `run-mismatch`，两者测试均不得观察到 `finish`。
2. preload 中已有 stream 的 MessagePort 失败后，`getActiveRun()` 返回 null 必须调用一次 `onError`，`onFinish` 为 0 次。
3. attach 前从未发现 active run 时，`attachChatStream()` 仍返回 null，controller 保持 ready，且没有 error banner。
4. 已发现 run 后 attach 被拒绝时，controller 最终为 error、registry 为 `needs_resume`，已回放文本保持不变。
5. attach failure、sequence gap 和 journal overflow 都不得新增 provider request、`turn/start`、tool call 或 approval response。
6. replay chunk 后收到 failure 时，chunk 全部可读，随后状态为 error；不得为了让测试通过而把 failure 改成正常 finish。
7. stream 已创建但零 event 静默关闭时进入明确的 unknown recovery error，不得进入 ready。
8. 权威 completed/aborted/failed/interrupted terminal 各只结算一次，原有 detach/replay 行为不回归。

### 4.2 Typed provider recovery

9. 任意文案的 `app_server_transport_closed` 或 `app_server_transport_terminated` code 都能触发一次 existing-turn recovery。
10. 使用旧英文文案但没有 code 的普通 Error 不触发 existing-turn recovery。
11. 任意文案的 `active_turn_unavailable` code 都收敛为 interrupted，保留 partial history，且不发第二个 `turn/start`。
12. provider transport/client/broker 产生的结构化 code 在 AI SDK `onError` 到 main 决策之间不丢失。
13. `codexChatRuntimeService.ts` 中不存在用 `includes()` 判断 transport recovery 或 active-turn-unavailable 的控制流。

### 4.3 Test integrity and scope

14. attach、renderer 状态机和 provider 错误码的每个修复点先有一个在当前实现失败的回归测试；实现提交不得先修改测试期望来制造绿灯。
15. E2E/support 只能注入真实故障事件或时序，不得直接调用 renderer recovery callback、直接写 UI state、合成 `finish/error`，也不得替换生产恢复算法。
16. `desktop-app/src/` 不新增 `DASCOWORK_E2E_*`、`NODE_ENV === "test"` 或等价生产分支。
17. `git diff --name-only -- codex/codex-rs/app-server` 和 cached 版本均为空。
18. 文档只在 fresh 测试通过后更新；P0-02B 保持 partial，并明确由 P0-03 完成 worktree 创建、元数据和恢复闭环。

## 5. Implementation Steps

### Phase 0 — 先锁定失败行为

涉及文件：

- `desktop-app/src/main/codexChatRuntimeService.test.ts:269-373`
- `desktop-app/src/preload/chatStreamBridge.test.ts:75-250`
- `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts:119-179`
- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.test.ts:1114-1215`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.test.ts:214-238`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/model.stream.test.ts:793-863`

步骤：

1. 新增 stale runId、run disappeared after discovery、MessagePort failure + no active run 测试；断言 `finish` 为 0。
2. 新增 renderer “stream 已创建、onError 发生、未 accepted”测试；当前实现必须暴露错误被 ready 覆盖。
3. 保留“attach 前无 active run 是正常 no-op”的对照测试，防止修复把所有 null 都变成错误。
4. provider 测试改为构造真实带 code 的 `CodexProviderError`，并通过 `toUIMessageStream.onError` 传给 main；禁止 mock 直接返回精心拼接的 `errorText` 来绕开生产错误映射。
5. 新增同文案无 code、不同文案同 code 两组反例。

退出条件：每个本轮阻断项都有独立红灯；对照测试证明正常 no-active-run 行为仍被保留。

### Phase 1 — 收口共享 attach/failure 协议

涉及文件：

- `desktop-app/src/shared/codexIpcApi.ts:151-263,352-372,502-512`
- `desktop-app/src/main/codexChatRuntimeService.ts:812-894`
- `desktop-app/src/main/index.ts:767-782`
- `desktop-app/src/main/codexChatRuntimeService.test.ts:269-373`

步骤：

1. 定义 `CodexChatStreamFailureCode/Failure` 与 typed attach result。
2. 更新 Zod schema、terminal fallback 和 bridge callback 类型，确保未知 code fail closed。
3. `attachChatStream()` 分别返回 attached、run-unavailable、run-mismatch、journal-unavailable。
4. 删除 `index.ts` 的 synthetic finish；rejected attach 向该 port 发送结构化 failure 后关闭。
5. 确保只有 journal/实时 canonical terminal 能产生 finish。

退出条件：Phase 0 main tests 转绿，旧 run/不存在 run 均有确定 failure code。

### Phase 2 — 修复 preload 与 renderer 的恢复状态机

涉及文件：

- `desktop-app/src/preload/chatStreamBridge.ts:115-210,312-388`
- `desktop-app/src/preload/chatStreamBridge.test.ts`
- `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts:174-240`
- `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts`
- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts:221-275,338-368`
- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.test.ts`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:138-175,570-602`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.test.ts`
- `desktop-app/src/renderer/src/runtime/classifyConversationRecoveryError.ts:1-44`

步骤：

1. preload 对 initial no-run 与 post-fault no-run 使用不同分支；后者必须 dispatch typed failure。
2. 统一三处 port message handler 的 error/resync 分派，避免 start、reattach、gap recovery 各自维护一套文案和终态判断。
3. transport 将完整 failure 交给 controller；仍正常 close stream 以保留排队 chunk。
4. controller 先判断 recovery failure，再判断 accepted/outcome；对 silent close 生成稳定 unknown failure。
5. registry 只在明确 no-active-run 时进入 attached；attach rejected/unknown close 保持 `needs_resume`。
6. classifier 按 code 映射诊断和自动重试资格；消息内容只用于安全展示。

退出条件：Phase 0 preload/renderer 红灯全部转绿；partial transcript、composer 和 error banner 状态一致。

### Phase 3 — 让 provider/main 使用结构化错误码

涉及文件：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/errors.ts:1-18`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/index.ts:58-89`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-client.ts:118-132,359-374`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/connection-broker.ts:355-370,564-584`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:1166-1230`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/app-server-client.test.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/app-server-connection.test.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/model.stream.test.ts:793-863`
- `desktop-app/src/main/codexChatRuntimeService.ts:608-720,2463-2486`
- `desktop-app/src/main/codexChatRuntimeService.test.ts:902-1079`

步骤：

1. 给 `CodexProviderError` 增加只读 code 和 type guard；message/cause 保持现有兼容性。
2. client 与 connection broker 的 close/termination 统一创建 coded errors。
3. model 的 active-turn-unavailable 使用 coded error。
4. main 在 `toUIMessageStream.onError` 中捕获原始 coded error，并独立生成 renderer-safe message。
5. transport recovery 与 active-turn-unavailable 分支只读 code；删除英文 substring helper。
6. 修改 test harness，使 mock stream 调用真实 `onError(error)`；不再直接喂目标英文 `errorText` 冒充 provider 行为。

退出条件：消息变更不影响恢复决策；无 code 的仿冒文案不触发恢复。

### Phase 4 — 端到端回归与文档收口

涉及文件：

- `desktop-app/tests/e2e/fault-injection.e2e.ts`
- `desktop-app/tests/e2e/support/preload-message-port-fault-hook.cjs`
- `docs/ai-sdk-provider-codex-asp-api.md`
- `docs/codex-electron-conversation-gap-checklist.md`
- `.omx/plans/p0-02-active-task-reconnect-and-local-recovery.md`

步骤：

1. 保留现有 P002-E2E-01 至 P002-E2E-10；新增用例必须驱动真实 renderer → preload → main → provider 路径。
2. fault hook 只能制造 MessagePort fault、transport close 或时序变化；不得合成 terminal、直接改 registry/controller 状态。
3. E2E 精确断言：attach failure 不显示完成、partial text 保留、错误诊断可见、provider request/turn-start/tool-call 均不增加。
4. 更新 provider 文档，记录稳定 error code 与 message 非契约。
5. fresh 验证通过后再更新 P0-02 证据；P0-02B 的 P0-03 依赖保持显式 partial。

退出条件：浏览器证据与 unit/integration 证据指向同一生产行为，没有测试专用成功路径。

## 6. Verification Steps

按顺序执行，前一层失败时先修复，不用更宽断言绕过：

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test

npm --prefix desktop-app run typecheck:node
npm --prefix desktop-app run typecheck:web
npm --prefix desktop-app run test -- src/main/codexChatRuntimeService.test.ts
npm --prefix desktop-app run test -- src/preload/chatStreamBridge.test.ts
npm --prefix desktop-app run test -- src/renderer/src/lib/ElectronIpcChatTransport.test.ts
npm --prefix desktop-app run test -- src/renderer/src/runtime/ConversationTranscriptController.test.ts
npm --prefix desktop-app run test -- src/renderer/src/runtime/ConversationChatRegistry.test.ts
npm --prefix desktop-app run lint
npm --prefix desktop-app test

npm --prefix desktop-app run test:e2e -- --grep "P002-E2E" --reporter=line
npm --prefix desktop-app run test:e2e -- --grep "P002-E2E" --repeat-each=3 --workers=1 --retries=0 --reporter=line

git diff --check
git diff --cached --check
git diff --name-only -- codex/codex-rs/app-server
git diff --cached --name-only -- codex/codex-rs/app-server
```

验证报告必须记录：

- provider request、`turn/start`、tool call、approval response 的精确次数
- attach failure code 与最终 renderer recovery phase
- partial transcript 是否保持
- E2E hook 只注入故障而没有合成成功/失败终态的代码审查结果

## 7. Risks and Mitigations

| 风险 | 缓解 |
| --- | --- |
| 扩展 error wire format 影响现有 start/terminal 测试 | 一次性更新 shared schema 和所有 callback 类型；保留 provider failure 的安全 message |
| 把正常 no-active-run 错判为失败 | 保留 initial discovery null 对照测试；只有已知 run 后 attach rejection 才是 recovery failure |
| 正常 close 与 failure 状态竞态 | controller 以显式 failure/terminal 为权威，stream close 不再决定业务终态 |
| provider error code 在 AI SDK 映射中丢失 | 在 `toUIMessageStream.onError` 捕获原始 error，测试必须经过该 callback |
| 尚未交付的 worktree 功能再次混入本轮修复范围 | 本计划不修改 worktree 契约、实现或测试；P0-02B 保持 partial，由 P0-03 单独形成创建到恢复的闭环 |
| 新 E2E 通过测试 hook 伪造结果 | hook 只允许注入低层故障/时序；测试不得调用 controller/registry 或合成 terminal |
| 大范围 staged diff 发生测试与实现错位 | 每个 phase 先跑定向测试，再跑全量；最终检查 staged snapshot 自包含 |

## 8. Stop Conditions

满足以下条件才可重新请求代码审查：

1. 所有 18 条 acceptance criteria 有 fresh evidence。
2. synthetic finish 和 recovery 文案匹配控制流全部删除。
3. renderer 不再把 attach rejection/silent close 收敛为 ready。
4. provider、desktop unit/integration、P002 E2E 和稳定性回归全部通过。
5. app-server 源码零改动，生产源码零 test-only 分支。
