# Render-Unit Reference Parity Phase 2 Plan

日期：2026-07-06
模式：`$plan` direct
关系：本计划是 `.omx/plans/render-unit-gap-driven-development-plan.md` 的第二阶段 follow-up，不替代第一阶段。第一阶段先把 provider 数据契约、live/history 归一化、特殊事件映射和 entry matrix 打稳；第二阶段只追 reference project 的用户可见 Render-Unit 体验。

## Phase Boundary

- 第一阶段已补齐 provider -> renderer 基础契约：MCP/sleep started 阶段通过 preliminary `result.item` 给 renderer，自动审批 review 映射为 `codex_automatic_approval_review`，history `dynamic-tool.output.item` 与 live `tool-call/result.item` 走同一 Render-Unit 归一化入口；当前契约与剩余项记录在 `.omx/plans/render-unit-provider-followups.md`。
- 必须先满足第一阶段 stop condition：live/history grouping 等价、provider type drift 已解决或明确记录、provider -> renderer 数据契约有链路测试、generated image/resource/comments 已进入 matrix，见 `.omx/plans/render-unit-gap-driven-development-plan.md:153`。
- 本阶段不直接修 app-server 协议，不绕过 Codex app server，不在 renderer 里新建模型请求或直接使用 Node/Electron 能力；新增桌面能力必须走现有 preload/main IPC 边界。
- 如果执行本阶段时发现 Phase 1 数据字段仍缺失，先回到第一阶段补字段和测试，再继续本计划对应 UI。
- 本阶段目标是 reference parity 的“可见能力”，不是逐行复刻 reference bundle 的内部结构。

## Evidence Summary

Reference bundle used below: `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js`. Line-only references such as `reference bundle:60520` point to this file.

