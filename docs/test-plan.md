# 引导对话全链路高覆盖测试计划

## 一、目标与测试策略

围绕“排队消息 → 发送引导 → 同一 turn 继续执行 → 工具调用 → 最终回答或失败 → 恢复”的完整链路建立测试矩阵。

已锁定的产品行为：

- 日常开发和 CI 全部使用模拟模型服务，不访问真实 LLM。
- 真实 Qwen/DashScope 只在发布验收时运行。
- `turn/steer` 不撤回已经显示的回答，而是追加到当前活跃 turn。
- 上游失败必须明确显示错误，保留已有回答、引导消息和工具记录。
- 不自动重试；用户手动重试时只启动一个新 turn。
- 用户主动停止属于“已取消”，不能显示成模型错误。
- 已被 app-server 接受的引导消息，即使后续生成失败，也不能重新回到队列。

现有 steer E2E 已覆盖基本追加行为：[follow-up-queue-steer.e2e.ts](/Users/nallylin/Documents/code/dasCowork/desktop-app/tests/e2e/follow-up-queue-steer.e2e.ts:141)。新增测试重点覆盖当前缺失的断流、错误显示、恢复和持久化场景。

### 可审计的完成定义

本文件是人类可读矩阵；[test-plan-coverage.json](/Users/nallylin/Documents/code/dasCowork/desktop-app/tests/test-plan-coverage.json) 是 CI 使用的唯一机器可读判定来源。每个场景都必须在清单中具备 requiredLayer（provider-unit、desktop-unit、integration、mock-e2e、release-e2e 中的一个或多个）、requiredAssertions（明确的 UI、terminal、queue、turn、provider request、tool/approval 或诊断断言）、status、evidence，以及只在延期时使用的 deferredReason。status 只能是 missing、partial、covered、deferred 或 not-applicable；没有测试文件和完整测试名称的证据，不得标记为 covered。P0/P1 不得延期。

本节 A～G 的编号是固定主键：A01-A14、B01-B16、C01-C24、D01-D20、E01-E28、F01-F20、G01-G12。每组第 n 条就是该组的字母加两位 n，例如 A.4 是 A04、C.23 是 C23。新增或改名的测试标题必须包含对应场景 ID。M01-M12 是最低 Mock E2E 组，R01-R06 是发布验收组；它们引用 A～G 主键而不另行增加场景数量。

### 终态、steer 与重试判定

- 每个 stream/turn 只能提交一次终态；提交后不可覆盖。用户停止仅在停止请求先于任何上游终态记录时为 interrupted；已收到 canonical turn/completed outcome 时，它优先于随后 transport close/error；尚无 canonical outcome 时，不可恢复的 provider、transport 或 MessagePort 异常为 failed。
- 终态后的 chunk、finish、error、thread-bound 和 lifecycle 事件一律忽略，只写一次可关联且脱敏的诊断。terminal IPC、active run 清理、队列结算和 worker 释放都必须幂等。
- 带 clientUserMessageId 的 canonical userMessage 是 steer 的主要接受证据。旧事件无 ID 时，compare key 只有在同一 turn 恰好命中一条未确认 steer 时才可接受；零个或多个候选都不得猜测。
- RPC 明确拒绝且没有 canonical 接受证据时，恢复原队列位置并标记 steer-rejected 或 turn-race。RPC 成功但没有 canonical 事件时，在 turn 终态或可注入的 30 秒确认窗口先到时进入 paused-recovery-uncertain；不得自动重发。canonical 已接受后只结算一次，后续模型失败也不能重新入队。
- 未知但不改变已知状态的事件应忽略并写脱敏诊断；完全重复的 item/terminal 按事件身份去重。可补齐前驱的乱序 item 只可在当前 turn 有限缓存；终止时仍缺必要前驱或出现不可能的倒退，当前 turn 单一失败并保留已显示内容。tool completed 先于 started 可暂存，但到 turn 结束仍缺 started 时工具标记失败。
- 历史 UI 保留失败 turn 的文本、reasoning、工具调用、审批和工具结果。regenerate 仅截断失败 turn 的 assistant tail，不能把旧工具结果当成新 turn 的完成工具。工具非零退出、output-error、超时或拒绝是交给模型解释的工具结果；只有 transport/协议失败、工具永不结算或 app-server 明确 failed 才直接使 turn 失败。手动重试只创建一个新 turn，绝不自动重试或自动执行工具；再次请求副作用工具必须使用新的 call ID 和 approval request。

### 时间、容量与发布边界

