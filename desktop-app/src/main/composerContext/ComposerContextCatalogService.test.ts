import { describe, expect, it, vi } from 'vitest'

import { ComposerContextCatalogService } from './ComposerContextCatalogService'
import { LiveAgentRegistry } from './LiveAgentRegistry'
import type { ComposerContextCatalogRequest } from '../../shared/codexIpcApi'

function request(
  overrides: Partial<ComposerContextCatalogRequest> = {}
): ComposerContextCatalogRequest {
  return {
    version: 1 as const,
    cwd: '/repo',
    threadId: 'current',
    projectSelection: { projectKind: 'path' as const, path: '/repo' },
    ...overrides
  }
}

// The concrete Vitest mocks are intentionally preserved for per-call assertions below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup() {
  const agentRoles = {
    listAgentRoles: vi.fn(async () => [
      { roleName: 'reviewer', description: 'Reviews code', nicknameCandidates: ['Ada'] }
    ])
  }
  const provider = {
    listSkills: vi.fn(async () => [
      {
        name: 'testing',
        displayName: 'Testing tools',
        description: 'Runs tests',
        path: '/skills/testing/SKILL.md',
        enabled: true,
        scope: 'user'
      },
      {
        name: 'disabled',
        path: '/skills/disabled/SKILL.md',
        enabled: false
      }
    ]),
    listInstalledPlugins: vi.fn(async () => [
      {
        id: 'github',
        name: 'github',
        mentionName: 'github',
        displayName: 'GitHub',
        mentionPath: 'plugin://github',
        enabled: true
      }
    ]),
    listApps: vi.fn(async () => [
      {
        id: 'slack',
        name: 'Slack',
        mentionName: 'slack',
        pluginDisplayNames: ['Work messaging'],
        mentionPath: 'app://slack',
        enabled: true,
        accessible: true
      },
      {
        id: 'locked',
        name: 'Locked',
        mentionName: 'locked',
        mentionPath: 'app://locked',
        enabled: true,
        accessible: false
      }
    ])
  }
  const liveAgents = new LiveAgentRegistry()
  liveAgents.observe({
    kind: 'completed',
    threadId: 'current',
    agentThreadId: 'child',
    agentPath: 'agents/explorer',
    status: 'completed'
  })

  return { agentRoles, provider, liveAgents }
}