| 证据 | 当前状态 | reference 对照 | 结论 |
| --- | --- | --- | --- |
| 第一阶段计划已把专用 renderer、最终产物和 timeline 列为缺口，见 `.omx/plans/render-unit-gap-driven-development-plan.md:12`、`:20`、`:21`、`:32`、`:45`。 | 当前计划范围更偏底座修复。 | reference 有完整 item renderer、timeline scroll、最终资源卡。 | 第二阶段应单独建计划，避免第一阶段膨胀。 |
| `ENTRY_ITEM_RENDER_MODES` 把 `todo-list`、`permission-request`、`turn-diff` 等标为 fallback，把 `generated-image` 标为 known-null，见 `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:45`。 | 多数 item 没有专用 UI。 | reference 的 item renderer 覆盖 todo、permission、MCP elicitation、turn diff、worktree、automation、dynamic 等，见 `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:75663`。 | Phase 2 需要 item renderer matrix 和专用组件。 |
| `App.tsx` 的 group renderer 主要是 shell 包住 `renderToolPart()`，见 `desktop-app/src/renderer/src/App.tsx:753`、`:773`、`:796`、`:818`、`:1014`。 | UI 已有 group 壳，但细节还是 fallback。 | reference 的 MCP、web search、collapsed activity 都有专门展开内容，见 reference bundle `:60520`、`:77391`、`:78333`。 | Phase 2 要把 shell 内部替换成 domain-specific content。 |
| `toolGroupSummary.ts` 主要是 counters 和 sourceSummary，见 `desktop-app/src/renderer/src/lib/toolGroupSummary.ts:1`、`:105`。 | 摘要足够基础，但缺 line count、stopped creating、source-rich MCP、loaded tool source。 | reference summary state 和文案覆盖这些细项，见 reference bundle `:43511`、`:44352`。 | Phase 2 要扩展 summary 数据和显示。 |
| provider 对 `turn/diff/updated` 仍 intentional NOOP，见 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:167` 和 `.omx/plans/render-unit-provider-followups.md`。 | 当前 renderer 即使做 UI，也需要后续先给轻量 diff item。 | reference 有完成态 diff 卡和 live bottom bar，见 reference bundle `:70680`、`:79127`。 | turn diff UI 可在 Phase 2 做，但入口数据必须先变成 preview/lazy item。 |
| 当前 renderer 已写 `data-render-target-id(s)`，见 `desktop-app/src/renderer/src/App.tsx:993`。 | 只有 DOM metadata，缺 scroll/focus/expand 行为。 | reference 有按 item id 滚动和 1s 重试，见 reference bundle `:76476`。 | Phase 2 加 timeline navigation 行为。 |

## Requirements Summary

- 保持第一阶段 Render-Unit pipeline，不重写数据源；第二阶段只消费第一阶段已承诺的 `AssistantRenderUnit`、`ThreadItem` 和 provider metadata。
- 以用户可见体验为交付单位：MCP rich output、web search detail、collapsed activity summary、turn diff/todo live footer、generated image gallery、end resources、review comments、remaining entry renderers、timeline navigation。
- 每个新增 renderer 都必须有 fixture 或 unit test，断言用户可见 label、状态、展开内容和 fallback，而不是只断言内部对象存在。
- 优先复用现有 assistant-ui primitives 和本仓库已有 `ToolGroupRoot`、`ToolGroupTrigger`、`ToolGroupContent`、`ToolFallback`、`MessagePrimitive`、`AttachmentPrimitive` 接入方式，见 `desktop-app/src/renderer/src/App.tsx:4`、`:30`、`:887`。
- 不新增运行时依赖，除非后续单独审批；图片 preview、resource card、diff preview、raw JSON dialog 优先用现有 React/CSS/assistant-ui 组件实现。
- 对无法安全渲染的内容保留 intentional fallback，并在 matrix 中写清楚原因和后续条件。

## Capability Matrix

| 能力线 | 当前缺口 | Phase 2 目标 | 参考证据 | 目标文件 |
| --- | --- | --- | --- | --- |
| MCP rich renderer | 当前 MCP group 内部仍渲染 generic tool part，source 只读少量字段，见 `App.tsx:773`、`assistantRenderUnits.ts:929`。 | 显示 app/plugin/native/browser/node 来源、结构化结果、文本/图片/audio/resource content blocks、错误、raw output 入口、自动审批 review 提示。 | reference bundle `nB` 和 content block renderer：`:60520`、`:60985`。 | `desktop-app/src/renderer/src/App.tsx`，建议拆到 `desktop-app/src/renderer/src/components/render-units/`。 |
| Web search detail | 当前 group label 基础，展开仍是 fallback，见 `App.tsx:818`。 | 折叠态显示 searching/searched，展开显示 query/action/favicons，支持 live 和 history。 | reference bundle `nK`：`:77391`。 | `assistantRenderUnits.ts`、`App.tsx`、fixtures/tests。 |
| Collapsed activity summary | 当前 summary 是基础 counter，见 `toolGroupSummary.ts:83`。 | 增加 running created line count、changed line count、stopped creating、loaded tool source、MCP named sources、web-search command summary。 | reference bundle summary state/text：`:43511`、`:44352`。 | `toolGroupSummary.ts`、`CollapsedToolActivityUnit`。 |
| Turn diff / todo live footer | 当前 turn diff fallback，provider diff NOOP，见 `assistantRenderUnits.ts:56`、`event-mapper.ts:167`。 | 当 Phase 1 提供轻量 turn diff item 后，显示完成态 diff card、live bottom footer、todo progress；大 diff 懒加载或 preview-only。 | reference bundle diff/live footer：`:70680`、`:79127`。 | `App.tsx`、new render-unit components、tests。 |
| Generated image gallery | 当前 `generated-image` known-null，见 `assistantRenderUnits.ts:69`。 | 显示 pending placeholder、completed gallery、overflow carousel、preview dialog、download/alt text。 | reference bundle `_K`/gallery：`:78942`、`:79368`。 | `App.tsx` 或 output attachment components。 |
| End resource cards | 第一阶段 matrix 才决定资源入口；当前 renderer 没有 end resource card。 | 渲染 file、google-drive、appgen-app、website resource rows；超过 3 条可展开。 | reference bundle `oRe`：`:83347`。 | renderer output/resource components。 |
| Review comments card | 当前无最终 comments card。 | 显示 comment count、priority、file:line、preview tooltip、show more/collapse；点击走既有打开文件能力。 | reference bundle `fRe`：`:83539`。 | renderer output/comment components，main/preload 只在已有打开文件能力不足时补。 |
| Remaining entry renderer matrix | 当前多项 fallback/known-null，见 `assistantRenderUnits.ts:45`。 | 对 todo-list、permission-request、mcp-server-elicitation、user-input-response、worktree-init、automation-update、context-compaction、model changes、errors 等给出专用 renderer 或 intentional fallback。 | reference bundle switch：`:75663` 到 `:76115`。 | `assistantRenderUnits.ts`、`App.tsx`、new components。 |
| Timeline navigation | 当前只有 data attributes，见 `App.tsx:993`。 | 提供按 item id/callId 定位、必要时展开父 group、滚动并 focus；失败时 1s 内重试后返回 false。 | reference bundle `BG/CIe/VG`：`:76476`、`:76518`。 | `assistantRenderUnits.ts`、`App.tsx`、thread navigation helper/tests。 |
| Dynamic app-control display | 当前只消费 mock-like registry metadata，见 `assistantRenderUnits.ts:876`。 | Phase 1 有真实 registry 后，显示 app-control dynamic tools 的 summary-only、standalone、continues-live、completed summary key/repeat behavior。 | reference bundle registry：`:43287`、`:43434`、`:43822`。 | `assistantRenderUnits.ts`、dynamic renderer/tests。 |

## Acceptance Criteria

- MCP rich renderer 对 success/error/empty result 都有稳定 UI：success 展示 content 或 structured JSON，error 展示错误块，empty 显示“无内容”式 fallback；raw output 可打开，并有测试覆盖。
- MCP content blocks 至少支持 `text`、`image`、`audio`、`resource_link`、`embedded_resource`、`unknown` 六类 fixture；不能渲染的 block 显示安全 JSON fallback。
- MCP source 展示支持 app/plugin/native/browser/node/server 五类来源；没有真实 metadata 时不伪造 icon，只显示稳定 server/tool fallback。
- Web search group 在 live 和 history fixture 中都显示同一套 collapsed/expanded UI；展开项包含 query/action 文案、completed/running 状态和可选 favicon。
- Collapsed activity summary 至少新增 running created line count、changed line count、stopped creating、loaded tool source、MCP named source、web-search command 六类断言。
- Turn diff renderer 不直接把完整大 diff 灌进 DOM；超过阈值时只显示文件摘要和 lazy/preview 入口。
- Live bottom footer 只在 turn running 且有 todo 或 turn diff 时显示；不会遮住 composer、assistant text 或 tool group 内容。
- Generated image gallery 支持 pending、single image、多图 overflow、preview dialog、alt text、缺失 previewSrc placeholder；`generated-image` 不再是无条件 known-null。
- End resource card 支持 file、google-drive、appgen-app、website 四类资源 fixture；未知资源显示 intentional fallback。
- Review comments card 支持 priority 排序、前三条显示、show more/collapse、tooltip preview、点击打开文件路径。
- Remaining entry matrix 中 P0/P1 entry 不能继续无说明地落到 `ToolFallback`；每个 fallback 必须在 matrix 中写明“故意 fallback 的原因”。
- Timeline navigation helper 可以用 item id/callId 找到普通 entry、collapsed child、MCP group、dynamic group、web search group；成功时 scroll/focus，失败时返回 false 并不抛错。
- 所有新增组件在窄宽度下文本不溢出按钮/卡片；长路径、长 query、长 JSON 都有 truncate、wrap 或 max-height 处理。
- 新增 UI 不引入 renderer 直连 Node/Electron；打开文件、资源和外链必须沿用已有 renderer -> preload/main 安全路径。
- 目标测试通过：`assistantRenderUnits.test.ts`、`toolGroupSummary.test.ts`、`App.test.tsx`、新增 render-unit component tests。

## Implementation Steps

### 0. Phase 1 Gate And Matrix Freeze

- 读取 `.omx/plans/render-unit-gap-driven-development-plan.md:153` 的 stop condition，确认 Phase 1 的 provider -> renderer contract 已落地。
- 在本计划执行分支新增或更新 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts` 或等价 markdown/test fixture，列出每种 item/event 的 target renderer、fallback 级别、test fixture。
- 把 `ENTRY_ITEM_RENDER_MODES` 从散列表升级为带 reason/test owner 的 matrix，避免 `known-null` 和 `fallback` 没有解释，当前入口在 `assistantRenderUnits.ts:45`。
- 先补测试快照，不改 UI：锁住当前 fallback 行为，后续每完成一个 renderer 再更新对应期望。

