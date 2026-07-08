# Render-Unit 未完成能力开发计划

日期：2026-07-07
模式：`$plan` direct
范围：基于暂存区 Render-Unit 验收表，把“半实现 / 未实现”的能力拆成可执行开发计划。目标不是重写现有 Phase 2，而是在现有实现上补齐 reference-projects/codex-electron-26.623.101652-beautified 里仍缺的可见能力。

## Execution Update

2026-07-07 追加执行结果：

- `exploration` 已实现为 renderer 侧 custom render-unit：pipeline 会识别 reference `exec.parsedCmd` 和当前 `commandExecution.commandActions` 的 read/list/search，合成探索卡片并显示 active/completed 标题、文件数、搜索数、目录数和内部明细。
- `worked-for` 维持 P3 intentional fallback：provider/app-server 当前没有稳定 `ThreadItem` 或事件形状可供桌面文本线程渲染。
- `realtime-transcript` 维持 P3 known-null：app-server 只提供实验性 `thread/realtime/transcript/*` 通知，不是普通文本线程持久化 `ThreadItem`。
- 定向验证：`npm --prefix desktop-app test -- assistantRenderUnits.test.ts renderUnitCapabilityMatrix.test.ts App.test.tsx` 通过，3 个文件 81 条测试。

2026-07-07 继续收口结果：

- `reviewComments` 文件打开链路补齐 main 层可测 helper：`codex:open-local-path` handler 现在通过 `createOpenLocalPathHandler()` 统一校验 payload，测试覆盖 `{ path, line }` 只打开 path、非法相对路径不调用 shell、以及 `shell.openPath` 错误透传。
- `collapsed-tool-activity` 折叠规则补齐关键差异：活跃活动和已完成活动会分组折叠，避免旧 command execution 被错误包进当前活跃组；新增 `stepsProse` 简略 detail level，隐藏已完成的低价值内部项，同时保留活跃内部项。
- `desktop e2e` 覆盖从真实聊天链路渲染 web search + exploration：扩展现有 web search e2e，在真实 app-server/provider 往返里执行 `cat package.json` 并断言出现探索卡片。
- 新增/更新验证：`npm --prefix desktop-app test -- assistantRenderUnits.test.ts toolGroupSummary.test.ts renderUnitCapabilityMatrix.test.ts App.test.tsx codexIpcApi.test.ts localPathOpen.test.ts` 通过，6 个文件 116 条测试；`npm --prefix desktop-app run typecheck:node`、`npm --prefix desktop-app run typecheck:web`、`npm --prefix desktop-app run lint`、provider `typecheck`、provider `event-mapper.test.ts`、目标 e2e `renders web search and exploration` 均通过。

## Requirements Summary

- 保留当前 Render-Unit 主流水线：`buildAssistantRenderUnits()` 已经负责 normalize、web/multi-agent group、collapsed activity、dynamic group、MCP group 和 thinking ownership，入口在 `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:204`。
- 先补用户可见缺口，再补 reference 级细节：优先修 review comment 文件打开、turn diff 富展示、exploration accordion，再处理 collapsed summary/detail-level 等精细行为。
- 对没有稳定数据来源的类型，不能伪装成已完成；要么接通 provider/app-server 数据，要么在 capability matrix 中保留 intentional/known-null 并写明原因。
- 所有“从半实现变已实现”的能力必须有用户可见断言测试，不只断内部对象。
- 本计划只规划，不执行源代码改动。

## Current Evidence

