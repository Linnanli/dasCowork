# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-04
- Primary product surfaces: Electron desktop shell, conversation view, composer, project sidebar, and the right-side Review/Terminal/Browser/Files workspace.
- Evidence reviewed: `AGENTS.md`, `.omx/plans/projectless-composer-project-picker-plan.md`, `.omx/plans/p0-06-approval-and-structured-input-parity.md`, `.omx/plans/app-server-approval-pending-full-parity-plan.md`, `.omx/plans/codex-right-workspace-implementation-plan.md`, `docs/design/codex-right-workspace-ui-spec.svg`, `desktop-app/src/renderer/src/App.tsx`, `desktop-app/src/renderer/src/assets/styles/globals.css`, `desktop-app/src/renderer/src/components/local-git-review/`, `desktop-app/src/renderer/src/components/assistant-ui/server-request-panel.tsx`, `desktop-app/src/renderer/src/components/assistant-ui/composer-add-context-popover.tsx`, `desktop-app/src/renderer/src/projects/ComposerProjectCard.tsx`, the user-provided Codex right-workspace screenshots, the v2 request contracts in `codex/codex-rs/app-server-protocol/src/protocol/`, and corresponding surfaces in `reference-projects/codex-electron-26.707.72221-beautified`, `reference-projects/openwork`, and `reference-projects/AionUi`.

## Brand

- Personality: Calm, focused, desktop-native, and tool-oriented.
- Trust signals: Clear current context, predictable actions, visible loading/error states, and consistent controls.
- Avoid: Decorative visual noise, exposed implementation terminology, and multiple visual patterns for the same interaction.

## Product goals

- Goals: Make project context easy to understand and choose before a conversation is bound, keep that
  context stable throughout the bound conversation, make pending approvals easy to inspect and resolve,
  and let users inspect changes, files, terminals, and web pages without leaving the active task.
- Non-goals: Reproduce every upstream Codex surface or add a second desktop design system.
- Success signals: Users can choose a project before sending, identify the conversation context, and never
  accidentally change the project of an existing conversation. The right workspace must visually read as one
  Codex-style system even though its tabs own different native capabilities.

## Personas and jobs

- Primary personas: People using Codex to work with local or remote code projects.
- User jobs: Start a task, select its workspace, add relevant context, follow progress, and review results.
- Key contexts of use: Long-running desktop sessions, keyboard-heavy interaction, and mixed local/remote projects.

## Information architecture

- Primary navigation: Sidebar for projects and conversations; main pane for the active conversation; optional right
  workspace for Review, Terminal, Browser, and Files.
- Core routes/screens: Conversation list, conversation view, composer, approvals, project management entry points,
  and the right-workspace launcher/tab states.
- Content hierarchy: Active conversation first, task-linked workspace second, composer context and supporting status
  around them. The right workspace is subordinate to the active project/task and never becomes global navigation.

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
- Treat Review, Terminal, Browser, and Files as content types inside one shared workspace shell. Tabs, menus,
  toolbars, empty states, tree rows, and resize behavior must not fork into type-specific visual systems.
- Match the supplied Codex screenshots in structure and density before adding product-specific embellishment.
  Use the local UI design board for measurable dimensions and `$visual-ralph` for implementation fidelity.
- Tradeoffs: Prefer consistency and compactness over dense project metadata or one-off visual treatments.

## Visual language

- Color: Semantic theme tokens from `globals.css`; translucent popovers use `bg-popover/90` with backdrop blur.
- Typography: System sans-serif; compact 13px controls and 11px section labels.
- Spacing/layout rhythm: Four-pixel-based spacing with compact composer controls and comfortable list rows;
  approval cards use 16px header/action insets and compact 8px gaps.
- Shape/radius/elevation: Composer and approval panels use large rounded corners, a subtle token border,
  semantic surfaces, and desktop elevation; approval cards use the `rounded-3xl` treatment. The right workspace
  itself is a flat full-height pane; only tabs, fields, selected rows, and menus receive 9–12px radii.