### 1. Renderer Component Shell Extraction

- 从 `App.tsx` 中拆出 Render-Unit 组件目录，保留 `AssistantRenderUnitView` 的 switch 作为入口，当前 switch 在 `App.tsx:710`。
- 保留现有 `ToolGroupRoot/Trigger/Content` 视觉基座，当前壳在 `App.tsx:859`。
- 建立共享 helper：safe JSON preview、content block renderer、source badge、show-more row、long text/path formatting、timeline attributes。
- 为新组件建立 fixture-first tests，优先用现有 `desktop-app/src/renderer/src/lib/__fixtures__/assistantRenderUnitFixtures.ts` 扩展。

### 2. MCP Rich Renderer

- 实现 `McpToolCallUnit` 和 `PendingMcpToolCallsUnit` 的 rich body：header source、result content、structured JSON、error、empty、raw output dialog。
- 按 reference 支持 MCP content blocks：`text`、`image`、`audio`、`resource_link`、`embedded_resource`、`unknown`，参考 reference bundle `:60985`。
- 使用 Phase 1 提供的 `appContext`、`mcpAppResourceUri`、`pluginId`、`source` 字段；没有字段时回退到 `server.tool`。
- 测试 live single MCP、grouped MCP、app MCP、browser/node/computer-use exclusion、error result、structuredContent 与 raw result。

