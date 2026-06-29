import { describe, expect, it, vi } from 'vitest'

const providerState = vi.hoisted(() => ({
  listModels: vi.fn(),
  shutdown: vi.fn()
}))

vi.mock('../codexAspProvider', () => ({
  createCodexAspProvider: vi.fn(() => ({
    listModels: providerState.listModels,
    shutdown: providerState.shutdown,
    chat: vi.fn()
  }))
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/app',
    isPackaged: false
  }
}))

import {
  CodexChatRuntimeService,
  type CodexPortLike
} from '../codexChatRuntimeService'
import { ProjectStore, createDefaultProjectState } from '../projects/ProjectStore'
import { startConversation } from './startConversation'

class FakePort implements CodexPortLike {
  readonly messages: unknown[] = []

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  on(): void {
    return undefined
  }

  start(): void {
    return undefined
  }

  close(): void {
    return undefined
  }
}

async function* emptyUiMessageStream(): AsyncGenerator<never, void, unknown> {
  if (process.env['NODE_ENV'] === '__unused_test_stream__') {
    yield undefined as never
  }
}

describe('startConversation', () => {
  it('ignores renderer supplied cwd and uses resolved target', async () => {
    const port = new FakePort()
    const streamText = vi.fn(async (_input: unknown) => ({
      toUIMessageStream: () => emptyUiMessageStream()
    }))
    const projectService = {
      resolveNewThreadTarget: vi.fn().mockResolvedValue({
        hostId: 'local',
        cwd: '/repo',
        workspaceRoots: ['/repo'],
        workspaceKind: 'project'
      }),
      resolveExistingThreadTarget: vi.fn()
    }
    const service = new CodexChatRuntimeService({
      cwd: '/fallback',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText,
      projectService
    })

    await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: {
          projectSelection: { projectKind: 'path', path: '/repo' },
          cwd: '/malicious'
        }
      },
      port
    )

    expect(projectService.resolveNewThreadTarget).toHaveBeenCalledWith({
      selection: { projectKind: 'path', path: '/repo' },
      prompt: ''
    })
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        executionTarget: expect.objectContaining({
          cwd: '/repo',
          runtimeWorkspaceRoots: ['/repo']
        })
      })
    )
    const streamTextInput = streamText.mock.calls[0]?.[0] as
      | { executionTarget?: unknown }
      | undefined
    expect(streamTextInput?.executionTarget).not.toMatchObject({
      cwd: '/malicious'
    })
    expect(port.messages).toEqual([{ type: 'finish' }])
  })

  it('persists project assignment by request chat id when no conversation id is available', async () => {
    const projectStore = ProjectStore.inMemory(createDefaultProjectState())
    const projectService = {
      resolveNewThreadTarget: vi.fn().mockResolvedValue({
        hostId: 'local',
        cwd: '/repo',
        workspaceRoots: ['/repo'],
        workspaceKind: 'project',
        projectAssignment: {
          projectKind: 'local',
          projectId: '/repo',
          path: '/repo',
          cwd: '/repo'
        }
      }),
      resolveExistingThreadTarget: vi.fn()
    }

    await startConversation({
      request: {
        chatId: 'chat-fallback',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: {
          projectSelection: { projectKind: 'path', path: '/repo' }
        }
      },
      projectService,
      projectStore
    })

    await expect(projectStore.getState()).resolves.toMatchObject({
      threadProjectAssignments: {
        'chat-fallback': {
          projectKind: 'local',
          projectId: '/repo',
          path: '/repo',
          cwd: '/repo'
        }
      }
    })
  })
})
