# Staged Review 最终阻断项修复计划

状态：`DRAFT — implementation ready`

日期：2026-07-24

上游计划：`.omx/plans/staged-review-root-cause-remediation-plan.md`

输入证据：2026-07-24 fresh review、定向测试、provider/desktop 质量门禁

## 1. Requirements Summary

本计划只修复最新复审仍然存在的阻断项，不重新实现已经通过的 dynamic tool、connection broker、MessagePort detach、审批结算和 app-server 边界。

目标结果：

1. follow-up queue 在重启时先使用 app-server canonical history 对账，再删除或降级 in-flight item；不得由 Store 在 Service 对账前丢失 `sending/steering` 语义。
2. runtime shutdown 先关闭新 run 的 admission，并等待已经进入启动流程的 admission 收敛后再快照 active runs。
3. 一个 `(threadId, turnId)` 在 Main 显式 stop、shutdown deadline 和 provider AbortSignal 组合下最多发送一次 `turn/interrupt`。
4. lifecycle 事件只有在 thread、turn、sequence 全部通过校验后才能修改 active run identity 或 alias。
5. coverage gate 的 `{runId, runner, file, fullTestName}` 必须来自真实 Vitest/Playwright 运行上下文，测试代码不能自行填写 `file/testName` 冒充其他 evidence。
6. canonical history 已包含附件 metadata 后，local overlay 被删除且不会因 history hydration 的 controller notification 被重新保存。
7. provider lint/typecheck/tests、desktop lint/typecheck/tests、coverage gate 和适用 E2E 均获得本次运行证据；release smoke 未满足运行条件时明确保持未完成。
8. 禁止修改 `codex/codex-rs/app-server/`，禁止新增绕过 Codex app-server 的模型调用路径，禁止在 `desktop-app/src/` 添加 test-only 行为开关。

### 1.1 当前已确认的根因