- Motion: Short Radix/Tailwind open-close transitions; no decorative motion. Workspace hover is 120ms, menus are
  140–180ms, and pane collapse/restore is 180–220ms; resize tracking has no easing.
- Imagery/iconography: Lucide line icons sized consistently with nearby text. Workspace chrome uses 16–18px icons
  from one family; file-type icons may use semantic color only inside file/change trees.

## Components

- Existing components to reuse: `Button`, `Popover`, `Command`, assistant-ui composer controls, the
  `aui-composer-context-panel` visual pattern, the shared `ServerRequestPanel` card shell, existing Git review
  services/`DiffViewer`, semantic tokens, and shared scroll/focus primitives.
- New/changed components: On unbound drafts, the Composer project picker follows the same panel, section-label,
  and list-row styling as `aui-composer-context-panel`; approval requests use a shared footer card shell
  across command, file, network, permission, tool-input, and MCP request types. Permission details are shared
  by standalone permission requests and command requests with additional permissions. MCP uses distinct typed
  form, OpenAI form, unsupported-form, and URL states inside the same shell. New approval or pending-request
  components own only body content, validation, and request state; they must not introduce another outer card,
  viewport modal, dialog, background, border, radius, shadow, width rule, or one-off visual token. The workspace
  adds one shared shell (`RightWorkspaceShell`, tabs, launcher, resize handle, and toolbar conventions); each tab
  contributes content and type-specific actions, not its own outer shell.
- Variants and states: The picker is visible for unbound drafts and absent for bound conversations; while visible,
  it supports default, hover/highlight, selected, disabled, loading, empty, error, and secondary-page states.
  The workspace supports launcher, active tabs, overflow, collapsed, maximized, narrow-tree-collapsed, loading,
  empty, inline error, unsupported file, exited terminal, and blocked browser states.
- Token/component ownership: Theme tokens live in `globals.css`; feature-specific composition stays in renderer components.

## Accessibility

- Target standard: Keyboard-operable desktop UI with semantic labels and readable contrast.
- Keyboard/focus behavior: Preserve Command/Popover navigation, Escape behavior, visible focus/highlight state,
  descriptive aria labels, and keyboard access to approval actions while the composer is replaced. MCP forms
  use Enter to submit and Escape to cancel; user-input auto-resolution countdowns expose a readable label
  without announcing every elapsed second.
- Contrast/readability: Use semantic foreground and muted-foreground tokens; do not encode selection by color alone.
- Screen-reader semantics: Floating lists expose named groups/items and selected-state labels.
- Workspace semantics: The top strip is a named tablist; each tab owns a labelled tabpanel; file/change trees expose
  tree/treeitem levels and expanded/selected states; native browser content cannot erase the accessible product toolbar.
- Reduced motion and sensory considerations: Keep motion brief and functional; follow system/theme behavior where supported.

## Responsive behavior

- Supported breakpoints/devices: Resizable desktop windows.
- Layout adaptations: Floating panels must remain inside collision padding and scroll internally when height is constrained;
  approval cards fill the thread content width up to 48rem, cap command content at 320px and file lists at 200px,
  and stack action buttons below a 448px request-card container. The right workspace defaults to 560px, clamps to
  360px–`min(960px, 70vw)`, hides the Files tree below 720px pane width, and hides the Review tree below 760px.
- Touch/hover differences: Desktop hover is enhanced, but click and keyboard interaction remain complete.

## Right workspace visual contract

![Codex-style right workspace launcher, tabs, files, browser, and review states](docs/design/codex-right-workspace-ui-spec.svg)

- Canonical detailed specification: `.omx/plans/codex-right-workspace-implementation-plan.md`, section “UI 视觉设计基线”.
- Shared chrome: 56px tab bar, 38px tabs and add button, 48–54px optional type toolbar, 1px separators,
  16px content padding, flat `bg-background`, and `bg-muted` active/selected surfaces.
