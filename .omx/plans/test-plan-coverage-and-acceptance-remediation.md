# 引导对话测试计划补全与验收阻断修复执行计划

## 1. 计划目标

本计划解决两类问题：

1. 修复当前暂存实现中会阻止验收的真实链路缺陷，包括活跃 turn 的 provider transport 中断、MessagePort 中断和相同文本 steer 的旧版确认歧义。
2. 修订 `docs/test-plan.md` 中无法客观判定完成、终态规则不明确、重试与工具记录冲突、发布验收不是打包产物等定义缺口，并补齐最低 Mock E2E、真实发布验收、诊断材料和 CI 稳定性门禁。

最终结果必须能通过一份“场景 ID → 测试层 → 测试文件/用例 → 必须断言 → 当前状态”的追踪清单，客观回答 134 个场景哪些已完成、哪些延期、哪些不适用。

## 2. 范围与边界

### 2.1 包含范围

- Provider fork 的 transport 终结、流关闭和 worker 回收。
- Desktop main、preload、renderer 之间的流终态和 MessagePort 故障恢复。
- steer 身份确认、队列 claim/commit/recovery。
- 工具、审批、手动重试和应用重启恢复。
- Mock backend、Mock E2E、发布时真实 LLM E2E、诊断材料和 CI 门禁。
- `ConversationTranscriptController` 接管普通聊天后必要的回归保护。
- `docs/test-plan.md` 的完成定义、状态规则和覆盖追踪。

### 2.2 不包含范围

- 不修改 `codex/codex-rs/app-server`；所有修复落在 provider fork 和 `desktop-app/`。该边界来自 `docs/test-plan.md:324` 和仓库架构约束。
- 不增加新的模型调用路径，不绕过 Codex app server。
- 不在普通 PR CI 中调用真实 LLM；真实接口只用于发布前手动门禁，沿用 `docs/test-plan.md:307-320` 的边界。
- 不顺带重构无关模型目录、项目选择器或普通 UI。

## 3. 先写入 `docs/test-plan.md` 的判定规则

实施产品代码前，先把以下规则写入 `docs/test-plan.md`，并给 A～G 的场景编号固定为
`A01-A14`、`B01-B16`、`C01-C24`、`D01-D20`、`E01-E28`、`F01-F20`、`G01-G12`。
后续测试名称必须包含对应场景 ID。

### 3.1 完成定义和覆盖分级

为每个场景增加以下字段：

- `requiredLayer`：`provider-unit`、`desktop-unit`、`integration`、`mock-e2e`、`release-e2e` 中的一个或多个。
- `requiredAssertions`：明确需要验证 UI、terminal、queue、turn、provider request、tool/approval、诊断中的哪些项目。
- `status`：仅允许 `missing`、`partial`、`covered`、`deferred`、`not-applicable`。
- `evidence`：测试文件和完整测试名称；没有证据不得写 `covered`。
- `deferredReason`：只有明确的外部依赖或独立后续计划才能延期。

新增 `desktop-app/tests/test-plan-coverage.json` 作为机器可读清单，并新增
`desktop-app/scripts/verify-test-plan-coverage.mjs`，至少检查：

- A～G 共 134 个 ID 全部存在且唯一。
- `covered` 条目必须引用存在的文件和非空测试名称。
- `mock-e2e` 的最低 12 组全部为 `covered`。
- 六个 `release-e2e` 场景全部有测试所有者；普通 CI 只检查清单，发布门禁才执行真实接口。
- P0/P1 场景不得标记为 `deferred`。

`docs/test-plan.md` 保留人类可读矩阵，JSON 清单作为执行和 CI 判定来源，避免仅凭“测试数量”声称完成。

### 3.2 唯一终态规则

把 `docs/test-plan.md:83-104`、`106-145`、`226-239` 的终态要求明确为：