- `ConversationFollowUpQueueStore` 在构造和首次磁盘读取时调用 `recoverRestartState()`，见 `desktop-app/src/main/followUps/ConversationFollowUpQueueStore.ts:82,103-112,167-192`。这会在 Service 看到 state 前把 `sending/steering` 变成 `paused-recovery-uncertain`。
- `ConversationFollowUpQueueService` 只会为仍处于 `sending/steering` 的 item 查询 canonical history，见 `desktop-app/src/main/followUps/ConversationFollowUpQueueService.ts:947-953,973-1053`。因此 `findAcceptedClientUserMessageIds` 当前拿不到候选项。
- `CodexChatRuntimeService.stop()` 在 `desktop-app/src/main/codexChatRuntimeService.ts:926-932` 立即快照 active runs；`startChatStream()` 在 `:352-376,419-425` 没有拒绝 `stopping`，也没有登记尚未完成注册的 pending admission。
- Main 的显式 interrupt 位于 `desktop-app/src/main/codexChatRuntimeService.ts:702-724`，canonical 缺失后的 abort 位于 `:743-763`；provider AbortSignal 另有独立 interrupt owner，见 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:739-769,879-895`，而 `CodexSessionImpl.interrupt()` 位于 `src/session.ts:302-318` 且没有共享 per-turn 幂等状态。
- `acceptTurnLifecycle()` 在完整验证前绑定 thread alias，见 `desktop-app/src/main/codexChatRuntimeService.ts:1229-1252`。
- `planAssert()` 接受调用者提供的 `file/testName`，见 `desktop-app/scripts/lib/test-plan-assertions.mjs:31-47`；coverage runner 又在 `desktop-app/scripts/test-plan-coverage.mjs:65-87` 用 manifest 名称重建 evidence identity，Vitest 解析目前只使用叶子 `assertion.title`，见 `:90-105`。
- recovery store 会在 canonical history 已包含相同附件时删除 overlay，见 `desktop-app/src/renderer/src/runtime/ConversationTranscriptRecoveryStore.ts:101-139`；但 `ConversationChatRegistry` 在 `:367-373` hydration 后触发 controller subscriber，subscriber 又在 `:443-455` 将 canonical 附件重新保存为 local overlay。
- provider 目标为 ES2022，见 `desktop-app/vendors/ai-sdk-provider-codex-asp/tsconfig.json:3`；`src/model.ts:296` 使用了当前 lib 不包含的 `findLastIndex`。

### 1.2 不在本轮重新设计的部分

- dynamic tool 的 non-cross-call/cross-call 事件所有权保持当前实现，只运行回归测试。
- broker detach、request timeout、physical fatal 和 connection bounded shutdown 保持当前实现，只运行回归测试。
- 不修改 app-server protocol、thread/turn/history 语义。
- 不增加依赖；格式收口使用仓库现有 ESLint/Prettier 配置。
- 不把 release 凭据或 provider secrets 暴露给 renderer、测试报告或计划 evidence。

## 2. Architecture Decisions

### 2.1 Store 只负责无损持久化，Service 负责重启语义

`ConversationFollowUpQueueStore` 只做 schema parse、版本迁移、clone 和原子写入。`accepted/sending/steering` 的重启处理统一放到 `ConversationFollowUpQueueService.ensureInitialized()` 路径中。

Service 在一个串行初始化事务内按以下顺序处理：

1. 读取未被语义改写的 durable state。
2. 删除 `accepted` 并记录待清理资产。
3. 按 conversation 分组 `sending/steering`，用 item `id` 作为 `clientUserMessageId` 查询 canonical history。
4. canonical 已包含的 item 删除；未包含或 history 查询失败的 item 转成无 lease 的 `paused-recovery-uncertain`。
5. `queued/editing/paused-*` 保持原状态。
6. 只写回一次并只增加一次 revision。

history 查询失败时选择“暂停、不重发”，因为重复发送比暂时需要用户确认风险更高。

### 2.2 一个共享的 per-turn interrupt coordinator

实际 `turn/interrupt` RPC 统一由 provider 的 `CodexSessionImpl.interrupt()` 发送并按 `(threadId, turnId)` 缓存 Promise：

- Main 显式 stop 继续调用 `session.interrupt()`。
- provider AbortSignal 不再通过 `model.ts` 的独立 `client.request("turn/interrupt")` 发送；它调用同一 session 方法。
- abort 在 session/turn 尚未建立时只设置 `stopRequested`；`turn-started` 后通过同一 session 方法补发。
- turn identity 改变时创建新的 interrupt key；同一 key 的成功、失败和 timeout 都不得触发第二次 RPC。

这样保留 standalone provider 的 AbortSignal 行为，同时消除 Main 与 provider 双 owner。

### 2.3 shutdown 使用 admission barrier

`startChatStream()` 第一段同步代码取得 admission lease；`stop()` 同步关闭 admission，等待已取得 lease 的启动流程完成“注册 active run 或失败退出”，再快照 active runs。

不能只检查一次 `status === "stopping"`：start 可能在检查后、register 前停在异步恢复流程中。admission lease 必须覆盖 `recoverBlockedConversationRun()`、`prepareClaimedFollowUp()` 和 `registerActiveConversationRun()`。

### 2.4 lifecycle 使用 validate-then-commit

`acceptTurnLifecycle()` 先在局部变量中校验 event，再一次性提交 `threadId/turnId/lastLifecycleSequence/alias`：

- 未绑定 run 只接受 `turn-started` 建立身份。
- 非 `turn-started` 事件不能建立 thread alias。
- mismatched thread、mismatched turn、旧 sequence 和 terminal 后事件返回 `false` 且零状态变化。

### 2.5 coverage identity 由 runner adapter 提供

将 evidence recorder 拆为 core recorder 与 runner adapter：

- Vitest adapter 从运行时测试上下文读取规范化文件路径和 suite-qualified full name。
- Playwright adapter 从 `test.info().file` 与 `test.info().titlePath` 读取身份。
- Node test 如需成为正式 evidence，必须由接收 `TestContext` 的 wrapper 提供身份。
- test body 只传 `{scenarioId, assertionId, assertion}`，不能传 `file/testName`。
- validator 只匹配真实 reporter 中 `passed + run mode` 的同一 invocation；manifest 不得合成已执行测试。

## 3. Acceptance Criteria

以下条件全部满足才能解除 `REQUEST CHANGES`：

### 3.1 Queue recovery

1. 从磁盘读取包含 `sending` 或 `steering` 的 state 后，在 canonical lookup 执行前 item 状态与 lease 信息仍可用于候选识别；Store 不提前将其改成 uncertain。
2. canonical lookup 每个 conversation 恰好调用一次，candidate IDs 与该 conversation 的全部 `sending/steering` item 精确一致。
3. canonical 已含 `clientUserMessageId` 时 item 被删除；未包含或 history read 抛错时 item 变成 `paused-recovery-uncertain` 且 `lease === undefined`。
4. 一次初始化恢复最多写回一次 durable state、revision 恰好 `+1`；无变化时 revision 和磁盘内容都不变。
5. `queued` 重启后 scheduler 只发送一次；`accepted` 删除；`editing` 和所有已有 paused 状态不调度。
6. 当前失败的 E13/E16/E17 与 E14 测试全部通过，见 `desktop-app/src/main/followUps/ConversationFollowUpQueueService.test.ts:832-948`。

### 3.2 Shutdown and interrupt

7. `stop()` 关闭 admission 后的新 `startChatStream()` 在注册 run、claim follow-up 或启动 provider 前返回一个稳定 error。
8. 已取得 admission 但停在异步准备阶段的 start 必须先注册或失败退出；`stop()` 之后的 active-run snapshot 不遗漏它。
9. 并发调用 `stop()` 两次只执行一次 provider shutdown；最终 active runs、pending admissions、approval、follow-up lease 和 timer 计数均为 0。
10. Main stop、shutdown deadline abort 和 provider AbortSignal 同时发生时，真实 transport 观察到的 matching `turn/interrupt` 数量严格为 1。
11. interrupt RPC timeout/失败后不得对同一 turn 再发第二次；最终通过 canonical lifecycle/history 输出一个 terminal 或稳定 unknown-outcome error。

### 3.3 Lifecycle identity

12. 未绑定 run 收到 `item-started/item-completed/turn-completed` 时返回拒绝，thread alias、threadId、turnId 和 sequence 全部不变。
13. wrong thread、wrong turn、重复 sequence、旧 sequence 和 terminal 后事件的 Main/Renderer 接收数均为 0；正确事件随后仍可建立身份并完成 turn。

### 3.4 Coverage evidence

14. `planAssert` 公共 API 不再接受 `file` 或 `testName`；所有 assertion evidence 的 identity 与 reporter 中的真实 invocation 完全一致。
15. 两个 suite 拥有相同叶子 test title 时，gate 能区分 full name；一个测试不能为另一个空测试或失败测试提交 assertion evidence。
16. fresh runId、错误文件、错误 full name、旧 report、重复 assertion source、skip/fixme/fail/only、failed retry 和缺 assertion ID 均使 gate 非零退出。
17. 所有 covered 场景使用本次命令生成的 report 和 assertion evidence 时，`npm --prefix desktop-app run test:plan-coverage` 返回 0。

### 3.5 Recovery overlay

18. canonical history 已含同等附件 metadata 时 overlay 删除后不会被 hydration subscriber 重新保存。
19. overlay 记录包含 schema version、稳定 identity、message ID 和 canonical base revision；revision 不匹配时只能按稳定 message ID 补附件，不能覆盖 canonical part。
20. localStorage 中仍不存在 assistant text、reasoning、tool args/result、terminal 或完整 messages snapshot；TTL、5 MiB、100 conversations 的 `limit-1/limit/limit+1` 测试继续通过。

### 3.6 Quality and staged snapshot

21. Provider `lint` 为 0 errors，`typecheck` 为 0 errors，全部 provider tests 通过；`model.ts:296` 不通过提高 target/lib 掩盖，保持 ES2022。
22. Desktop lint/typecheck、unit/integration tests 和 mock E2E 全部通过；lint warning 数不得高于修复前的 333。
23. `git diff --check`、`git diff --cached --check` 均返回 0；`git diff --name-only -- codex/codex-rs/app-server` 与 cached 版本均为空。
24. staged snapshot 自包含：没有 staged 测试依赖 untracked helper，也没有 `MM/AM` 文件只有 unstaged 部分才包含正确实现。
25. release R01-R06 只有在 packaged artifact、凭据、真实工具与审批 UI 均具备并通过后才能从 `partial` 改为 `covered`；否则保持 `partial`，不得宣称整个上游计划完成。

## 4. Implementation Steps

### Phase 0 — 锁定回归证据和可交付边界

涉及文件：

- `desktop-app/src/main/followUps/ConversationFollowUpQueueService.test.ts:832-948`
- `desktop-app/src/main/codexChatRuntimeService.test.ts:3673-3955`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/model.stream.test.ts:2203-2288`
- `desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.test.ts`

