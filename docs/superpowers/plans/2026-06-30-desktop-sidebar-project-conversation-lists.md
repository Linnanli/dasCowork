# Desktop Sidebar Project Conversation Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the desktop left sidebar as a first-class map of local projects, path workspaces, quick chats, and recent conversations while preserving the Codex app-server execution boundary.

**Architecture:** Electron main owns conversation metadata by calling app-server thread primitives through a main-owned app-server client and joining those rows with persisted `ProjectState`. `ProjectState` and `ProjectService` remain the source of truth for project/workspace selection, cwd, writable roots, and `threadProjectAssignments`; they decide where a conversation runs. `CodexChatRuntimeService` remains the owner of active chat execution, provider streams, abort controllers, and live turn interruption; it decides how a conversation opens, continues, or stops. The renderer consumes typed `window.desktopApp.conversations`, pure sidebar view-model selectors, and the existing assistant-ui/AI SDK runtime. Chat execution continues through the existing assistant-ui -> preload -> main -> AI SDK provider -> Codex app-server stream path.

**Tech Stack:** Electron, React 19, TypeScript, Vitest/jsdom, zod, assistant-ui primitives, lucide-react, Tailwind utility classes, Codex app-server JSON-RPC.

---

## Scope Check

This plan covers one subsystem: `desktop-app` sidebar project and conversation list behavior. It includes the main/preload conversation adapter, renderer sidebar state model, component split, project actions, conversation archive/rename/open/interrupt actions, and focused verification.

Resolved product choices for this stage:

- Use "Quick chats" as the user-facing label for projectless chats; keep `projectless` as the internal model name.
- Keep Archive as the only removal action for conversations. Do not render irreversible Delete in the sidebar.
- Hide pinned projects, remote projects, search, plugins, skills, pull requests, automations, stable worktrees, and feature gates.
- Use a main-owned `AppServerThreadClient` wrapper for stored thread metadata/actions: `thread/list`, `thread/read`, `thread/archive`, `thread/unarchive`, and `thread/name/set`. Do not add renderer JSON-RPC calls.
- Do not send `turn/interrupt` from a fresh sidebar app-server process. Live interruption must go through `CodexChatRuntimeService`, because the active provider stream owns the current `{ threadId, turnId }` and abort controller.
- Opening a conversation is not a no-op. `openConversation` must read persisted turns, return UI messages plus the resolved project assignment, update the renderer's active conversation context, and make the next send resume the selected app-server thread.
- Preserve the workspace concept explicitly: project rows select `ProjectSelection`; project chats start with that selection; existing conversations resolve their workspace from `ProjectState.threadProjectAssignments` first, then app-server thread cwd fallback.

Resolved edge-case behavior for this stage:

- Opening an existing conversation automatically switches the visible project context to that conversation's resolved workspace. This keeps the sidebar selection, composer context, and app-server execution cwd aligned.
- If a conversation is assigned to a local project that still exists, select that local project.
- If the assigned local project was removed but the thread still has a cwd or workspace root hint, show and select it as a path workspace fallback. If the path no longer exists, keep the conversation readable and mark the workspace as missing; sending must be blocked until the user selects or recreates a valid workspace.
- Removing a project removes only the project entry. It must not archive, delete, or hide historical app-server threads. Those conversations fall back to path workspace grouping when possible.
- Quick chats remain `projectless` internally and get a local projectless workspace. Quick chats may create files in that generated workspace; they are not pure in-memory chats.
- If a projectless workspace directory is missing when reopening a quick chat, keep the history readable and block sending until a new projectless workspace is created or the user selects another valid workspace.
- Continuing an existing conversation uses the currently selected desktop model unless the user changes model behavior later. The app resumes the same app-server thread id, but the active model selector still controls the next turn's model override.

## Layer Contract

- `ProjectState` / `ProjectService`: owns local/path/projectless/remote project selections, workspace roots, cwd resolution, projectless workspaces, and thread-to-project assignment persistence.
- `ConversationApiService`: owns sidebar metadata state by joining app-server thread rows with `ProjectState`; handles archive, unarchive, rename, and persisted-thread reads for open.
- `CodexChatRuntimeService`: owns live streams, active thread/turn tracking, abort/interrupt behavior, and resume execution context.
- `useCodexIpcAssistantRuntime` / `ElectronIpcChatTransport`: owns renderer chat state; it sets opened history messages into `useChat`, tracks the active `{ conversationId, threadId }`, and sends that context on subsequent messages.
- Sidebar components: emit user intent only: select project, start a new chat in a project, open conversation, archive/rename conversation, interrupt live conversation, and refresh.

## File Structure

- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/shared/codexIpcApi.ts`
  - Adds `SidebarConversation`, `SidebarConversationListState`, `SidebarPreferences`, zod payload schemas, and `DesktopConversationsApi`.
  - Keeps shared types secret-free and renderer-safe.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/shared/codexIpcApi.test.ts`
  - Verifies conversation action schemas reject empty ids/titles and preference patches accept only supported modes.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/AppServerThreadClient.ts`
  - Owns main-process app-server JSON-RPC requests for stored thread metadata and stored-thread actions.
  - Uses app-server protocol names exactly: `thread/name/set`, snake_case sort keys, and `turn/interrupt` is intentionally excluded.
  - Parses only the stable fields required by the sidebar.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/AppServerThreadClient.test.ts`
  - Uses fake app-server client/transport factories to verify initialization, pagination, action methods, and field normalization.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/ConversationApiService.ts`
  - Joins app-server thread rows with `ProjectStore` state into `SidebarConversationListState`.
  - Reads a selected stored thread with turns and maps it into a renderer-safe `SidebarConversationOpenResult`.
  - Owns sidebar preferences in memory for this stage.
  - Emits state after archive, unarchive, rename, and refresh.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/ConversationApiService.test.ts`
  - Verifies local/path/projectless assignment joins, archived filtering, running status, safe fallbacks, and preference merging.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/index.ts`
  - Wires `ConversationApiService`, IPC handlers, and `codex:conversations-state-change` broadcasts.
  - Routes `codex:conversations:interrupt` to `CodexChatRuntimeService.interruptConversation()` instead of `AppServerThreadClient`.
  - Broadcasts conversation refresh after chat stream completion or failure.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.ts`
  - Tracks active app-server `threadId`, active `turnId`, current stream id, and abort controller from provider metadata.
  - Exposes safe methods for sidebar interruption and for querying whether a conversation is currently running.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider-settings.ts`
  - Adds an explicit, provider-owned `resumeThreadId` call option for continuing an existing app-server thread.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts`
  - Makes resume selection prefer `callOptions.resumeThreadId` before falling back to provider metadata in historical assistant messages.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts`
  - Exposes `openConversation` support that calls the conversation API, sets `useChat` messages, and records the active conversation context for the transport.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts`
  - Includes the active `{ conversationId, threadId }` in trusted request body when continuing an opened conversation.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/preload/index.ts`
  - Exposes `window.desktopApp.conversations` under the existing stable namespace.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/preload/index.d.ts`
  - Adds `DesktopConversationsApi` to `DesktopAppApi` so renderer typecheck sees `window.desktopApp.conversations`.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/projects/useProjectState.ts`
  - Adds wrappers for existing `renameProject` and `removeProject`.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/projects/useProjectState.test.tsx`
  - Verifies rename/remove wrappers update local state.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarTypes.ts`
  - Defines renderer-only sidebar group and row view-model types.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarModel.ts`
  - Pure selectors for local/path projects, quick chats, grouped conversations, recent-project ordering, chronological ordering, missing roots, counts, and collapsed state.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarModel.test.ts`
  - Unit coverage for grouping, sorting, counts, hiding remote/pinned UI, missing roots, and archived defaults.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/useConversationState.ts`
  - Renderer hook for initial conversation state, live updates, refresh, actions, and preferences.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarRoot.tsx`
  - Expanded sidebar layout: primary actions, projects section, chats section.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarPrimaryActions.tsx`
  - New chat and quick chat actions.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarProjectsSection.tsx`
  - Local/path project rows, add/open actions, group controls, rename/remove/archive chats menus.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarChatsSection.tsx`
  - Quick chats and chronological recent conversations.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/ConversationRow.tsx`
  - Conversation row title, metadata, active/running state, project badge, and actions menu.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/ProjectGroupRow.tsx`
  - Expand/collapse row, select project, start project chat, missing-root state, actions menu.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarRoot.test.tsx`
  - jsdom render tests for sections, empty/loading/error states, accessible labels, action callbacks, and no Delete action.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/threads/ThreadList.tsx`
  - Shrinks to assistant-ui primitive compatibility wrappers only if still needed by tests; sidebar UI moves to `sidebar/`.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.tsx`
  - Uses `SidebarRoot` in `CodexSidebar`.
  - Keeps collapsed sidebar icon-only behavior.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.test.tsx`
  - Updates expectations from mixed `ThreadList` sections to split sidebar sections.

## Task 1: Shared Conversation IPC Contract

**Files:**
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/shared/codexIpcApi.test.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/shared/codexIpcApi.ts`

- [ ] **Step 1: Write failing shared schema tests**

Add these imports in `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/shared/codexIpcApi.test.ts`:

```ts
import {
  sidebarConversationActionPayloadSchema,
  sidebarConversationRenamePayloadSchema,
  sidebarConversationOpenResultSchema,
  sidebarPreferencesPatchSchema
} from './codexIpcApi'
```

Add these tests inside the existing `describe('codex IPC schemas', () => { ... })` block:

```ts
it('validates conversation action payloads', () => {
  expect(sidebarConversationActionPayloadSchema.safeParse({ conversationId: 'thread-1' }).success).toBe(
    true
  )
  expect(sidebarConversationActionPayloadSchema.safeParse({ conversationId: '' }).success).toBe(
    false
  )
})

it('validates conversation rename payloads', () => {
  expect(
    sidebarConversationRenamePayloadSchema.safeParse({
      conversationId: 'thread-1',
      title: 'Investigate provider lifecycle'
    }).success
  ).toBe(true)
  expect(
    sidebarConversationRenamePayloadSchema.safeParse({
      conversationId: 'thread-1',
      title: '   '
    }).success
  ).toBe(false)
})

it('validates conversation open results', () => {
  expect(
    sidebarConversationOpenResultSchema.safeParse({
      conversationId: 'thread-1',
      threadId: 'thread-1',
      messages: [],
      projectAssignment: {
        projectKind: 'projectless',
        cwd: '/tmp/dascowork/thread-1',
        workspaceRoot: '/tmp/dascowork/thread-1',
        outputDirectory: '/tmp/dascowork/thread-1/out'
      }
    }).success
  ).toBe(true)
  expect(sidebarConversationOpenResultSchema.safeParse({ conversationId: '' }).success).toBe(false)
})

it('validates sidebar preference patches', () => {
  expect(
    sidebarPreferencesPatchSchema.safeParse({
      organizeMode: 'chronological',
      sortKey: 'created_at',
      collapsedSectionIds: ['projects'],
      collapsedGroupIds: ['local:project-1']
    }).success
  ).toBe(true)
  expect(sidebarPreferencesPatchSchema.safeParse({ organizeMode: 'remote' }).success).toBe(false)
  expect(sidebarPreferencesPatchSchema.safeParse({ sortKey: 'name' }).success).toBe(false)
})
```

- [ ] **Step 2: Run shared schema tests to verify they fail**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/shared/codexIpcApi.test.ts
```

Expected:

```text
FAIL  src/shared/codexIpcApi.test.ts
Error: No export is defined for sidebarConversationActionPayloadSchema
```

- [ ] **Step 3: Add shared sidebar conversation types and schemas**

In `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/shared/codexIpcApi.ts`, extend the existing project type import:

```ts
import type {
  LocalProject,
  ProjectSelection,
  ProjectState,
  RemoteProject,
  ThreadProjectAssignment,
  WorkspaceFileSearchResult,
  WorkspaceRootOption
} from './projects/projectTypes'
```

