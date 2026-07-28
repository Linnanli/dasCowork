# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-07-27
- Primary product surfaces: Electron desktop shell, conversation view, composer, project sidebar.
- Evidence reviewed: `AGENTS.md`, `.omx/plans/projectless-composer-project-picker-plan.md`, `.omx/plans/p0-06-approval-and-structured-input-parity.md`, `.omx/plans/app-server-approval-pending-full-parity-plan.md`, `desktop-app/src/renderer/src/App.tsx`, `desktop-app/src/renderer/src/assets/styles/globals.css`, `desktop-app/src/renderer/src/components/assistant-ui/server-request-panel.tsx`, `desktop-app/src/renderer/src/components/assistant-ui/composer-add-context-popover.tsx`, `desktop-app/src/renderer/src/projects/ComposerProjectCard.tsx`, the v2 request contracts in `codex/codex-rs/app-server-protocol/src/protocol/`, and the approval, permission, user-input, and MCP request cards in `reference-projects/codex-electron-26.707.72221-beautified`.

## Brand

- Personality: Calm, focused, desktop-native, and tool-oriented.
- Trust signals: Clear current context, predictable actions, visible loading/error states, and consistent controls.
- Avoid: Decorative visual noise, exposed implementation terminology, and multiple visual patterns for the same interaction.

## Product goals

- Goals: Make project context easy to understand and choose before a conversation is bound, keep that
  context stable throughout the bound conversation, and make pending approvals easy to inspect and resolve.
- Non-goals: Reproduce every upstream Codex surface or add a second desktop design system.
- Success signals: Users can choose a project before sending, identify the conversation context, and never
  accidentally change the project of an existing conversation.

## Personas and jobs

- Primary personas: People using Codex to work with local or remote code projects.
- User jobs: Start a task, select its workspace, add relevant context, follow progress, and review results.
- Key contexts of use: Long-running desktop sessions, keyboard-heavy interaction, and mixed local/remote projects.

## Information architecture

- Primary navigation: Sidebar for projects and conversations; main pane for the active conversation.
- Core routes/screens: Conversation list, conversation view, composer, approvals, and project management entry points.
- Content hierarchy: Active conversation first, composer context second, supporting navigation and status around it.

## Design principles

- Reuse the composer context-panel language for floating menus attached to the composer.
- Treat approval requests as a composer-footer surface: they occupy the composer slot while pending and
  return control to the composer after resolution; they are not viewport-level modal overlays.
- Display only actions that have a real App Server response mapping. “Skip”, “Dismiss”, “Reject”, and
  “Cancel” are distinct when the protocol distinguishes decline, empty input, and cancel.
- A permission card must make every requested network or filesystem capability inspectable before approval;
  partially understood permission payloads fail closed instead of showing a partial grant.
- Prefer content-driven approval cards with bounded internal scroll regions over fixed overall dimensions.
- Keep active project and execution context visible without exposing internal protocol details.
- Treat the project assignment as immutable after a conversation binds to a thread; hide the Composer project
  picker instead of presenting an action that cannot safely apply in place.
- Tradeoffs: Prefer consistency and compactness over dense project metadata or one-off visual treatments.

## Visual language

- Color: Semantic theme tokens from `globals.css`; translucent popovers use `bg-popover/90` with backdrop blur.
- Typography: System sans-serif; compact 13px controls and 11px section labels.
- Spacing/layout rhythm: Four-pixel-based spacing with compact composer controls and comfortable list rows;
  approval cards use 16px header/action insets and compact 8px gaps.
- Shape/radius/elevation: Composer and approval panels use large rounded corners, a subtle token border,
  semantic surfaces, and desktop elevation; approval cards use the `rounded-3xl` treatment.
- Motion: Short Radix/Tailwind open-close transitions; no decorative motion.
- Imagery/iconography: Lucide line icons sized consistently with nearby text.

## Components

- Existing components to reuse: `Button`, `Popover`, `Command`, assistant-ui composer controls, the
  `aui-composer-context-panel` visual pattern, and the shared `ServerRequestPanel` card shell.
- New/changed components: On unbound drafts, the Composer project picker follows the same panel, section-label,
  and list-row styling as `aui-composer-context-panel`; approval requests use a shared footer card shell
  across command, file, network, permission, tool-input, and MCP request types. Permission details are shared
  by standalone permission requests and command requests with additional permissions. MCP uses distinct typed
  form, OpenAI form, unsupported-form, and URL states inside the same shell. New approval or pending-request
  components own only body content, validation, and request state; they must not introduce another outer card,
  viewport modal, dialog, background, border, radius, shadow, width rule, or one-off visual token.
