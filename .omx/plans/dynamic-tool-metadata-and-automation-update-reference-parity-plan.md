# Dynamic Tool Metadata and Automation Update Reference Parity Plan

## Requirements Summary

Bring the current renderer behavior for these three dynamic-tool concepts closer to `reference-projects/codex-electron-26.623.101652-beautified`:

1. `summaryOnlyInConversationGroup` is a display metadata flag, not a tool. In the reference, a dynamic tool-call group whose items all have this flag is summary-only and cannot be expanded. Evidence: reference registry marks this flag at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:43297`; helper `PDe` reads it at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:43440`; dynamic group sets `canExpand` to `false` when every item is summary-only at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:45797`.
2. `continuesLiveActivityBetweenCalls` is also display metadata, not a tool. In the reference, a completed final item can keep the group visually active while the turn is still active. Evidence: reference registry marks this flag at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:43305`; helper `DN` reads it at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:43437`; active calculation keeps the latest completed item live at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:43451`.
3. `automation_update` is an actual dynamic tool. In the reference, hidden dynamic tools include `automation_update` and `load_workspace_dependencies`, but successful completed `automation_update` calls are converted into a dedicated `automation-update` item. Evidence: hidden-tool predicate is at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~new-~djgpfzje-D9gL_dwm.js:44597`; successful conversion starts at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~new-~djgpfzje-D9gL_dwm.js:44857`; visibility check is at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~new-~djgpfzje-D9gL_dwm.js:45399`.

Current project state:

- `DynamicToolMetadata` already stores `summaryOnlyInConversationGroup` and `continuesLiveActivityBetweenCalls` at `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:41`.
- Dynamic metadata is read from registry-like fields at `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:1187`, then merged at `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:1262`.
- Current grouping only uses `standaloneInConversation` to affect grouping/open behavior at `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:503`; the two other flags are not yet used for can-expand or active-state behavior.
- Current dynamic group rendering always renders a `ToolActivityGroupShell` with a trigger/content pair at `desktop-app/src/renderer/src/App.tsx:891`, and `ToolActivityGroupShell` does not support non-expandable summary-only groups at `desktop-app/src/renderer/src/components/render-units/toolActivityGroupShell.tsx:24`.
- `automation_update` currently has local labels at `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:248`, but the existing test expects it to remain a `dynamicToolCall` entry at `desktop-app/src/renderer/src/lib/assistantRenderUnits.test.ts:436`; this is not reference-parity behavior.
- The capability matrix already treats `automation-update` / `automationUpdate` as custom compact entries at `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:263`, and `SpecialEntryRenderer` already maps `automationUpdate` to `CompactEntryUnit` at `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx:195`.

## Acceptance Criteria

1. A dynamic tool group whose every item has `summaryOnlyInConversationGroup: true` renders as a summary-only unit: no clickable expand trigger, no details body, and no missing-metadata diagnostic. This should be covered by a renderer test in `desktop-app/src/renderer/src/App.test.tsx`.
2. A mixed dynamic tool group where at least one item does not have `summaryOnlyInConversationGroup: true` remains expandable and still shows the same details behavior as today. This should be covered by a unit test in `desktop-app/src/renderer/src/lib/assistantRenderUnits.test.ts` or a renderer test in `desktop-app/src/renderer/src/App.test.tsx`.
3. During a running assistant message, a dynamic tool group whose latest item is completed but has `continuesLiveActivityBetweenCalls: true` is marked active and uses active labels. A completed message with the same items is not marked active. This should be covered in `desktop-app/src/renderer/src/lib/assistantRenderUnits.test.ts`.
4. A successful completed `automation_update` dynamic tool call with parseable arguments becomes an `automationUpdate` / `automation-update` compact entry instead of a generic dynamic-tool fallback. This should be covered in `desktop-app/src/renderer/src/lib/assistantRenderUnits.test.ts` and `desktop-app/src/renderer/src/App.test.tsx`.
5. A pending, failed, or unparseable `automation_update` dynamic tool call is not shown as a noisy generic tool card unless there is explicit useful error content to show. This should be covered by at least two tests: one for pending/hidden and one for failed/unparseable behavior.
6. Existing dynamic-tool fallback behavior for unknown tools remains intact, including the missing metadata diagnostic after expanding unknown dynamic groups. Existing assertions around `Lookup（2 次）` in `desktop-app/src/renderer/src/App.test.tsx:1284` should continue to pass or be intentionally updated only if reference behavior demands it.
7. Verification passes with `npm --prefix desktop-app run lint` and the targeted renderer test files. If a full desktop test run is too slow, the targeted command and the reason for not running the full suite must be recorded in the implementation report.

## Implementation Steps

### 1. Model Dynamic Group Display Policy Explicitly

Add explicit derived fields to the dynamic group unit, instead of making the React component reinterpret merged metadata ad hoc.

Suggested shape in `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts`:

- Add `canExpand?: boolean` or `summaryOnly?: boolean` to the `dynamic-tool-call-group` render unit type near `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:70`.
- In `groupDynamicToolCalls`, compute summary-only using reference semantics: all grouped items must have `summaryOnlyInConversationGroup === true`, matching reference `i.every(PDe)` at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:45797`.
- Fix `mergeDynamicMetadata` so group-level `summaryOnlyInConversationGroup` is not `some(...)` when the value is used as group policy. Current `some(...)` at `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:1275` is correct only for "there exists such an item", not for "the group is summary-only".
- Keep a separate boolean if both meanings are useful, for example `hasSummaryOnlyItems` and `summaryOnlyInConversationGroup`, to avoid muddy behavior.