Add these types after `CodexModelList`:

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
  archivedConversationIds: string[]
  loaded: boolean
  error?: string
}

export type SidebarPreferences = {
  organizeMode: 'project' | 'recent-projects' | 'chronological'
  sortKey: 'updated_at' | 'created_at'
  collapsedSectionIds: string[]
  collapsedGroupIds: string[]
}

export type SidebarConversationActionPayload = {
  conversationId: string
}

export type SidebarConversationRenamePayload = SidebarConversationActionPayload & {
  title: string
}

export type SidebarConversationOpenResult = {
  conversationId: string
  threadId: string
  title: string | null
  messages: UIMessage[]
  projectAssignment?: ThreadProjectAssignment
  cwd?: string | null
}
```

Add these schemas after `workspaceFileSearchPayloadSchema`:

```ts
export const sidebarConversationActionPayloadSchema = z.object({
  conversationId: z.string().min(1)
})

export const sidebarConversationRenamePayloadSchema = sidebarConversationActionPayloadSchema.extend({
  title: z.string().trim().min(1).max(120)
})

export const sidebarConversationOpenResultSchema = z.object({
  conversationId: z.string().min(1),
  threadId: z.string().min(1),
  title: z.string().nullable(),
  messages: z.array(z.custom<UIMessage>(isUiMessage)),
  projectAssignment: z.custom<ThreadProjectAssignment>().optional(),
  cwd: z.string().nullable().optional()
}) satisfies z.ZodType<SidebarConversationOpenResult>

export const sidebarPreferencesSchema = z.object({
  organizeMode: z.enum(['project', 'recent-projects', 'chronological']),
  sortKey: z.enum(['updated_at', 'created_at']),
  collapsedSectionIds: z.array(z.string()),
  collapsedGroupIds: z.array(z.string())
}) satisfies z.ZodType<SidebarPreferences>

export const sidebarPreferencesPatchSchema = sidebarPreferencesSchema.partial()
```

Add this API type after `DesktopCodexChatApi`:

```ts
export type DesktopConversationsApi = {
  getConversationList(): Promise<SidebarConversationListState>
  refreshConversationList(): Promise<SidebarConversationListState>
  openConversation(input: SidebarConversationActionPayload): Promise<SidebarConversationOpenResult>
  archiveConversation(input: SidebarConversationActionPayload): Promise<SidebarConversationListState>
  unarchiveConversation(input: SidebarConversationActionPayload): Promise<SidebarConversationListState>
  renameConversation(input: SidebarConversationRenamePayload): Promise<SidebarConversationListState>
  interruptConversation(input: SidebarConversationActionPayload): Promise<void>
  getPreferences(): Promise<SidebarPreferences>
  setPreferences(input: Partial<SidebarPreferences>): Promise<SidebarPreferences>
  onConversationListChange(callback: (state: SidebarConversationListState) => void): () => void
}
```

- [ ] **Step 4: Run shared schema tests to verify they pass**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/shared/codexIpcApi.test.ts
```

Expected:

```text
PASS  src/shared/codexIpcApi.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add /Users/nallylin/Documents/code/dasCowork/desktop-app/src/shared/codexIpcApi.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/shared/codexIpcApi.test.ts
git commit -m "feat: add sidebar conversation ipc contract"
```

## Task 2: Main App-Server Thread Client

**Files:**
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/AppServerThreadClient.test.ts`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/AppServerThreadClient.ts`

- [ ] **Step 1: Write failing app-server thread client tests**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/AppServerThreadClient.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { AppServerThreadClient, type AppServerJsonRpcClientLike } from './AppServerThreadClient'

function createJsonRpcClient(responses: Record<string, unknown>): AppServerJsonRpcClientLike {
  const client: AppServerJsonRpcClientLike = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    notification: vi.fn(async () => undefined),
    request: vi.fn(async (method: string) => {
      const response = responses[method]
      if (response === undefined) throw new Error(`unexpected method ${method}`)
      return response
    })
  }
  return client
}

describe('AppServerThreadClient', () => {
  it('initializes the app-server client before listing threads', async () => {
    const jsonRpc = createJsonRpcClient({
      initialize: {},
      'thread/list': {
        data: [
          {
            id: 'thread-1',
            sessionId: 'thread-1',
            name: 'Provider work',
            preview: 'Investigate provider',
            createdAt: 1782777600,
            updatedAt: 1782777900,
            status: { state: 'idle' },
            cwd: '/repo/app'
          }
        ],
        nextCursor: null
      }
    })
    const client = new AppServerThreadClient({
      createClient: () => jsonRpc
    })

    await expect(client.listThreads({ includeArchived: false })).resolves.toEqual([
      {
        id: 'thread-1',
        title: 'Provider work',
        preview: 'Investigate provider',
        createdAt: '2026-06-29T18:40:00.000Z',
        updatedAt: '2026-06-29T18:45:00.000Z',
        archived: false,
        running: false,
        cwd: '/repo/app'
      }
    ])

    expect(jsonRpc.connect).toHaveBeenCalledOnce()
    expect(jsonRpc.request).toHaveBeenNthCalledWith(
      1,
      'initialize',
      expect.objectContaining({
        clientInfo: expect.objectContaining({ name: 'dascowork_desktop_sidebar' })
      })
    )
    expect(jsonRpc.notification).toHaveBeenCalledWith('initialized')
    expect(jsonRpc.request).toHaveBeenCalledWith(
      'thread/list',
      expect.objectContaining({ archived: false, sortKey: 'updated_at', sortDirection: 'desc' })
    )
    expect(jsonRpc.disconnect).toHaveBeenCalledOnce()
  })

  it('falls back from empty names to previews and paginates thread/list', async () => {
    const jsonRpc: AppServerJsonRpcClientLike = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      notification: vi.fn(async () => undefined),
      request: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          data: [
            {
              id: 'thread-1',
              name: null,
              preview: 'First prompt',
              createdAt: 1782777600,
              updatedAt: 1782777800,
              status: { state: 'running' },
              cwd: '/repo/a'
            }
          ],
          nextCursor: 'cursor-1'
        })
        .mockResolvedValueOnce({
          data: [
            {
              id: 'thread-2',
              name: '',
              preview: '',
              createdAt: 1782777900,
              updatedAt: 1782777900,
              status: { state: 'idle' },
              cwd: null
            }
          ],
          nextCursor: null
        })
    }
    const client = new AppServerThreadClient({ createClient: () => jsonRpc })

    await expect(client.listThreads({ includeArchived: true })).resolves.toEqual([
      {
        id: 'thread-1',
        title: 'First prompt',
        preview: 'First prompt',
        createdAt: '2026-06-29T18:40:00.000Z',
        updatedAt: '2026-06-29T18:43:20.000Z',
        archived: false,
        running: true,
        cwd: '/repo/a'
      },
      {
        id: 'thread-2',
        title: null,
        preview: '',
        createdAt: '2026-06-29T18:45:00.000Z',
        updatedAt: '2026-06-29T18:45:00.000Z',
        archived: false,
        running: false,
        cwd: null
      }
    ])

    expect(jsonRpc.request).toHaveBeenCalledWith(
      'thread/list',
      expect.objectContaining({ cursor: 'cursor-1', archived: true })
    )
  })

  it('sends archive, unarchive, set name, and read requests', async () => {
    const jsonRpc = createJsonRpcClient({
      initialize: {},
      'thread/archive': {},
      'thread/unarchive': {},
      'thread/name/set': {},
      'thread/read': {
        thread: {
          id: 'thread-1',
          name: 'Renamed',
          preview: 'Prompt',
          createdAt: 1782777600,
          updatedAt: 1782777900,
          status: { state: 'idle' },
          cwd: '/repo/app'
        }
      }
    })
    const client = new AppServerThreadClient({ createClient: () => jsonRpc })

    await client.archiveThread('thread-1')
    await client.unarchiveThread('thread-1')
    await client.renameThread('thread-1', 'Renamed')
    await client.readThread('thread-1')

    expect(jsonRpc.request).toHaveBeenCalledWith('thread/archive', { threadId: 'thread-1' })
    expect(jsonRpc.request).toHaveBeenCalledWith('thread/unarchive', { threadId: 'thread-1' })
    expect(jsonRpc.request).toHaveBeenCalledWith('thread/name/set', {
      threadId: 'thread-1',
      name: 'Renamed'
    })
    expect(jsonRpc.request).toHaveBeenCalledWith('thread/read', {
      threadId: 'thread-1',
      includeTurns: false
    })
  })
})
```

- [ ] **Step 2: Run app-server thread client tests to verify they fail**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/conversations/AppServerThreadClient.test.ts
```

Expected:

```text
FAIL  src/main/conversations/AppServerThreadClient.test.ts
Error: Failed to resolve import "./AppServerThreadClient"
```

- [ ] **Step 3: Implement app-server thread client**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/AppServerThreadClient.ts`:

```ts
import { AppServerClient, StdioTransport } from '@janole/ai-sdk-provider-codex-asp'
import { z } from 'zod'

import type { CodexAppServerLaunchOptions } from '../codexAppServerLaunch'

export type AppServerThreadRow = {
  id: string
  title: string | null
  preview: string
  createdAt?: string
  updatedAt?: string
  archived: boolean
  running: boolean
  cwd: string | null
  turns?: unknown[]
}

export type AppServerJsonRpcClientLike = {
  connect(): Promise<void>
  disconnect(): Promise<void>
  notification(method: string, params?: unknown): Promise<void>
  request<T = unknown>(method: string, params?: unknown): Promise<T>
}

export type AppServerThreadClientOptions = {
  launch?: CodexAppServerLaunchOptions
  createClient?: () => AppServerJsonRpcClientLike
}

const threadStatusSchema = z
  .object({
    state: z.string().optional()
  })
  .catchall(z.unknown())
  .optional()

const appServerThreadSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable().optional(),
    preview: z.string().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    archivedAt: z.number().nullable().optional(),
    archived_at: z.number().nullable().optional(),
    status: threadStatusSchema,
    cwd: z.string().nullable().optional(),
    turns: z.array(z.unknown()).optional()
  })
  .catchall(z.unknown())

const threadListResponseSchema = z.object({
  data: z.array(appServerThreadSchema),
  nextCursor: z.string().nullable().optional()
})

const threadReadResponseSchema = z.object({
  thread: appServerThreadSchema
})

export class AppServerThreadClient {
  constructor(private readonly options: AppServerThreadClientOptions) {}

  async listThreads(input: {
    includeArchived: boolean
    sortKey?: 'updated_at' | 'created_at'
  }): Promise<AppServerThreadRow[]> {
    return this.withClient(async (client) => {
      const rows: AppServerThreadRow[] = []
      let cursor: string | undefined

      do {
        const response = threadListResponseSchema.parse(
          await client.request('thread/list', {
            cursor,
            limit: 100,
            archived: input.includeArchived,
            sortKey: input.sortKey === 'created_at' ? 'created_at' : 'updated_at',
            sortDirection: 'desc'
          })
        )
        rows.push(...response.data.map(toThreadRow))
        cursor = response.nextCursor ?? undefined
      } while (cursor)

      return rows
    })
  }

  async readThread(threadId: string, input: { includeTurns?: boolean } = {}): Promise<AppServerThreadRow> {
    return this.withClient(async (client) => {
      const response = threadReadResponseSchema.parse(
        await client.request('thread/read', { threadId, includeTurns: input.includeTurns ?? false })
      )
      return toThreadRow(response.thread)
    })
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.withClient((client) => client.request('thread/archive', { threadId }))
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await this.withClient((client) => client.request('thread/unarchive', { threadId }))
  }

  async renameThread(threadId: string, name: string): Promise<void> {
    await this.withClient((client) => client.request('thread/name/set', { threadId, name }))
  }

  private async withClient<T>(callback: (client: AppServerJsonRpcClientLike) => Promise<T>): Promise<T> {
    const client = this.createClient()
    await client.connect()
    try {
      await client.request('initialize', {
        clientInfo: {
          name: 'dascowork_desktop_sidebar',
          title: 'dasCowork Desktop Sidebar',
          version: '1.0.0'
        },
        capabilities: { experimentalApi: true }
      })
      await client.notification('initialized')
      return await callback(client)
    } finally {
      await client.disconnect()
    }
  }