| 能力 | 当前状态 | 证据 |
| --- | --- | --- |
| Turn diff | 半实现 | 当前 renderer 只显示文件数和加减行摘要，见 `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx:443`；reference 有可展开文件列表、review 按钮、逐文件打开和大文件兜底，见 `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:70805`。 |
| Review comments | 半实现 | renderer 会调用 `openLocalPath({ path, line })`，见 `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx:800`；shared schema 接受 `line`，见 `desktop-app/src/shared/codexIpcApi.ts:152`；main process 只调用 `openLocalPath(request.path)`，见 `desktop-app/src/main/index.ts:261`。 |
| Collapsed tool activity | 半实现 | 当前只按连续可折叠项和 `group.length > 1` 折叠，见 `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:358`；reference 还看 detail level、是否当前活动、MCP 状态、单条 exec/MCP 是否保持展开，见 reference `.../app-initial~app-main~onboarding-page-2jNGqpwT.js:43876` 和 `:43924`。 |
| Tool group summary | 半实现 | 当前 summary 有 counters/label/icon/sourceSummary，见 `desktop-app/src/renderer/src/lib/toolGroupSummary.ts:118`；reference summary 还有 running/stopped/created 行数、source summary、动画切换和 expand 条件联动，见 reference `.../app-initial~app-main~onboarding-page-2jNGqpwT.js:78333`。 |
| End resources | 半实现 | 当前是 client-derived resource cards，见 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:350` 和 `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx:529`；还没有协议级来源确认。 |
| Live footer | 半实现 | 当前只把 active `todoList` / `turnDiff` 移到 footer，见 `desktop-app/src/renderer/src/App.tsx:596` 和 `:661`；reference live footer 有 blocking request/detail-level 等条件，见 reference `.../app-initial~app-main~onboarding-page-2jNGqpwT.js:79127`。 |
| Exploration | 已实现 | capability matrix 已改为 custom renderer；`assistantRenderUnits.test.ts` 覆盖 reference `exec.parsedCmd` 与当前 `commandExecution.commandActions` 聚合；`App.test.tsx` 覆盖用户可见探索卡片。 |
| Worked-for | intentional non-goal | 本仓库 provider/app-server 搜索不到稳定 `worked-for` ThreadItem 或事件来源；matrix 保持 P3 intentional fallback 并写明桌面文本线程无稳定来源。 |
| Realtime transcript | known-null | app-server 有实验性 `thread/realtime/transcript/delta|done` 通知，但 provider 文本聊天 mapper 不把它作为持久化 ThreadItem；matrix 保持 P3 known-null 并写明不是普通文本线程数据。 |

## Acceptance Criteria

- Review comment 点击文件时，main process 能打开对应本地文件。
- Turn diff 支持至少 5 个文件的展开/收起、文件级加减行、点击打开已解析为绝对路径的文件、大 diff 折叠兜底；超过阈值不把完整 diff 一次性塞进 DOM。
- Turn diff 相对路径必须有明确解析契约：优先使用 provider/codex metadata 中的 cwd 或 thread cwd 转成绝对路径；没有 cwd 时禁用打开按钮，并用测试锁住。
- Exploration 不再是 temporary fallback：通过归一化函数同时识别 reference `exec.parsedCmd` 和当前 `commandExecution.commandActions` 的 read/list/search，合成 exploration unit，显示“正在探索/已探索”、文件数、搜索数、列表数，并能展开查看内部活动。
- Collapsed activity 的折叠规则覆盖 reference 的关键用户可见差异：当前运行中的活动可展开/有 active summary；单条普通 MCP 或非当前 exec 不被错误折叠；`STEPS_PROSE` 类似简略模式能隐藏低价值内部项。
- Tool group summary 覆盖 running/stopped/created/edited/deleted、MCP source、web search、approval denied/timedOut/approved/inProgress；summary label 和详情区都要有测试。
- End resources 的数据来源被定性：若只支持 client-derived，就在 capability matrix 和测试中保持这个契约；若 provider/app-server 有来源，则接入真实来源并加链路测试。
- Live footer 条件与 reference 接近：running turn 才展示；blocking request 或非活跃项不抢 footer；完成后回到普通消息区。
- `worked-for` 和 `realtime-transcript` 必须二选一：实现可见 renderer，或用代码证据证明桌面文本线程没有稳定来源，并把状态保持为 intentional/known-null。
- Capability matrix 测试能阻止 P0/P1/P2 的 temporary fallback 被误认为完成；P3 intentional fallback 必须带 follow-up 或“不适用”说明。
- 目标测试通过或明确记录现有无关失败：renderer unit tests、App tests、provider mapper tests、desktop e2e 中至少一条真实聊天链路。

## Implementation Steps

### 1. 先修 Review Comments 文件打开

- 保持 `desktop-app/src/shared/codexIpcApi.ts:152` 的 `{ path, line? }` payload；不要为了行号支持改成复杂返回类型。
- 修改 `desktop-app/src/main/index.ts:84` 的 `openLocalPath` 接口，让它接收完整 payload 或新增内部 helper，但验收只要求打开 `path` 指向的文件。
- 在 `desktop-app/src/main/index.ts:261` 把 `request.path` 稳定传给打开逻辑；`request.line` 可以作为 best-effort 保留给未来编辑器集成，但当前不要求 UI 提示或跳行。
- macOS/Windows/Linux 分别选稳定策略：优先打开系统默认程序到文件；不要把“跳到指定行”作为本轮完成条件。
- 更新 `desktop-app/src/shared/codexIpcApi.test.ts`，确认 schema 仍拒绝非绝对路径、接受正整数行号。
- 增加 main 层测试或轻量 mock，断言 `codex:open-local-path` handler 能调用文件打开逻辑。

### 2. 把 Turn Diff 从摘要卡片升级为可审查卡片

- 在 `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx:443` 拆出 `TurnDiffEntryUnit` 子组件，避免继续把解析、渲染、打开动作全堆在一个函数里。
- 复用现有 `diffFiles()` / `diffLineSummary()`，补充 unified diff 文件头、hunk 行号、binary/large diff 标识解析。
- UI 至少包含：总标题、总加减行、前 N 个文件、显示更多/收起、每个文件的路径、加减行、打开按钮。
- 大 diff 策略：超过当前 `LARGE_DIFF_TEXT_LENGTH` 继续摘要展示；只渲染文件列表，不渲染完整内容。
- 先定义 `resolveTurnDiffFilePath()`：绝对路径原样使用；相对路径必须结合 provider/codex metadata 中的 cwd、thread cwd 或等价桌面会话 cwd 转成绝对路径；没有 cwd 时不渲染打开按钮。
- 点击文件时调用 `window.desktopApp.codex.openLocalPath({ path })`，只保证文件能打开；行号不进入本轮验收。
- 测试：更新 `desktop-app/src/renderer/src/App.test.tsx`，覆盖小 diff 展开、大 diff 折叠、绝对路径可打开、相对路径带 cwd 可打开、相对路径无 cwd 禁用打开、超过 5 个文件显示更多。

### 3. 实现 Exploration Render-Unit

- 在 `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:204` 的 pipeline 中加入 exploration 聚合步骤，位置建议在 normalize 之后、collapsed activity 之前。
- 新增一个薄归一化函数，例如 `explorationActionForItem()`，把 reference 形状 `exec.parsedCmd.type === "read" | "list_files" | "search"` 和当前形状 `commandExecution.commandActions[].type === "read" | "listFiles" | "search"` 统一成内部 `read | list | search`。
- 聚合条件参考 reference：连续 read/list/search 和穿插 reasoning 可进入 exploration；reference 判断在 `.../app-initial~app-main~onboarding-page-2jNGqpwT.js:84082`，当前桌面链路则通过归一化函数消费 `commandExecution.commandActions`。
- 保留现有 `explorationKey()`，但让 `type === "exploration"` 进入 custom renderer，而不是 fallback。
- 在 `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx` 新增 `ExplorationEntryUnit`，显示 active/completed 标题、文件数、搜索数、列表数、展开后的内部活动。
- 在 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:91` 把 `exploration` 从 temporary fallback 改为 custom，testOwner 指向新的 App/render unit 测试。
- 测试：新增 fixtures 覆盖 reference `exec.parsedCmd`、当前 `commandExecution.commandActions`、running exploration、completed exploration、重复读取同一文件去重、search/list counts。