- 回答显示后但 completed 尚未到达的时序用事件 gate 表达，禁止依赖精确 80ms 或固定 sleep。
- 所有容量场景都以 limit - 1、limit、limit + 1 覆盖。
- 普通 PR CI 只使用 Mock backend。真实 LLM 只在发布前运行，并且必须启动由 electron-builder --dir 生成的 unpacked packaged artifact；不得用开发态 Electron 或 cargo run 回退作为发布证据。
- 发布用例必须等待唯一 terminal、Composer 恢复且没有错误卡；仅看到一段非空文本不能视为成功。外部服务故障只允许整套重跑一次，并保留第一次及重跑的脱敏诊断。

## 二、测试基础设施与内部接口

### 模拟模型服务

扩展 [mockBackend.ts](/Users/nallylin/Documents/code/dasCowork/desktop-app/tests/e2e/support/mockBackend.ts:23) 的测试响应定义，支持以下终止方式：

- `complete`：正常发送 `response.completed` 并结束。
- `disconnect`：在指定事件后销毁连接，模拟 `stream disconnected before completion`。
- `hang`：在指定事件后保持连接，用于超时和取消测试。
- `close-before-headers`：请求到达后立即断开。
- 保留已有 HTTP 状态错误能力，覆盖 401、403、429、5xx。
- 支持发送空流、非法 SSE、重复事件、乱序事件和未知事件。
- 每个步骤支持确定性的 gate/deferred 控制，不使用固定 `sleep` 制造竞态。

补充组合响应构造器：

- 回答文本 → 等待 → 引导 → 继续回答。
- 回答文本 → 工具调用 → 工具结果 → 最终回答。
- 工具结果 → 下一次模型请求断流。
- 部分最终回答 → 断流。
- 多工具调用 → 第 N 步失败。
- 等待审批 → 引导/取消/批准/拒绝。

### 错误状态展示契约

不改变外部公开 API，仅完善内部消息状态：

- Provider 继续通过现有 error stream 传递 `turn.error`。
- Live transcript 在失败时把最后一个助手段标记为 `incomplete/error`，附带错误文本。
- 历史映射读取 `turn.status` 和 `turn.error`，重启后仍能恢复失败状态；当前 [history-mapper.ts](/Users/nallylin/Documents/code/dasCowork/desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-mapper.ts:45) 尚未处理这两个字段。
- [App.tsx](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.tsx:590) 不再只显示历史加载错误，还要显示运行中 turn 的失败。
- 手动重试沿用 regenerate 语义：保留到引导用户消息为止，移除失败的助手尾段并启动一个新 turn；不得恢复已经失败的旧 turn。
- 重试不会自动复用或跳过工具。如果模型再次请求有副作用的工具，仍须重新走审批。

## 三、完整场景矩阵

### A. 正常引导时序

1. turn 刚开始、尚未产生任何输出时发送引导。
2. reasoning 已开始但尚无助手文本时发送引导。
3. 助手文本只输出一部分时发送引导。
4. 助手完整回答已经显示、但 `turn/completed` 尚未到达时发送引导；用 completed gate 复现该事件边界，不依赖固定时长。
5. 工具调用刚开始时发送引导。
6. 工具执行中发送引导。
7. 工具结果已经返回、下一次模型请求尚未发出时发送引导。
8. 最终回答正在流式输出时再次发送引导。
9. 审批面板等待用户决定时发送引导。
10. 同一 turn 连续发送两条或多条引导。
11. 从队列中选择非队首消息发送引导。
12. 引导包含文本、图片、文件、文件夹和上下文引用。
13. 引导发送期间切换到其他对话，再切回原对话。
14. 两个不同对话同时运行并分别发送引导。

每项必须断言：

- 已输出的原回答不消失、不被修改。
- 引导使用原 turn ID，不产生额外 `turn/started`。
- 每个 `clientUserMessageId` 只接受一次。
- 多条引导按 app-server 接受顺序出现在 transcript。
- 其他队列消息的顺序和内容不变。
- 不同对话的 turn、队列、错误和工具事件完全隔离。

### B. turn/steer 竞态与身份一致性