describe('ComposerContextCatalogService', () => {
  it('builds ordered, filtered sections and keeps live and configured agents together', async () => {
    const dependencies = setup()
    const service = new ComposerContextCatalogService({
      ...dependencies,
      defaultCwd: '/default'
    })

    const result = await service.list(request())

    expect(result.sections.map((section) => section.id)).toEqual([
      'agents',
      'skills',
      'plugins',
      'apps'
    ])
    expect(result.sections.find(({ id }) => id === 'agents')?.items).toEqual([
      expect.objectContaining({ kind: 'liveAgent', threadId: 'child', status: 'completed' }),
      expect.objectContaining({ kind: 'configuredAgent', roleName: 'reviewer' })
    ])
    expect(result.sections.find(({ id }) => id === 'skills')?.items).toEqual([
      expect.objectContaining({ kind: 'skill', name: 'testing', label: 'Testing tools' })
    ])
    expect(result.sections.find(({ id }) => id === 'apps')?.items).toEqual([
      expect.objectContaining({
        kind: 'app',
        appId: 'slack',
        label: 'Slack',
        mentionName: 'slack',
        pluginDisplayNames: ['Work messaging']
      })
    ])
    expect(result.sections.find(({ id }) => id === 'plugins')?.items).toEqual([
      expect.objectContaining({
        kind: 'plugin',
        pluginId: 'github',
        label: 'GitHub',
        mentionName: 'github'
      })
    ])
    expect(dependencies.provider.listApps).toHaveBeenCalledWith({
      threadId: null,
      forceRefetch: false,
      pageSize: 100
    })
  })

  it('uses a 30 second cwd/thread cache and refresh bypasses it', async () => {
    const dependencies = setup()
    let now = 1_000
    const service = new ComposerContextCatalogService({
      ...dependencies,
      defaultCwd: '/default',
      now: () => now
    })

    await service.list(request())
    await service.list(request())
    expect(dependencies.agentRoles.listAgentRoles).toHaveBeenCalledTimes(1)
    expect(dependencies.provider.listSkills).toHaveBeenCalledTimes(1)
    expect(dependencies.provider.listInstalledPlugins).toHaveBeenCalledTimes(1)
    expect(dependencies.provider.listApps).toHaveBeenCalledTimes(1)

    await service.refresh(request())
    expect(dependencies.agentRoles.listAgentRoles).toHaveBeenCalledTimes(2)
    expect(dependencies.provider.listSkills).toHaveBeenCalledTimes(2)
    expect(dependencies.provider.listSkills).toHaveBeenLastCalledWith({
      cwd: '/repo',
      forceReload: true
    })

    now += 30_001
    await service.list(request())
    expect(dependencies.provider.listSkills).toHaveBeenCalledTimes(3)
  })

  it('refreshes only the requested section', async () => {
    const dependencies = setup()
    const service = new ComposerContextCatalogService({
      ...dependencies,
      defaultCwd: '/default'
    })

    await service.list(request())
    await service.refresh(request(), { sectionIds: ['skills'] })

    expect(dependencies.agentRoles.listAgentRoles).toHaveBeenCalledTimes(1)
    expect(dependencies.provider.listSkills).toHaveBeenCalledTimes(2)
    expect(dependencies.provider.listSkills).toHaveBeenLastCalledWith({
      cwd: '/repo',
      forceReload: true
    })
    expect(dependencies.provider.listInstalledPlugins).toHaveBeenCalledTimes(1)
    expect(dependencies.provider.listApps).toHaveBeenCalledTimes(1)
  })

  it('reuses static catalogs across threads but isolates remote hosts', async () => {
    const dependencies = setup()
    dependencies.liveAgents.observe({
      kind: 'started',
      threadId: 'other-thread',
      agentThreadId: 'other-child',
      agentPath: 'agents/other'
    })
    const service = new ComposerContextCatalogService({
      ...dependencies,
      defaultCwd: '/default'
    })

    const otherThread = await service.list(request({ threadId: 'other-thread' }))
    expect(otherThread.sections.find(({ id }) => id === 'agents')?.items).toEqual([
      expect.objectContaining({ kind: 'liveAgent', threadId: 'other-child' }),
      expect.objectContaining({ kind: 'configuredAgent', roleName: 'reviewer' })
    ])
    await service.list(
      request({
        cwd: '/srv/repo',
        projectSelection: { projectKind: 'remote', projectId: 'remote-1', hostId: 'host-a' }
      })
    )
    await service.list(
      request({
        cwd: '/srv/repo',
        projectSelection: { projectKind: 'remote', projectId: 'remote-2', hostId: 'host-b' }
      })
    )

    expect(dependencies.provider.listSkills).toHaveBeenCalledTimes(3)
    expect(dependencies.provider.listApps).toHaveBeenCalledTimes(3)
    expect(dependencies.agentRoles.listAgentRoles).toHaveBeenCalledTimes(3)
  })

  it('isolates configured-agent caches by cwd and project selection', async () => {
    const dependencies = setup()
    const service = new ComposerContextCatalogService({
      ...dependencies,
      defaultCwd: '/default'
    })

    await service.list(request())
    await service.list(
      request({
        projectSelection: { projectKind: 'local', projectId: 'project-1' }
      })
    )
    await service.list(
      request({
        cwd: '/repo/packages/api',
        projectSelection: { projectKind: 'local', projectId: 'project-1' }
      })
    )

    expect(dependencies.agentRoles.listAgentRoles).toHaveBeenCalledTimes(3)
    expect(dependencies.provider.listSkills).toHaveBeenCalledTimes(2)
  })

  it('rescans configured agents when the Agents section is refreshed', async () => {
    const dependencies = setup()
    const service = new ComposerContextCatalogService({
      ...dependencies,
      defaultCwd: '/default'
    })

    await service.list(request())
    await service.refresh(request(), { sectionIds: ['agents'] })

    expect(dependencies.agentRoles.listAgentRoles).toHaveBeenCalledTimes(2)
    expect(dependencies.provider.listSkills).toHaveBeenCalledTimes(1)
    expect(dependencies.provider.listInstalledPlugins).toHaveBeenCalledTimes(1)
    expect(dependencies.provider.listApps).toHaveBeenCalledTimes(1)
  })

  it('does not let an invalidated in-flight load repopulate the cache', async () => {
    const dependencies = setup()
    let resolveStale!: (value: { name: string; path: string; enabled: boolean }[]) => void
    const stale = new Promise<{ name: string; path: string; enabled: boolean }[]>((resolve) => {
      resolveStale = resolve
    })
    dependencies.provider.listSkills
      .mockImplementationOnce(() => stale)
      .mockResolvedValueOnce([{ name: 'fresh', path: '/skills/fresh/SKILL.md', enabled: true }])
    const service = new ComposerContextCatalogService({
      ...dependencies,
      defaultCwd: '/default'
    })

    const first = service.list(request())
    await vi.waitFor(() => expect(dependencies.provider.listSkills).toHaveBeenCalledTimes(1))
    const refreshed = await service.refresh(request(), { sectionIds: ['skills'] })
    resolveStale([{ name: 'stale', path: '/skills/stale/SKILL.md', enabled: true }])
    await first
    const cached = await service.list(request())

    expect(refreshed.sections.find(({ id }) => id === 'skills')?.items).toEqual([
      expect.objectContaining({ kind: 'skill', label: 'fresh' })
    ])
    expect(cached.sections.find(({ id }) => id === 'skills')?.items).toEqual([
      expect.objectContaining({ kind: 'skill', label: 'fresh' })
    ])
    expect(dependencies.provider.listSkills).toHaveBeenCalledTimes(2)
  })

  it('isolates a failing catalog section and keeps the other sections usable', async () => {
    const dependencies = setup()
    dependencies.provider.listInstalledPlugins.mockRejectedValueOnce(
      new Error('plugin unavailable')
    )
    const service = new ComposerContextCatalogService({
      ...dependencies,
      defaultCwd: '/default'
    })

    const result = await service.list(request())
    const plugins = result.sections.find(({ id }) => id === 'plugins')

    expect(plugins).toEqual({
      id: 'plugins',
      status: 'error',
      items: [],
      error: 'plugin unavailable'
    })
    expect(result.sections.find(({ id }) => id === 'skills')?.status).toBe('ready')
    expect(result.sections.find(({ id }) => id === 'apps')?.status).toBe('ready')
  })
})