步骤：

1. 保留当前 3 个 queue recovery 失败测试作为红灯，不改宽断言、不删除 `planAssert`。
2. 新增 shutdown admission race 测试：用 deferred barrier 把 start 停在 `prepareClaimedFollowUp()` 前后，调用 `stop()`，证明 snapshot 不漏 run。
3. 新增真实 Main→provider 组合测试或 provider integration harness，让同一 transport 同时收到 session stop 与 abort；先复现两个 `turn/interrupt`。
4. 新增 pre-bind lifecycle 乱序事件测试，断言 rejected event 后 alias map 和 run identity 未变。
5. 新增 registry 集成测试，复现 canonical attachment 触发 overlay 删除后又被 subscriber 保存。
6. 新增 coverage spoof fixture：测试 A 为空，测试 B 尝试登记 A 的 identity；旧实现必须错误放行或明确暴露身份不可验证，修复后必须拒绝。

退出条件：每个已确认根因至少有一个修复前失败、修复后通过的回归测试；测试名称与 assertion ID 不复用现有无关场景。

### Phase 1 — 修复 queue recovery 的职责顺序

涉及文件：

- `desktop-app/src/main/followUps/ConversationFollowUpQueueStore.ts:75-112,145-192`
- `desktop-app/src/main/followUps/ConversationFollowUpQueueStore.test.ts:78-230`
- `desktop-app/src/main/followUps/ConversationFollowUpQueueService.ts:947-1053`
- `desktop-app/src/main/followUps/ConversationFollowUpQueueService.test.ts:832-948`
- `desktop-app/src/main/index.ts:186-211`