1. 点击引导时已经没有活跃 turn。
2. `expectedTurnId` 与当前 turn 不一致。
3. 点击引导与 `turn/completed` 同时发生。
4. 引导 RPC 成功先到，canonical `userMessage` 后到。
5. canonical `userMessage` 先到，RPC 成功后到。
6. RPC 拒绝与 turn 终止同时发生。
7. turn 已终止后收到迟到的 RPC 成功。
8. RPC 成功但 canonical `userMessage` 永远不出现。
9. 重复收到 canonical `userMessage`。
10. 重复收到 `turn/completed`、finish 或 error。
11. 两条内容完全相同但 ID 不同的引导，不能错误去重。
12. 用户快速双击“引导”，只能产生一次 claim 和一次 RPC。
13. conversation 本地 ID 在引导过程中迁移为 app-server thread ID。
14. 引导过程中收到旧 revision 的队列订阅事件。
15. 同一对话已存在 active run 时，第二个普通发送不能替换原 run。
16. steer session 与 active run 不匹配时必须拒绝，不能发到其他 session。

预期状态：

- 未被 app-server 接受：消息恢复到原队列位置，并显示 `turn-race` 或 `steer-rejected`。
- 接受状态无法确认：进入 `paused-recovery-uncertain`，不得自动再次发送。
- 已 canonical 接受：队列项只结算一次，后续模型失败也不能重新入队。

### C. 模型接口和流异常

覆盖以下注入点：

1. 请求发送前连接失败。
2. 连接建立但响应头前断开。
3. HTTP 401、403、404、429。
4. HTTP 500、502、503、504。
5. 收到 `response.created` 后立即断流。
6. reasoning 过程中断流。
7. 第一段助手文本部分输出后断流。
8. 第一段助手文本完整输出但流未完成时断流。
9. 模型发出工具调用后、工具尚未执行时断流。
10. 工具结果成功返回后，最终采样请求断流；这是本次故障的核心回归场景。
11. 多个工具完成一部分后断流。
12. 最终回答部分输出后断流。
13. 返回 HTTP 200，但 SSE 流为空。
14. SSE JSON 非法。
15. 事件顺序非法，例如 done 先于 created。
16. 相同事件重复发送。
17. 插入未知事件类型。
18. `turn.status=failed` 且包含错误文本。
19. `turn.status=failed` 但没有错误文本，必须显示通用错误。
20. 请求在首 token 前永久挂起。
21. 请求在工具结果后永久挂起。
22. MessagePort 在流期间关闭。
23. app-server/provider transport 意外断开。
24. 错误事件后又收到 chunk、finish 或 thread-bound。

每项必须断言：

- UI 不得把失败消息标记为正常 `complete/stop`。
- 已经收到的文本、reasoning、工具和结果继续可见。
- 显示单一、明确的错误，不重复弹出。
- Composer 恢复可用，停止按钮消失。
- 不产生自动模型重试。
- 不产生额外工具调用。
- 迟到事件被忽略。
- terminal IPC 只能结算一次。
- 页面没有 unhandled rejection 或 renderer page error。

### D. 工具与审批异常

1. 单个只读工具成功，随后正常生成最终回答。
2. 多个工具串行执行后生成最终回答。
3. 工具退出码非零。
4. 工具返回 `output-error`。
5. 工具执行超时。
6. 工具返回空输出。
7. 工具返回超大输出。
8. 工具返回中文、emoji、非法 UTF-8 替代字符或复杂 JSON。
9. 工具开始后没有完成事件，turn 结束时应关闭为失败状态。
10. 工具完成事件早于 started 事件。
11. 相同工具结果重复到达。
12. 审批允许后继续执行。
13. 审批拒绝后不执行工具，并允许模型解释拒绝结果。
14. 审批等待期间用户主动停止。
15. 审批等待期间模型流断开。
16. 工具已经产生副作用后最终生成失败。
17. 上述失败不能触发自动重试或自动重复工具。
18. 用户手动重试后，如果模型再次请求有副作用工具，必须重新审批。
19. steer 在工具开始前、执行中、完成后三个时间点分别到达。
20. 工具失败与 steer RPC 失败同时发生时，错误来源和队列状态不能混淆。

### E. 队列、持久化和重启恢复