  private createClient(): AppServerJsonRpcClientLike {
    if (this.options.createClient) return this.options.createClient()
    if (!this.options.launch) throw new Error('Codex app-server launch options are required')
    return new AppServerClient(
      new StdioTransport({
        command: this.options.launch.command,
        args: this.options.launch.args,
        cwd: this.options.launch.cwd,
        env: this.options.launch.env
      })
    )
  }
}

function toThreadRow(thread: z.infer<typeof appServerThreadSchema>): AppServerThreadRow {
  const title = cleanTitle(thread.name) ?? cleanTitle(thread.preview) ?? null
  return {
    id: thread.id,
    title,
    preview: thread.preview ?? '',
    createdAt: fromUnixSeconds(thread.createdAt),
    updatedAt: fromUnixSeconds(thread.updatedAt),
    archived: Boolean(thread.archivedAt ?? thread.archived_at),
    running: thread.status?.state === 'running' || thread.status?.state === 'active',
    cwd: thread.cwd ?? null,
    ...(thread.turns ? { turns: thread.turns } : {})
  }
}

function cleanTitle(value: string | null | undefined): string | null {
  const title = value?.trim()
  return title ? title : null
}

function fromUnixSeconds(value: number | undefined): string | undefined {
  return typeof value === 'number' ? new Date(value * 1000).toISOString() : undefined
}
```

- [ ] **Step 4: Run app-server thread client tests to verify they pass**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/conversations/AppServerThreadClient.test.ts
```

Expected:

```text
PASS  src/main/conversations/AppServerThreadClient.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add /Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/AppServerThreadClient.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/AppServerThreadClient.test.ts
git commit -m "feat: add app server thread client"
```

## Task 3: Main Conversation API Service

**Files:**
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/ConversationApiService.test.ts`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/ConversationApiService.ts`

- [ ] **Step 1: Write failing conversation service tests**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/ConversationApiService.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { ConversationApiService, type ConversationThreadClientLike } from './ConversationApiService'
import type { ProjectState } from '../../shared/projects/projectTypes'

const baseProjectState: ProjectState = {
  workspaceRootOptions: [],
  localProjects: {
    local: {
      id: 'local',
      kind: 'local',
      name: 'Desktop App',
      hostId: 'local',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
      writableRoots: ['/repo/desktop-app'],
      defaultCwd: '/repo/desktop-app'
    }
  },
  remoteProjects: [],
  projectOrder: ['local'],
  pinnedProjectIds: [],
  projectWritableRoots: { local: ['/repo/desktop-app'] },
  threadProjectAssignments: {
    'thread-local': { projectKind: 'local', projectId: 'local', cwd: '/repo/desktop-app' },
    'thread-path': { projectKind: 'local', projectId: 'path:/repo/cli', path: '/repo/cli', cwd: '/repo/cli' },
    'thread-quick': {
      projectKind: 'projectless',
      cwd: '/tmp/dascowork/thread-quick',
      workspaceRoot: '/tmp/dascowork/thread-quick',
      outputDirectory: '/tmp/dascowork/thread-quick/out'
    }
  },
  threadWritableRoots: {},
  threadWorkspaceRootHints: { 'thread-path': ['/repo/cli'] },
  threadProjectlessOutputDirectories: { 'thread-quick': '/tmp/dascowork/thread-quick' },
  projectlessThreadIds: ['thread-quick'],
  projectlessHints: {
    'thread-quick': { workspaceRoot: null, outputDirectory: '/tmp/dascowork/thread-quick' }
  }
}

function createClient(): ConversationThreadClientLike {
  return {
    listThreads: vi.fn(async () => [
      {
        id: 'thread-local',
        title: 'Local project thread',
        preview: 'Local project thread',
        createdAt: '2026-06-30T01:00:00.000Z',
        updatedAt: '2026-06-30T01:05:00.000Z',
        archived: false,
        running: false,
        cwd: '/repo/desktop-app'
      },
      {
        id: 'thread-path',
        title: 'Path workspace thread',
        preview: 'Path workspace thread',
        createdAt: '2026-06-30T02:00:00.000Z',
        updatedAt: '2026-06-30T02:05:00.000Z',
        archived: false,
        running: true,
        cwd: '/repo/cli'
      },
      {
        id: 'thread-quick',
        title: null,
        preview: 'Scratch prompt',
        createdAt: '2026-06-30T03:00:00.000Z',
        updatedAt: '2026-06-30T03:05:00.000Z',
        archived: false,
        running: false,
        cwd: '/tmp/dascowork/thread-quick'
      }
    ]),
    readThread: vi.fn(),
    archiveThread: vi.fn(async () => undefined),
    unarchiveThread: vi.fn(async () => undefined),
    renameThread: vi.fn(async () => undefined)
  }
}

describe('ConversationApiService', () => {
  it('joins app-server thread rows with project assignments', async () => {
    const service = new ConversationApiService({
      threadClient: createClient(),
      projectStore: { getState: async () => baseProjectState }
    })

    await expect(service.getConversationList()).resolves.toMatchObject({
      loaded: true,
      error: undefined,
      archivedConversationIds: [],
      conversations: [
        {
          id: 'thread-local',
          threadId: 'thread-local',
          title: 'Local project thread',
          projectAssignment: { projectKind: 'local', projectId: 'local' },
          cwd: '/repo/desktop-app'
        },
        {
          id: 'thread-path',
          threadId: 'thread-path',
          title: 'Path workspace thread',
          projectAssignment: { projectKind: 'local', projectId: 'path:/repo/cli', path: '/repo/cli' },
          running: true
        },
        {
          id: 'thread-quick',
          threadId: 'thread-quick',
          title: null,
          projectAssignment: { projectKind: 'projectless' },
          cwd: '/tmp/dascowork/thread-quick'
        }
      ]
    })
  })

  it('refreshes after archive, unarchive, and rename actions', async () => {
    const threadClient = createClient()
    const service = new ConversationApiService({
      threadClient,
      projectStore: { getState: async () => baseProjectState }
    })

    await service.archiveConversation({ conversationId: 'thread-local' })
    await service.unarchiveConversation({ conversationId: 'thread-local' })
    await service.renameConversation({ conversationId: 'thread-local', title: 'New name' })

    expect(threadClient.archiveThread).toHaveBeenCalledWith('thread-local')
    expect(threadClient.unarchiveThread).toHaveBeenCalledWith('thread-local')
    expect(threadClient.renameThread).toHaveBeenCalledWith('thread-local', 'New name')
    expect(threadClient.listThreads).toHaveBeenCalledTimes(3)
  })

  it('merges sidebar preferences with defaults', async () => {
    const service = new ConversationApiService({
      threadClient: createClient(),
      projectStore: { getState: async () => baseProjectState }
    })

    expect(
      service.setPreferences({
        organizeMode: 'chronological',
        collapsedGroupIds: ['local:local']
      })
    ).toEqual({
      organizeMode: 'chronological',
      sortKey: 'updated_at',
      collapsedSectionIds: [],
      collapsedGroupIds: ['local:local']
    })
  })
})
```

- [ ] **Step 2: Run conversation service tests to verify they fail**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/conversations/ConversationApiService.test.ts
```

Expected:

```text
FAIL  src/main/conversations/ConversationApiService.test.ts
Error: Failed to resolve import "./ConversationApiService"
```

- [ ] **Step 3: Implement conversation API service**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/ConversationApiService.ts`:

```ts
import type {
  SidebarConversationActionPayload,
  SidebarConversationListState,
  SidebarConversationOpenResult,
  SidebarConversationRenamePayload,
  SidebarPreferences
} from '../../shared/codexIpcApi'
import type { ProjectState, ThreadProjectAssignment } from '../../shared/projects/projectTypes'
import type { AppServerThreadRow } from './AppServerThreadClient'

export type ConversationThreadClientLike = {
  listThreads(input: { includeArchived: boolean; sortKey?: 'updated_at' | 'created_at' }): Promise<AppServerThreadRow[]>
  readThread(threadId: string, input?: { includeTurns?: boolean }): Promise<AppServerThreadRow>
  archiveThread(threadId: string): Promise<void>
  unarchiveThread(threadId: string): Promise<void>
  renameThread(threadId: string, name: string): Promise<void>
}

export type ConversationProjectStoreLike = {
  getState(): Promise<ProjectState>
}

export type ConversationApiServiceOptions = {
  threadClient: ConversationThreadClientLike
  projectStore: ConversationProjectStoreLike
}

const defaultPreferences: SidebarPreferences = {
  organizeMode: 'project',
  sortKey: 'updated_at',
  collapsedSectionIds: [],
  collapsedGroupIds: []
}

export class ConversationApiService {
  private preferences: SidebarPreferences = defaultPreferences
  private lastState: SidebarConversationListState = {
    conversations: [],
    archivedConversationIds: [],
    loaded: false
  }

  constructor(private readonly options: ConversationApiServiceOptions) {}

  async getConversationList(): Promise<SidebarConversationListState> {
    return this.refreshConversationList()
  }

  async refreshConversationList(): Promise<SidebarConversationListState> {
    try {
      const [projectState, threads] = await Promise.all([
        this.options.projectStore.getState(),
        this.options.threadClient.listThreads({
          includeArchived: false,
          sortKey: this.preferences.sortKey
        })
      ])
      this.lastState = {
        conversations: threads.map((thread) => ({
          id: thread.id,
          threadId: thread.id,
          title: thread.title,
          projectAssignment: resolveAssignment(projectState, thread),
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          archived: thread.archived,
          running: thread.running,
          cwd: thread.cwd
        })),
        archivedConversationIds: threads.filter((thread) => thread.archived).map((thread) => thread.id),
        loaded: true
      }
      return this.lastState
    } catch (error) {
      this.lastState = {
        ...this.lastState,
        loaded: this.lastState.loaded,
        error: errorMessage(error)
      }
      return this.lastState
    }
  }

  async openConversation(input: SidebarConversationActionPayload): Promise<SidebarConversationOpenResult> {
    const [projectState, thread] = await Promise.all([
      this.options.projectStore.getState(),
      this.options.threadClient.readThread(input.conversationId, { includeTurns: true })
    ])
    return {
      conversationId: thread.id,
      threadId: thread.id,
      title: thread.title,
      messages: mapThreadTurnsToUiMessages(thread),
      projectAssignment: resolveAssignment(projectState, thread),
      cwd: thread.cwd
    }
  }

  async archiveConversation(input: SidebarConversationActionPayload): Promise<SidebarConversationListState> {
    await this.options.threadClient.archiveThread(input.conversationId)
    return this.refreshConversationList()
  }

  async unarchiveConversation(input: SidebarConversationActionPayload): Promise<SidebarConversationListState> {
    await this.options.threadClient.unarchiveThread(input.conversationId)
    return this.refreshConversationList()
  }

  async renameConversation(input: SidebarConversationRenamePayload): Promise<SidebarConversationListState> {
    await this.options.threadClient.renameThread(input.conversationId, input.title.trim())
    return this.refreshConversationList()
  }

  getPreferences(): SidebarPreferences {
    return this.preferences
  }

  setPreferences(input: Partial<SidebarPreferences>): SidebarPreferences {
    this.preferences = {
      ...this.preferences,
      ...input,
      collapsedSectionIds: input.collapsedSectionIds ?? this.preferences.collapsedSectionIds,
      collapsedGroupIds: input.collapsedGroupIds ?? this.preferences.collapsedGroupIds
    }
    return this.preferences
  }
}

