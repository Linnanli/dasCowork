# Design: Desktop Sidebar Project and Conversation Lists

## Source of Truth

- Status: Draft
- Last refreshed: 2026-06-30
- Primary product surfaces: `desktop-app` Electron renderer left sidebar, project switcher, chat thread list, project setup gate.
- Current stage in scope:
  - Local project list.
  - Path-only recent workspace roots.
  - Projectless chat list.
  - Project-grouped and chronological conversation list.
  - Basic project and conversation actions that are already supported or can be backed by app-server/main APIs.
- Current stage out of scope:
  - Chat history search.
  - Pinning projects or conversations.
  - Remote projects.
  - Auxiliary navigation such as Plugins/Skills, Pull requests, Automations, Debug, Mobile, or equivalent secondary routes.
  - Feature gates for the excluded features.
- Evidence reviewed:
  - `desktop-app/src/renderer/src/App.tsx`
  - `desktop-app/src/renderer/src/threads/ThreadList.tsx`
  - `desktop-app/src/renderer/src/threads/threadProjectSections.ts`
  - `desktop-app/src/renderer/src/projects/ProjectSwitcher.tsx`
  - `desktop-app/src/renderer/src/projects/useProjectState.ts`
  - `desktop-app/src/shared/projects/projectTypes.ts`
  - `desktop-app/src/shared/codexIpcApi.ts`
  - `desktop-app/src/main/projects/ProjectApiService.ts`
  - `desktop-app/src/main/projects/ProjectService.ts`
  - `desktop-app/src/main/projects/projectRuntimeServices.ts`
  - `desktop-app/src/main/projects/WorkspaceFileSearchService.ts`
  - `desktop-app/src/main/threads/startConversation.ts`
  - `desktop-app/src/main/codexChatRuntimeService.ts`
  - `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts`
  - `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/types.ts`
  - `codex/codex-rs/app-server/src/request_processors/thread_processor.rs`
  - `reference-projects/codex-electron-26.527.31326-beautified-analysis-v2/.vite/build/src-B5wXNbcV.js`
  - `reference-projects/codex-electron-26.527.31326-beautified-analysis-v2/.vite/build/main-B260eRdI.js`
  - `reference-projects/codex-electron-26.527.31326-beautified-analysis-v2/webview/assets/app-server-dynamic-tools-ChwcT_7g.js`
  - `reference-projects/codex-electron-26.527.31326-beautified-analysis-v2/webview/assets/app-main-BxvNtdQT.js`
  - `reference-projects/codex-electron-26.527.31326-beautified-analysis-v2/webview/assets/thread-actions-Cs8S1-Cm.js`
- Evidence limits:
  - The reference project is a built and beautified webview artifact, not original source. Several sidebar chunks are imported by name but not present as standalone files in the checked-in `webview/assets` directory. Findings from the reference project are therefore strongest for visible behavior, labels, action names, and component boundaries, weaker for original source ownership.

## Brand

- Personality: calm, developer-tool focused, dense but scannable.
- Trust signals: stable local project identity, explicit workspace roots, visible thread/project assignment, reversible archive/remove flows, predictable keyboard/focus behavior.
- Avoid:
  - Marketing-style sidebar cards or decorative panels.
  - Hiding project ownership behind only per-thread badges.
  - Renderer-only execution hints that bypass main process validation or Codex app-server ownership.

## Product Goals

- Goals:
  - Make the left sidebar the user's primary map of work: local projects, projectless chats, and recent conversations.
  - Support complete project list and conversation list workflows without moving sensitive project/runtime authority into renderer.
  - Keep current app-server based chat execution path intact.
  - Let users start chats globally, start chats inside a project, switch project context, rename/remove projects, and archive or manage conversations.
- Non-goals:
  - Reimplement the reference app wholesale.
  - Add independent LLM clients, direct model HTTP calls, or renderer-owned app-server protocol logic.
  - Design or ship chat history search, pinning, remote projects, auxiliary navigation, or feature-gated secondary routes in this stage.