### 2. Teach the Group Shell to Render Non-Expandable Summaries

Extend `ToolActivityGroupShell` and `ToolGroupRoot`/trigger usage to support a summary-only mode.

Suggested implementation:

- Add a `canExpand?: boolean` prop to `ToolActivityGroupShell` at `desktop-app/src/renderer/src/components/render-units/toolActivityGroupShell.tsx:24`.
- When `canExpand === false`, render the same visual summary row without `CollapsibleTrigger` behavior and without `ToolGroupContent`. This keeps the UI close to reference `canExpand: _` at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:45887`.
- Keep the existing expandable path unchanged for collapsed tool activity, MCP, web search, multi-agent, and ordinary dynamic groups.
- In `DynamicToolCallGroupUnit` at `desktop-app/src/renderer/src/App.tsx:891`, pass `canExpand={!unit.dynamicMetadata?.summaryOnlyInConversationGroup}` or the new unit-level `canExpand`.

### 3. Implement Continues-Live Active Calculation

Mirror reference active behavior for dynamic groups while keeping existing active detection for ordinary tools.

Suggested implementation:

- Carry message running state into dynamic group conversion. `buildAssistantRenderUnits` already derives `isRunning` at `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:257`; pass that into `toRenderUnit` or into a dynamic-specific active helper.
- Replace dynamic group active calculation at `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:687` with:
  - active when any part is actually active;
  - active when the assistant message is running and at least one item is incomplete;
  - active when the assistant message is running, every item is completed, and the latest item has `continuesLiveActivityBetweenCalls === true`, matching reference `AN` at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:43451`.
- Keep completed messages static so completed transcripts do not shimmer forever.
- Add tests for both running and complete message status.

### 4. Convert Successful Automation Updates Before Generic Dynamic Rendering

Add a normalization step that maps successful completed `automation_update` calls with parseable arguments into the existing compact `automationUpdate` item type.

Preferred renderer-local path:

- In `normalizeParts`, after `extractThreadItem(part)` and before `canonicalItemType`, transform the extracted item when it is a `dynamicToolCall` with `tool === 'automation_update'`, `status === 'completed'`, `success === true`, and object-like arguments. This localizes the behavior to render units and avoids changing provider stream contracts.
- Return an entry item shaped like `{ type: 'automation-update', id/callId, arguments, result?, title?, summary?, action? }`; `canonicalItemType` already maps `automation-update` to `automationUpdate` at `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:1102`.
- Reuse `SpecialEntryRenderer` / `CompactEntryUnit`, which already support `automationUpdate` at `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx:195` and title/detail generation at `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx:1409`.

Alternative provider path:

- Convert the item earlier in `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/shared-item-extractors.ts`, where `dynamicToolCall` is currently classified as a generic tool at `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/shared-item-extractors.ts:68`.
- This is closer to the source but has wider blast radius because provider tests currently cover generic `dynamicToolCall` mapping in `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/event-mapper.test.ts`.