function resolveAssignment(
  projectState: ProjectState,
  thread: AppServerThreadRow
): ThreadProjectAssignment | undefined {
  const explicit = projectState.threadProjectAssignments[thread.id]
  if (explicit) return explicit

  if (projectState.projectlessThreadIds.includes(thread.id)) {
    const hints = projectState.projectlessHints[thread.id]
    return {
      projectKind: 'projectless',
      cwd: thread.cwd,
      workspaceRoot: hints?.workspaceRoot ?? thread.cwd,
      outputDirectory: hints?.outputDirectory ?? projectState.threadProjectlessOutputDirectories[thread.id] ?? null
    }
  }

  const workspaceRootHint = projectState.threadWorkspaceRootHints[thread.id]?.[0]
  if (workspaceRootHint) {
    return {
      projectKind: 'local',
      projectId: `path:${workspaceRootHint}`,
      path: workspaceRootHint,
      cwd: thread.cwd ?? workspaceRootHint
    }
  }

  const localProject = Object.values(projectState.localProjects).find((project) =>
    project.writableRoots.some((root) => root === thread.cwd)
  )
  if (localProject) {
    return {
      projectKind: 'local',
      projectId: localProject.id,
      cwd: thread.cwd ?? localProject.defaultCwd
    }
  }

  return undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mapThreadTurnsToUiMessages(thread: AppServerThreadRow): SidebarConversationOpenResult['messages'] {
  const turns = thread.turns ?? []
  const messages: SidebarConversationOpenResult['messages'] = []

  for (const turn of turns) {
    const items = isRecord(turn) && Array.isArray(turn.items) ? turn.items : []
    for (const item of items) {
      if (!isRecord(item) || typeof item.id !== 'string') continue

      if (item.type === 'userMessage') {
        const text = userInputText(item.content)
        if (text) {
          messages.push({
            id: typeof item.clientId === 'string' ? item.clientId : item.id,
            role: 'user',
            parts: [{ type: 'text', text }]
          })
        }
        continue
      }

      if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
        messages.push({ id: item.id, role: 'assistant', parts: [{ type: 'text', text: item.text }] })
        continue
      }

      if (item.type === 'reasoning' && Array.isArray(item.summary) && item.summary.length > 0) {
        messages.push({
          id: item.id,
          role: 'assistant',
          parts: [{ type: 'text', text: item.summary.filter(isString).join('\n') }]
        })
        continue
      }

      if (item.type === 'plan' && typeof item.text === 'string' && item.text.trim()) {
        messages.push({ id: item.id, role: 'assistant', parts: [{ type: 'text', text: item.text }] })
      }
    }
  }

  return messages
}

function userInputText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((entry) => (isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string' ? entry.text : ''))
    .filter(Boolean)
    .join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
```

- [ ] **Step 4: Run conversation service tests to verify they pass**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/conversations/ConversationApiService.test.ts
```

Expected:

```text
PASS  src/main/conversations/ConversationApiService.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add /Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/ConversationApiService.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/ConversationApiService.test.ts
git commit -m "feat: join conversations with project state"
```

## Task 4: Main and Preload Conversation IPC Wiring

**Files:**
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/index.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/preload/index.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/preload/index.d.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.test.tsx`

- [ ] **Step 1: Add preload API test expectation**

In `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.test.tsx`, update the mocked `window.desktopApp` object used by tests to include:

```ts
conversations: {
  getConversationList: vi.fn(async () => ({
    conversations: [],
    archivedConversationIds: [],
    loaded: true
  })),
  refreshConversationList: vi.fn(async () => ({
    conversations: [],
    archivedConversationIds: [],
    loaded: true
  })),
  openConversation: vi.fn(async () => ({
    conversationId: 'thread-1',
    threadId: 'thread-1',
    title: 'Thread',
    messages: []
  })),
  archiveConversation: vi.fn(async () => ({
    conversations: [],
    archivedConversationIds: [],
    loaded: true
  })),
  unarchiveConversation: vi.fn(async () => ({
    conversations: [],
    archivedConversationIds: [],
    loaded: true
  })),
  renameConversation: vi.fn(async () => ({
    conversations: [],
    archivedConversationIds: [],
    loaded: true
  })),
  interruptConversation: vi.fn(async () => undefined),
  getPreferences: vi.fn(async () => ({
    organizeMode: 'project',
    sortKey: 'updated_at',
    collapsedSectionIds: [],
    collapsedGroupIds: []
  })),
  setPreferences: vi.fn(async (input) => ({
    organizeMode: input.organizeMode ?? 'project',
    sortKey: input.sortKey ?? 'updated_at',
    collapsedSectionIds: input.collapsedSectionIds ?? [],
    collapsedGroupIds: input.collapsedGroupIds ?? []
  })),
  onConversationListChange: vi.fn(() => () => undefined)
}
```

- [ ] **Step 2: Wire main IPC handlers**

In `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/index.ts`, add imports:

```ts
import { AppServerThreadClient } from './conversations/AppServerThreadClient'
import { ConversationApiService } from './conversations/ConversationApiService'
import {
  sidebarConversationActionPayloadSchema,
  sidebarConversationRenamePayloadSchema,
  sidebarPreferencesPatchSchema
} from '../shared/codexIpcApi'
```

Add module state near `projectApi`:

```ts
let conversationApi: ConversationApiService | undefined
```

In `createCodexRuntime()`, after `workspaceFileSearch = projectRuntimeServices.workspaceFileSearch`, add:

```ts
const launch = resolveCodexAppServerLaunchOptions({
  env: process.env,
  isPackaged: app.isPackaged,
  mainDir: __dirname,
  resourcesPath: process.resourcesPath
})

conversationApi = new ConversationApiService({
  threadClient: new AppServerThreadClient({ launch }),
  projectStore: projectRuntimeServices.projectStore
})
```

Then pass the already computed `launch` into `CodexChatRuntimeService`:

```ts
return new CodexChatRuntimeService({
  launch,
  modelCatalog: createModelCatalogService(loadDesktopRuntimeConfig(process.env)),
  projectService: projectRuntimeServices.projectService,
  projectStore: projectRuntimeServices.projectStore
})
```

Add helper functions below `requireWorkspaceFileSearch()`:

```ts
function requireConversationApi(): ConversationApiService {
  if (!conversationApi) throw new Error('Conversation API is not initialized')
  return conversationApi
}

async function broadcastConversationState(): Promise<void> {
  if (!conversationApi) return
  const state = await conversationApi.refreshConversationList()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('codex:conversations-state-change', state)
  }
}
```

Add IPC handlers before `ipcMain.on('codex-chat:start', ...)`:

```ts
ipcMain.handle('codex:conversations:get-list', () => requireConversationApi().getConversationList())
ipcMain.handle('codex:conversations:refresh-list', async () => {
  const state = await requireConversationApi().refreshConversationList()
  await broadcastConversationState()
  return state
})
ipcMain.handle('codex:conversations:open', (_, payload: unknown) => {
  const request = sidebarConversationActionPayloadSchema.parse(payload)
  return requireConversationApi().openConversation(request)
})
ipcMain.handle('codex:conversations:archive', async (_, payload: unknown) => {
  const request = sidebarConversationActionPayloadSchema.parse(payload)
  const state = await requireConversationApi().archiveConversation(request)
  await broadcastConversationState()
  return state
})
ipcMain.handle('codex:conversations:unarchive', async (_, payload: unknown) => {
  const request = sidebarConversationActionPayloadSchema.parse(payload)
  const state = await requireConversationApi().unarchiveConversation(request)
  await broadcastConversationState()
  return state
})
ipcMain.handle('codex:conversations:rename', async (_, payload: unknown) => {
  const request = sidebarConversationRenamePayloadSchema.parse(payload)
  const state = await requireConversationApi().renameConversation(request)
  await broadcastConversationState()
  return state
})
ipcMain.handle('codex:conversations:interrupt', (_, payload: unknown) => {
  const request = sidebarConversationActionPayloadSchema.parse(payload)
  return runtime.interruptConversation(request.conversationId)
})
ipcMain.handle('codex:conversations:get-preferences', () => requireConversationApi().getPreferences())
ipcMain.handle('codex:conversations:set-preferences', (_, payload: unknown) => {
  const request = sidebarPreferencesPatchSchema.parse(payload)
  return requireConversationApi().setPreferences(request)
})
```

In the existing `codex-chat:start` handler, replace the finalizer:

```ts
void runtime.startChatStream(request, port).finally(() => {
  broadcastStatus()
  void broadcastConversationState()
})
```

- [ ] **Step 3: Wire preload API**

In `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/preload/index.ts`, import conversation types:

```ts
  DesktopConversationsApi,
  SidebarConversationListState,
  SidebarConversationOpenResult,
  SidebarPreferences,
```

Add `desktopConversations` after `desktopCodexChat`:

```ts
const desktopConversations: DesktopConversationsApi = {
  getConversationList: () =>
    ipcRenderer.invoke('codex:conversations:get-list') as Promise<SidebarConversationListState>,
  refreshConversationList: () =>
    ipcRenderer.invoke('codex:conversations:refresh-list') as Promise<SidebarConversationListState>,
  openConversation: (input) =>
    ipcRenderer.invoke('codex:conversations:open', input) as Promise<SidebarConversationOpenResult>,
  archiveConversation: (input) =>
    ipcRenderer.invoke('codex:conversations:archive', input) as Promise<SidebarConversationListState>,
  unarchiveConversation: (input) =>
    ipcRenderer.invoke('codex:conversations:unarchive', input) as Promise<SidebarConversationListState>,
  renameConversation: (input) =>
    ipcRenderer.invoke('codex:conversations:rename', input) as Promise<SidebarConversationListState>,
  interruptConversation: (input) =>
    ipcRenderer.invoke('codex:conversations:interrupt', input) as Promise<void>,
  getPreferences: () =>
    ipcRenderer.invoke('codex:conversations:get-preferences') as Promise<SidebarPreferences>,
  setPreferences: (input) =>
    ipcRenderer.invoke('codex:conversations:set-preferences', input) as Promise<SidebarPreferences>,
  onConversationListChange: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: SidebarConversationListState
    ): void => callback(state)
    ipcRenderer.on('codex:conversations-state-change', listener)
    return () => ipcRenderer.removeListener('codex:conversations-state-change', listener)
  }
}
```

Add it to `desktopApp`:

```ts
const desktopApp = {
  electron: electronAPI,
  codex: desktopCodex,
  chat: desktopCodexChat,
  projects: desktopProjects,
  conversations: desktopConversations
}
```

Update `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/preload/index.d.ts`:

```ts
import type {
  DesktopCodexApi,
  DesktopCodexChatApi,
  DesktopConversationsApi,
  DesktopProjectsApi
} from '../shared/codexIpcApi'

export type DesktopAppApi = {
  electron: ElectronAPI
  codex: DesktopCodexApi
  chat: DesktopCodexChatApi
  projects: DesktopProjectsApi
  conversations: DesktopConversationsApi
}
```

- [ ] **Step 4: Run main/preload related tests**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/conversations/AppServerThreadClient.test.ts src/main/conversations/ConversationApiService.test.ts src/renderer/src/App.test.tsx
```

Expected:

```text
PASS  src/main/conversations/AppServerThreadClient.test.ts
PASS  src/main/conversations/ConversationApiService.test.ts
PASS  src/renderer/src/App.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add /Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/index.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/preload/index.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/preload/index.d.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.test.tsx
git commit -m "feat: expose desktop conversation ipc"
```

## Task 4A: Runtime Conversation Open and Interrupt Integration

**Files:**
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.test.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider-settings.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/vendors/ai-sdk-provider-codex-asp/tests/model.stream.test.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts`

- [ ] **Step 1: Add runtime tests for active conversation tracking**

Add focused tests in `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.test.ts` that assert these concrete outcomes:

- a stream that emits provider metadata with `threadId` and `turnId` records `conversationId -> { threadId, turnId, abortController }` while the stream is active;
- the runtime also indexes the same active run by the app-server `threadId` after that id is known;
- the active run is cleared when the stream finishes;
- `interruptConversation(conversationId)` aborts the matching live stream controller;
- the test double for `AppServerThreadClient` is never called for interruption, because the provider stream owns live turn interruption.

- [ ] **Step 2: Implement runtime active conversation registry**

In `CodexChatRuntimeService`, maintain a private map:

```ts
type ActiveConversationRun = {
  conversationId: string
  threadId?: string
  turnId?: string
  abortController: AbortController
}