- Success signals:
  - A user can answer "where is this chat running?" from the sidebar alone.
  - A user can filter or navigate to project-specific conversations without losing the active conversation.
  - Project and conversation operations refresh the sidebar without stale counts or incorrect active project fallback.

## Personas and Jobs

- Primary personas:
  - Developer using Codex across multiple local repositories.
  - Developer switching between project-bound and projectless exploratory chats.
- User jobs:
  - Start a new chat in the active project.
  - Start a projectless chat for scratch work.
  - Open a recent conversation.
  - Find all conversations for one project.
  - Rename, remove, or archive a project/conversation safely.
  - Understand missing workspace roots and recover from moved/deleted folders.
- Key contexts of use:
  - Long-running desktop sessions.
  - Mixed local project and scratch-chat histories.
  - Narrow sidebar states and macOS native backdrop.

## Evidence and Current State

### Current desktop-app evidence

- The current sidebar is rendered by `CodexSidebar` in `App.tsx`. It supports expanded and collapsed widths, a brand header, a collapsed new-chat icon, and an expanded `ThreadList`.
- `ThreadList.tsx` currently combines three concepts in one component:
  - a global new-thread button,
  - project groups built from `buildThreadProjectSections`,
  - assistant-ui's `ThreadListPrimitive.Items` for conversations.
- `threadProjectSections.ts` already derives pinned, local, remote, projectless, and current-path project groups from `ProjectState`, including counts and missing-root warnings. For this stage, pinned and remote branches are evidence of existing state shape, not required UI scope.
- `getThreadProjectBadge` already avoids using only the active project by resolving each thread from `threadProjectAssignments` through known thread ids.
- `ProjectSwitcher.tsx` currently exposes a popover with Current, Pinned, Local projects, Remote projects, and Other sections. For this stage, the sidebar should use only local/path/projectless entries.
- `useProjectState.ts` wraps `getState`, `pickWorkspaceRoot`, `createLocalProject`, and `selectProject`, but does not expose existing preload capabilities for `removeProject` or `renameProject`.
- `ProjectState` already stores:
  - local and remote projects,
  - project order,
  - pinned project ids,
  - thread-project assignments,
  - thread writable roots and workspace hints,
  - projectless thread ids and projectless hints.
- `DesktopProjectsApi` already exposes `removeProject` and `renameProject` at the shared IPC type level.
- `ProjectService` already resolves `ProjectSelection` into trusted `ResolvedExecutionTarget` values for new and resumed chats. It is the correct owner for cwd, workspace roots, workspace kind, and thread project assignment.
- `startConversation.ts` persists project assignment when a chat starts. `codexChatRuntimeService.ts` later normalizes that assignment from renderer chat id to the app-server thread id when provider metadata is available.
- `ElectronIpcChatTransport.ts` strips renderer-provided execution hints and adds only `projectSelection`, matching the intended trust boundary.
- `projectRuntimeServices.ts` implements projectless workspaces under Electron `userData`; this is lighter than the reference project's Documents/Codex work and output directory model.
- `WorkspaceFileSearchService.ts` currently searches active local/path project roots and returns no results for projectless/remote contexts.

### Reference project evidence

- The reference sidebar has top-level actions for New chat, Quick chat through an alternate modifier path, Search, Project navigation, Plugins/Skills, Pull requests, Automations, and other feature-gated nav entries. Search and auxiliary navigation are reference evidence only and are out of scope for this stage.
- Its project add flow presents "start from scratch", "use existing folder", and "remote project" options, including a remote-project coachmark. Remote project behavior is reference evidence only and is out of scope for this stage.
- Its projects section has an options menu with grouping controls:
  - By project,
  - By connection,
  - Recent projects,
  - Chronological list.