步骤：

1. 从 Store constructor/getState 移除 `recoverRestartState()` 的业务转换；Store 只返回 parse/migrate 后的 durable state。
2. 将重启矩阵全部收口到 `reconcileInterruptedDeliveries()`，并保证它在 asset reconciliation 和 scheduler 可见 state 前完成。
3. 先收集 candidate IDs，再调用 `findAcceptedClientUserMessageIds`，最后统一执行 delete/uncertain 变换。
4. history read 失败记录脱敏诊断，只包含 conversation key 的安全标识、candidate count 和 error kind；不得记录消息文本或附件路径。
5. 同一次初始化把 accepted cleanup 与 in-flight reconciliation 合并为一次 state write/revision increment。
6. 更新 Store 测试：验证无损读写和 schema migration；状态恢复语义只由 Service 测试拥有。

退出条件：Phase 0 的三个 queue 红灯转绿；Store 测试不再把“读取即降级”当作正确行为。

### Phase 2 — 关闭 shutdown admission 并统一 interrupt owner

涉及文件：

- `desktop-app/src/main/codexChatRuntimeService.ts:102-130,352-425,702-763,926-1033`
- `desktop-app/src/main/codexChatRuntimeService.test.ts:3766-3955`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/session.ts:302-318`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:728-769,879-905`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/provider.test.ts:730-760`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/model.stream.test.ts:2203-2288`

步骤：