Recommendation: choose the renderer-local path first. It matches the existing render-unit capability matrix, keeps protocol-generated types untouched, and is the least risky route for UI parity.

### 5. Hide Hidden Dynamic Tools Unless They Become Dedicated Entries

Implement the reference hidden-tool rule for current renderer output.

Suggested behavior:

- Add a small helper in `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts`, for example `shouldRenderDynamicToolCall(item)`.
- Hidden tools: `automation_update` and `load_workspace_dependencies`, matching reference `QH` at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~new-~djgpfzje-D9gL_dwm.js:44597`.
- `automation_update` exception: render only after successful parse into `automationUpdate`, matching reference visibility check at `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~new-~djgpfzje-D9gL_dwm.js:45399`.
- For failed hidden tools, decide whether to show an error compact entry only if there is user-actionable error text. Do not show raw argument dumps for ordinary hidden-tool noise.

### 6. Align Summary Labels and Repeat Counts

Keep the current dynamic labels but make sure they follow reference grouping behavior.

Suggested implementation:

- Keep local labels for `automation_update`, `load_workspace_dependencies`, `pia_slackbot_dm`, and `read_thread_terminal` at `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:240`.
- Preserve repeat-count behavior in `dynamicGroupLabel` at `desktop-app/src/renderer/src/App.tsx:1023`, because it already mirrors reference repeat count summary behavior from `reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~onboarding-page-2jNGqpwT.js:46008`.
- Add coverage for summary-only groups with repeat count, active labels, and completed labels.

### 7. Update Tests First, Then Implementation

Add or update tests before implementation to lock the desired behavior:

- `desktop-app/src/renderer/src/lib/assistantRenderUnits.test.ts`
  - summary-only group has `canExpand: false` or equivalent render-unit policy.
  - mixed summary-only and normal dynamic calls remain expandable.
  - `continuesLiveActivityBetweenCalls` keeps a running message active after the latest item completes.
  - successful completed `automation_update` becomes `itemType: 'automationUpdate'`.
  - pending/failed hidden dynamic tools are hidden or compactly surfaced only when useful.
- `desktop-app/src/renderer/src/App.test.tsx`
  - summary-only dynamic group has no trigger/content expansion.
  - `automationUpdate` renders through compact entry and shows user-facing text, not a generic `ToolFallback`.
  - existing unknown dynamic group fallback still shows the diagnostic only after expansion.

## Risks and Mitigations

- Risk: Treating `summaryOnlyInConversationGroup` as `some(...)` would make mixed groups non-expandable by accident. Mitigation: compute group summary-only using `every(...)`, and keep tests for mixed groups.
- Risk: `continuesLiveActivityBetweenCalls` could make old completed transcripts look permanently active. Mitigation: require the parent assistant message to be running before applying the flag.
- Risk: Converting `automation_update` in the provider could break provider-level dynamic-tool tests. Mitigation: implement conversion in renderer normalization first unless a later architecture pass decides provider-level conversion is needed.
- Risk: Hidden failed `automation_update` errors could disappear when users need to know something failed. Mitigation: preserve actionable error content through a compact error/status entry, but avoid generic raw `ToolFallback` dumps.
- Risk: Existing dirty worktree changes may already touch these files. Mitigation: inspect current diffs before implementing, keep changes scoped, and do not revert unrelated edits.

## Verification Steps

1. Run targeted render-unit tests:

```bash
npm --prefix desktop-app test -- src/renderer/src/lib/assistantRenderUnits.test.ts src/renderer/src/App.test.tsx
```

2. Run renderer lint:

```bash
npm --prefix desktop-app run lint
```

3. If provider code is changed despite the renderer-local recommendation, also run:

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test -- event-mapper.test.ts cross-call-tools.test.ts
```

4. Optional manual UI smoke check:

- Build a fixture assistant message with two summary-only dynamic calls and confirm it shows one compact summary row with no expandable body.
- Build a running message with a completed `continuesLiveActivityBetweenCalls` item and confirm the label remains active while the message is running.
- Build a completed successful `automation_update` item and confirm it renders as compact automation status, not as a generic dynamic-tool card.

## Stop Condition

Stop when the three behaviors above are covered by tests, implemented in the renderer without protocol churn, and verified by targeted tests plus lint. Defer provider-level conversion unless renderer-local conversion cannot represent the reference behavior.