- It also exposes sort controls for Created and Updated ordering.
- Project rows support expansion/collapse, keyboard activation, hover actions, project-level new chat, and project-level actions.
- Project-level menus include rename, pin/unpin, mark all as read, archive chats, remove workspace root or remote project, and stable-worktree creation where applicable. This stage should carry forward rename, archive chats, and remove; pin/unpin, remote removal, and stable-worktree actions remain out of scope.
- Conversation actions in `thread-actions-Cs8S1-Cm.js` include archive, interrupt, rename, mark unread, copy working directory, copy session id, copy app link, and copy conversation as Markdown.
- The reference separates Pinned, Projects, Recent chats, and projectless Chats into distinct sections. This stage should use Projects and Chats only.
- Reference thread operations call host/app-server actions such as `archive-conversation`, `set-thread-title`, `mark-conversation-as-unread`, `search-threads-for-host`, and `set-pinned-thread-ids-for-host`. This stage should consider only archive, title, and unread/read style actions if the local runtime exposes them.
- The reference global state treats project data as first-class runtime/navigation state, not as a label attached to messages. It tracks local projects, remote projects, project order, pinned ids, per-project writable roots, thread project assignments, workspace root hints, projectless output directories, and projectless thread ids.
- The reference start-conversation path resolves a target before thread creation and passes cwd, workspace roots, workspace kind, project assignment, and projectless output directory metadata into the app-server path.
- The reference has host handlers for projectless cwd creation and per-project writable root add/remove/clear. Those details make project ownership durable across thread creation, sidebar grouping, and filesystem tools.

### Inference

- The current desktop-app has enough project-state scaffolding to support a fuller project list UI, but it lacks a first-class conversation index API and dedicated sidebar section model.
- The reference design's strongest transferable pattern is the information architecture, not its exact code:
  - top action rail,
  - separate Projects and Chats sections,
  - group and sort controls,
  - project row with inline expand/collapse plus actions menu,
  - conversation row with actions menu and assignment metadata.
- To support a complete conversation list, desktop-app should not rely solely on assistant-ui's in-memory `ThreadListPrimitive.Items`; it needs a main/preload-backed conversation index that can be filtered by project assignment, archived state, updated time, and title.
- A project is not only a conversation classification. In both the reference design and the current main-process scaffolding, it is also the execution target, workspace-root authority, filesystem-search boundary, sidebar grouping key, and persistent thread-assignment source.

### Current-to-reference Gap Analysis

- Keep `desktop-app/src/main/projects`. It already owns the right boundary for resolving project selection into trusted cwd/workspace roots and should be extended, not deleted. Deleting it would move execution authority toward renderer or duplicate app-server/provider protocol knowledge in the wrong layer.
- The largest missing piece is a conversation index. The reference builds the sidebar from persisted thread/project state and app-server operations; the current UI still leans on assistant-ui's in-memory `ThreadListPrimitive.Items`, with project badges layered on top.
- Current project execution alignment is stronger than the current UI alignment. `ProjectService`, `startConversation.ts`, `codexChatRuntimeService.ts`, and `ElectronIpcChatTransport.ts` already preserve the main-process runtime boundary, but the sidebar does not yet expose that state as a first-class project/conversation map.
- Current sidebar scope is broader than this design stage in a few places. `ProjectSwitcher`, `ProjectGate`, and `threadProjectSections` still include pinned or remote branches, while this stage explicitly excludes pinning and remote projects.
- Projectless support is partial. Current code can create a projectless execution target, but it does not yet mirror the reference model's richer projectless metadata, visible output directory behavior, or consistently populated projectless thread index.
- Per-project writable roots exist in state, but they are not yet exposed as a focused add/remove/clear capability. The reference treats writable roots as project-scoped runtime configuration, not only project metadata.
- Conversation actions are incomplete. The current desktop UI has assistant-ui archive/delete primitives; the reference uses host/app-server-backed archive, title rename, interrupt, unread state, copy cwd/session/app link, and copy Markdown actions.
- App-server already has many needed thread primitives, including list, read, archive, unarchive, and set-name behavior. The gap is a desktop main/preload conversation adapter and provider/app-server protocol coverage, not a need for renderer-owned protocol calls.