private readonly activeConversationRuns = new Map<string, ActiveConversationRun>()
```

During `startChatStream()`:

- Use `request.body?.conversationId ?? request.body?.threadId ?? request.chatId` as the initial conversation key.
- Store the `AbortController` before the stream begins.
- On each chunk, extract provider metadata for both `threadId` and `turnId`; update the map under the renderer conversation key and the app-server thread id when available.
- Keep the existing `normalizeProjectAssignmentThreadId()` behavior so project assignment keys normalize to the app-server thread id.
- In `finally`, remove every map entry whose run object matches the completed run.

Expose:

```ts
interruptConversation(conversationId: string): void {
  const run = this.activeConversationRuns.get(conversationId)
  if (!run) return
  run.abortController.abort()
}

isConversationRunning(conversationId: string): boolean {
  return this.activeConversationRuns.has(conversationId)
}
```

Do not manually send `turn/interrupt` here. The provider already sends protocol-correct `{ threadId, turnId }` when the abort signal fires.

- [ ] **Step 3: Add explicit provider resume thread option**

Passing `{ threadId }` through `CodexChatRequest.body` is not sufficient by itself. The AI SDK provider decides whether to call `thread/resume` before `turn/start`; therefore the selected app-server thread id must enter the provider as a first-class call option.

Implementation requirements:

- Add `resumeThreadId?: string` to `CodexCallOptions` in `/Users/nallylin/Documents/code/dasCowork/desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider-settings.ts`.
- In `/Users/nallylin/Documents/code/dasCowork/desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts`, compute the resume target as `callOptions?.resumeThreadId ?? extractResumeThreadId(options.prompt)`.
- Keep the existing provider metadata fallback so older SDK message histories still resume when they already carry Codex provider metadata.
- When `resumeThreadId` is present, the provider must call `thread/resume` for that id, then call `turn/start` on the resumed thread.
- Add provider tests proving that a call option `resumeThreadId: 'thread-1'` sends `thread/resume` before `turn/start`, even when the prompt messages do not contain Codex provider metadata.

In `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.ts`, update `defaultStreamText()` so trusted `request.body?.threadId` becomes the provider call option:

```ts
const resumeThreadId = typeof request.body?.threadId === 'string' ? request.body.threadId : undefined
const providerOptions = codexCallOptions({
  model: modelId,
  summary: 'auto',
  ...(resumeThreadId ? { resumeThreadId } : {}),
  ...(executionTarget?.cwd ? { cwd: executionTarget.cwd } : {}),
  ...(executionTarget?.runtimeWorkspaceRoots
    ? { runtimeWorkspaceRoots: executionTarget.runtimeWorkspaceRoots }
    : {})
})
```

Add runtime tests proving that opening an existing conversation and sending a new message passes `request.body.threadId` through to `codexCallOptions()` as `resumeThreadId`.

- [ ] **Step 4: Add renderer active conversation context**

Update `ElectronIpcChatTransport` options:

```ts
getActiveConversation?: () => { conversationId?: string; threadId?: string } | undefined
```

In `createTrustedBody()`, after stripping unsafe renderer execution hints and applying `projectSelection`, merge only these trusted identity fields:

```ts
const activeConversation = this.getActiveConversation?.()
if (activeConversation?.conversationId) trustedBody.conversationId = activeConversation.conversationId
if (activeConversation?.threadId) trustedBody.threadId = activeConversation.threadId
```

Add tests that verify:

- unsafe cwd/runtimeWorkspaceRoots are still stripped;
- active `conversationId/threadId` are included when present;
- project selection is still included for new project chats.

- [ ] **Step 5: Add open support to `useCodexIpcAssistantRuntime`**

Expose from the hook:

```ts
openConversation(input: SidebarConversationActionPayload): Promise<void>
activeConversation: { conversationId?: string; threadId?: string } | undefined
```

Implementation requirements:

- Call `window.desktopApp.conversations.openConversation(input)`.
- Call `chat.setMessages(result.messages)` from `useChat`.
- Store `{ conversationId: result.conversationId, threadId: result.threadId }` in React state.
- Treat `result.threadId` as the resume authority for subsequent sends. Do not rely on `result.messages` carrying provider metadata; persisted thread reads may map to plain UI messages.
- If `result.projectAssignment` exists, select or reconcile the matching project context through `ProjectState` in the app shell, not by trusting renderer-supplied cwd:
  - `local` assignment with an existing `projectId`: call/select `{ projectKind: 'local', projectId }`.
  - `local` assignment whose project was removed but has `path` or `cwd`: use/select a path workspace fallback for that absolute path.
  - `projectless` assignment: select `{ projectKind: 'projectless' }` and keep the generated projectless workspace as the execution target.
  - missing or invalid fallback path: keep history visible, surface missing-workspace state, and prevent sending until a valid workspace is selected.
- Pass `getActiveConversation` into `ElectronIpcChatTransport` so subsequent sends resume the selected app-server thread.
- When `ThreadListPrimitive.New` starts a fresh thread, clear the active conversation context so the next send creates a new thread in the currently selected project.

- [ ] **Step 6: Run runtime integration tests**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/codexChatRuntimeService.test.ts src/renderer/src/lib/ElectronIpcChatTransport.test.ts
npm --prefix vendors/ai-sdk-provider-codex-asp test -- tests/model.stream.test.ts
npm run typecheck
```

Expected:

```text
PASS  src/main/codexChatRuntimeService.test.ts
PASS  src/renderer/src/lib/ElectronIpcChatTransport.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add /Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.test.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts
git commit -m "feat: connect sidebar conversations to chat runtime"
```

## Task 5: Renderer Project State Actions

**Files:**
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/projects/useProjectState.test.tsx`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/projects/useProjectState.ts`

- [ ] **Step 1: Write failing hook tests for rename and remove**

In `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/projects/useProjectState.test.tsx`, add assertions to the existing hook tests:

```ts
await act(async () => {
  await controller.renameProject({
    projectKind: 'local',
    projectId: 'local',
    label: 'Renamed Desktop App'
  })
})
expect(window.desktopApp.projects.renameProject).toHaveBeenCalledWith({
  projectKind: 'local',
  projectId: 'local',
  label: 'Renamed Desktop App'
})

await act(async () => {
  await controller.removeProject({ projectKind: 'local', projectId: 'local' })
})
expect(window.desktopApp.projects.removeProject).toHaveBeenCalledWith({
  projectKind: 'local',
  projectId: 'local'
})
```

- [ ] **Step 2: Run hook tests to verify they fail**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/renderer/src/projects/useProjectState.test.tsx
```

Expected:

```text
FAIL  src/renderer/src/projects/useProjectState.test.tsx
TypeError: controller.renameProject is not a function
```

- [ ] **Step 3: Add project action wrappers**

In `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/projects/useProjectState.ts`, update imports:

```ts
import type {
  LocalProject,
  ProjectSelection,
  ProjectState
} from '../../../shared/projects/projectTypes'
import type { ProjectRenamePayload } from '../../../shared/codexIpcApi'
```

Add fields to `ProjectStateController`:

```ts
  renameProject: (input: ProjectRenamePayload) => Promise<void>
  removeProject: (selection: ProjectSelection) => Promise<void>
```

Add callbacks after `selectProject`:

```ts
  const renameProject = useCallback(async (input: ProjectRenamePayload) => {
    const nextState = await window.desktopApp.projects.renameProject(input)
    setState(nextState)
  }, [])

  const removeProject = useCallback(async (selection: ProjectSelection) => {
    const nextState = await window.desktopApp.projects.removeProject(selection)
    setState(nextState)
  }, [])
```

Return them from the hook:

```ts
    renameProject,
    removeProject
```

- [ ] **Step 4: Run hook tests to verify they pass**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/renderer/src/projects/useProjectState.test.tsx
```

Expected:

```text
PASS  src/renderer/src/projects/useProjectState.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/projects/useProjectState.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/projects/useProjectState.test.tsx
git commit -m "feat: expose project rename and remove in renderer state"
```

## Task 6: Pure Sidebar State Model

**Files:**
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarTypes.ts`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarModel.test.ts`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarModel.ts`

- [ ] **Step 1: Create sidebar view-model types**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarTypes.ts`:

```ts
import type {
  SidebarConversation,
  SidebarPreferences
} from '../../../shared/codexIpcApi'
import type { ProjectSelection } from '../../../shared/projects/projectTypes'

export type SidebarProjectGroup = {
  id: string
  label: string
  detail?: string
  selection: ProjectSelection
  conversations: SidebarConversation[]
  threadCount: number
  warning?: string
  collapsed: boolean
  active: boolean
}

export type SidebarViewModel = {
  preferences: SidebarPreferences
  projectGroups: SidebarProjectGroup[]
  quickChats: SidebarConversation[]
  chronologicalChats: SidebarConversation[]
}
```

- [ ] **Step 2: Write failing model tests**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { buildSidebarViewModel } from './sidebarModel'
import type { SidebarConversation, SidebarPreferences } from '../../../shared/codexIpcApi'
import type { ProjectState } from '../../../shared/projects/projectTypes'

const preferences: SidebarPreferences = {
  organizeMode: 'project',
  sortKey: 'updated_at',
  collapsedSectionIds: [],
  collapsedGroupIds: ['local:collapsed']
}

const projectState: ProjectState = {
  workspaceRootOptions: [
    {
      root: '/repo/path',
      label: 'Path Repo',
      hostId: 'local',
      addedAt: '2026-06-30T00:00:00.000Z',
      lastOpenedAt: '2026-06-30T00:00:00.000Z'
    },
    {
      root: '/repo/missing',
      label: 'Missing Repo',
      hostId: 'local',
      addedAt: '2026-06-30T00:00:00.000Z',
      lastOpenedAt: '2026-06-30T00:00:00.000Z',
      missing: true
    }
  ],
  localProjects: {
    local: {
      id: 'local',
      kind: 'local',
      name: 'Desktop App',
      hostId: 'local',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
      writableRoots: ['/repo/local']
    },
    collapsed: {
      id: 'collapsed',
      kind: 'local',
      name: 'Collapsed App',
      hostId: 'local',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
      writableRoots: ['/repo/collapsed']
    }
  },
  remoteProjects: [
    {
      id: 'remote',
      kind: 'remote',
      hostId: 'ssh-dev',
      label: 'Remote App',
      remotePath: '/srv/app',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z'
    }
  ],
  projectOrder: ['collapsed', 'local'],
  pinnedProjectIds: ['local'],
  projectWritableRoots: {},
  threadProjectAssignments: {},
  threadWritableRoots: {},
  threadWorkspaceRootHints: {},
  threadProjectlessOutputDirectories: {},
  projectlessThreadIds: [],
  projectlessHints: {},
  activeProjectSelection: { projectKind: 'local', projectId: 'local' },
  activeWorkspaceRoots: ['/repo/local']
}

const conversations: SidebarConversation[] = [
  {
    id: 'thread-local',
    title: 'Local thread',
    projectAssignment: { projectKind: 'local', projectId: 'local', cwd: '/repo/local' },
    updatedAt: '2026-06-30T03:00:00.000Z',
    createdAt: '2026-06-30T01:00:00.000Z',
    cwd: '/repo/local'
  },
  {
    id: 'thread-path',
    title: 'Path thread',
    projectAssignment: { projectKind: 'local', projectId: 'path:/repo/path', path: '/repo/path', cwd: '/repo/path' },
    updatedAt: '2026-06-30T02:00:00.000Z',
    createdAt: '2026-06-30T02:00:00.000Z',
    cwd: '/repo/path'
  },
  {
    id: 'thread-quick',
    title: 'Scratch',
    projectAssignment: {
      projectKind: 'projectless',
      cwd: '/tmp/thread-quick',
      workspaceRoot: '/tmp/thread-quick',
      outputDirectory: '/tmp/thread-quick/out'
    },
    updatedAt: '2026-06-30T04:00:00.000Z',
    createdAt: '2026-06-30T04:00:00.000Z',
    cwd: '/tmp/thread-quick'
  },
  {
    id: 'thread-archived',
    title: 'Archived',
    archived: true,
    projectAssignment: { projectKind: 'local', projectId: 'local', cwd: '/repo/local' }
  }
]