- Launcher: Review, Terminal, Browser, Files in that order; 460px group, 32px rows, 8px gaps, vertically centered
  slightly above the content midpoint. Rows use a borderless secondary semantic surface so they remain distinct
  from the workspace background in both themes.
- Files: file content left and searchable file tree right at 65/35; code is edge-to-edge, not nested in a card.
- Review: diff left and changed-file tree right at 68/32; current Git capabilities are preserved but shell chrome is shared.
- Browser: shared tab bar plus a 48px navigation row; remote content fills all remaining space with no card margin.
- Terminal: shared tab bar and an edge-to-edge xterm surface with 16px top/left padding; no redundant type toolbar.
- Forbidden drift: VS Code-style square tabs, activity bars, colored tab underlines, nested cards/shadows, per-tab
  toolbar heights, arbitrary hex colors in product code, or trees appearing on the left contrary to the supplied references.
- Tab dragging: Start after 6px of pointer movement. Keep the dragged tab as an invisible layout slot, move neighboring
  tabs with stable horizontal transforms, and render an exact-size copy from the original grab point at window level.
  Prefer the tab beneath the pointer; when the pointer is in a strip gap, use the closest tab in that strip and its
  horizontal midpoint to resolve before/after placement. Never interpret a gap in a non-empty strip as the first slot.
  Escape, window blur, lost pointer capture, pointer cancellation, and leaving the window all cancel the interaction and
  remove every drag layer immediately.

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
- Workspace loading: Preserve the active tab and its toolbar; show a compact spinner/status inside the content area.
- Workspace empty: Use one centered icon, a 20px title, a 14px explanation, and at most one primary action.
- Workspace error: Keep other tabs operational, show the error in the failed tab, and provide retry/restart where meaningful.
- Workspace resource exit: A closed PTY or destroyed browser view becomes an explicit recoverable state rather than a blank pane.

## Content voice

- Tone: Direct, compact, and task-oriented.
- Terminology: Use user-facing terms such as “项目”, “对话”, “上下文”, “审阅”, “终端”, “浏览器”, and “文件”;
  avoid protocol, PTY, IPC, WebContentsView, and process names in product copy.
- Microcopy rules: Prefer short verb-first actions and explicit empty/error text.

## Implementation constraints

- Framework/styling system: React, assistant-ui, Radix/shadcn primitives, Tailwind CSS v4, and semantic theme tokens.
- Design-token constraints: Reuse existing semantic tokens and composer patterns before adding raw colors or new layers.
- Performance constraints: Keep filtering local and avoid filesystem/network work in renderer presentation code.
- Compatibility constraints: Renderer accesses desktop capabilities only through the preload bridge; do not modify Codex app-server.
- Workspace visual constraint: Product code must implement the dimensions, content order, and adaptive tree behavior in
  the right-workspace visual contract; static SVG hex values are illustrative and must map to semantic theme tokens.
- Approval-shell constraint: Every approval and pending-request type enters through `ServerRequestPanel` and reuses
  the current `RequestShell`, action-row, button, typography, spacing, responsive, busy, and error treatments.
  Type-specific UI may change only the body, fields, copy, and protocol-backed actions.
- Test/screenshot expectations: Add targeted component assertions, run typecheck/lint/tests, and capture approval
  screenshots for command, file, network, permission, tool-input auto-resolution, MCP typed/OpenAI/unsupported,
  and MCP URL states at desktop and narrow request-card widths. Regression assertions must also prove that all
  new types retain the shared approval-shell contract instead of introducing a visually separate popup family.
  Workspace implementation additionally captures RW-01 through RW-06 from the canonical plan and completes a
  `$visual-ralph` comparison against the supplied Codex screenshots and local SVG design board.

## Open questions

- [ ] Whether all composer-attached floating panels should share a dedicated reusable primitive after more than two consumers need the pattern.
