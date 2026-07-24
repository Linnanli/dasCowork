# 暂存区审查阻断项闭环计划

## 1. 目标与范围

本计划只处理本次“暂存区是否完成根因修复”的审查阻断项。完成标准是：**仅应用暂存内容**也能构建、执行测试，并满足真实 Codex app-server 协议；不能把工作区未暂存的修复、测试环境开关或本地转录副本算作完成。

必须保持的边界：

- 不修改 `codex/codex-rs/app-server/`，不绕过 Codex app-server 新建模型调用链路。
- 不以全局去重、吞错或“缺事件也成功”的补丁掩盖事件所有权和生命周期错误。
- 测试只在进程、网络、窗口和临时工作区等系统边界制造故障；不得用生产环境变量、假工具、假 RPC 结果或客户端专用分支制造绿灯。
- app-server 的 thread/turn/history 是对话文本、推理、工具和终态的唯一来源；renderer 本地恢复只能保存按稳定消息 ID 绑定的附件展示信息。
- 计划与实现拆分提交范围：先让 index 自包含并可验证，再处理语义修复；不得用 `git add .` 混入无关工作区改动。

审查证据：跨调用终态逻辑在 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:642-676`，但 broker 的 `parkToolCall` 在 `src/client/connection-broker.ts:213-220` 仍声明为 `void`。共享连接关闭在 `src/client/app-server-connection.ts:66-91` 无限等待 lease；broker detach 和请求路由分别在 `connection-broker.ts:123-149`。覆盖率门禁只静态读取测试名，见 `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:360-465`。

## 2. 验收条件

以下条件全部满足才能结束本计划：

1. 对 `git diff --cached` 单独创建的提交不依赖任何未跟踪或未暂存的模块；所有被暂存测试 import 的 helper、wrapper、脚本、fixture 也都在同一暂存集合中。
2. non-cross-call 与 cross-call dynamic tool 都有明确的唯一 UI 事件所有者。每个 `toolCallId` 恰好一个 `tool-call` 和一个对应结果；重放/迟到事件不重复输出，也不会让 stream 悬挂。
3. `parkToolCall` 的返回契约一致：首次 park 明确返回 `true`，同一 continuation 的重放明确返回 `false`；调用处按此语义决定是否发出 UI terminal。不能依靠 `void` 的真假转换。
4. logical channel detach、request timeout 和 physical transport fatal 后，目标 channel 的 pending request、initialize waiter、continuation、lease/owner 计数都归零；迟到 response 被忽略且不保留完整请求参数。
5. `CodexAppServerConnection.shutdown()` 在活跃 lease 永不释放时，仍会在可注入 deadline 内终止；正常 idle 路径不提前断开。诊断只暴露计数，不暴露 request params、threadId 或正文。
6. coverage gate 只接受本次 Vitest/Playwright/Node 运行产生的 passed 报告与成功后的 `planAssert` 证据；缺 report、runId 不匹配、旧记录、skip/fixme/fail/only、空测试或缺 assertion ID 均非零退出。
7. checkpoint、steer rejection、端口断开、进程崩溃与 release smoke 均通过真实系统边界触发。生产 `desktop-app/src/` 不含 `DASCOWORK_E2E_CHECKPOINT`、`DASCOWORK_E2E_FORCE_STEER_REJECTION`、端口强关、传输强杀或 sandbox/tools 改写分支。
8. `queued` 重启后仍可安全发送一次；`sending`/`steering` 无 lease 地转为 uncertain，并按 `clientUserMessageId` 与 app-server canonical history 对账：已被接受的项删除，未接受的项不得自动重发。
9. recovery localStorage 不包含 assistant text、reasoning、tool args/result 或 terminal outcome；app-server history 已包含附件 metadata 时立即删除 overlay。恢复记录只按 canonical message ID 合并。
10. `git diff --cached --check`、provider lint/typecheck/tests、desktop lint/typecheck/unit tests、计划 coverage gate 和指定 E2E 全部通过；`git diff --cached --name-only -- codex/codex-rs/app-server` 为空。

## 3. 实施步骤

### Phase 0 — 固定可交付的暂存基线

1. 列出 `git diff --cached --name-status`、`git diff --name-only` 与 `git ls-files --others --exclude-standard`，建立“每个已暂存测试的本地 import 必须在 index 中存在”的清单。
2. 将已经被暂存测试引用但仍未跟踪的下列文件，与其调用点作为一组纳入：
   - `desktop-app/scripts/lib/test-plan-assertions.mjs`
   - `desktop-app/scripts/test-plan-coverage.mjs`
   - `desktop-app/tests/e2e/support/app-server-process-wrapper.mjs`
   - `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/helpers/plan-assertion.ts`
   例如 `desktop-app/tests/e2e/fault-injection.e2e.ts:17` 和 `:202-211` 直接依赖这些边界辅助文件。
3. 对每个 `MM`/`AM` 文件逐一选择：将完整且已验证的修复加入暂存，或从暂存中移除其依赖方；禁止留下“index 使用旧实现、工作区才有正确实现”的混合状态。
4. 使用临时 index 或仅基于 `git diff --cached` 的 checkout 运行模块解析预检，确保不是依赖当前工作区碰巧存在的文件。

退出条件：暂存测试的所有静态 import 可解析；工作区未暂存修复不再是任何暂存测试通过的隐含前提。

### Phase 1 — 修复 dynamic tool 的唯一所有权与 cross-call 终态

1. 以 `model.ts:642-676` 为契约入口，将 `PersistentTransport.parkToolCall` 和 `CodexAppServerConnectionBroker.parkToolCall` 改为返回明确 boolean；首次保存 continuation 返回 `true`，相同 request/call 的重放返回 `false`，不同冲突必须以稳定 provider error 拒绝。
2. 补齐 `transport-persistent.ts`、`connection-broker.ts` 及其测试，使返回类型、转发和调用语义一致。不要通过非空断言、强制转换或 `if (!undefined)` 修复。
3. 审查 `dynamic-tools.ts`、`model.ts`、`protocol/event-mapper.ts` 的事件所有权。删除通过 `_sdkDynamicToolCallIds` 之类全局“已见集合”静默压制重复的路径（审查点：`event-mapper.ts:260`、`:904`），改为每种模式只有一个 emitter：non-cross-call 由 mapper，cross-call 由 continuation coordinator，app-server native tool 由 mapper。
4. 先补测试再改实现：真实生成协议 `params.item` fixture；首次 cross-call、同 ID replay、迟到 completed、handler 抛错、并行 provider tool。每个 case 用精确长度断言 `tool-call === 1`、`tool-result === 1`，并断言流 settle，而不是只寻找任意一个事件。

退出条件：cross-call 不悬挂、无重复 UI part；没有“事后全局去重”承担正确性责任。

### Phase 2 — 让共享连接的关闭和路由释放有界且可证明

1. 将 `PendingRequest` 从 `connection-broker.ts:22-27` 的完整 `params` 替换为最小路由元数据 `{ channel, localId, method, threadId? }`；诊断保持仅计数。
2. 在 broker 新增按 `{ channel, localId }` 取消 request 的能力。`detach()`（现为 `:123-128`）必须清理该 channel 的 pending request、initialize waiter、turn/thread owner 和 continuation，并通知 logical channel 失败/关闭；不能影响其他 channel。
3. 让 `AppServerClient` 的 timeout（现为 `app-server-client.ts:175-181`）先调用 broker cancellation，再删除本地 waiter；late response 只记录脱敏诊断并忽略。
4. 为 `CodexAppServerConnectionSettings` 增加可注入 `shutdownDeadlineMs`。将 `app-server-connection.ts:66-91` 从无限 `waitForIdle()` 改为“正常等待 idle，deadline 后终止 logical channel、清理 broker/lease 并断开 physical transport”。生产默认使用计划规定的有限值，单测使用 fake timer。
5. 补 broker、persistent transport、connection 和 app-server client 集成测试：detach、timeout、fatal、lease 永不归还、正常 idle shutdown、多个 channel 隔离、迟到响应。每个用例断言 diagnostics 的所有相关计数归零。

退出条件：任何单一 channel 的泄漏不能阻塞全局关闭；每个路由都有明确创建、取消和终结责任。

### Phase 3 — 将 coverage gate 改为本次执行证据，而非源码声明

1. 保留 manifest 的“场景、层级、required assertion ID”职责，但不再以 `extractDeclaredTestNames()`（`test-plan-coverage-validator.mjs:360-465`）作为覆盖证明；它只能做静态配置校验。
2. 实现/纳入 `planAssert(scenarioId, assertionId, assertionFn)`：只有 callback 成功后才写入记录，记录包括本次 runId、test file、完整测试名、层级和 assertion ID。
3. 让 `test-plan-coverage.mjs` 在同一命令内启动 Vitest、Playwright 与 Node 目标测试，收集真实 reporter 结果并生成单次 runId evidence；`verify-test-plan-coverage.mjs` 只能消费该 run 的报告与 assertion evidence。
4. 在 validator node tests 中明确覆盖并拒绝：空测试、skip/fixme/fail/only、failed test、未运行、删除一个 planAssert、旧 evidence、runId/file/testName 不匹配、重复来源、缺少 required assertion。
5. 更新 `desktop-app/package.json` 的命令顺序，使 validator 自测、真实测试运行、evidence 聚合和 gate 校验发生在同一个受控流程；不得让 CI 消费前一次运行残留文件。

退出条件：测试名存在但没有真正通过的断言时 gate 必须失败；所有 required assertions 实际通过时才为 0。

### Phase 4 — 删除测试侧规避，改为真实故障注入

1. 将 `checkpoint-restart.e2e.ts:302` 的 `DASCOWORK_E2E_CHECKPOINT` 改为外部可观察条件后由测试进程 `crashApp()`/重启；无法从外部观察的持久化竞态下沉为 store/service 集成测试。
2. 将 `follow-up-queue-steer.e2e.ts:668` 的 `DASCOWORK_E2E_FORCE_STEER_REJECTION` 改为 scripted mock app-server 对真实 `turn/steer` 返回 rejection，并断言 `turn/steer` request 和 server rejection 各为一次；不得再断言 RPC 次数为零。
3. MessagePort 用真实 renderer reload/window teardown；app-server mock 必须发送真实顺序的 `response.output_item.done` 后 `response.completed`。断开后从 canonical history 恢复，不允许客户端补文本或终态。
4. release smoke 使用 disposable workspace、正式 sandbox/工具注册和真实 approval UI。删除假 `read_thread_terminal` 工具注入和“完全无审批”的假设；若不存在安全只读工具，记录为产品配置缺口而不是伪造工具。
5. 收紧 `tests/e2e/support/terminalScenario.ts:294-314`：所有登记为 transcript-preservation 证据的场景必须提供并断言先前 assistant 文本，不能只验证最后一个 user message。
6. 用静态扫描保护生产目录，允许 E2E 辅助文件中的外部资源配置，但禁止生产代码读取上述 E2E 控制变量或根据它们改 sandbox、tools、RPC、MessagePort 语义。

退出条件：故障由真实边界产生，测试的成功不会依赖生产客户端为 fixture 特设的分支。

### Phase 5 — 完成队列与 canonical history 对账

1. 保持 `ConversationFollowUpQueueStore` 的恢复矩阵：`queued` 保持 queued，`editing`/既有 paused 保持原样，`accepted` 删除，`sending`/`steering` 无 lease 地转 `paused-recovery-uncertain`。
2. 在 `ConversationFollowUpQueueService` 与 `ConversationApiService` 的恢复编排中，按 `clientUserMessageId` 读取 app-server canonical history：找到已接受消息即删除 uncertain 项；未找到则保留暂停、绝不自动重发。
3. 用真实队列重启测试覆盖 queued 的精确一次发送、sending/steering 无 lease、accepted 删除、editing/paused 不调度，以及 canonical 已接受/未接受的两条 uncertain 分支。
4. 确认 `ConversationTranscriptRecoveryStore` 与 `ConversationChatRegistry` 仍仅保留附件 overlay；对稳定 canonical message ID 合并，canonical 包含相同 metadata 时即删除 local overlay。

退出条件：重启不会丢失未发消息，也不会重复发送可能已经被 app-server 接受的消息；本地存储不再成为对话结果来源。

### Phase 6 — 仅按暂存快照做分层验证并收口

1. 在每个 Phase 后先执行相应的 unit/integration tests，再合并后执行：
   - `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint`
   - `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck`
   - provider 的 dynamic tool、broker、connection、transport 定向 tests
   - `npm --prefix desktop-app run typecheck`
   - `npm --prefix desktop-app test`
   - `npm --prefix desktop-app run test:plan-coverage`
   - Playwright 的 checkpoint、steer、C22 MessagePort、M09/E12/F16、approval/release-smoke 场景
2. 将 release smoke 分为可在本地无凭据运行的打包/配置检查与凭据存在时的真实发布门禁；没有凭据时不能声称该 gate 已通过。
3. 最后从仅暂存快照运行关键模块解析、质量命令和 `git diff --cached --check`，检查 `git diff --cached --name-only -- codex/codex-rs/app-server` 为空。
4. 记录每条验收条件的命令、runId、通过/失败和证据路径；未运行或凭据受限的项目明确标为缺口，不以旧账本替代。

退出条件：所有验收项都具有本次暂存快照的可复现证据；否则保持 `REQUEST CHANGES`。

## 4. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 直接暂存工作区全部修改会混入无关变更 | 每个文件先确认调用关系和测试证据；按 Phase 分组暂存，禁止全量 add。 |
| 新的 broker 清理误伤其他 logical channel | 多 channel 集成测试必须断言目标 channel 清零、非目标 channel 仍可完成请求。 |
| deadline 导致正常关闭时丢失 canonical outcome | 正常 idle 与 deadline 两条测试分开；deadline 只强制释放本地资源，canonical outcome 仍由 app-server history 读取。 |
| 测试报告格式不稳定 | 用项目现有 Vitest/Playwright reporter 的结构化输出；schema/runId 校验失败即拒绝，不做宽松兼容。 |
| release smoke 依赖凭据或外部服务 | 将其设为发布门禁；本地仅验证包、配置和测试 harness，最终结果清楚区分“通过”和“未具备凭据”。 |

## 5. 完成定义

本计划完成后，复审者应能在没有作者工作区残留、没有测试专用生产分支、没有本地 transcript 回填的情况下，复现所有关键测试并确认：暂存区自包含、跨调用工具不挂起、连接不会无限关闭、覆盖率来自本次真实执行、队列不会重复发送，且 app-server 没有被修改。