describe('buildSidebarViewModel', () => {
  it('builds local/path project groups, quick chats, counts, active state, and missing warnings', () => {
    const model = buildSidebarViewModel({ projectState, conversations, preferences })

    expect(model.projectGroups.map((group) => group.id)).toEqual([
      'local:collapsed',
      'local:local',
      'path:/repo/path',
      'path:/repo/missing'
    ])
    expect(model.projectGroups.find((group) => group.id === 'local:local')).toMatchObject({
      label: 'Desktop App',
      threadCount: 1,
      active: true,
      collapsed: false
    })
    expect(model.projectGroups.find((group) => group.id === 'local:collapsed')).toMatchObject({
      collapsed: true
    })
    expect(model.projectGroups.find((group) => group.id === 'path:/repo/missing')).toMatchObject({
      label: 'Missing Repo',
      warning: 'This project folder was deleted or moved'
    })
    expect(model.quickChats.map((chat) => chat.id)).toEqual(['thread-quick'])
  })

  it('orders chronological chats by selected sort key and hides archived rows', () => {
    const model = buildSidebarViewModel({
      projectState,
      conversations,
      preferences: { ...preferences, organizeMode: 'chronological', sortKey: 'created_at' }
    })

    expect(model.chronologicalChats.map((chat) => chat.id)).toEqual([
      'thread-quick',
      'thread-path',
      'thread-local'
    ])
    expect(model.chronologicalChats.map((chat) => chat.id)).not.toContain('thread-archived')
  })

  it('orders recent projects by latest conversation activity', () => {
    const model = buildSidebarViewModel({
      projectState,
      conversations,
      preferences: { ...preferences, organizeMode: 'recent-projects' }
    })

    expect(model.projectGroups.map((group) => group.id).slice(0, 2)).toEqual([
      'local:local',
      'path:/repo/path'
    ])
  })
})
```

- [ ] **Step 3: Run sidebar model tests to verify they fail**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/renderer/src/sidebar/sidebarModel.test.ts
```

Expected:

```text
FAIL  src/renderer/src/sidebar/sidebarModel.test.ts
Error: Failed to resolve import "./sidebarModel"
```

- [ ] **Step 4: Implement pure sidebar model**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarModel.ts`:

```ts
import type {
  SidebarConversation,
  SidebarPreferences
} from '../../../shared/codexIpcApi'
import type {
  LocalProject,
  ProjectSelection,
  ProjectState,
  WorkspaceRootOption
} from '../../../shared/projects/projectTypes'
import type { SidebarProjectGroup, SidebarViewModel } from './sidebarTypes'

export function buildSidebarViewModel(input: {
  projectState: ProjectState | null
  conversations: SidebarConversation[]
  preferences: SidebarPreferences
}): SidebarViewModel {
  const visibleConversations = input.conversations.filter((conversation) => !conversation.archived)
  const projectGroups = input.projectState
    ? buildProjectGroups(input.projectState, visibleConversations, input.preferences)
    : []

  return {
    preferences: input.preferences,
    projectGroups,
    quickChats: sortConversations(
      visibleConversations.filter(
        (conversation) => conversation.projectAssignment?.projectKind === 'projectless'
      ),
      input.preferences.sortKey
    ),
    chronologicalChats: sortConversations(visibleConversations, input.preferences.sortKey)
  }
}

function buildProjectGroups(
  projectState: ProjectState,
  conversations: SidebarConversation[],
  preferences: SidebarPreferences
): SidebarProjectGroup[] {
  const localGroups = projectState.projectOrder
    .map((projectId) => projectState.localProjects[projectId])
    .filter((project): project is LocalProject => Boolean(project))
    .map((project) => localProjectGroup(projectState, project, conversations, preferences))

  const pathGroups = projectState.workspaceRootOptions
    .filter((option) => option.hostId === 'local')
    .map((option) => pathProjectGroup(projectState, option, conversations, preferences))

  const groups = [...localGroups, ...pathGroups]
  if (preferences.organizeMode === 'recent-projects') {
    return groups.sort((left, right) => latestActivity(right) - latestActivity(left))
  }
  return groups
}

function localProjectGroup(
  projectState: ProjectState,
  project: LocalProject,
  conversations: SidebarConversation[],
  preferences: SidebarPreferences
): SidebarProjectGroup {
  const id = `local:${project.id}`
  const groupConversations = conversations.filter(
    (conversation) =>
      conversation.projectAssignment?.projectKind === 'local' &&
      conversation.projectAssignment.projectId === project.id
  )
  return {
    id,
    label: project.name,
    detail:
      project.writableRoots.length === 1
        ? project.writableRoots[0]
        : `${project.writableRoots.length} roots`,
    selection: { projectKind: 'local', projectId: project.id },
    conversations: sortConversations(groupConversations, preferences.sortKey),
    threadCount: groupConversations.length,
    warning: missingRoots(projectState, project.writableRoots),
    collapsed: preferences.collapsedGroupIds.includes(id),
    active: isActiveSelection(projectState.activeProjectSelection, {
      projectKind: 'local',
      projectId: project.id
    })
  }
}

function pathProjectGroup(
  projectState: ProjectState,
  option: WorkspaceRootOption,
  conversations: SidebarConversation[],
  preferences: SidebarPreferences
): SidebarProjectGroup {
  const id = `path:${option.root}`
  const selection: ProjectSelection = { projectKind: 'path', path: option.root }
  const groupConversations = conversations.filter(
    (conversation) =>
      conversation.projectAssignment?.projectKind === 'local' &&
      (conversation.projectAssignment.path === option.root ||
        conversation.projectAssignment.cwd === option.root)
  )
  return {
    id,
    label: option.label ?? basename(option.root),
    detail: option.root,
    selection,
    conversations: sortConversations(groupConversations, preferences.sortKey),
    threadCount: groupConversations.length,
    warning: option.missing ? 'This project folder was deleted or moved' : undefined,
    collapsed: preferences.collapsedGroupIds.includes(id),
    active: isActiveSelection(projectState.activeProjectSelection, selection)
  }
}

function sortConversations(
  conversations: SidebarConversation[],
  sortKey: SidebarPreferences['sortKey']
): SidebarConversation[] {
  const field = sortKey === 'created_at' ? 'createdAt' : 'updatedAt'
  return [...conversations].sort((left, right) => timestamp(right[field]) - timestamp(left[field]))
}

function latestActivity(group: SidebarProjectGroup): number {
  return Math.max(0, ...group.conversations.map((conversation) => timestamp(conversation.updatedAt)))
}

function timestamp(value: string | undefined): number {
  return value ? Date.parse(value) || 0 : 0
}

function missingRoots(projectState: ProjectState, roots: string[]): string | undefined {
  const missing = roots.filter((root) =>
    projectState.workspaceRootOptions.some(
      (option) => option.hostId === 'local' && option.root === root && option.missing
    )
  )
  return missing.length > 0 ? `Missing roots: ${missing.join(', ')}` : undefined
}