## Information Architecture

### Sidebar Layout

The expanded sidebar should use this vertical order:

1. Brand and primary actions
   - New chat
   - Optional quick/projectless chat behavior
2. Projects
   - Local projects.
   - Recent path-only workspace roots.
   - Missing roots remain visible with warning state.
3. Chats
   - Projectless chats.
   - Recent chats when chronological mode is selected.

The collapsed sidebar should keep only high-frequency icon buttons:

- New chat.
- Active section/project indicator if space allows.
- Toggle affordance remains in the main header.

### Section Semantics

- Projects:
  - Owns project list browsing and project-specific conversation lists.
  - A project is a one-to-many container: one project can have zero, one, or many conversations. By default, assigned conversation rows are grouped under their project.
  - Each project group row can be expanded/collapsed.
  - Project row primary click toggles the group; a secondary accessible action selects/shows the project home or makes it the active project.
- Chats:
  - Owns projectless and chronological conversation lists.
  - In chronological mode, it can replace project grouping with a single recent list.

### Modes

Sidebar organization should support these modes:

- By project: default. Groups conversations under project rows.
- Recent projects: still grouped by project, but project order follows most recent thread activity.
- Chronological list: no project grouping; show recent conversations with project badges.

## Design Principles

- Structure before density: keep sections explicit even when labels are short.
- Project identity is a first-class navigation object, not a badge-only annotation.
- Actions appear where the user expects them:
  - thread actions on thread rows,
  - project actions on project rows,
  - section actions in section headers.
- Every destructive or bulk operation needs confirmation or an undo-capable archive path.
- Use existing IPC, project service, assistant-ui primitives, and shadcn-style components before adding new abstractions.
- Keep renderer untrusted for runtime execution hints; main process validates project/thread actions.

## Visual Language

- Color:
  - Continue using existing tokenized `bg-background`, `bg-muted`, `text-muted-foreground`, `border-border`, and native backdrop classes.
  - Use warning amber only for missing roots.
  - Use destructive color only for remove/delete operations.
- Typography:
  - Sidebar section labels: small uppercase or muted label, consistent with current `ThreadProjectSections`.
  - Project row label: readable single line, secondary path/host suffix optional.
  - Conversation row: title first, muted metadata second.
- Spacing/layout rhythm:
  - Keep row heights stable, approximately 32px for primary nav/actions and conversation rows.
  - Project group headers may be slightly taller when showing host/path metadata.
- Shape/radius/elevation:
  - Use existing rounded-md/rounded-lg patterns.
  - Avoid nested card visuals inside the sidebar.
- Motion:
  - Expand/collapse may animate height, but must respect reduced motion.
  - Avoid animation for simple hover menus except opacity.
- Imagery/iconography:
  - Use lucide icons already present in the codebase.
  - Folder/project, plus, archive, trash, more, and warning icons should have tooltips or aria labels.

## Components

### Existing Components to Reuse

- `CodexSidebar` for sidebar shell and collapsed/expanded state.
- `ProjectSwitcher` for header-level project switcher. It should remain a compact active-context picker, not become the full sidebar.
- `ProjectGate` for empty composer project selection.
- `useProjectState` and `CreateLocalProjectDialog` for project state subscription, local project creation, active project labels, and safe renderer-to-preload project intents.
- Existing `Button`, `Dialog`, `Popover`, `Command`, and `Tooltip` UI primitives.
- `ThreadListItemPrimitive` and `ThreadListPrimitive.New` where they still fit assistant-ui's runtime model.

### Renderer Project Module Boundary