### 3. Web Search Detail And Activity Summary

- 把 `WebSearchGroupUnit` 从 fallback body 改为 query list renderer，当前入口在 `App.tsx:818`。
- 将 webSearch detail 从 item 的 `action/query/completed/favicon` 或 Phase 1 contract 字段读取；字段缺失时显示稳定 fallback。
- 扩展 `toolGroupSummary.ts` state，增加 line count、stopped creating、loaded tool source、MCP named sources、web-search command 摘要，当前 state/counter 在 `toolGroupSummary.ts:1`。
- 为 collapsed summary 增加 active summary：最后一个运行中的 command/MCP/webSearch 能替代泛化“思考中”。

### 4. Turn Diff, Todo, And Live Footer

- 以 Phase 1 的轻量 `turnDiff` item 为输入，实现完成态 diff card：文件数、行数、前 N 个文件、show more/collapse、review/open action。
- 大 diff 只显示摘要和 lazy/preview 入口；不得直接渲染 50KB+ diff 文本，provider 当前 NOOP 注释说明了 freeze 风险，见 `event-mapper.ts:167`。
- 实现 turn running 时的 bottom footer：有 todo-list 或 turnDiff 才显示；没有 blocking request 时出现；结束后收起。
- `todo-list` 从 fallback 升为轻量 renderer：显示任务状态、完成数、当前项，支持 footer 和普通 entry 两种位置。

### 5. Generated Images And Final Output Resources

- 将 `generated-image` 从 unconditional known-null 改成 matrix-driven：pending 显示 placeholder，completed 显示 gallery。
- Gallery 支持自然比例、多图 overflow 控制、preview dialog、alt text 和缺图 placeholder，参考 reference bundle `:79368`。
- 实现 end resource card：file、google-drive、appgen-app、website 四类；超过 3 条 show more，参考 reference bundle `:83347`。
- 资源打开必须走已有安全路径；如果当前 renderer 没有对应能力，先渲染只读卡片并把打开能力记为 follow-up。

### 6. Review Comments And Remaining Entry Renderers

- 实现 review comments card：priority `[P1]`/`[P2]` 排序、location、title、body preview、show more/collapse，参考 reference bundle `:83539`。
- 对 `mcp-server-elicitation`、`permission-request`、`user-input-response`、`worktree-init`、`automation-update`、`context-compaction`、`model-changed`、`model-rerouted`、`stream-error`、`system-error` 建最小专用 renderer。
- 对 `plan-implementation`、`proposed-plan`、`userInput`、`realtime-transcript` 等仍不显示的 item，记录 intentional known-null 原因。
- `automatic-approval-review` 已在 Phase 1 有数据后，补专用状态 renderer：inProgress、approved、denied、timedOut、aborted。

### 7. Timeline Navigation

- 在 renderer 增加 `scrollToRenderTarget(itemId, behavior)` 或等价 helper，复用当前 `data-render-target-ids`，当前 attributes 在 `App.tsx:993`。
- 对 collapsed group、MCP group、dynamic group、web search group，滚动前先展开父 group 或保证目标 DOM 已出现。
- 增加 1s retry window，找不到目标返回 false；不因为历史缺失 item id 抛错。
- 加单元测试和 App test：普通 entry、collapsed child、MCP group child、web search child 都能生成可定位 target。