1. 活跃 turn 中加入一条和多条排队消息。
2. 队列排序、删除、编辑、取消编辑和默认模式切换。
3. 队首正常发送后，后续消息按新顺序继续。
4. 队首失败后阻塞后续消息。
5. 选择非队首消息引导，剩余顺序不变。
6. steer claim 仅在 canonical 用户消息确认后删除。
7. steer 被明确拒绝，恢复到原位置。
8. steer 已接受但后续模型失败，队列项保持已消费状态。
9. 发送前失败，队列项进入 `paused-failed` 并可手动重试。
10. 用户主动停止时，尚未发送的消息进入 `paused-interrupted`。
11. 恢复队列时只恢复被中断的消息。
12. 应用在纯 queued 状态退出并重启。
13. 应用在 steering、canonical 接受前退出并重启。
14. 应用在 canonical 接受后、队列 commit 前退出并重启。
15. 应用在工具完成、最终生成失败后退出并重启。
16. 重启后不保留失效 lease。
17. 重启后无法确认的发送进入 `recovery-uncertain`。
18. 队列文件写入失败。
19. 队列资源清理失败，但已提交队列状态不得回滚。
20. 附件丢失、内容被替换、校验和错误或 capability 过期。
21. conversation key 迁移时 ID 去重、顺序和附件所有权保持正确。
22. 对话归档、恢复后队列状态保持。
23. 两个窗口或客户端并发修改同一队列，revision 单调递增。
24. 达到 20 条队列上限。
25. 达到单附件 10MB、单队列项 10MB、总资产 50MB 边界。
26. 文本长度接近 1,000,000 字符。
27. 删除或重试 recovery-uncertain 项后，后续队列能够继续。
28. 失败项处于 lease 中时禁止排序、移动或重复 claim。

状态枚举与容量边界来自 [codexFollowUpApi.ts](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/shared/codexFollowUpApi.ts:20)。

### F. 错误界面、手动重试和可访问性

1. 模型错误以内联错误卡显示，不能表现为静默停止。
2. 原回答、引导消息、工具过程和部分最终回答全部保留。
3. 错误文本为空时显示稳定的中文兜底文案。
4. 超长错误自动换行并限制展示长度。
5. 错误中包含 URL、header 或密钥形态时必须脱敏。
6. 错误卡使用 `aria-live`/alert 语义，屏幕阅读器可以感知。
7. 错误出现后焦点不被强制抢走。
8. 键盘可以聚焦并触发“重试”。
9. 重试按钮在新 turn 运行期间禁用。
10. 快速双击重试只能创建一个新 turn。
11. 手动重试保留原助手回答和引导用户消息，移除失败的助手尾段。
12. 手动重试成功后清除当前错误，不产生重复引导消息。
13. 手动重试再次失败时更新同一失败位置，不追加多个空错误消息。
14. 失败后直接发送一条新普通消息仍然可用。
15. 切换对话再回来，错误状态仍在。
16. 应用重启、重新加载历史后，失败状态和错误原因仍可见。
17. 用户主动停止显示“已取消”状态，不显示红色模型错误。
18. 普通 turn 错误和队列 `paused-failed` 同时存在时，各自显示在正确位置。
19. 错误后 Queue、Composer、审批面板不能残留错误的 running 状态。
20. Error 卡、重试按钮和队列提示均有稳定的 `data-slot`，供 E2E 精确定位。

### G. 安全、隔离和压力边界

1. Renderer 伪造 conversation ID、thread ID、cwd 或 project selection。
2. 队列快照的 trusted context 与 conversation key 不匹配。
3. 文件 URL 与真实路径不一致。
4. 路径穿越、符号链接替换和附件内容变化。
5. provider 错误体包含 API key、Authorization 或完整请求头。
6. 一个对话失败时，其他并发对话继续运行。
7. 一个队列暂停时，其他对话队列继续发送。
8. 四个并发对话占满 transport pool，第五个等待、取消和恢复。
9. 快速执行 100 次 enqueue/delete/steer 循环，不残留 listener、lease 或 active run。
10. 大文本、大工具输出和最大队列同时存在时，UI 不崩溃。
11. 错误、取消和完成事件任意两两竞态，最终只能进入一个终态。
12. 日志必须包含 conversation、thread、turn、client message ID 和失败阶段，但不能包含密钥。

## 四、测试层级与质量门禁

### Provider 单元测试

覆盖事件映射、failed/interrupted turn、异常事件顺序、工具安全收尾和历史错误恢复：

- [event-mapper.test.ts](/Users/nallylin/Documents/code/dasCowork/desktop-app/vendors/ai-sdk-provider-codex-asp/tests/event-mapper.test.ts:2070)
- `model.stream.test.ts`
- `cross-call-tools.test.ts`
- `history-mapper.test.ts`

### Desktop 单元与集成测试

覆盖 main terminal event、steer lease、队列状态机、renderer transcript 和 UI 状态：

- [codexChatRuntimeService.test.ts](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.test.ts:686)
- `ConversationFollowUpQueueService.test.ts`
- `ConversationTranscriptController.test.ts`
- `ElectronIpcChatTransport.test.ts`
- `App.test.tsx`
- `QueuedFollowUpList.test.tsx`

### Mock E2E