- `desktop-app/src/renderer/src/projects` remains needed for project selection and setup flows. The new sidebar should not duplicate project authority in a separate renderer store.
- `useProjectState` should become the shared renderer adapter for project state and project actions used by the header switcher, project gate, composer context, mention search, and sidebar project section.
- `ProjectSwitcher` should be narrowed to a compact active-context switcher. It should not continue to expose a full project browser with pinned, remote, or secondary project sections for this stage.
- `ProjectGate` remains the empty-state setup flow for users who have not selected where Codex should work. It should align with this stage's local/path/projectless scope.
- Sidebar-specific grouping, conversation counts, collapsed groups, sorting preferences, and conversation rows belong in the sidebar state/model layer, not in the generic `projects` components.
- Main/preload remain the source of truth for project mutations. Renderer project components send intents such as create, select, rename, or remove; they do not resolve trusted cwd or workspace roots themselves.

### New or Changed Components

- `SidebarRoot`
  - Owns layout sections and receives project/conversation state.
- `SidebarPrimaryActions`
  - New chat and optional quick chat.
- `SidebarProjectsSection`
  - Section header, add project, options menu, group/sort controls, local/path groups.
- `ProjectGroupRow`
  - Expand/collapse, select project, start new chat in project, actions menu, missing-root state.
- `ProjectConversationList`
  - Conversation rows filtered by project id or path assignment.
- `SidebarChatsSection`
  - Projectless and chronological recent conversations.
- `ConversationRow`
  - Title, status, project badge, updated/created metadata, running indicator, unread marker, actions menu.

### Variants and States

- Sidebar:
  - expanded,
  - collapsed,
  - loading,
  - empty,
  - offline/app-server unavailable.
- Section:
  - collapsed,
  - expanded,
  - empty,
  - loading,
  - drag-over future state.
- Project row:
  - active project,
  - expanded/collapsed,
  - missing root,
  - hover/focus/menu-open.
- Conversation row:
  - active conversation,
  - running,
  - unread,
  - archived hidden by default,
  - selected/focused,
  - hover/menu-open.

## Functional Requirements

### Project List

- Show local projects ordered by `projectOrder`.
- Show recent path-only workspace roots from `workspaceRootOptions`.
- Show missing roots with a warning icon and explanatory tooltip.
- Do not surface pinned or remote project controls in this stage, even though state fields and reference behavior exist.
- Support selecting a project.
- Support creating a local project.
- Support opening an existing folder as a path project.
- Support rename project through existing IPC.
- Support remove project through existing IPC.
- Support archive all project conversations. Requires conversation archive API or adapter.
- Support start new chat in project. The request body should include `projectSelection`, letting main process resolve execution target.

### Conversation List

- Show conversations from a main-process conversation index, not only assistant-ui in-memory runtime.
- Merge app-server thread metadata with `ProjectState.threadProjectAssignments`, workspace root hints, and projectless metadata before grouping rows.
- Each conversation item should include:
  - stable id,
  - title,
  - project assignment,
  - created/updated time,
  - running/loading status if known,
  - archived state,
  - unread state if supported,
  - cwd/workspace roots metadata if available.
- Support opening/resuming an existing conversation by id.
- Support archive/unarchive.
- Support delete only if app-server supports irreversible delete and the product explicitly wants it. Prefer archive as the primary removal action.
- Support rename title.
- Support interrupt for running conversations.
- Support mark unread/read if supported.
- Support copy session id/app link/working directory when metadata exists.
- Support copy conversation as Markdown when transcript retrieval exists.

### Filtering, Sorting, and Grouping

- Default grouping: By project.
- Optional grouping:
  - Recent projects,
  - Chronological list.
- Sort conversations by:
  - Updated, default,
  - Created.
- Persist user preferences in a sidebar UI state store, not in project runtime state.
- Collapse/expand state should be persisted per section/group.

## Data and API Design

### Keep Existing Boundary