1. 每个 stream/turn 只能提交一次终态；终态一旦提交不可被后续事件覆盖。
2. 用户停止只有在“停止请求先于任何上游终态被记录”时判定为 `interrupted`。
3. 已收到的 canonical `turn/completed` outcome 优先于随后到达的 transport close/error。
4. 尚无 canonical outcome 时，provider/transport/MessagePort 的不可恢复异常判定为 `failed`。
5. 已记录终态后的 chunk、finish、error、thread-bound 和 lifecycle 事件全部忽略，并记录一次可关联的诊断事件，不再次更新 UI 或队列。
6. terminal IPC、active run 清理、队列结算和 worker 释放都必须幂等。

### 3.3 steer 接受状态规则

把 `docs/test-plan.md:83-104` 的不确定状态细化为：

- 带 `clientUserMessageId` 的 canonical `userMessage` 是主要接受证据。
- 旧事件没有 ID 时，compare key 只有在同一 turn 中恰好匹配一个未确认 steer 时才可接受；零个或多个候选都不得猜测。
- RPC 明确拒绝且没有 canonical 接受证据：恢复原队列位置，状态为 `steer-rejected` 或 `turn-race`。
- RPC 成功但 canonical 事件未出现：在 turn 终态或 30 秒确认窗口先到时进入 `paused-recovery-uncertain`；不得自动重发。
- canonical 已接受：队列只结算一次，后续模型失败不得重新入队。

30 秒必须定义为可注入配置，单元测试使用假时钟，不允许真实等待。

### 3.4 重复、未知和乱序事件规则

把 `docs/test-plan.md:122-133`、`149-168` 的模糊情况定义为：

- 未知但不改变已知状态的事件：忽略并写脱敏诊断。
- 完全重复的 item/terminal：按事件身份去重。
- 可通过 sequence 和 item ID 补齐前驱的乱序 item：在当前 turn 内有限缓存；前驱到达后按 sequence 应用。
- turn 终止时仍缺少必要前驱、或出现无法成立的状态倒退：当前 turn 单一失败，已显示内容保留。
- tool completed 先于 started：允许暂存；到 turn 结束仍缺 started 时，工具标记失败，turn 不得伪装为正常完成。
- error 后的所有 chunk/finish/lifecycle：忽略。

### 3.5 工具失败、记录保留与重试规则

解决 `docs/test-plan.md:12,47,50-51,138,164-168,206,215,329` 之间的歧义：

- 历史 UI 保留失败 turn 已显示的文本、reasoning、工具调用、审批和工具结果。
- regenerate 构造新模型输入时，只截断失败 turn 的 assistant tail；不得把旧工具结果伪装成新 turn 已完成的工具。
- 工具非零退出、`output-error`、超时或拒绝作为工具结果交给模型解释；只有 transport/协议失败、工具永不结算或 app-server 明确 failed 才直接使 turn 失败。
- 新 turn 再次请求同一有副作用工具时必须产生新 call ID 和新 approval request；旧审批不得复用。
- 手动重试只允许创建一个新 turn，不自动重试，也不自动执行工具。

### 3.6 精确时间、容量和发布规则

- 将 `docs/test-plan.md:60` 的“精确 80ms”改为“回答可见且 `turn/completed` gate 尚未释放”的事件边界；禁止依赖固定 sleep。
- 所有容量场景按 `limit - 1`、`limit`、`limit + 1` 测试。当前边界来源包括
  `desktop-app/src/shared/codexFollowUpApi.ts:10-17,49-68,92-100,131-155`。
- 明确发布真实 LLM E2E 必须启动 `electron-builder --dir` 产生的 unpacked packaged artifact，禁止开发态 Electron 和 `cargo run` 回退。当前开发态回退位于
  `desktop-app/src/main/codexAppServerLaunch.ts:79-98`。
- 发布用例必须等待单一 terminal、Composer 恢复和无错误卡；出现一段非空文本不能视为成功。
- 外部服务暂时故障只允许整套重跑一次；第一次和重跑结果都必须保留脱敏诊断。

## 4. 可测试的总体验收标准

以下条件全部满足后，才能把计划标记为完成：