在现有 `follow-up-queue-steer.e2e.ts` 保留正常场景，新增独立的 `follow-up-failures.e2e.ts`，至少覆盖：

1. 已显示回答后 steer，随后正常继续。
2. steer → 工具成功 → 最终请求断流。
3. 部分最终回答后断流。
4. steer 与 turn/completed 竞态。
5. steer 被拒绝后队列恢复。
6. 已接受 steer 后模型失败，队列不恢复。
7. 错误显示与单次手动重试成功。
8. 手动重试再次失败。
9. app 重启后错误和队列恢复。
10. 两个并发对话，一个失败、一个成功。
11. 审批等待期间 steer、拒绝和取消。
12. 空流、非法 SSE、重复 terminal 事件。

所有模拟测试使用事件 gate，不依赖真实响应速度或固定等待时间。

最低 Mock E2E 组固定为：

| 组  | 覆盖场景                | 验收                           |
| --- | ----------------------- | ------------------------------ |
| M01 | A03、A08                | 已显示回答后 steer 并正常继续  |
| M02 | C10、E08                | steer 后工具成功、最终采样断流 |
| M03 | C12、F02                | 部分最终回答后断流             |
| M04 | B03                     | steer 与 completed 竞态        |
| M05 | E07                     | steer 明确拒绝后恢复原位置     |
| M06 | E08                     | 已接受 steer 后失败仍保持消费  |
| M07 | F11、F12                | 错误显示与单次手动重试成功     |
| M08 | F13                     | 手动重试再次失败               |
| M09 | E12-E17、F16            | 重启后错误与队列恢复           |
| M10 | G06                     | 两个并发对话隔离               |
| M11 | A09、D12-D15            | 审批等待期间 steer、拒绝和取消 |
| M12 | C13、C14、C16、C17、C24 | 空流、非法 SSE、重复/迟到事件  |

每组都必须同时断言最终 UI、terminal 类型和次数、queue 状态/顺序/revision、turn 数量、provider 请求数量、tool/approval 执行数量和 renderer/page 健康；只检查错误卡或非空文本不足以标记完成。

### CI 门禁

每个 PR 运行：

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
```

验收标准：

- 精确复现本次故障时，UI 必须显示错误和手动重试入口。
- 模拟测试过程中不得产生任何真实模型请求。
- 所有终态断言同时验证 UI、IPC terminal event、queue state、turn 数量和 provider 请求数量。
- 测试不得出现非预期 renderer console error、page error、未处理 Promise 或残留进程。
- 失败 E2E 自动保存主进程日志、renderer 日志、provider 请求、截图和队列状态。
- 标有 @terminal-failure、@recovery 或 @approval-retry 的 P0/P1 异常场景以单 worker 重复 10 次；普通 Mock E2E 不使用全局十次重复。

## 五、发布时真实 LLM 验收

真实接口不进入普通 CI，仅发布前人工触发独立脚本 test:e2e:release-llm。R01-R06 由 desktop-e2e 维护，并且仍走完整架构：

`Renderer → IPC → Main → Provider → Codex app-server → Qwen/DashScope`

只执行安全的结构性冒烟测试：

1. 普通文本回答成功。
2. 助手可见输出后发送 steer，最终结果体现追加要求。
3. 执行只读工具后生成最终回答。
4. steer 发生在只读工具阶段，工具和最终回答均完成。
5. 手动停止能够产生 interrupted，而不是 failed。
6. 历史重载后回答、引导和工具记录完整。

真实测试不使用精确文本断言，只检查 turn、事件、工具和最终状态。测试失败时保留完整诊断并阻断发布；确认属于短暂外部服务故障后，可设置 `DASCOWORK_RELEASE_EXTERNAL_RETRY=1`，由发布脚本把完整 R01-R06 最多重跑一次，并分别保留 `release-llm-attempt-1` 与 `release-llm-attempt-2` 的脱敏诊断。密钥只存在于 main/app-server 的发布环境，不写入测试文件、截图或日志。

## 六、默认假设

- 禁止修改 `codex/codex-rs/app-server`；所有改动落在 provider fork、desktop main、renderer 和测试设施。
- 本计划只覆盖“引导全链路”以及与其直接交互的队列、工具、审批、错误和恢复，不扩展无关的模型目录或普通聊天功能。
- 产品不自动重试任何失败的模型请求。
- app-server 已接受的引导消息视为已消费；后续生成失败不重新入队。
- 用户主动取消与模型/网络失败使用不同的状态和视觉提示。
- 有副作用的工具在手动重试中仍需重新审批，测试不能假设工具天然幂等。