1. 为 runtime 增加同步关闭的 admission gate、pending admission count 和 drain Promise；不要依赖异步设置的 UI status 作为互斥锁。
2. `startChatStream()` 在第一次 `await` 前取得 lease，在 active run 成功注册或启动失败后释放。
3. `stop()` 先关闭 gate，再等待 admission drain，然后快照 active runs；将 stop 自身缓存为一个 Promise，使重复调用幂等。
4. 给 `CodexSessionImpl.interrupt()` 增加 keyed Promise cache；key 必须包含 threadId 和 turnId。
5. 删除或内聚 `model.ts` 的独立 `interruptTurnIfPossible()`；AbortSignal 和 late turn-start 都调用 session 的共享 interrupt。
6. 保留“等待 canonical terminal 后再 teardown”的现有语义；abort 只释放 provider stream，不能合成 interrupted terminal。
7. 增加 timeout、RPC rejection、canonical notification 丢失和 stop+abort 并发测试，精确断言 outbound RPC 数量。

退出条件：所有组合中每个 turn 最多一个 interrupt；stop 完成后 admission/active run/resource count 全为 0。

### Phase 3 — 修复 lifecycle validate-then-commit

涉及文件：

- `desktop-app/src/main/codexChatRuntimeService.ts:1229-1252`
- `desktop-app/src/main/codexChatRuntimeService.test.ts:3673-3764`
- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts:293-405`
- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.test.ts`

步骤：

1. 将 acceptance 逻辑拆成纯校验结果和 commit 两段；校验阶段不得调用 `bindActiveConversationRunAlias()`。
2. 未绑定 run 只有合法、单调的 `turn-started` 可以建立 thread/turn identity。
3. commit 时一次性更新 alias、threadId、turnId 和 sequence，避免部分写入。
4. Main 和 Renderer 都补 pre-bind、wrong thread、wrong turn、old sequence、duplicate sequence、post-terminal 测试。
5. 测试必须先发送一个 rejected event，再发送正确 canonical 序列，证明 ledger 没有被污染。

退出条件：所有 rejected lifecycle event 都是零副作用；现有 terminal 映射测试不回归。

### Phase 4 — 将 coverage identity 绑定到 runner

涉及文件：

- `desktop-app/scripts/lib/test-plan-assertions.mjs:11-47`
- `desktop-app/scripts/test-plan-coverage.mjs:33-128`
- `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:428-524`
- `desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/helpers/plan-assertion.ts`
- 所有直接调用 `planAssert({ file, testName, ... })` 的 Vitest/Playwright evidence 测试

步骤：

1. 定义不可由 test body 填写的 `ExecutedTestIdentity`：`runner + normalizedFile + fullTestName + invocationId`。
2. 为 Vitest 和 Playwright 建立 runner adapter；adapter 从运行时 API读取 file/full title 并传给 core recorder。
3. 将 `planAssert` API 缩减为 `scenarioId/assertionId/assertion`，批量删除测试中的 `file/testName` 字段。
4. `runVitest()` 使用 suite-qualified full name，不再只用 `assertion.title`；Playwright 使用完整 `titlePath`。
5. `executeEvidenceTests()` 直接保留 reporter invocation，不得用 manifest testName 合成 passed evidence。
6. validator 按同一个 invocation key 关联 passed test 和 assertion records；重复 key、跨文件、跨 runner、跨 retry 证据 fail closed。
7. 增加 spoof、同叶子名不同 suite、retry 一次失败一次通过、empty target、wrong file/full name/runId 的 node fixtures。

退出条件：测试代码无法为另一个测试登记 identity；validator self-tests 和真实 coverage gate 均通过。

### Phase 5 — 修复附件 overlay 的 canonical hydration 回写

涉及文件：

- `desktop-app/src/renderer/src/runtime/ConversationTranscriptRecoveryStore.ts:8-29,87-150`
- `desktop-app/src/renderer/src/runtime/ConversationTranscriptRecoveryStore.test.ts`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:350-379,443-455,643-662`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.test.ts`
- `desktop-app/src/shared/codexIpcApi.ts:85-92,415-422`
- `desktop-app/src/main/conversations/ConversationApiService.ts:190-210`

步骤：