function isActiveSelection(left: ProjectSelection | undefined, right: ProjectSelection): boolean {
  if (!left) return false
  if (left.projectKind !== right.projectKind) return false
  if (left.projectKind === 'local' && right.projectKind === 'local') {
    return left.projectId === right.projectId
  }
  if (left.projectKind === 'path' && right.projectKind === 'path') return left.path === right.path
  if (left.projectKind === 'projectless' && right.projectKind === 'projectless') return true
  if (left.projectKind === 'remote' && right.projectKind === 'remote') {
    return left.projectId === right.projectId && left.hostId === right.hostId
  }
  return false
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
```

- [ ] **Step 5: Run sidebar model tests to verify they pass**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/renderer/src/sidebar/sidebarModel.test.ts
```

Expected:

```text
PASS  src/renderer/src/sidebar/sidebarModel.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarTypes.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarModel.ts /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/sidebarModel.test.ts
git commit -m "feat: add sidebar grouping model"
```

## Task 7: Renderer Conversation Hook

**Files:**
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/useConversationState.ts`

- [ ] **Step 1: Create conversation hook**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/useConversationState.ts`.

This hook owns sidebar list state and preferences only. It receives the chat-opening behavior from `useCodexIpcAssistantRuntime`, because opening a stored conversation must also update `useChat` messages and active resume context.

```ts
import { useCallback, useEffect, useState } from 'react'

import type {
  SidebarConversationActionPayload,
  SidebarConversationListState,
  SidebarConversationRenamePayload,
  SidebarPreferences
} from '../../../shared/codexIpcApi'

const initialConversationState: SidebarConversationListState = {
  conversations: [],
  archivedConversationIds: [],
  loaded: false
}

const defaultPreferences: SidebarPreferences = {
  organizeMode: 'project',
  sortKey: 'updated_at',
  collapsedSectionIds: [],
  collapsedGroupIds: []
}

export type ConversationStateController = {
  state: SidebarConversationListState
  preferences: SidebarPreferences
  refresh: () => Promise<void>
  openConversation: (input: SidebarConversationActionPayload) => Promise<void>
  archiveConversation: (input: SidebarConversationActionPayload) => Promise<void>
  unarchiveConversation: (input: SidebarConversationActionPayload) => Promise<void>
  renameConversation: (input: SidebarConversationRenamePayload) => Promise<void>
  interruptConversation: (input: SidebarConversationActionPayload) => Promise<void>
  setPreferences: (input: Partial<SidebarPreferences>) => Promise<void>
}

export function useConversationState({
  openConversation: openConversationInRuntime
}: {
  openConversation: (input: SidebarConversationActionPayload) => Promise<void>
}): ConversationStateController {
  const [state, setState] = useState<SidebarConversationListState>(initialConversationState)
  const [preferences, setPreferencesState] = useState<SidebarPreferences>(defaultPreferences)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.desktopApp.conversations.getConversationList(),
      window.desktopApp.conversations.getPreferences()
    ]).then(([nextState, nextPreferences]) => {
      if (cancelled) return
      setState(nextState)
      setPreferencesState(nextPreferences)
    })
    const removeListener = window.desktopApp.conversations.onConversationListChange((nextState) => {
      setState(nextState)
    })
    return () => {
      cancelled = true
      removeListener()
    }
  }, [])

  const refresh = useCallback(async () => {
    setState(await window.desktopApp.conversations.refreshConversationList())
  }, [])

  const openConversation = useCallback(async (input: SidebarConversationActionPayload) => {
    await openConversationInRuntime(input)
  }, [openConversationInRuntime])

  const archiveConversation = useCallback(async (input: SidebarConversationActionPayload) => {
    setState(await window.desktopApp.conversations.archiveConversation(input))
  }, [])

  const unarchiveConversation = useCallback(async (input: SidebarConversationActionPayload) => {
    setState(await window.desktopApp.conversations.unarchiveConversation(input))
  }, [])

  const renameConversation = useCallback(async (input: SidebarConversationRenamePayload) => {
    setState(await window.desktopApp.conversations.renameConversation(input))
  }, [])

  const interruptConversation = useCallback(async (input: SidebarConversationActionPayload) => {
    await window.desktopApp.conversations.interruptConversation(input)
  }, [])

  const setPreferences = useCallback(async (input: Partial<SidebarPreferences>) => {
    setPreferencesState(await window.desktopApp.conversations.setPreferences(input))
  }, [])

  return {
    state,
    preferences,
    refresh,
    openConversation,
    archiveConversation,
    unarchiveConversation,
    renameConversation,
    interruptConversation,
    setPreferences
  }
}
```

- [ ] **Step 2: Run typecheck to validate hook globals**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm run typecheck:web
```

Expected:

```text
> desktop-app@1.0.0 typecheck:web
> tsc --noEmit -p tsconfig.web.json --composite false
```

- [ ] **Step 3: Commit**

```bash
git add /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/useConversationState.ts
git commit -m "feat: add renderer conversation state hook"
```

## Task 8: Sidebar Components

**Files:**
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarRoot.test.tsx`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/ConversationRow.tsx`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/ProjectGroupRow.tsx`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarPrimaryActions.tsx`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarProjectsSection.tsx`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarChatsSection.tsx`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarRoot.tsx`

- [ ] **Step 1: Write failing sidebar render tests**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarRoot.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { SidebarRoot } from './SidebarRoot'
import type { ProjectStateController } from '../projects/useProjectState'
import type { ConversationStateController } from './useConversationState'

vi.mock('@assistant-ui/react', () => ({
  ThreadListPrimitive: {
    New: ({ children }: { children: React.ReactNode }) => <div data-primitive="ThreadList.New">{children}</div>
  }
}))

const projectState: ProjectStateController = {
  state: {
    workspaceRootOptions: [
      {
        root: '/repo/path',
        label: 'Path Repo',
        hostId: 'local',
        addedAt: '2026-06-30T00:00:00.000Z',
        lastOpenedAt: '2026-06-30T00:00:00.000Z'
      }
    ],
    localProjects: {
      local: {
        id: 'local',
        kind: 'local',
        name: 'Desktop App',
        hostId: 'local',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        writableRoots: ['/repo/local']
      }
    },
    remoteProjects: [],
    projectOrder: ['local'],
    pinnedProjectIds: [],
    projectWritableRoots: {},
    threadProjectAssignments: {},
    threadWritableRoots: {},
    threadWorkspaceRootHints: {},
    threadProjectlessOutputDirectories: {},
    projectlessThreadIds: [],
    projectlessHints: {},
    activeProjectSelection: { projectKind: 'local', projectId: 'local' },
    activeWorkspaceRoots: ['/repo/local']
  },
  hasSelection: true,
  currentLabel: 'Desktop App',
  currentDetail: '/repo/local',
  pickWorkspaceRoot: vi.fn(async () => undefined),
  createLocalProject: vi.fn(),
  selectProject: vi.fn(async () => undefined),
  renameProject: vi.fn(async () => undefined),
  removeProject: vi.fn(async () => undefined)
}

const conversationState: ConversationStateController = {
  state: {
    loaded: true,
    error: undefined,
    archivedConversationIds: [],
    conversations: [
      {
        id: 'thread-local',
        title: 'Local thread',
        projectAssignment: { projectKind: 'local', projectId: 'local', cwd: '/repo/local' },
        updatedAt: '2026-06-30T03:00:00.000Z',
        cwd: '/repo/local'
      },
      {
        id: 'thread-quick',
        title: 'Scratch',
        projectAssignment: {
          projectKind: 'projectless',
          cwd: '/tmp/thread-quick',
          workspaceRoot: '/tmp/thread-quick',
          outputDirectory: '/tmp/thread-quick/out'
        },
        updatedAt: '2026-06-30T04:00:00.000Z',
        cwd: '/tmp/thread-quick'
      }
    ]
  },
  preferences: {
    organizeMode: 'project',
    sortKey: 'updated_at',
    collapsedSectionIds: [],
    collapsedGroupIds: []
  },
  refresh: vi.fn(async () => undefined),
  openConversation: vi.fn(async () => undefined),
  archiveConversation: vi.fn(async () => undefined),
  unarchiveConversation: vi.fn(async () => undefined),
  renameConversation: vi.fn(async () => undefined),
  interruptConversation: vi.fn(async () => undefined),
  setPreferences: vi.fn(async () => undefined)
}

describe('SidebarRoot', () => {
  it('renders primary actions, project groups, quick chats, and archive-only conversation actions', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <SidebarRoot
          nativeBackdrop={false}
          projectState={projectState}
          conversationState={conversationState}
        />
      )
    })

    expect(container.textContent).toContain('New chat')
    expect(container.textContent).toContain('Quick chat')
    expect(container.textContent).toContain('Projects')
    expect(container.textContent).toContain('Desktop App')
    expect(container.textContent).toContain('Local thread')
    expect(container.textContent).toContain('Quick chats')
    expect(container.textContent).toContain('Scratch')
    expect(container.textContent).toContain('Archive')
    expect(container.textContent).not.toContain('Delete')
  })

  it('selects a project when a project row is clicked', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <SidebarRoot
          nativeBackdrop={false}
          projectState={projectState}
          conversationState={conversationState}
        />
      )
    })

    const button = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Desktop App')
    )
    await act(async () => button?.click())

    expect(projectState.selectProject).toHaveBeenCalledWith({
      projectKind: 'local',
      projectId: 'local'
    })
  })
})
```

- [ ] **Step 2: Run sidebar render tests to verify they fail**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/renderer/src/sidebar/SidebarRoot.test.tsx
```

Expected:

```text
FAIL  src/renderer/src/sidebar/SidebarRoot.test.tsx
Error: Failed to resolve import "./SidebarRoot"
```

- [ ] **Step 3: Implement `ConversationRow`**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/ConversationRow.tsx`:

```tsx
import { ArchiveIcon, MoreHorizontalIcon, SquareIcon } from 'lucide-react'

import { cn } from '../lib/utils'
import type { SidebarConversation } from '../../../shared/codexIpcApi'

export function ConversationRow({
  conversation,
  projectLabel,
  nativeBackdrop,
  onOpen,
  onArchive,
  onInterrupt
}: {
  conversation: SidebarConversation
  projectLabel?: string
  nativeBackdrop: boolean
  onOpen: () => void
  onArchive: () => void
  onInterrupt: () => void
}): React.JSX.Element {
  const title = conversation.title ?? 'New Chat'
  return (
    <div
      className={cn(
        'group flex min-h-8 items-center gap-1 rounded-md transition-colors',
        nativeBackdrop
          ? 'hover:bg-background/40 focus-within:bg-background/40 dark:hover:bg-foreground/8'
          : 'hover:bg-muted focus-within:bg-muted'
      )}
    >
      <button
        className="flex min-w-0 flex-1 flex-col px-3 py-1 text-left text-sm font-medium text-foreground outline-none"
        type="button"
        onClick={onOpen}
      >
        <span className="min-w-0 truncate">{title}</span>
        <span className="truncate text-[11px] font-normal text-muted-foreground">
          {projectLabel ?? formatConversationMeta(conversation)}
        </span>
      </button>
      {conversation.running ? (
        <button
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"
          type="button"
          aria-label={`Interrupt ${title}`}
          title={`Interrupt ${title}`}
          onClick={onInterrupt}
        >
          <SquareIcon className="size-3.5" />
        </button>
      ) : null}
      <button
        className="mr-1.5 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent"
        type="button"
        aria-label={`Archive ${title}`}
        title={`Archive ${title}`}
        onClick={onArchive}
      >
        <ArchiveIcon className="size-3.5" />
        <span className="sr-only">Archive</span>
      </button>
      <MoreHorizontalIcon className="mr-2 hidden size-3.5 text-muted-foreground" aria-hidden="true" />
    </div>
  )
}

function formatConversationMeta(conversation: SidebarConversation): string {
  if (conversation.running) return 'Running'
  if (conversation.updatedAt) return new Date(conversation.updatedAt).toLocaleString()
  return conversation.cwd ?? 'Conversation'
}
```

- [ ] **Step 4: Implement `ProjectGroupRow`**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/ProjectGroupRow.tsx`:

