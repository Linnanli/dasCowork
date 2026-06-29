import type { UIMessage } from 'ai'

import type { ProjectStore } from '../projects/ProjectStore'
import type { ProjectService } from '../projects/ProjectService'
import type { CodexChatRequest } from '../../shared/codexIpcApi'
import type { ResolvedExecutionTarget } from '../../shared/projects/projectTypes'

export type ProjectServiceLike = Pick<
  ProjectService,
  'resolveNewThreadTarget' | 'resolveExistingThreadTarget'
>

export type ProjectStoreLike = Pick<ProjectStore, 'getState' | 'setState'>

export type ConversationExecutionTarget = {
  cwd?: string
  runtimeWorkspaceRoots?: string[]
}

export type StartConversationResult = {
  executionTarget?: ConversationExecutionTarget
}

export async function startConversation({
  request,
  projectService,
  projectStore
}: {
  request: CodexChatRequest
  projectService?: ProjectServiceLike
  projectStore?: ProjectStoreLike
}): Promise<StartConversationResult> {
  if (!projectService) return {}

  const resolvedTarget = await resolveExecutionTarget({ request, projectService })
  if (!resolvedTarget) return {}

  await persistProjectAssignment({ request, projectStore, resolvedTarget })

  return {
    executionTarget: toConversationExecutionTarget(resolvedTarget)
  }
}

async function resolveExecutionTarget({
  request,
  projectService
}: {
  request: CodexChatRequest
  projectService: ProjectServiceLike
}): Promise<ResolvedExecutionTarget | null> {
  const conversationId = request.body?.conversationId
  const threadId = request.body?.threadId

  if (conversationId || threadId) {
    return projectService.resolveExistingThreadTarget({
      conversationId: conversationId ?? request.chatId,
      threadId: threadId ?? null
    })
  }

  return projectService.resolveNewThreadTarget({
    selection: request.body?.projectSelection,
    prompt: extractLatestUserPrompt(request.messages)
  })
}

async function persistProjectAssignment({
  request,
  projectStore,
  resolvedTarget
}: {
  request: CodexChatRequest
  projectStore?: ProjectStoreLike
  resolvedTarget: ResolvedExecutionTarget
}): Promise<void> {
  if (!projectStore || !resolvedTarget.projectAssignment) return

  // The provider stream wrapper does not currently expose the app-server thread id here.
  // Persist against the renderer conversation id when present, otherwise the request chat id.
  // When provider metadata extraction is added, this key should be normalized to the app-server
  // thread id at the same boundary.
  const conversationId = request.body?.conversationId ?? request.chatId
  const state = await projectStore.getState()
  await projectStore.setState({
    ...state,
    threadProjectAssignments: {
      ...state.threadProjectAssignments,
      [conversationId]: resolvedTarget.projectAssignment
    }
  })
}

function toConversationExecutionTarget(
  resolvedTarget: ResolvedExecutionTarget
): ConversationExecutionTarget {
  return {
    ...(resolvedTarget.cwd ? { cwd: resolvedTarget.cwd } : {}),
    ...(resolvedTarget.workspaceRoots.length > 0
      ? { runtimeWorkspaceRoots: resolvedTarget.workspaceRoots }
      : {})
  }
}

function extractLatestUserPrompt(messages: UIMessage[]): string {
  const latestUserMessage = messages.findLast((message) => message.role === 'user')
  if (!latestUserMessage) return ''

  return latestUserMessage.parts
    .map((part) => {
      if (part.type !== 'text') return ''
      return typeof part.text === 'string' ? part.text : ''
    })
    .filter(Boolean)
    .join('\n')
}