- Variants and states: The picker is visible for unbound drafts and absent for bound conversations; while visible,
  it supports default, hover/highlight, selected, disabled, loading, empty, error, and secondary-page states.
- Token/component ownership: Theme tokens live in `globals.css`; feature-specific composition stays in renderer components.

## Accessibility

- Target standard: Keyboard-operable desktop UI with semantic labels and readable contrast.
- Keyboard/focus behavior: Preserve Command/Popover navigation, Escape behavior, visible focus/highlight state,
  descriptive aria labels, and keyboard access to approval actions while the composer is replaced. MCP forms
  use Enter to submit and Escape to cancel; user-input auto-resolution countdowns expose a readable label
  without announcing every elapsed second.
- Contrast/readability: Use semantic foreground and muted-foreground tokens; do not encode selection by color alone.
- Screen-reader semantics: Floating lists expose named groups/items and selected-state labels.
- Reduced motion and sensory considerations: Keep motion brief and functional; follow system/theme behavior where supported.

## Responsive behavior

- Supported breakpoints/devices: Resizable desktop windows.
- Layout adaptations: Floating panels must remain inside collision padding and scroll internally when height is constrained;
  approval cards fill the thread content width up to 48rem, cap command content at 320px and file lists at 200px,
  and stack action buttons below a 448px request-card container.
- Touch/hover differences: Desktop hover is enhanced, but click and keyboard interaction remain complete.

## Interaction states

- Loading: Disable unsafe actions and show concise loading copy or a spinner.
- Empty: Explain that no matching or available items exist.
- Error: Keep the relevant panel open when possible and show an inline actionable error.
- Success: Close the completed flow and reflect the newly active context.
- Disabled: Preserve labels while reducing emphasis and preventing input.
- Approval pending: Replace the composer in the thread footer with the pending approval card; keep execution status,
  recovery, and queued-follow-up context visible above it.
- Approval error: Keep the card mounted, show an inline error inside the card, and leave the approval actions retryable.
- Approval auto-resolution: Show the remaining time when App Server supplies an automatic-resolution window;
  pause automatic resolution after the first meaningful user interaction and never restart the deadline on refresh.
- Unsupported request payload: Explain that the client cannot safely display the request and expose only
  protocol-safe Skip/Dismiss actions; never fall back to raw JSON.
- MCP URL action: Opening a link does not approve the request. Replace “Open link” with “Continue” after the
  external action starts, and settle the request only when the user continues.
- Bound conversation: Do not render `ComposerProjectCard` or `composer-project-card-shell`; project changes begin
  from a new conversation instead.
- Offline/slow network, if applicable: Keep local state readable and surface provider/runtime failures inline.

## Content voice

- Tone: Direct, compact, and task-oriented.
- Terminology: Use user-facing terms such as “项目”, “对话”, and “上下文”; avoid protocol and process names.
- Microcopy rules: Prefer short verb-first actions and explicit empty/error text.

## Implementation constraints

- Framework/styling system: React, assistant-ui, Radix/shadcn primitives, Tailwind CSS v4, and semantic theme tokens.
- Design-token constraints: Reuse existing semantic tokens and composer patterns before adding raw colors or new layers.
- Performance constraints: Keep filtering local and avoid filesystem/network work in renderer presentation code.
- Compatibility constraints: Renderer accesses desktop capabilities only through the preload bridge; do not modify Codex app-server.
- Approval-shell constraint: Every approval and pending-request type enters through `ServerRequestPanel` and reuses
  the current `RequestShell`, action-row, button, typography, spacing, responsive, busy, and error treatments.
  Type-specific UI may change only the body, fields, copy, and protocol-backed actions.
- Test/screenshot expectations: Add targeted component assertions, run typecheck/lint/tests, and capture approval
  screenshots for command, file, network, permission, tool-input auto-resolution, MCP typed/OpenAI/unsupported,
  and MCP URL states at desktop and narrow request-card widths. Regression assertions must also prove that all
  new types retain the shared approval-shell contract instead of introducing a visually separate popup family.

## Open questions

- [ ] Whether all composer-attached floating panels should share a dedicated reusable primitive after more than two consumers need the pattern.