```tsx
import { AlertTriangleIcon, ArchiveIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon, TrashIcon } from 'lucide-react'

import { cn } from '../lib/utils'
import type { SidebarProjectGroup } from './sidebarTypes'
import { ConversationRow } from './ConversationRow'

export function ProjectGroupRow({
  group,
  nativeBackdrop,
  onSelect,
  onNewChat,
  onArchiveConversation,
  onArchiveProjectChats,
  onRemoveProject,
  onOpenConversation,
  onInterruptConversation
}: {
  group: SidebarProjectGroup
  nativeBackdrop: boolean
  onSelect: () => void
  onNewChat: () => void
  onArchiveConversation: (conversationId: string) => void
  onArchiveProjectChats: () => void
  onRemoveProject: () => void
  onOpenConversation: (conversationId: string) => void
  onInterruptConversation: (conversationId: string) => void
}): React.JSX.Element {
  const Chevron = group.collapsed ? ChevronRightIcon : ChevronDownIcon
  return (
    <div className="space-y-0.5">
      <div
        className={cn(
          'group flex min-h-8 items-center gap-1 rounded-md px-1 transition-colors',
          group.active && 'bg-muted',
          nativeBackdrop ? 'hover:bg-background/40 dark:hover:bg-foreground/8' : 'hover:bg-muted'
        )}
      >
        <button
          className="grid size-6 place-items-center rounded-md text-muted-foreground"
          type="button"
          aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.label}`}
          aria-expanded={!group.collapsed}
          onClick={onSelect}
        >
          <Chevron className="size-3.5" />
        </button>
        <button
          className="flex min-w-0 flex-1 flex-col py-1 text-left text-sm"
          type="button"
          onClick={onSelect}
        >
          <span className="truncate font-medium text-foreground">{group.label}</span>
          {group.detail ? (
            <span className="truncate text-[11px] text-muted-foreground">{group.detail}</span>
          ) : null}
        </button>
        {group.warning ? (
          <span className="grid size-6 place-items-center text-amber-600 dark:text-amber-400" title={group.warning}>
            <AlertTriangleIcon className="size-3.5" />
          </span>
        ) : null}
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {group.threadCount}
        </span>
        <button className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent" type="button" aria-label={`New chat in ${group.label}`} title={`New chat in ${group.label}`} onClick={onNewChat}>
          <PlusIcon className="size-3.5" />
        </button>
        <button className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent" type="button" aria-label={`Archive chats in ${group.label}`} title={`Archive chats in ${group.label}`} disabled={group.threadCount === 0} onClick={onArchiveProjectChats}>
          <ArchiveIcon className="size-3.5" />
        </button>
        <button className="grid size-6 place-items-center rounded-md text-destructive hover:bg-destructive/10" type="button" aria-label={`Remove ${group.label}`} title={`Remove ${group.label}`} onClick={onRemoveProject}>
          <TrashIcon className="size-3.5" />
        </button>
      </div>
      {!group.collapsed ? (
        <div className="space-y-0.5 pl-5">
          {group.conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              nativeBackdrop={nativeBackdrop}
              onOpen={() => onOpenConversation(conversation.id)}
              onArchive={() => onArchiveConversation(conversation.id)}
              onInterrupt={() => onInterruptConversation(conversation.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 5: Implement section components and root**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarPrimaryActions.tsx`:

```tsx
import { ThreadListPrimitive } from '@assistant-ui/react'
import { PlusIcon, ZapIcon } from 'lucide-react'

import { cn } from '../lib/utils'

export function SidebarPrimaryActions({
  nativeBackdrop,
  onQuickChat
}: {
  nativeBackdrop: boolean
  onQuickChat: () => void
}): React.JSX.Element {
  const hoverClass = nativeBackdrop ? 'hover:bg-background/40 dark:hover:bg-foreground/8' : 'hover:bg-muted'
  return (
    <div className="space-y-1">
      <ThreadListPrimitive.New asChild>
        <button className={cn('inline-flex h-8 w-full items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors', hoverClass)} type="button">
          <PlusIcon className="size-4" />
          New chat
        </button>
      </ThreadListPrimitive.New>
      <button className={cn('inline-flex h-8 w-full items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors', hoverClass)} type="button" onClick={onQuickChat}>
        <ZapIcon className="size-4" />
        Quick chat
      </button>
    </div>
  )
}
```

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarProjectsSection.tsx`:

```tsx
import type { ProjectStateController } from '../projects/useProjectState'
import type { ConversationStateController } from './useConversationState'
import type { SidebarProjectGroup } from './sidebarTypes'
import { ProjectGroupRow } from './ProjectGroupRow'

export function SidebarProjectsSection({
  groups,
  nativeBackdrop,
  projectState,
  conversationState
}: {
  groups: SidebarProjectGroup[]
  nativeBackdrop: boolean
  projectState: ProjectStateController
  conversationState: ConversationStateController
}): React.JSX.Element {
  return (
    <section className="space-y-1" aria-label="Projects">
      <div className="flex items-center justify-between px-2 text-[11px] font-medium text-muted-foreground uppercase">
        <span>Projects</span>
        <button className="rounded px-1 py-0.5 hover:bg-muted" type="button" onClick={() => void projectState.pickWorkspaceRoot()}>
          Open folder
        </button>
      </div>
      <div className="space-y-0.5">
        {groups.length === 0 ? (
          <button className="w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted" type="button" onClick={() => void projectState.pickWorkspaceRoot()}>
            Open a local project folder
          </button>
        ) : (
          groups.map((group) => (
            <ProjectGroupRow
              key={group.id}
              group={group}
              nativeBackdrop={nativeBackdrop}
              onSelect={() => void projectState.selectProject(group.selection)}
              onNewChat={() => void projectState.selectProject(group.selection)}
              onArchiveConversation={(conversationId) => void conversationState.archiveConversation({ conversationId })}
              onArchiveProjectChats={() => {
                for (const conversation of group.conversations) {
                  void conversationState.archiveConversation({ conversationId: conversation.id })
                }
              }}
              onRemoveProject={() => void projectState.removeProject(group.selection)}
              onOpenConversation={(conversationId) => void conversationState.openConversation({ conversationId })}
              onInterruptConversation={(conversationId) => void conversationState.interruptConversation({ conversationId })}
            />
          ))
        )}
      </div>
    </section>
  )
}
```

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarChatsSection.tsx`:

```tsx
import type { SidebarConversation } from '../../../shared/codexIpcApi'
import { ConversationRow } from './ConversationRow'
import type { ConversationStateController } from './useConversationState'

export function SidebarChatsSection({
  quickChats,
  chronologicalChats,
  showChronological,
  nativeBackdrop,
  conversationState
}: {
  quickChats: SidebarConversation[]
  chronologicalChats: SidebarConversation[]
  showChronological: boolean
  nativeBackdrop: boolean
  conversationState: ConversationStateController
}): React.JSX.Element {
  const chats = showChronological ? chronologicalChats : quickChats
  return (
    <section className="space-y-1" aria-label={showChronological ? 'Recent chats' : 'Quick chats'}>
      <div className="px-2 text-[11px] font-medium text-muted-foreground uppercase">
        {showChronological ? 'Recent chats' : 'Quick chats'}
      </div>
      <div className="space-y-0.5">
        {chats.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {showChronological ? 'No recent chats' : 'No quick chats'}
          </div>
        ) : (
          chats.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              nativeBackdrop={nativeBackdrop}
              onOpen={() => void conversationState.openConversation({ conversationId: conversation.id })}
              onArchive={() => void conversationState.archiveConversation({ conversationId: conversation.id })}
              onInterrupt={() => void conversationState.interruptConversation({ conversationId: conversation.id })}
            />
          ))
        )}
      </div>
    </section>
  )
}
```

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar/SidebarRoot.tsx`:

```tsx
import type { ProjectStateController } from '../projects/useProjectState'
import { buildSidebarViewModel } from './sidebarModel'
import { SidebarChatsSection } from './SidebarChatsSection'
import { SidebarPrimaryActions } from './SidebarPrimaryActions'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import type { ConversationStateController } from './useConversationState'

export function SidebarRoot({
  nativeBackdrop,
  projectState,
  conversationState
}: {
  nativeBackdrop: boolean
  projectState: ProjectStateController
  conversationState: ConversationStateController
}): React.JSX.Element {
  const model = buildSidebarViewModel({
    projectState: projectState.state,
    conversations: conversationState.state.conversations,
    preferences: conversationState.preferences
  })

  return (
    <div className="flex flex-col gap-4">
      <SidebarPrimaryActions
        nativeBackdrop={nativeBackdrop}
        onQuickChat={() => void projectState.selectProject({ projectKind: 'projectless' })}
      />
      {conversationState.state.error ? (
        <button className="rounded-md px-2 py-1 text-left text-xs text-destructive hover:bg-destructive/10" type="button" onClick={() => void conversationState.refresh()}>
          {conversationState.state.error}
        </button>
      ) : null}
      <SidebarProjectsSection
        groups={model.projectGroups}
        nativeBackdrop={nativeBackdrop}
        projectState={projectState}
        conversationState={conversationState}
      />
      <SidebarChatsSection
        quickChats={model.quickChats}
        chronologicalChats={model.chronologicalChats}
        showChronological={model.preferences.organizeMode === 'chronological'}
        nativeBackdrop={nativeBackdrop}
        conversationState={conversationState}
      />
    </div>
  )
}
```

- [ ] **Step 6: Run sidebar render tests**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/renderer/src/sidebar/SidebarRoot.test.tsx
```

Expected:

```text
PASS  src/renderer/src/sidebar/SidebarRoot.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/sidebar
git commit -m "feat: add desktop sidebar components"
```

## Task 9: Integrate Sidebar into App Shell

**Files:**
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.tsx`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.test.tsx`

- [ ] **Step 1: Update app shell tests**

In `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.test.tsx`, replace expectations that require `ThreadProjectSections` with assertions for the split sidebar text:

```ts
expect(container.textContent).toContain('Projects')
expect(container.textContent).toContain('Quick chats')
expect(container.textContent).toContain('New chat')
expect(container.textContent).not.toContain('Remote projects')
expect(container.textContent).not.toContain('Pinned')
```

- [ ] **Step 2: Run app tests to verify they fail before integration**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/renderer/src/App.test.tsx
```

Expected:

```text
FAIL  src/renderer/src/App.test.tsx
AssertionError: expected ... to contain 'Quick chats'
```

- [ ] **Step 3: Integrate `useConversationState` and `SidebarRoot`**

In `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.tsx`, add imports:

```ts
import { SidebarRoot } from './sidebar/SidebarRoot'
import { useConversationState, type ConversationStateController } from './sidebar/useConversationState'
```

Update `CodexSidebarProps`:

```ts
type CodexSidebarProps = {
  collapsed: boolean
  nativeBackdrop: boolean
  projectState: ProjectStateController
  conversationState: ConversationStateController
}
```

Inside `App()`, pass the runtime opener into the sidebar state hook:

```ts
const {
  runtime,
  serverRequests,
  respondToServerRequest,
  rejectServerRequest,
  models,
  selectedModelId,
  setSelectedModelId,
  openConversation
} = useCodexIpcAssistantRuntime({
  projectSelection: projectState.state?.activeProjectSelection
})
const conversationState = useConversationState({ openConversation })
```

Pass it into `CodexSidebar`:

```tsx
<CodexSidebar
  collapsed={sidebarCollapsed}
  nativeBackdrop={nativeBackdrop}
  projectState={projectState}
  conversationState={conversationState}
/>
```

Update `CodexSidebar` parameters:

```ts
function CodexSidebar({
  collapsed,
  nativeBackdrop,
  projectState,
  conversationState
}: CodexSidebarProps): React.JSX.Element {
```

Replace the expanded sidebar body:

```tsx
<div className="relative min-h-0 flex-1 overflow-y-auto p-3">
  <SidebarRoot
    nativeBackdrop={nativeBackdrop}
    projectState={projectState}
    conversationState={conversationState}
  />
</div>
```

- [ ] **Step 4: Run app shell tests**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/renderer/src/App.test.tsx src/renderer/src/sidebar/SidebarRoot.test.tsx
```

Expected:

```text
PASS  src/renderer/src/App.test.tsx
PASS  src/renderer/src/sidebar/SidebarRoot.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.tsx /Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.test.tsx
git commit -m "feat: integrate project conversation sidebar"
```

## Task 10: Final Verification

**Files:**
- No code changes.

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/shared/codexIpcApi.test.ts src/main/conversations/AppServerThreadClient.test.ts src/main/conversations/ConversationApiService.test.ts src/main/codexChatRuntimeService.test.ts src/renderer/src/lib/ElectronIpcChatTransport.test.ts src/renderer/src/projects/useProjectState.test.tsx src/renderer/src/sidebar/sidebarModel.test.ts src/renderer/src/sidebar/SidebarRoot.test.tsx src/renderer/src/App.test.tsx
```

Expected:

```text
PASS  src/shared/codexIpcApi.test.ts
PASS  src/main/conversations/AppServerThreadClient.test.ts
PASS  src/main/conversations/ConversationApiService.test.ts
PASS  src/main/codexChatRuntimeService.test.ts
PASS  src/renderer/src/lib/ElectronIpcChatTransport.test.ts
PASS  src/renderer/src/projects/useProjectState.test.tsx
PASS  src/renderer/src/sidebar/sidebarModel.test.ts
PASS  src/renderer/src/sidebar/SidebarRoot.test.tsx
PASS  src/renderer/src/App.test.tsx
```

- [ ] **Step 2: Run lint**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm run lint
```

Expected:

```text
> desktop-app@1.0.0 lint
> eslint --cache .
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm run typecheck
```

Expected:

```text
> desktop-app@1.0.0 typecheck
> npm run typecheck:node && npm run typecheck:web
```

- [ ] **Step 4: Run desktop smoke test**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm run test:e2e -- --reporter=line
```

Expected:

```text
Running ... tests using ... workers
... passed
```

- [ ] **Step 5: Manual QA checklist**

Run the app:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm run dev
```

Verify:

```text
Expanded sidebar shows New chat, Quick chat, Projects, and Quick chats.
Local projects appear in projectOrder.
Path workspace roots appear as project rows.
Missing path roots show a warning icon and tooltip.
Remote and pinned sections are not visible.
Starting a chat in a selected local project creates a conversation row under that project after the stream finishes.
Selecting Quick chat switches to projectless context.
Opening an existing conversation restores its persisted messages and selects the resolved project/workspace context.
Sending after opening an existing conversation resumes the same app-server thread instead of creating a new projectless thread.
Stopping a running sidebar conversation interrupts the live runtime stream through `CodexChatRuntimeService`.
Archiving a conversation removes it from visible rows after main confirms.
Collapsed sidebar keeps only icon actions and no text overlap.
Keyboard focus reaches section rows and action buttons.
```

- [ ] **Step 6: Commit verification fixes**

If verification required fixes, commit only those touched files:

```bash
git add /Users/nallylin/Documents/code/dasCowork/desktop-app
git commit -m "fix: polish desktop sidebar verification"
```

If no fixes were needed, record the clean verification in the final implementation report instead of creating an empty commit.

## Self-Review

Spec coverage:

- Local project list, path roots, missing roots, quick chats, grouped conversations, chronological conversations, project actions, archive-first conversation actions, runtime open/continue/interrupt behavior, and app-server/main boundary are covered by Tasks 1-9.
- Search, pinning, remote projects, auxiliary navigation, feature gates, and irreversible delete are intentionally excluded by Scope Check and component tests.
- Conversation list state comes from main/preload and app-server thread primitives in Tasks 2-4, not from assistant-ui in-memory items.
- Project/workspace semantics remain in `ProjectState` and are carried into open and resume behavior through Task 4A instead of being flattened into a projectless chat list.
- Sorting, grouping, counts, archived hiding, and missing-root warnings are covered by Task 6.
- Keyboard/focus and no text overlap are covered by component structure and final manual QA.

Placeholder scan:

- The plan contains no prohibited placeholder patterns and no unbounded implementation prompts.
- Each code-changing step names exact files and includes concrete code or exact patch content.

Type consistency:

- Shared `SidebarConversation`, `SidebarConversationListState`, and `SidebarPreferences` types are introduced in Task 1 and reused consistently in main services, preload, hooks, selectors, and components.
- `ConversationStateController` and `ProjectStateController` are the renderer component interfaces throughout Tasks 7-9.
- Conversation actions consistently use `{ conversationId }`; rename consistently uses `{ conversationId, title }`.
