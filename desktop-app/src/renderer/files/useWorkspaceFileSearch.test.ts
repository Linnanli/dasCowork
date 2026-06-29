import { describe, expect, it, vi } from 'vitest'

import {
  searchWorkspaceFiles,
  type WorkspaceFileSearchManager,
  type WorkspaceFileSearchSessionRequest
} from './useWorkspaceFileSearch'

describe('searchWorkspaceFiles', () => {
  it('creates fuzzy file search session for target roots', async () => {
    const manager = createMockAppServerManager()

    await searchWorkspaceFiles({
      manager,
      query: 'app'
    })

    expect(manager.sessions[0]).toMatchObject({
      query: 'app'
    })
  })
})

function createMockAppServerManager(): {
  sessions: Array<{ query: string }>
} & WorkspaceFileSearchManager {
  const sessions: Array<{ query: string }> = []

  return {
    sessions,
    createFuzzyFileSearchSession: vi.fn(async (session: WorkspaceFileSearchSessionRequest) => {
      sessions.push(session)
      return { results: [] }
    })
  }
}