1. 给 open result 增加 canonical history revision，优先使用 app-server thread `updatedAt`；shared schema 同步校验。
2. 将 recovery payload 升级一个 schema version，在 record 中保存 `baseRevision`；旧版本只迁移附件白名单，继续丢弃历史 text/terminal 字段。
3. 给 registry 的 history hydration 增加明确 source/guard，使 `replaceMessages()` 触发的 subscriber 不把 canonical history 当作本地产生的 overlay。
4. canonical 包含相同附件时删除 record；canonical 缺附件且 message ID 存在时才补充 local metadata。
5. base revision 不同或 message ID 不存在时不追加孤立消息，不覆盖 canonical parts；过期 overlay 按现有 TTL/容量规则删除。
6. 增加真实 registry integration test，而不是只测试 Store 的纯 merge。

退出条件：canonical metadata 收敛后 localStorage 中没有该 overlay；刷新两次也不会重新出现。

### Phase 6 — Provider 类型与格式收口

涉及文件：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:294-305`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tsconfig.json:2-20`
- provider lint 报告涉及的当前变更文件，包含 `src/history-mapper.ts`、`src/turn-lifecycle.ts`、`tests/turn-lifecycle.test.ts`

步骤：

1. 将 `findLastIndex` 改为 ES2022 可用的反向索引循环或等价 helper；不得通过把 `target/lib` 提升为 ES2023 掩盖错误。
2. 使用 provider 现有 `npm run lint:fix` 做纯机械格式收口；将格式 pass 与语义修复分开审查。
3. 人工检查 lint fix diff，确认没有条件分支、标识符、协议字段或 fixture 行为变化。
4. 运行 provider lint/typecheck/tests；任何 error 都阻断下一阶段。
5. Desktop lint 的 333 个 warning 至少不得增加；本轮触及文件的新增格式 warning 必须为 0。

退出条件：provider `qa` 返回 0，ES2022 target 保持不变，`git diff --check` 返回 0。

### Phase 7 — 全门禁、E2E 与 staged snapshot 收口

涉及文件：

- `desktop-app/tests/test-plan-coverage.json:3871-4030`
- `desktop-app/tests/e2e/release-llm.e2e.ts`
- `desktop-app/scripts/run-release-llm-smoke.mjs`
- `.github/workflows/desktop-test-plan.yml:41-62`
- 当前 `MM/AM` 和 untracked helper 文件

步骤：

1. 先运行 unit/integration/coverage gate，全部通过后再进入 Electron E2E，避免用 E2E 噪声掩盖确定性失败。
2. 运行 mock E2E 和 stability E2E；检查真实 renderer→IPC→main→provider→app-server 路径。
3. release smoke 运行前验证 packaged artifact、provider credentials、disposable workspace 和真实审批 UI；不满足时记录为 `BLOCKED_EXTERNAL`，R01-R06 保持 `partial`。
4. 逐个解决 `MM/AM`：确保每个关键实现和对应测试位于同一 staged snapshot；把被 staged 测试引用的 helper 一并纳入。
5. 从只包含 staged snapshot 的临时 worktree/index 复跑 provider QA、desktop typecheck/tests 和 coverage gate。
6. 保存本次 runId、命令、退出码和报告路径；旧账本不能替代 fresh evidence。

退出条件：所有可运行门禁为 0；release eligible 时 R01-R06 全部通过，否则上游计划不得标记完成。

## 5. Verification Steps

按顺序执行，前一组失败时停止后续高成本门禁：

```bash
# Queue recovery
npm --prefix desktop-app exec -- vitest run \
  src/main/followUps/ConversationFollowUpQueueStore.test.ts \
  src/main/followUps/ConversationFollowUpQueueService.test.ts

# Lifecycle, shutdown, overlay
npm --prefix desktop-app exec -- vitest run \
  src/main/codexChatRuntimeService.test.ts \
  src/renderer/src/runtime/ConversationTranscriptController.test.ts \
  src/renderer/src/runtime/ConversationTranscriptRecoveryStore.test.ts \
  src/renderer/src/runtime/ConversationChatRegistry.test.ts

# Provider
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test

# Coverage authenticity and full evidence
npm --prefix desktop-app run test:plan-coverage:validator
npm --prefix desktop-app run test:plan-coverage

# Desktop
npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
npm --prefix desktop-app test
npm --prefix desktop-app run test:e2e -- --reporter=line
npm --prefix desktop-app run test:e2e:stability

# Release-only, only when eligibility checks pass
npm --prefix desktop-app run test:e2e:release-llm

# Diff and architecture boundaries
git diff --check
git diff --cached --check
git diff --name-only -- codex/codex-rs/app-server
git diff --cached --name-only -- codex/codex-rs/app-server
```