### 4. 拉平 Collapsed Activity 和 Summary 规则

- 在 `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:358` 扩展 `collapseToolActivity()`：加入“当前活动”“活动是否关闭”“单条 MCP/exec 保持展开”“mixed dynamic tool”这些规则。
- 如果当前组件还没有 `conversationDetailLevel`，先做最小本地枚举，例如 `default` / `stepsProse`，不要把 reference 的所有状态一次性搬进来。
- 在 `desktop-app/src/renderer/src/lib/toolGroupSummary.ts:118` 增强 summary：running command、stopped command、created/edited/deleted files、MCP source、approval 状态都要生成稳定详情。
- 在 `desktop-app/src/renderer/src/App.tsx:838` 的 `CollapsedToolActivityUnit` 中补 active summary 与 source summary 展示；不要只显示一行 label。
- 测试：`assistantRenderUnits.test.ts` 覆盖折叠边界；`toolGroupSummary.test.ts` 覆盖 summary 文案；`App.test.tsx` 覆盖展开后内部项仍可见。

### 5. 明确 End Resources 的数据契约

- 先查 provider/app-server 是否有真实 end resources / final resources 事件；如果没有，保持 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:350` 的 client-derived 结论。
- 如果保持 client-derived：把来源写入测试名和 reason，验收口径改成“客户端合成资源卡片已支持”，不再拿它和 reference 协议级能力混为一谈。
- 如果接入真实来源：在 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts` 映射成稳定 `endResources` item，并让 renderer 只读取一个约定位置。
- 资源打开继续走 `openExternalHttpUrl` / `openLocalPath`，保留安全校验。
- 测试：覆盖本地文件、http(s)、未知资源类型、空资源列表、显示更多/收起。

### 6. 补 Live Footer 条件

- 在 `desktop-app/src/renderer/src/App.tsx:680` 的 `latestLiveFooterUnits()` 上增加条件参数：是否 running、是否有 blocking request、当前 unit 是否 active、是否已在正文中完成。
- 明确 blocking request 数据流：从 `App()` 顶层已有的 `serverRequests.length > 0` 派生 `hasBlockingRequest`，通过轻量 React context 或从 `ChatThread` 向 `AssistantMessage` 传入；不要让 `AssistantMessage()` 自己重新猜请求状态。
- 保持当前 todo/diff footer 行为，但补“完成后回正文”“非 active 不进 footer”“多个同类型只保留最新”的测试。
- 如果后续 exploration 也需要 footer，必须先证明 reference 行为和用户价值；本轮默认不把 exploration 加进 footer。

