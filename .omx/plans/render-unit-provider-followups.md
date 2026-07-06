# Render-Unit Provider Contract And Follow-Ups

日期：2026-07-06

## Provider -> Renderer 最小字段契约

| Render-Unit | app-server 字段 | provider/AI SDK UI 位置 | renderer 读取顺序 | summary |
| --- | --- | --- | --- | --- |
| `webSearch` | `ThreadItem.webSearch.id/query/action` | provider raw: `tool-call` + `tool-result.result.item`; AI SDK UI/history: `dynamic-tool.output.item` | `output.item` -> `result.item` -> direct `output/result` -> legacy `providerMetadata[@janole/ai-sdk-provider-codex-asp].item` | `webSearches` |
| `mcpToolCall` | `id/server/tool/status/arguments/appContext/mcpAppResourceUri/pluginId/result/error/durationMs` | provider raw started/progress/completed: `tool-result.result.item`; AI SDK UI/history: `dynamic-tool.output.item`, with `state/preliminary` carrying lifecycle | same shared `extractThreadItem()` order; source label uses `displayName -> appName -> name -> server/tool` | `mcpTools` plus source summary |
| `dynamicToolCall` | `id/namespace/tool/arguments/status/contentItems/success/durationMs` plus optional real registry metadata | provider raw: `tool-call`/`tool-result.result.item`; AI SDK UI/history: `dynamic-tool.output.item` | same shared tool normalization for live `dynamic-tool`, legacy `tool-call`, and history | generic tool unless known metadata exists |
| `automaticApprovalReview` | `item/autoApprovalReview/started|completed`: `reviewId/targetItemId/review/action/startedAtMs/completedAtMs/decisionSource` | provider raw synthetic `codex_automatic_approval_review`; AI SDK UI: `dynamic-tool.output.item` | shared `extractThreadItem()` | approved/denied/timedOut/inProgress counters |
| `sleep` | `ThreadItem.sleep.id/durationMs` | provider raw `codex_sleep` tool-call/result; AI SDK UI/history: `dynamic-tool.output.item`, with preliminary output treated as active | shared `extractThreadItem()` plus `state/preliminary` active detection | sleep counter |
| `turnDiff` | `turn/diff/updated.diff` | intentional provider NOOP | not rendered in this phase | follow-up: preview/lazy diff renderer |

## Entry Matrix

| Item/output | Current decision |
| --- | --- |
| automatic approval review | fallback renderer with stable summary |
| sleep | fallback renderer with stable summary |
| turn diff | intentional NOOP/follow-up; full diff is too large for eager DOM rendering |
| generated image | provider emits image file parts, but Render-Unit image gallery is Phase 2 |
| resource/end card | follow-up; no stable provider contract consumed in this phase |
| review comments/result attachments | follow-up; no stable provider contract consumed in this phase |

## Remaining Provider/App-Server Follow-Ups

- Dynamic tool registry metadata is still not provided by app-server; renderer only consumes real metadata when present and keeps fixture-only metadata as fallback coverage.
- Rich MCP app/source fields are consumed from real item payloads in `dynamic-tool.output.item` when present. Renderer still accepts the legacy `providerMetadata.item` fallback, but tests should not use that as proof of the live provider contract.
- `turn/diff/updated` should be mapped later to a lightweight preview item with lazy full diff rendering, not to a large eager text block.
- Generated image gallery, resource/end cards, and review/result attachments belong to the Phase 2 user-visible output work.

## UI Reuse Decision

This phase did not add new UI components. New item types reuse the existing assistant-ui-based `ToolGroup` and `ToolFallback` surfaces, so no assistant-ui MCP component lookup was needed.