必须额外记录的精确断言：

- queue recovery：canonical lookup candidate 数量、删除/uncertain 数量、lease count、revision delta、RPC send count。
- shutdown：pending admission count、active run count、provider shutdown count、matching `turn/interrupt` count。
- lifecycle：rejected event 前后 identity/alias/sequence 深比较相等。
- coverage：reporter invocation identity 与 assertion identity 一一对应，没有 manifest 合成记录。
- overlay：canonical merge 后 storage key 不存在或不再包含 resolved message ID，第二次 hydration 后仍然如此。

## 6. Risks and Mitigations

| 风险 | 缓解 |
| --- | --- |
| Store 改为无损读取后，Service 初始化前其他调用看到 in-flight state | 所有公开 Service 操作继续经过 `serialize() -> ensureInitialized()`；为绕过 Service 的直接 Store 使用建立搜索清单和测试。 |
| admission drain 自身死锁，导致 shutdown 永久等待 | admission lease 必须在 `finally` 释放；新增启动失败、follow-up prepare 失败和 stop 并发测试；shutdown 仍保留总 deadline。 |
| 统一 interrupt 后 standalone provider abort 不再工作 | provider AbortSignal 保留 stopRequested latch，并在 session/turn 可用时调用共享 `session.interrupt()`；现有 abort tests 必须继续通过。 |
| full test name 在 Vitest/Playwright 格式不同 | identity 包含 runner；分别规范化，不跨 runner 比较字符串；用相同叶子名 fixture 验证。 |
| base revision 缺失导致附件显示丢失 | IPC schema 允许旧端短期兼容，但 revision 缺失时采取保守的 ID-only merge；绝不恢复消息正文或 terminal。 |
| 大规模 lint fix 淹没语义 diff | 语义测试先通过，再单独执行机械格式 pass；检查 `git diff --word-diff=porcelain` 和 `git diff --check`。 |
| Electron SIGABRT 或 release 凭据不可用 | 将环境故障与代码失败分开记录；不得修改生产代码跳过 gate，也不得把未运行写成通过。 |
| staged/unstaged 混合导致复审结果不可复现 | 最终从仅 staged snapshot 验证；禁止 `git add .`，逐文件确认实现、测试和 helper 的闭包。 |

## 7. Stop Conditions

出现以下任一情况时停止叠加补丁并回到根因分析：

1. queue 修复需要在 Store 和 Service 同时保留两套 restart conversion。
2. interrupt 幂等依赖吞掉第二次 RPC，而不是让第二个调用复用同一 Promise。
3. shutdown 需要真实 sleep、轮询或无限等待才能通过测试。
4. coverage 修复仍允许 test body 自行填写 file/full test name。
5. overlay 修复需要保存完整 messages、assistant text、tool result 或 terminal。
6. 为使 E2E 通过需要在 `desktop-app/src/` 新增测试环境变量分支、假工具或假 terminal。
7. 需要修改 `codex/codex-rs/app-server/` 才能继续。
8. release smoke 缺少凭据或 packaged artifact；此时记录外部阻断，不降低验收条件。

## 8. Definition of Done

只有在以下事实同时成立时，才能将上游计划标记为完成：

- 已确认的 queue、shutdown、interrupt、lifecycle、coverage identity 和 overlay 根因都有修复前失败、修复后通过的测试。
- provider 和 desktop 的必跑命令全部返回 0。
- coverage gate 消费本次 runner 产生的真实 identity 和 assertion evidence。
- mock E2E 通过；release eligible 时 release R01-R06 通过。
- staged snapshot 自包含、`diff --check` 通过、app-server diff 为空。
- 没有通过放宽断言、跳过测试、延长真实超时或添加生产测试钩子获得绿灯。