### 7. 处理 Worked-for 和 Realtime Transcript

- 先做数据来源探测：在 provider mapper、history mapper、fixtures 里搜索 `worked-for` 和 `realtime-transcript` 的真实 part/item 形状。
- 单独检查 provider protocol 中的 `thread/realtime/transcript/delta` / `thread/realtime/transcript/done`：如果决定支持，需要在 `event-mapper.ts` 规划累积、去重、role 归属和 renderer；如果决定不支持，要把它标成明确 NOOP/known-null，并用测试说明桌面文本线程为什么忽略。
- 如果有稳定数据：
  - `worked-for` 做 compact renderer，显示工作对象、持续时间或来源；更新 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:33`。
  - `realtime-transcript` 做 text renderer 或 compact renderer，避免在桌面文本线程中吞掉用户可见内容；更新 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:401`。
- 如果没有稳定数据：保持 intentional/known-null，但新增测试确认它们不会变成临时 fallback，并在 follow-up 文档中写清“不做原因”。

### 8. 收紧 Capability Matrix 和回归测试

- 更新 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.test.ts`：P2 temporary fallback 不能再自动通过；需要明确 allowlist 和过期说明。
- 每个从半实现变已实现的能力都要有一条 App 层用户可见测试。
- 每个 provider 接入项都要有 event mapper 测试，避免 renderer 只能靠猜字段。
- 增加一条 e2e：真实 desktop chat flow 至少覆盖 web search + turn diff 或 exploration 中的一项新增能力。

## Suggested Execution Order

1. Review comment 文件打开：范围小、收益直接，先清掉已知 bug。
2. Turn diff 富展示：用户最容易感知，也是 live footer 已接入的能力。
3. Exploration：当前明确 temporary fallback，是全量 parity 的最大缺口。
4. Collapsed activity / summary：依赖 exploration 和 diff 后再调，避免折叠规则反复返工。
5. End resources / live footer：把“支持范围”和“展示条件”定清楚。
6. Worked-for / realtime transcript：最后做数据来源判定，能实现就实现，不能实现就变成清晰的 intentional non-goal。
7. Capability matrix 收口：让测试强制反映最新验收口径。

## Risks and Mitigations

- 风险：盲目复刻 reference 会把 Electron 桌面端没有的数据也做成假 UI。缓解：每个能力先证明数据来源，再改 capability matrix。
- 风险：turn diff 完整渲染大文件会卡 UI。缓解：保留长度阈值，只做文件级摘要和按需展开。
- 风险：collapsed activity 规则过度复杂。缓解：先覆盖用户可见差异，不复制所有内部 analytics/detail-level 分支。
- 风险：系统默认打开文件不支持跳行。缓解：本轮只验收文件能打开；额外字段仅作为 best-effort 参数，不做 UI 承诺。
- 风险：turn diff 文件路径来自相对路径，IPC 拒绝打开。缓解：先实现 cwd 解析契约；没有 cwd 时禁用打开按钮并测试。
- 风险：exploration 聚合影响已有 tool activity 分组。缓解：把 exploration 聚合放在 collapsed activity 前，并用 fixtures 锁定 web/MCP/dynamic 不被误吞。
- 风险：P3 类型花太多时间。缓解：`worked-for` 和 `realtime-transcript` 先做数据来源判定，不能证明来源就保留 intentional/known-null。

## Verification Steps

1. Renderer targeted tests:
   - `npm --prefix desktop-app test -- assistantRenderUnits.test.ts toolGroupSummary.test.ts renderUnitCapabilityMatrix.test.ts App.test.tsx`
2. Desktop IPC tests:
   - `npm --prefix desktop-app test -- codexIpcApi.test.ts`
   - 若已有 main process test harness，把 `codex:open-local-path` handler 加进去。
3. Provider tests when data mapping changes:
   - `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck`
   - `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test`
4. Desktop broad checks:
   - `npm --prefix desktop-app run lint`
   - `npm --prefix desktop-app test`
5. E2E smoke:
   - `npm --prefix desktop-app run test:e2e -- --reporter=line`

## Stop Condition

- 验收表里的“半实现”项要么变成已实现，要么有明确的数据来源限制和 intentional follow-up。
- `exploration` 不再是 temporary fallback。
- Review comment 文件能通过 main process 打开。
- Turn diff 至少达到“可审查文件列表 + 大 diff 兜底 + 已解析文件可打开”的 reference 近似体验。
- Capability matrix、unit tests、App tests 与计划验收口径一致。
- 所有目标测试通过；若有失败，必须证明失败与本计划改动无关。