1. `desktop-app/tests/test-plan-coverage.json` 包含 134 个唯一场景 ID；所有 P0/P1 和最低 Mock E2E 场景为 `covered`。
2. 活跃 turn 的 stdio/WebSocket/persistent transport 在 error 或 close 后 1 秒内使消费流得到单一 error terminal；active session 失效，worker 可被下一请求重新建立。
3. MessagePort 数据通道中断后 1 秒内，renderer 经独立 terminal fallback 收到单一 `error` 或 `aborted`；Composer 恢复，active stream/run 清零。
4. 两条相同文本但不同 ID 的 steer 在旧版无 ID ack 下都不得被错误接受；唯一候选仍兼容旧事件。
5. `docs/test-plan.md:267-278` 的 12 组最低 Mock E2E 全部存在，并同时断言计划要求的 UI、terminal、queue、turn 数量和 provider 请求数量。
6. 应用重启用例复用同一 `userDataDir` 和 `CODEX_HOME`，证明错误、已消费 steer、未消费队列和 recovery-uncertain 均按规则恢复。
7. 有副作用工具重试 E2E 证明第二次调用拥有新 call ID、新 approval ID，且没有自动执行或自动批准。
8. 六个真实 LLM 场景均针对 packaged artifact；每项等待 terminal 和 Composer 恢复，并验证 thread/turn/tool/history 结构。
9. 每个 Mock 异常 E2E 在单 worker 下 `--repeat-each=10` 全部通过；没有 page error、unhandled rejection、残留 active run、lease、approval 或子进程。
10. 失败 E2E 附件包含脱敏后的 main/renderer/provider 日志、backend 请求、terminal 记录、queue snapshot、active run/turn 计数和截图。
11. Provider 与 Desktop 的 lint、typecheck、单元测试、Mock E2E、覆盖清单校验全部进入 PR CI。
12. `ConversationTranscriptController` 接管所有会话的普通聊天回归全部通过，包括普通发送、停止、regenerate、附件、历史重载、切换对话和 metadata/source/data parts。
13. `git diff --check` 通过，且没有 `codex/codex-rs/app-server` 改动。

## 5. 实施步骤

### 阶段 0：修订计划契约并建立追踪清单

涉及文件：

- `docs/test-plan.md:3-329`
- 新增 `desktop-app/tests/test-plan-coverage.json`
- 新增 `desktop-app/scripts/verify-test-plan-coverage.mjs`
- `desktop-app/package.json:8-30`

行动：

1. 写入第 3 节定义的完成状态、终态优先级、steer 接受证据、非法事件、工具重试、容量和 packaged release 规则。
2. 将场景固定编号为 `A01-A14`、`B01-B16`、`C01-C24`、`D01-D20`、`E01-E28`、`F01-F20`、`G01-G12`。
3. 录入已有测试证据，不能确认完整断言的标为 `partial`，不得为了提高完成率写成 `covered`。
4. 给最低 12 组 Mock E2E 和六组 release E2E 建立独立验收条目。
5. 增加 `test:plan-coverage` script。

验收：

- 校验脚本能拒绝缺失 ID、重复 ID、不存在文件、空测试名、P0/P1 deferred 和最低 Mock E2E 未覆盖。
- 现状第一次运行应明确失败并列出缺口；不得先把清单全部标绿。

### 阶段 1：先用回归测试锁定三个高风险断点

涉及文件：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/persistent-transport.test.ts:200-246`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/model.stream.test.ts`
- `desktop-app/src/preload/chatStreamBridge.test.ts:51-273`
- `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts`
- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.test.ts:32-369`
- `desktop-app/src/main/codexChatRuntimeService.test.ts:686-768,1476-2218`

先新增失败测试：

1. 在首个 token 前和部分 token 后分别关闭 active transport，断言 stream 单一 error、session inactive、下一请求建立新 worker。
2. 模拟 MessagePort 在无 terminal 时损坏，断言 preload/renderer 只收到一次 error，activeStreams 清零。
3. 模拟 main terminal 与 MessagePort fallback 同时到达，断言 first-terminal-wins。
4. 暂存两条相同 compare key、不同 ID 的 steer，再发送无 ID canonical ack，断言两条都保持未确认；发送带 ID ack 只接受对应一条。
5. 测试终态后的 chunk、lifecycle、finish、error 全部不改变 transcript、queue 和回调计数。

验收：

- 新测试在修复前可稳定复现问题，在修复后通过。
- 测试使用 deferred、假时钟或显式事件，不使用固定 sleep。

### 阶段 2：修复 provider 活跃 transport 终结

涉及文件：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/transport.ts:35-49`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-client.ts:70-135`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/worker.ts:48-85`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/transport-persistent.ts:108-176`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:693-820,958-993,1250-1263`

