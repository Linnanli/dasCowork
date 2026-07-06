# Render-Unit Gap-Driven Development Plan

日期：2026-07-06
模式：`$plan` direct
范围：基于暂存区 Render-Unit 实现、reference project 行为、以及本轮 provider/app-server 查证结果，规划下一阶段开发内容。

## 已做到 / 还缺 / 影响清单

| 能力 | 已做到 | 还缺 | 影响 |
| --- | --- | --- | --- |
| Render-Unit 主流水线 | Renderer 已通过 `buildAssistantRenderUnits(message)` 执行 normalize -> web/multi-agent -> collapsed activity -> dynamic -> MCP -> thinking ownership，入口在 `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:232`。 | 还没有把 live part 与历史 `dynamic-tool` part 统一成同一套 tool normalization 入口。 | 同一段会话在“刚生成”和“重新打开历史”时可能分组不同。 |
| UI 接入 | `App.tsx` 已用 Render-Unit 替换 assistant-ui grouped parts 主路径，入口在 `desktop-app/src/renderer/src/App.tsx:566`，分派在 `desktop-app/src/renderer/src/App.tsx:710`。 | 专用 renderer 仍偏薄，很多 group 内部还是复用 generic tool shell / fallback。 | 结构接近 reference，但用户看到的细节、标题和展开内容还不等价。 |
| 完成态 `ThreadItem` 保真 | Provider 完成态会把完整 item 放进 `tool-result.result.item`；历史回放会放进 `dynamic-tool.output.item`，见 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/shared-item-extractors.ts:177`、`desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-mapper.ts:206`。 | live started/progress 阶段只给薄 payload；完整 item 要等 completed。 | running 状态下不能稳定显示 reference 里的 MCP app/source、动态工具细节、自动审批细节。 |
| Provider generated types | app-server 当前 schema 已包含 `McpToolCallAppContext`、`sleep`、自动审批 review、turn diff。 | vendor provider 里的 generated types 落后：`ThreadItem` 缺 `appContext` 和 `sleep`，缺自动审批 notification 类型。 | 类型覆盖和 mapper switch 不完整；renderer 虽然做了字段探测，但 provider 层不会稳定承诺这些字段。 |
| MCP 分组 | live MCP 能分成 `pending-mcp-tool-calls`，staged renderer 可从 `toolName` / completed item 提取 server/tool。 | 历史 MCP 可以成组，但 probe 显示 `mcpSource` metadata 不完整；`appContext.appName` 与 renderer 当前读取的 `displayName/name` 不匹配。 | 历史会话和 app connector 场景可能只显示 server fallback，缺 app 名、connector id、plugin/native icon 语义。 |
| Web search 分组 | live webSearch completed 会输出 `tool-call + tool-result`，staged renderer 能合并为 `web-search-group`。 | 历史 `dynamic-tool.output.item` 的 webSearch probe 显示会落为两个普通 `entry`，不会合并。 | 重新打开旧会话时网页搜索体验比 live 退化。 |
| Dynamic tool 分组 | live 和历史 dynamic tool probe 都可合并为 `dynamic-tool-call-group`。 | reference 依赖的 registry 语义没有上游字段：`summaryOnlyInConversationGroup`、`standaloneInConversation`、`continuesLiveActivityBetweenCalls`、completed summary key/repeat identity。 | 当前只能靠 fixture/mock metadata 展示 fallback，真实动态工具无法达到 reference 的摘要/重复项/standalone 语义。 |
| Collapsed activity summary | `toolGroupSummary.ts` 已覆盖 command/file/web/MCP/subagent/context/hook/review/loaded-tool/approval counters，入口在 `desktop-app/src/renderer/src/lib/toolGroupSummary.ts:105`。 | 自动审批 live notification 没进 UI stream；turn diff 被 NOOP；running created line count、loaded tool source 等 reference 细项仍缺真实来源。 | summary 能表达常见活动，但 reference 的细粒度 activity detail 还不完整。 |
| 自动审批 / turn diff / sleep | app-server 协议已有 `item/autoApprovalReview/*`、`turn/diff/updated`、`sleep`。 | Provider event mapper 对自动审批、sleep 输出空数组；turn diff 明确 NOOP，见 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:134` 和 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:167`。 | `automatic-approval-review`、`turn-diff`、`sleep` 不可能靠 renderer 单独补齐，需要 provider 映射。 |
| Timeline target | staged renderer 已收集 unit 内部 id/callId，入口在 `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:783`。 | 还没有接到 reference 类似的滚动定位/折叠恢复行为。 | 已有测试和 DOM metadata 基础，但还不是完整 timeline navigation 能力。 |
| 最终回答与附件资源 | 主路径已经能渲染 assistant text 和 tool activity。 | 计划尚未明确 generated image、resource/end card、评论/结果附件等“工具结束后给用户看的东西”是本轮支持、隐藏、还是后续。 | 只补工具过程会让用户看到“执行了”，但看不到部分最终产物，体验仍不等价。 |
| Provider -> Renderer 数据交接 | renderer 已有大量字段探测与 fallback。 | 缺少明确的数据契约：字段放在 `item`、`result`、`output`、`providerMetadata` 哪一层，命名和 fallback 顺序不固定。 | provider 写出的字段可能到不了 renderer 正在读取的位置，导致测试局部通过但真实页面仍缺内容。 |
| Live 流式生命周期 | provider 已有 started/progress/completed 的状态跟踪。 | 计划还没要求验证同一个活动从开始到完成只显示一条 Render-Unit，并且完成态能替换/补齐开始态的薄信息。 | 用户可能看到重复条目，或一直停留在缺少来源信息的 running 版本。 |
| UI 组件复用 | 当前实现主要在 `App.tsx` 内复用现有壳层。 | 若要新增 UI 组件，计划还没要求优先查找 assistant-ui 组件库和示例。 | 容易造出一套和 assistant-ui 不一致的本地组件，增加维护成本。 |

## Requirements Summary

- 先修 provider 协议同步和事件映射，再补 renderer 兼容；不要让 renderer 猜上游没有承诺的事实。
- 保持 staged Render-Unit 主架构，但补齐 live/history part 形状差异，尤其是历史 webSearch 和历史 MCP source。
- 对 reference 需要但本项目协议仍没有的动态工具 registry metadata，明确保留 fallback 和 provider follow-up，不伪造字段。
- 先定义 provider -> renderer 的最小数据交接契约，再实现映射；每个 Render-Unit 类型要说明字段来源、字段位置、fallback 顺序和测试入口。
- 对 generated image、resource/end card、评论/结果附件等最终产物，要明确本轮支持、known-null 还是 follow-up；不能默认为“工具 UI 已覆盖”。
- 如果需要新增 UI 组件或交互，先通过 assistant-ui MCP/文档/示例查 assistant-ui 组件库，优先复用；只有 Codex ThreadItem 特有展示才新增本地组件。
- 计划交付范围横跨 provider fork 与 renderer：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/`、`desktop-app/src/renderer/src/lib/`、`desktop-app/src/renderer/src/App.tsx`、对应测试。

## Acceptance Criteria

- Provider generated types 与当前 app-server schema 同步，至少 `ThreadItem` 包含 `mcpToolCall.appContext` 和 `sleep`，且相关 transitive type 被跟踪。
- Provider event mapper 对 `sleep`、`item/autoApprovalReview/started`、`item/autoApprovalReview/completed` 有稳定 UI part 输出；`turn/diff/updated` 若继续 NOOP，必须有专门注释和 follow-up，不再被误认为 renderer 缺口。
- Live started/progress 阶段的 MCP part 至少能让 renderer 得到 server/tool/appContext/resourceUri/pluginId 中可用的 source metadata；如果 AI SDK part 不能承载完整 item，则用 provider metadata 或 result metadata 明确承载。
- `buildAssistantRenderUnits` 对 live `tool-call` 和历史 `dynamic-tool` 使用统一 tool classification；历史 webSearch 连续项输出 `web-search-group`。
- 历史 MCP 连续项输出 `pending-mcp-tool-calls`，且 `mcpSource.sourceType/groupKey/label` 与 completed item 中的 `appContext/server/tool/mcpAppResourceUri/pluginId` 一致。
- Dynamic tool registry metadata 缺失时 UI 不崩、不误报；有 metadata fixture 时 summary-only、standalone、repeat count 行为保持现有测试通过。
- 自动审批 review、sleep、turn diff 的 entry matrix 有明确处理：专用 renderer、known-null 或 fallback 三选一。
- generated image、resource/end card、评论/结果附件有明确矩阵：本轮渲染、known-null、或写入 provider/renderer follow-up，不能遗漏。
- Provider -> renderer 字段契约被测试锁住：provider 输出的位置必须是 renderer 实际读取的位置，至少覆盖 MCP source、dynamic metadata、webSearch item、autoApproval、sleep。
- Live started/progress/completed 序列不会生成重复 Render-Unit；完成态能补齐开始态缺失的 source/detail metadata。
- 新增 UI 前必须先通过 assistant-ui MCP/文档/示例检查 assistant-ui 可复用组件；若使用本地组件，需要在实现说明中写清楚 assistant-ui 不适用的原因。
- 至少有一条轻量集成测试覆盖 app-server/event mapper 输出 -> AI SDK part -> `buildAssistantRenderUnits()` 的真实交接路径。
- 目标测试通过：`assistantRenderUnits.test.ts`、`toolGroupSummary.test.ts`、`App.test.tsx`。
- Provider 目标测试通过：provider typecheck 与 event/history mapper 相关测试。

## Implementation Steps

### 0. 锁定数据交接契约与 UI 复用策略

- 为每类 Render-Unit 写一张最小字段表：`webSearch`、`mcpToolCall`、`dynamicToolCall`、`automaticApprovalReview`、`sleep`、`turnDiff`、generated image/resource/end card。
- 字段表必须包含：provider 接收的 app-server 字段、provider 输出到 AI SDK part 的位置、renderer 读取位置、fallback 顺序、是否参与 group summary。
- 明确 `providerMetadata`、`result.item`、`output.item`、`part.metadata` 的使用边界，避免同一类信息散落到多个位置。
- UI 组件策略：新增按钮、折叠区、工具壳、消息附件或结果卡片前，先通过 assistant-ui MCP/文档/示例查 assistant-ui 组件库；能复用则复用，不能复用才写 Codex-specific 组件。
- 对 generated image、resource/end card、评论/结果附件做范围决策：本轮支持就进入后续步骤；暂不支持就写入 follow-up，并在 entry matrix 标成 known-null 或 intentional fallback。

### 1. 同步 provider generated protocol types

- 在 `desktop-app/vendors/ai-sdk-provider-codex-asp` 运行 `npm run codex:generate-types`，按 README 指引跟踪必要 generated files。
- 核对 `src/protocol/app-server-protocol/v2/ThreadItem.ts` 是否包含 `appContext` 与 `sleep`。
- 补齐新增 import/export 依赖，例如 `McpToolCallAppContext`、`ItemGuardianApprovalReviewStartedNotification`、`ItemGuardianApprovalReviewCompletedNotification`、`TurnDiffUpdatedNotification`。
- 生成后先审 generated diff：确认枚举/字段名变化不会让现有 mapper 读旧名字，必要时加兼容层。
- 更新 provider tests，锁住类型漂移风险。

### 2. 修 provider event mapper 的特殊事件

- 在 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts` 增加 `sleep` item 的 `item/started` 与 `item/completed` 映射，工具名建议用 `codex_sleep` 或等价稳定内部名。
- 增加 `item/autoApprovalReview/started` 与 `item/autoApprovalReview/completed` handler，输出 provider-executed tool-call/result 或 dedicated dynamic-tool-compatible part，result 内保留 review/action/targetItemId。
- 重新评估 `turn/diff/updated`：短期可继续 NOOP，但需要把“diff 过大需 lazy rendering”的决策写入 provider follow-up；如果要支持 Render-Unit entry，则先输出轻量 `{ type: "turnDiff", id, diffPreview, hasFullDiff }`。
- 增加 event mapper 单元测试覆盖 started/progress/completed 的输出形状。
- 增加生命周期测试：同一个 id/callId 从 started 到 completed 不能变成两条可见活动，completed 必须能补齐 source/detail metadata。

### 3. 统一 renderer tool normalization

- 在 `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts` 中把 `tool-call`、`dynamic-tool`、以及其他带 `result.item/output.item` 的 part 统一识别为 tool-like normalized part。
- 确保 webSearch、MCP、dynamic、multi-agent 的 group 判断不依赖 part 原始 `type === "tool-call"`。
- 保留 unknown fallback，但不要让已知 `output.item.type` 落成普通 `entry`，除非该 item 类型明确不参与 group。
- `canonicalItemType` 同步覆盖 kebab-case、camelCase 和 app-server 原始类型，例如 `turn-diff`/`turnDiff`、`automatic-approval-review`/`automaticApprovalReview`、`sleep`。
- 增加 fixture：live tool-call 与 historical dynamic-tool 输入应输出同构 unit 摘要。

### 4. 修历史 webSearch 与 MCP source metadata

- 为 historical `dynamic-tool.output.item.type === "webSearch"` 增加连续聚合测试：两个连续 webSearch 必须输出一个 `web-search-group`。
- 为 historical MCP 增加 `appContext` fixture，覆盖 `connectorId/appName/resourceUri`；renderer label 优先级补上 `appName`，再 fallback 到 server/tool。
- MCP source key 规则调整为：app/connector 优先，其次 `resourceUri`/`mcpAppResourceUri`，再次 `pluginId`/server，最后 toolName parse。
- MCP source label 规则调整为：`displayName` -> `appName` -> `name` -> server/tool fallback；native icon/plugin/native app 语义只消费真实字段，不凭空推断。
- 确认 computer-use exclusion、browser/node_repl 分类在 live 和 history 中一致。

### 5. 补 entry matrix 和 UI renderer

- 在 `ENTRY_ITEM_RENDER_MODES` 中加入 `sleep`，并决定是专用 renderer 还是 fallback。
- 为 `automaticApprovalReview` 增加 entry/fallback 模型，至少能显示 denied/timedOut/approved/inProgress。
- 如果 `turnDiff` 暂不显示 full diff，使用 known fallback 或 preview renderer，避免大 diff 直接灌进 DOM。
- 同步更新 `toolGroupSummary.ts`：新增类型不能只在单条 entry 里显示，还要在 collapsed summary 中有稳定名称、数量和状态。
- 在 `App.tsx` 对新增 unit/entry 只做轻量 UI，不引入新依赖。
- 新增 UI 组件前先通过 assistant-ui MCP/文档/示例查 assistant-ui 组件库；优先复用 assistant-ui 的消息、附件、工具、折叠或按钮组件。只有 assistant-ui 没有合适承载时，才新增本地 Codex-specific 组件。
- 对 generated image、resource/end card、评论/结果附件按第 0 步范围决策落地：支持则加 renderer 和测试；不支持则保留 intentional known-null/follow-up。

### 6. 增加轻量链路集成测试

- 增加至少一条测试或 probe 覆盖：app-server-like notification -> provider mapper -> AI SDK part -> `buildAssistantRenderUnits()`。
- 集成测试至少覆盖 MCP source、historical webSearch、dynamic metadata fallback、sleep/autoApproval 中的一项新增事件。
- 测试断言用户可见结果：unit 类型、标题/label、source/groupKey、collapsed summary，而不是只断言内部对象存在。

### 7. 更新缺口文档与验证清单

- 更新 `.omx/plans/render-unit-provider-followups.md`：把“未知字段”改成“已由 app-server schema 提供但 provider 未同步/未映射”和“上游仍没有字段”两类。
- 同步检查 `.omx/plans/render-unit-remaining-development-plan.md`，避免旧计划继续描述已修或已改口径的缺口。
- 将 Dynamic tool registry metadata 保留为真实 follow-up；不要把 fixture-only 字段描述成已接通。
- 把本计划中的 probe 结论转成固定回归测试，避免以后再次误判 live/history 差异。

## Risks and Mitigations

- 风险：generated types 文件很多，盲目全量跟踪会扩大 diff。缓解：先跟踪 provider 实际 import 链需要的类型，运行 typecheck 找缺失依赖。
- 风险：started/progress 阶段塞完整 item 可能和 AI SDK part 生命周期冲突。缓解：优先使用 provider metadata 或 preliminary result metadata，并加 mapper tests。
- 风险：turn diff 很大导致 UI 卡顿。缓解：短期保持 NOOP 或 preview-only，full diff 后续做 lazy renderer。
- 风险：历史回放修正影响现有 entry fallback。缓解：fixture 对 live/history 分别锁 unit 摘要，App test 只断言用户可见结构。
- 风险：Dynamic registry metadata 没有协议来源。缓解：继续记录为 provider/app-server follow-up，renderer 只消费真实存在字段。
- 风险：provider 写出的 metadata 与 renderer 读取位置不一致。缓解：先写字段契约，再用集成测试锁住真实交接路径。
- 风险：新增本地 UI 组件偏离 assistant-ui 体系。缓解：实现前先通过 assistant-ui MCP/文档/示例查 assistant-ui 组件库，能复用就复用；不适用时记录原因。
- 风险：只补工具过程，漏掉最终产物。缓解：generated image、resource/end card、评论/结果附件必须进入 entry matrix，哪怕结论是 intentional follow-up。

## Verification Steps

1. Provider:
   - `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck`
   - `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test`
2. Renderer targeted:
   - `npm --prefix desktop-app test -- assistantRenderUnits.test.ts toolGroupSummary.test.ts App.test.tsx`
   - `npm --prefix desktop-app run typecheck:web`
   - 新增或更新 Render-Unit 链路测试，覆盖 provider 输出 part 被 `buildAssistantRenderUnits()` 正确消费。
3. Desktop regression:
   - `npm --prefix desktop-app run lint`
   - `npm --prefix desktop-app test`
4. Manual/probe validation:
   - Re-run a small event mapper probe for MCP started/progress/completed, dynamic completed, webSearch completed, sleep, autoApproval, turnDiff.
   - Re-run a small Render-Unit probe comparing live `tool-call` and historical `dynamic-tool` parts for dynamic/MCP/webSearch parity.

## Suggested Execution Order

1. Data contract and UI reuse check first: it prevents provider/renderer field mismatch and unnecessary local UI.
2. Protocol sync second: it removes false unknowns and lets TypeScript tell us real mapper gaps.
3. Provider event mapper third: without stable UI parts, renderer can only guess.
4. Renderer live/history normalization fourth: fixes visible parity for old conversations.
5. UI entry/detail polish last: only after data shape is stable.

## Stop Condition

- Live and historical Render-Unit probes produce equivalent grouping for dynamic/MCP/webSearch where the source data is equivalent.
- Provider type drift is resolved or explicitly documented as intentionally partial.
- Provider -> renderer data contract is documented and covered by at least one chain-level test.
- generated image、resource/end card、评论/结果附件已明确支持或明确进入 follow-up/known-null。
- 新增 UI 已优先通过 assistant-ui MCP/文档/示例检查 assistant-ui 复用；未复用的本地组件有明确原因。
- New event types either render through a tested path or are explicitly documented as intentionally unsupported.
- Targeted provider and renderer tests pass, or remaining failures are isolated to pre-existing unrelated issues with evidence.
