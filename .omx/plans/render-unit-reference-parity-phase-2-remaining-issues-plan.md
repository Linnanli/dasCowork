# Render Unit Reference Parity Phase 2 Remaining Issues Plan

Date: 2026-07-07
Status: completed on 2026-07-07; archived as historical planning context

## Completion Update

The remaining issues tracked by this plan have been implemented or superseded by the Phase 2 completion work recorded in `.omx/plans/render-unit-reference-parity-phase-2-completion.md`.

- `endResources` and `reviewComments` are intentionally client-derived render-unit shapes, matching the reference project: renderer support remains, but app-server `ThreadItem` protocol types and provider realtime/history mapping have been removed.
- The Phase 2 matrix gate now treats P0/P1 `fallback` or `temporary` support as completion-blocking unless explicitly scoped out.
- The old `review-comments` renderer path remains as a P2 compatibility alias for local conversation data; it is not an app-server protocol item.
- Web search, MCP resource blocks, TODO/diff live footer behavior, generated image file parts, safe resource opening, review-comment navigation, and timeline navigation are covered by renderer/provider tests plus the existing desktop e2e chat path.

## Verification Evidence

- `RUSTUP_TOOLCHAIN=stable cargo fmt -p codex-app-server-protocol` passed.
- `RUSTUP_TOOLCHAIN=stable cargo run -p codex-app-server-protocol --bin write_schema_fixtures -- --schema-root app-server-protocol/schema` passed.
- `RUSTUP_TOOLCHAIN=stable cargo test -p codex-app-server-protocol schema_fixtures_match_generated --test schema_fixtures` passed; 2 tests passed.
- `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint` passed.
- `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck` passed.
- `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test` passed; 15 files passed, 134 tests passed.
- `npm --prefix desktop-app run typecheck` passed.
- `npm --prefix desktop-app run lint` passed.
- `npm --prefix desktop-app test` passed; 34 files passed, 264 tests passed.
- `npm --prefix desktop-app run test:e2e -- --reporter=line` passed; 10 tests passed.

## Follow-Up Boundary

No remaining item in this plan blocks Phase 2 completion. If future work needs final resources or review comments, keep them in the client-side conversation adapter/render-unit layer unless there is a separately approved protocol change.