行动：

1. `AppServerClient` 同时订阅 transport `error` 和 `close`，统一转换成一次 fatal termination；disconnect 时同步移除两类监听器。
2. 除拒绝 pending RPC 外，把 fatal termination 暴露给当前模型流。
3. 模型流调用既有单一 `closeWithError` 路径，关闭 session、dynamic tools、approvals 和 file resolver。
4. persistent worker 收到 error/close 后保持 `disconnected`，清理 pending tool 状态；pool 释放时不得把损坏连接直接交给 waiter。
5. 明确用户 abort 与 transport failure 竞态遵循第 3.2 节规则。

验收：

- active crash 不再等待通知中的 finish。
- error+close 连续触发仍只有一个 stream error 和一次资源清理。
- crash 后下一请求重新 initialize；无 listener、worker、pending tool 泄漏。

### 阶段 3：建立 MessagePort 之外的 terminal fallback

涉及文件：

- `desktop-app/src/shared/codexIpcApi.ts:147-207`
- `desktop-app/src/main/index.ts:663-690`
- `desktop-app/src/main/codexChatRuntimeService.ts:275-543`
- `desktop-app/src/preload/index.ts:65-70`
- `desktop-app/src/preload/chatStreamBridge.ts:18-78`
- `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts:100-170`

行动：

1. 给每次 stream 分配稳定 `streamId`，并随 `codex-chat:start` 传给 main。
2. MessagePort 保留 chunk/lifecycle 数据面；main 在 terminal 时同时通过受控 IPC fallback 发送
   `{ streamId, terminal }`，用于 port 已关闭或 postMessage 失败的情况。
3. preload 按 streamId 合并 port terminal 与 fallback terminal，使用单一 first-terminal-wins 状态机。
4. preload 处理 `messageerror`，立即清理数据 port，但等待同一 stream 的 fallback terminal；增加 1 秒可注入保护超时，超时后以稳定脱敏错误结算。
5. main 监听 `MessagePortMain` close；如果 run 仍活跃，触发 abort/清理，但不能把用户未请求的端口故障显示为“已取消”。
6. stream terminal 后移除 IPC fallback listener/registry，防止长期会话积累 listener。

验收：

- 正常 finish/error/aborted 不改变现有 UI。
- port terminal 丢失、port messageerror、main fallback 先到或后到均只结算一次。
- 12 个并发 stream 全部结束后 activeStreams 和 fallback registry 为 0。

### 阶段 4：修复 steer 身份歧义和确认超时

涉及文件：

- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts:193-228,423-452`
- `desktop-app/src/main/codexChatRuntimeService.ts:835-889`
- `desktop-app/src/main/followUps/ConversationFollowUpQueueService.ts`
- `desktop-app/src/shared/codexFollowUpApi.ts:28-61`

行动：

1. 抽取共享的“唯一 legacy compare-key 候选”选择规则，renderer 与 main 使用相同语义。
2. 无 ID ack 匹配多个候选时不得更新任何一条；记录 correlation 信息，不记录消息全文或密钥。
3. 为 RPC 成功但 canonical 缺失增加可注入的 30 秒确认截止；进入
   `paused-recovery-uncertain`，释放失效 lease，但不自动重发。
4. 统一文档和代码状态名称为 `paused-recovery-uncertain`；pause kind 保持 `recovery-uncertain`。
5. 验证 conversation local ID → thread ID 迁移前后计时器、claim 和 pending identity 不丢失。

验收：

- B04-B09、B11-B14 每项有对应单元或集成测试。
- 相同文本不同 ID、迟到 RPC、重复 canonical、旧 revision 都不会重复 commit 或错误恢复队列。

### 阶段 5：补齐重启恢复和工具重试安全

涉及文件：

- `desktop-app/src/main/followUps/ConversationFollowUpQueueStore.ts`
- `desktop-app/src/main/followUps/ConversationFollowUpQueueService.ts`
- `desktop-app/src/main/followUps/ConversationFollowUpQueueStore.test.ts:72-184`
- `desktop-app/src/main/followUps/ConversationFollowUpQueueService.test.ts:81-846`
- `desktop-app/src/main/codexApprovalBroker.ts`
- `desktop-app/tests/e2e/approvals.e2e.ts`
- `desktop-app/tests/e2e/follow-up-failures.e2e.ts:21-145`
- `desktop-app/tests/e2e/support/app.ts:12-87`

行动：

1. 增加三类 crash checkpoint：canonical 前、canonical 后 queue commit 前、工具完成后最终生成失败。
2. 重启时清除失效 lease；无法确认的发送进入 recovery-uncertain，已 canonical 接受的 steer 保持消费。
3. 用同一 `userDataDir` 和 `codexHomeDir` 重启 Electron，验证错误卡、队列、turn history 和 tool record。
4. 增加副作用工具失败 → 手动 retry → 再次请求工具的 E2E；断言第二次必须出现新 approval，未点击允许前工具不执行。
5. 增加审批等待期间 steer、拒绝、停止、transport failure 和 app 重启组合；晚到或重复审批响应必须失败关闭，不得应用到新 turn。

验收：

- E12-E17、F16、D14-D18 全部能从持久化状态证明，不只验证内存对象。
- retry 前后 provider 请求、tool call ID、approval ID 和执行次数均有精确断言。

### 阶段 6：补齐最低 12 组 Mock E2E 和断言设施

涉及文件：

- `desktop-app/tests/e2e/follow-up-queue-steer.e2e.ts:22-300`
- `desktop-app/tests/e2e/follow-up-failures.e2e.ts:21-462`
- `desktop-app/tests/e2e/approvals.e2e.ts:15-220`
- `desktop-app/tests/e2e/support/mockBackend.ts:23-338`
- `desktop-app/tests/e2e/support/app.ts:98-177`
- `desktop-app/src/main/codexChatRuntimeService.ts:644-675`

行动：

1. 补齐四个明确缺失场景：
   - `M04/B03`：steer 与 turn/completed 竞态。
   - `M05/E07`：steer 明确拒绝后恢复原队列位置。
   - `M09/E12-E17/F16`：app 重启恢复错误和队列。
   - `M11/A09/D12-D15`：审批等待期间 steer、拒绝和取消。
2. 将“空流、非法 SSE、重复 terminal”扩展为非法顺序、unknown、duplicate 和 error 后 late events。
3. 提供 E2E-only 诊断快照接口，返回 queue state、active run 数、turn ID、terminal 记录、pending steer/approval 数；只在测试环境启用，不暴露密钥或 provider 配置。
4. 建立共享断言 `expectTerminalScenario`，每个异常场景同时检查：
   - UI 最终状态；
   - terminal 类型和次数；
   - queue item 状态、顺序、revision；
   - turn started 数量；
   - provider 请求数量；
   - tool/approval 执行数量；
   - renderer/page 健康。
5. `attachDiagnostics` 增加 queue snapshot、terminal、active runs、pending approvals，并继续使用
   `redactDiagnosticData`；release 日志也必须走同一脱敏函数，替换
   `release-llm.e2e.ts:34-37` 的原始日志附件。

验收：

- 最低 12 组各有独立测试名和场景 ID。
- 每组都调用共享终态断言，不允许只看错误卡或非空文本。

### 阶段 7：补齐 A～G 的高风险矩阵与普通聊天回归

优先级：

- P0：C22、C23、B11、D18、E13-E17、G11。
- P1：A05-A09、B03-B10、C09-C12、C15-C24、D09-D20、F16-F19、G05-G09。
- P2：容量、复杂内容、可访问性和压力边界。

涉及文件：

- Provider tests：`event-mapper.test.ts`、`model.stream.test.ts`、
  `persistent-transport.test.ts`、`cross-call-tools.test.ts`、`history-mapper.test.ts`。
- Desktop tests：`codexChatRuntimeService.test.ts`、
  `ConversationFollowUpQueueService.test.ts`、`ConversationFollowUpQueueStore.test.ts`、
  `ConversationTranscriptController.test.ts`、`ElectronIpcChatTransport.test.ts`、
  `App.test.tsx`、`QueuedFollowUpList.test.tsx`。
- E2E：`follow-up-queue-steer.e2e.ts`、`follow-up-failures.e2e.ts`、
  `approvals.e2e.ts`、必要时新增 `follow-up-recovery.e2e.ts`。

行动：

1. 事件/协议问题尽量在 provider 单元层穷举；跨 IPC/队列状态在 Desktop 集成层覆盖；只把用户可见链路和恢复行为放到 E2E。
2. HTTP 使用表驱动覆盖 401、403、404、429、500、502、503、504。
3. reasoning、工具 started/completed、多个工具、hang、out-of-order 和 late event 使用 deterministic gate。
4. 容量测试使用 limit-1/limit/limit+1；不把 10MB/50MB 大对象直接放入每个 E2E，边界校验在单元层，UI 大负载只保留一个代表性 smoke。
5. 为 `ConversationTranscriptController` 全局接管增加普通聊天回归：
   - 普通发送和流式文本；
   - reasoning/source/data/tool parts；
   - 用户停止与 regenerate；
   - 图片、文件、文件夹和 context references；
   - 历史重载和对话切换；
   - thread-bound、metadata 和 source item identity。
6. 进行 100 次 queue/steer 循环和 transport pool 第五等待者测试；完成后 listener、lease、active run、waiter 均为 0。

验收：

- 清单中 P0/P1 全部 covered。
- P2 若延期，必须有单独计划路径、负责人和不影响当前发布的理由。
- 普通聊天核心回归不得因 follow-up controller 引入行为变化。

### 阶段 8：把真实 LLM 验收改为 packaged release gate

涉及文件：

- `desktop-app/package.json:12-30`
- `desktop-app/scripts/run-release-llm-smoke.mjs:1-28`
- `desktop-app/tests/e2e/release-llm.e2e.ts:1-40`
- `desktop-app/tests/e2e/support/app.ts:12-65`
- `desktop-app/electron-builder.yml:17-23`
- `desktop-app/src/main/codexAppServerLaunch.ts:60-98`

行动：

1. 脚本先执行 `build:unpack`，解析当前平台的 packaged executable，使用
   `launchApp({ executablePath, args, cwd })` 启动打包产物。
2. 测试启动后记录并断言 app-server 来自 packaged resources；禁止 `CODEX_APP_SERVER_BIN` 和 `cargo run` 开发回退。
3. 实现六个独立 release 测试：
   - R01 普通文本；
   - R02 可见输出后 steer；
   - R03 只读工具；
   - R04 工具阶段 steer；
   - R05 用户停止得到 interrupted；
   - R06 历史重载保留回答、steer 和工具。
4. 只允许安全只读工具 allowlist；测试明确禁止文件修改和网络副作用工具。
5. 不断言精确模型文案，但必须断言 turn、唯一 terminal、工具完成、steer canonical 接受和 Composer 恢复。
6. 所有附件使用脱敏诊断；日志、截图和请求体不得包含 authorization、API key、token 或 provider headers。

验收：

- 六项全部通过才允许发布。
- 任一项失败阻断发布；只允许整套人工重跑一次，不能单独挑失败项反复重跑。
- 测试证明 packaged resources 中 app-server 可启动，不采信开发环境成功作为发布证据。

### 阶段 9：CI、十次稳定性和最终验收

涉及文件：

- 新增仓库实际 CI 使用的 workflow 文件。
- `desktop-app/package.json:8-30`
- `desktop-app/playwright.config.ts:3-15`
- `desktop-app/tests/e2e/support/app.ts:98-177`

PR CI 顺序：

1. Provider lint、typecheck、test。
2. Desktop lint、typecheck、test。
3. `npm --prefix desktop-app run test:plan-coverage`。
4. Mock E2E 单次全量。
5. 本次 P0/P1 异常 E2E 使用 `--repeat-each=10 --workers=1`。
6. `git diff --check HEAD` 和 app-server 禁改路径检查。

实现要求：

- 普通 Mock E2E 不设置全局 `repeatEach: 10`，避免所有普通场景成本放大；单独增加
  `test:e2e:stability` script，只选异常场景项目或 grep 标签。
- 每个 P0/P1 异常测试增加统一标签，例如 `@terminal-failure`、`@recovery`、`@approval-retry`。
- CI 失败上传 Playwright trace、截图和脱敏诊断。
- 增加 afterAll 资源检查或 E2E 诊断断言，确保无残留 Electron/app-server 进程和临时目录。

最终验收：

- 执行第 6 节完整命令集。
- 由独立 reviewer 按 `test-plan-coverage.json` 抽查至少所有 P0/P1 证据。
- 报告必须列出 covered/partial/deferred 数量；只要存在 P0/P1 missing/partial，就不得写“计划完成”。

## 6. 验证命令

```text
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test
npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
npm --prefix desktop-app test
npm --prefix desktop-app run test:plan-coverage
npm --prefix desktop-app run test:e2e -- --reporter=line
npm --prefix desktop-app run test:e2e:stability
git diff --check HEAD
git diff --name-only HEAD -- codex/codex-rs/app-server
```

发布前额外执行：

```text
npm --prefix desktop-app run test:e2e:release-llm
```

最后一个命令需要真实发布环境和凭据，不进入普通 CI。

## 7. 风险与缓解

### 风险 1：MessagePort fallback 形成两个互相竞争的终态来源

缓解：所有 terminal 必须带 streamId，通过一个 first-terminal-wins reducer 结算；重复来源只记录诊断，不重复调用 renderer callback。

### 风险 2：transport close 与正常 disconnect 无法区分

缓解：`AppServerClient.disconnect()` 先标记 intentional shutdown，再移除监听器；只有非主动关闭才向模型流发 fatal termination。

### 风险 3：worker crash 后 pending tool call 污染下一 turn

缓解：error/close 清空 crash worker 的 pending tool 和 buffer；下一次必须重新连接和 initialize，不允许跨崩溃恢复旧工具。

### 风险 4：重启 E2E 和审批 E2E 变慢或不稳定

缓解：使用共享数据目录、事件 gate 和明确的 app close/relaunch helper；不使用固定延迟，不依赖模型响应速度。

### 风险 5：134 场景全部 E2E 导致 CI 成本不可接受

缓解：按测试层分配；协议穷举放 provider 单元层、持久化放 Desktop 集成层、用户可见关键链路放 E2E。最低 12 组和 P0/P1 必须 E2E 的场景不可下放规避。

### 风险 6：发布 smoke 泄露真实凭据

缓解：关闭原始 packet 日志或统一走 `redactDiagnosticData`；诊断写入前扫描敏感 key 和 Bearer/sk-* 形态，命中即使测试失败并拒绝上传原附件。

### 风险 7：修改全局 transcript controller 引发普通聊天回归

缓解：阶段 7 的普通聊天契约测试是发布阻断项；不以“计划只覆盖 follow-up”为理由跳过该回归。

## 8. 推荐执行顺序与提交边界

建议保持以下小提交，便于回滚和审查：

1. `test-plan contract + coverage manifest`
2. `provider active transport termination`
3. `IPC terminal fallback`
4. `steer identity and uncertain recovery`
5. `restart and approval retry safety`
6. `minimum mock E2E and diagnostics`
7. `matrix and ordinary-chat regression coverage`
8. `packaged release LLM gate`
9. `CI and stability gate`

每个提交先包含对应回归测试，再包含实现；上一阶段验证通过后再进入下一阶段。

## 9. 停止条件

满足以下任一情况时停止当前实施分支并上报，不扩大范围：

- 修复必须修改 `codex/codex-rs/app-server` 才能成立。
- packaged release 无法提供真实 app-server binary，且需要改变发布架构。
- 终态规则需要改变用户可见的“取消、失败、完成”产品语义。
- 副作用工具 allowlist 或真实发布凭据管理需要新的安全授权。

除上述情况外，按阶段连续执行、测试和修复，不在普通本地改动之间请求确认。