- Renderer may request project/conversation operations through preload only.
- Renderer desktop capability access should use one stable preload namespace, `window.desktopApp`, with domain children such as `codex`, `chat`, `projects`, and future `conversations`. Do not add UI-specific globals such as `window.desktopSidebar`.
- Main process validates payloads with shared Zod schemas.
- Provider fork keeps AI SDK to Codex App Server Protocol mapping.
- Chat execution continues through `window.desktopApp.chat.startChatStream` -> main -> AI SDK provider -> Codex app server.
- Renderer must not send trusted cwd/workspace roots directly; current `ElectronIpcChatTransport` strips renderer execution hints and adds only validated `projectSelection`.

### Conversation Adapter Boundary

- Add a main/preload conversation adapter backed by app-server thread primitives where possible: list, read, archive, unarchive, set title, and interrupt.
- Keep app-server protocol details out of renderer. If new protocol messages are required, add them through the provider/main boundary or a main-owned app-server client, not as renderer JSON-RPC calls.
- The adapter should join app-server thread rows with `ProjectState` assignment data so the sidebar can answer both "what is this conversation?" and "where does it run?"
- The adapter should tolerate missing app-server metadata. If created/updated/unread/cwd fields are unavailable for a row, the UI should hide only the dependent affordance and keep the row navigable.
- The first implementation should prefer archive over irreversible delete and should avoid search, pinning, remote, and stable-worktree actions.

### Proposed Shared Types

```ts
export type SidebarConversation = {
  id: string
  threadId?: string
  title: string | null
  projectAssignment?: ThreadProjectAssignment
  createdAt?: string
  updatedAt?: string
  archived?: boolean
  unread?: boolean
  running?: boolean
  cwd?: string | null
}

export type SidebarConversationListState = {
  conversations: SidebarConversation[]
  archivedConversationIds?: string[]
  loaded: boolean
  error?: string
}

export type SidebarPreferences = {
  organizeMode: 'project' | 'recent-projects' | 'chronological'
  sortKey: 'updated_at' | 'created_at'
  collapsedSectionIds: string[]
  collapsedGroupIds: string[]
}
```

### Proposed IPC Surface

```ts
type DesktopSidebarApi = {
  getConversationList(): Promise<SidebarConversationListState>
  refreshConversationList(): Promise<SidebarConversationListState>
  openConversation(input: { conversationId: string }): Promise<void>
  archiveConversation(input: { conversationId: string }): Promise<SidebarConversationListState>
  unarchiveConversation(input: { conversationId: string }): Promise<SidebarConversationListState>
  renameConversation(input: { conversationId: string; title: string }): Promise<SidebarConversationListState>
  interruptConversation(input: { conversationId: string }): Promise<void>
  getPreferences(): Promise<SidebarPreferences>
  setPreferences(input: Partial<SidebarPreferences>): Promise<SidebarPreferences>
  onConversationListChange(callback: (state: SidebarConversationListState) => void): () => void
}
```

The conversation APIs should be backed by the app-server/runtime thread store where available. If app-server exposes only partial metadata, ship an MVP with title/id/projectAssignment/updatedAt and mark other row affordances unavailable.

## Accessibility

- Target standard: keyboard navigable and screen-reader understandable for all sidebar actions.
- Keyboard/focus behavior:
  - Section headers are buttons with `aria-expanded`.
  - Project rows are focusable and announce label, host/path suffix, and missing-root state.
  - Conversation rows are buttons or links with active state.
  - Actions menus use menu semantics and do not steal focus on close.
- Contrast/readability:
  - Muted metadata must remain readable in light/dark mode.
  - Warning/destructive states must not rely on color only.
- Screen-reader semantics:
  - Use labelled lists for Projects and Chats.
  - Counts should be included in labels or visually hidden text when useful.
- Reduced motion:
  - Collapse/expand animations disabled or simplified under reduced motion.

## Responsive Behavior

- Supported breakpoints/devices:
  - Desktop primary.
  - Existing `md:flex` behavior means mobile/narrow sidebar can remain hidden until mobile layout is designed.
- Layout adaptations:
  - Expanded sidebar width should remain stable.
  - Collapsed sidebar keeps icon-only primary actions.
  - Long project paths truncate in row, full path appears in tooltip.