### 8. Integration, Visual QA, And Cleanup

- 增加一个 fixture-driven integration test：Phase 1 provider-like parts -> `buildAssistantRenderUnits()` -> `AssistantRenderUnitView`，断言可见标题、展开内容、target ids。
- 对 MCP rich output、generated image gallery、turn diff card、resources/comments card 做 App-level render tests。
- 执行 code simplifier-style cleanup：如果 `App.tsx` 继续膨胀，拆到 components；不做无关重构。
- 更新 `.omx/plans/render-unit-gap-driven-development-plan.md` 的 follow-up 备注或新增 completion note，说明 Phase 2 已接管哪些能力。

## Risks And Mitigations

- 风险：Phase 1 数据契约没完成，Phase 2 UI 只能继续猜字段。缓解：Step 0 gate 不通过就停止 Phase 2，回修第一阶段。
- 风险：reference bundle 是 beautified/minified 产物，函数名不稳定。缓解：只追用户可见行为和数据要求，不追函数名。
- 风险：MCP app/resource HTML 有安全边界。缓解：默认先做 content block / JSON / raw output；任何 HTML app surface 必须确认 sandbox、CSP、外链策略和 preload/main 边界后再启用。
- 风险：turn diff 大文本造成卡顿。缓解：强制 preview/lazy/cap；测试覆盖大 diff 不渲染全文。
- 风险：最终产物卡片会和 assistant text、attachments、tool groups 重叠。缓解：App test 加多内容布局；CSS 使用稳定尺寸、max-height、wrap/truncate。
- 风险：组件过多导致 `App.tsx` 维护困难。缓解：先抽 render-unit components 和 shared helpers，再逐项替换。
- 风险：资源打开或文件定位越过 Electron 安全边界。缓解：只用现有 renderer -> preload/main 能力，不直接在 renderer 访问文件系统。

## Verification Steps

1. Renderer targeted tests:
   - `npm --prefix desktop-app test -- assistantRenderUnits.test.ts toolGroupSummary.test.ts App.test.tsx`
   - 新增 render-unit component tests，覆盖 MCP、web search、collapsed summary、turn diff、generated image、resources、comments、timeline。
2. Type and lint:
   - `npm --prefix desktop-app run typecheck:web`
   - `npm --prefix desktop-app run lint`
3. Full desktop regression:
   - `npm --prefix desktop-app test`
4. E2E smoke when Phase 1 chain data is available:
   - `npm --prefix desktop-app run test:e2e -- --reporter=line`
   - 覆盖真实 renderer -> IPC -> main -> provider -> app-server 路径中至少一个 MCP、一个 webSearch、一个 final resource/comment/generated image 场景。
5. Manual visual QA:
   - 宽屏和窄屏各检查：MCP rich output、web search 展开、collapsed activity、turn diff card、generated image gallery、resources/comments card、timeline scroll。
   - 检查长 query、长路径、长 JSON、图片缺失、大 diff、无 metadata fallback。

## Suggested Execution Order

1. 先做 Step 0-1：matrix 和组件壳，否则后面会把 `App.tsx` 写散。
2. 先做 MCP rich renderer：它是 reference 差距最大、用户收益最高的能力线。
3. 再做 web search 和 collapsed summary：这两项共享 activity grouping 和 summary 数据。
4. 再做 turn diff/todo/live footer：依赖 Phase 1 轻量 diff 数据，风险较高。
5. 最后做 generated images、resources、comments 和 remaining entries：它们更偏 turn-end output，可分批验收。
6. Timeline navigation 穿插在 group renderer 稳定后做；太早做会反复改展开逻辑。

## Stop Condition

- Capability Matrix 中 P0/P1 能力均有专用 renderer 或 intentional fallback 说明。
- MCP、web search、collapsed activity、turn diff/todo、generated image、resources、comments、timeline 至少各有一个用户可见测试。
- `generated-image` 不再无条件 known-null；`turn-diff` 不再无说明 fallback；P0/P1 entry 不再无解释落到 `ToolFallback`。
- 新增 UI 在窄屏、长文本、大数据、缺 metadata 场景下不重叠、不撑爆布局、不冻结页面。
- Targeted renderer tests、typecheck、lint 通过；无法运行的验证必须记录原因和替代检查。