- Touch/hover differences:
  - Hover-only action buttons must also appear on focus and menu-open.
  - Touch should reveal row actions through long press only if implemented intentionally; MVP should keep actions accessible through visible or focusable menu buttons.

## Interaction States

- Loading:
  - Skeleton or muted "Loading projects" and "Loading chats" rows.
- Empty:
  - No projects: show Add project and Open folder.
  - No project conversations: show Start new chat in this project.
  - No projectless chats: show Start projectless chat.
- Error:
  - Project state error: retry, keep existing stale data if available.
  - Conversation index error: show retry and keep project list usable.
- Success:
  - Rename/remove/archive updates list immediately after main confirms.
- Disabled:
  - Archive-all disabled when there are no archiveable conversations.
- Offline/slow runtime:
  - Project list remains available from persisted state.
  - Conversation actions needing app-server show disabled or retryable state.

## Content Voice

- Tone: concise, concrete, developer-facing.
- Terminology:
  - Use "Project" for local/path work containers.
  - Use "Chat" or "Conversation" consistently in UI. Current UI says "New thread" and "New Chat"; choose "New chat" for user-facing copy.
  - Use "Projectless" only where necessary; "Quick chat" can be friendlier for starting projectless work.
- Microcopy rules:
  - Prefer action labels: "New chat", "Rename project", "Archive chats", "Remove".
  - Warnings explain the recovery path: "This project folder was deleted or moved".

## Implementation Constraints

- Framework/styling system:
  - React renderer, assistant-ui runtime, AI SDK UI runtime.
  - Tailwind-style utility classes and existing shadcn-like UI primitives.
- Design-token constraints:
  - Use existing CSS variables in `globals.css`; do not add a new design-token layer for this feature.
- Performance constraints:
  - Conversation list should be computed in main/runtime and sent as compact metadata.
  - Avoid rendering all archived or hidden conversations by default.
- Compatibility constraints:
  - Preserve existing chat start/resume path through Codex app server.
  - Do not expose provider credentials, headers, or model config to renderer.
- Test/screenshot expectations:
  - Unit tests for project grouping, conversation grouping, sorting, counts, missing roots.
  - Renderer tests for sidebar sections, actions menus, empty/loading/error states.
  - Main/preload tests for new IPC schemas and state mutation.
  - E2E smoke for selecting project -> starting chat -> conversation appears under that project.

## Recommended Delivery Plan

1. Data foundation
   - Add `DesktopSidebarApi` or extend existing project/chat APIs with conversation list state.
   - Add an app-server-backed conversation adapter in main/preload.
   - Normalize conversation id vs thread id assignment in one place.
   - Join app-server thread metadata with `ProjectState.threadProjectAssignments` and projectless metadata.
   - Add IPC schemas and tests.
2. Sidebar state model
   - Add selectors for projects, chats, recent, grouped, sorted, and filtered views.
   - Keep pure grouping functions unit-tested.
3. Component split
   - Split `ThreadList` into primary actions, projects section, chats section, and reusable row components.
   - Keep `ProjectSwitcher` as the header active-context picker.
   - Hide pinned and remote project UI paths for this stage.
4. Actions
   - Wire rename/remove project through existing IPC wrappers.
   - Add archive/rename conversation actions as runtime support allows.
5. Polish
   - Add keyboard/focus QA and reduced-motion behavior.
6. E2E validation
   - Verify project selection, new chat in project, projectless chat, conversation re-open, archive, and rename flows.

## Open Questions

- [ ] Should the desktop conversation adapter call app-server thread primitives through provider extensions or through a main-owned app-server client wrapper?
- [ ] Which app-server thread metadata fields are stable enough for the MVP sidebar: created time, updated time, archived state, running status, cwd, unread state?
- [ ] Should irreversible Delete remain in UI, or should Archive be the only default removal action?
- [ ] Should "Projectless" be user-facing, or should the UI call it "Quick chats" while preserving `projectless` as an internal model name?
