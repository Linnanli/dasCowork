import {
  COMPOSER_CONTEXT_CATALOG_VERSION,
  composerContextCatalogResultSchema,
  composerContextReferenceSchema,
  type ComposerContextCatalogRequest,
  type ComposerContextCatalogResult,
  type ComposerContextCatalogRefreshOptions,
  type ComposerContextReference,
  type ComposerContextSection,
  type ComposerContextSectionId
} from '../../shared/codexIpcApi'
import type { ProjectSelection } from '../../shared/projects/projectTypes'
import type { LiveAgentRegistry } from './LiveAgentRegistry'

export type CodexAgentRoleCatalogEntry = {
  roleName: string
  description?: string
  nicknameCandidates?: string[]
}

export type CodexSkillCatalogEntry = {
  name: string
  displayName?: string
  description?: string
  path: string
  enabled: boolean
  scope?: string
}

export type CodexPluginCatalogEntry = {
  id: string
  name: string
  mentionName: string
  displayName?: string
  description?: string
  mentionPath: string
  enabled: boolean
}

export type CodexAppCatalogEntry = {
  id: string
  name: string
  mentionName: string
  pluginDisplayNames?: string[]
  description?: string
  mentionPath: string
  enabled?: boolean
  accessible?: boolean
  isEnabled?: boolean
  isAccessible?: boolean
}

export type ComposerContextCatalogProviderLike = {
  listSkills(input: { cwd: string; forceReload?: boolean }): Promise<CodexSkillCatalogEntry[]>
  listInstalledPlugins(input: { cwd: string }): Promise<CodexPluginCatalogEntry[]>
  listApps(input: {
    threadId?: string | null
    forceRefetch?: boolean
    pageSize?: number
  }): Promise<CodexAppCatalogEntry[]>
}

export type AgentRoleCatalogSourceLike = {
  listAgentRoles(input: {
    cwd: string
    projectSelection?: ProjectSelection
  }): Promise<CodexAgentRoleCatalogEntry[]>
}

export type ComposerContextCatalogServiceOptions = {
  provider: ComposerContextCatalogProviderLike
  agentRoles: AgentRoleCatalogSourceLike
  liveAgents: Pick<LiveAgentRegistry, 'list'>
  defaultCwd: string
  cacheTtlMs?: number
  now?: () => number
}

type CachedSection = Omit<ComposerContextSection, 'items'> & {
  items: ComposerContextReference[]
}

type CacheEntry = {
  expiresAt: number
  section: CachedSection
}

type StaticCatalogPart = 'configuredAgents' | 'skills' | 'plugins' | 'apps'

type PendingCacheEntry = {
  generation: number
  promise: Promise<CachedSection>
  token: symbol
}

const staticCatalogParts = ['configuredAgents', 'skills', 'plugins', 'apps'] as const
const allSectionIds = ['agents', 'skills', 'plugins', 'apps'] as const

export class ComposerContextCatalogService {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly pending = new Map<string, PendingCacheEntry>()
  private readonly generations = new Map<string, number>()
  private readonly cacheTtlMs: number
  private readonly now: () => number

  constructor(private readonly options: ComposerContextCatalogServiceOptions) {
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000
    this.now = options.now ?? Date.now
  }

  async list(input: ComposerContextCatalogRequest): Promise<ComposerContextCatalogResult> {
    return this.load(input, new Set())
  }

  async refresh(
    input: ComposerContextCatalogRequest,
    options: ComposerContextCatalogRefreshOptions = {}
  ): Promise<ComposerContextCatalogResult> {
    const sectionIds = new Set(options.sectionIds ?? allSectionIds)
    const forceParts = staticPartsForSections(sectionIds)
    this.invalidateStaticParts(input, forceParts)
    return this.load(input, forceParts)
  }

  private async load(
    input: ComposerContextCatalogRequest,
    forceParts: ReadonlySet<StaticCatalogPart>
  ): Promise<ComposerContextCatalogResult> {
    const cwd = input.cwd ?? this.options.defaultCwd
    const scopedInput = { ...input, cwd }
    const requestedSections = input.sectionIds ?? [...allSectionIds]
    const wantsAgents = requestedSections.includes('agents')
    const [configuredAgents, skills, plugins, apps, liveAgents] = await Promise.all([
      wantsAgents
        ? this.loadStaticPart('configuredAgents', scopedInput, forceParts.has('configuredAgents'))
        : undefined,
      requestedSections.includes('skills')
        ? this.loadStaticPart('skills', scopedInput, forceParts.has('skills'))
        : undefined,
      requestedSections.includes('plugins')
        ? this.loadStaticPart('plugins', scopedInput, forceParts.has('plugins'))
        : undefined,
      requestedSections.includes('apps')
        ? this.loadStaticPart('apps', scopedInput, forceParts.has('apps'))
        : undefined,
      wantsAgents && input.threadId
        ? settle(() => this.options.liveAgents.list(input.threadId!))
        : ready([])
    ])
    const sectionsById = new Map<ComposerContextSectionId, CachedSection>([
      ['agents', mergeAgentSections(configuredAgents, liveAgents)],
      ['skills', skills ?? readySection('skills', [])],
      ['plugins', plugins ?? readySection('plugins', [])],
      ['apps', apps ?? readySection('apps', [])]
    ])

    const sections = requestedSections.map((id) => {
      const section = sectionsById.get(id) ?? errorSection(id, 'section is unavailable')
      return { ...section, items: section.items.slice(0, input.limit ?? 200) }
    })

    return composerContextCatalogResultSchema.parse({
      version: COMPOSER_CONTEXT_CATALOG_VERSION,
      generatedAt: new Date(this.now()).toISOString(),
      sections
    })
  }

  private async loadStaticPart(
    part: StaticCatalogPart,
    input: ComposerContextCatalogRequest & { cwd: string },
    forceReload: boolean
  ): Promise<CachedSection> {
    const key = staticCacheKey(part, input)
    const generation = this.generations.get(key) ?? 0
    const existing = this.cache.get(key)
    if (!forceReload && existing && existing.expiresAt > this.now()) return existing.section
    const active = this.pending.get(key)
    if (!forceReload && active?.generation === generation) return active.promise

    const token = Symbol(key)
    const loading = this.loadStaticPartUncached(part, input, forceReload)
      .then((section) => {
        if ((this.generations.get(key) ?? 0) === generation) {
          this.cache.set(key, { expiresAt: this.now() + this.cacheTtlMs, section })
        }
        return section
      })
      .finally(() => {
        if (this.pending.get(key)?.token === token) this.pending.delete(key)
      })
    this.pending.set(key, { generation, promise: loading, token })
    return loading
  }

  private loadStaticPartUncached(
    part: StaticCatalogPart,
    input: ComposerContextCatalogRequest & { cwd: string },
    forceReload: boolean
  ): Promise<CachedSection> {
    switch (part) {
      case 'configuredAgents':
        return settle(() =>
          this.options.agentRoles.listAgentRoles({
            cwd: input.cwd,
            ...(input.projectSelection ? { projectSelection: input.projectSelection } : {})
          })
        ).then((section) => mapSection('agents', section, configuredAgentReference))
      case 'skills':
        return settle(() => this.options.provider.listSkills({ cwd: input.cwd, forceReload })).then(
          (section) => mapSection('skills', section, skillReference, (skill) => skill.enabled)
        )
      case 'plugins':
        return settle(() => this.options.provider.listInstalledPlugins({ cwd: input.cwd })).then(
          (section) => mapSection('plugins', section, pluginReference, (plugin) => plugin.enabled)
        )
      case 'apps':
        return settle(() =>
          this.options.provider.listApps({
            threadId: null,
            forceRefetch: forceReload,
            pageSize: 100
          })
        ).then((section) =>
          mapSection('apps', section, appReference, (app) => appEnabled(app) && appAccessible(app))
        )
    }
  }

  private invalidateStaticParts(
    input: ComposerContextCatalogRequest,
    parts: ReadonlySet<StaticCatalogPart>
  ): void {
    const cwd = input.cwd ?? this.options.defaultCwd
    const scopedInput = { ...input, cwd }
    for (const part of parts) {
      const key = staticCacheKey(part, scopedInput)
      this.cache.delete(key)
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
    }
  }
}

type Settled<T> = { status: 'ready'; value: T } | { status: 'error'; error: string }

async function settle<T>(loader: () => Promise<T>): Promise<Settled<T>> {
  try {
    return ready(await loader())
  } catch (error) {
    return { status: 'error', error: errorMessage(error) }
  }
}

function ready<T>(value: T): Settled<T> {
  return { status: 'ready', value }
}

function mapSection<T>(
  id: ComposerContextSectionId,
  settled: Settled<T[]>,
  mapper: (value: T) => ComposerContextReference,
  include: (value: T) => boolean = () => true
): CachedSection {
  if (settled.status === 'error') return errorSection(id, settled.error)
  return readySection(id, settled.value.filter(include).map(mapper))
}

function mergeAgentSections(
  configured: CachedSection | undefined,
  live: Settled<ComposerContextReference[]>
): CachedSection {
  const base = configured ?? errorSection('agents', 'configured agents are unavailable')
  if (live.status === 'ready') return { ...base, items: [...live.value, ...base.items] }
  return {
    id: 'agents',
    status: 'error',
    items: base.items,
    error: [base.status === 'error' ? base.error : undefined, live.error].filter(Boolean).join('; ')
  }
}

function readySection(
  id: ComposerContextSectionId,
  items: ComposerContextReference[]
): CachedSection {
  const parsedItems: ComposerContextReference[] = []
  let invalidItemCount = 0
  for (const item of items) {
    const parsed = composerContextReferenceSchema.safeParse(item)
    if (parsed.success) parsedItems.push(parsed.data)
    else invalidItemCount += 1
  }
  if (invalidItemCount > 0) {
    return {
      id,
      status: 'error',
      items: parsedItems,
      error: `${invalidItemCount} invalid ${id} catalog item(s) were omitted`
    }
  }
  return { id, status: 'ready', items: parsedItems }
}

function errorSection(id: ComposerContextSectionId, error: string): CachedSection {
  return { id, status: 'error', items: [], error }
}

function configuredAgentReference(role: CodexAgentRoleCatalogEntry): ComposerContextReference {
  return {
    version: COMPOSER_CONTEXT_CATALOG_VERSION,
    kind: 'configuredAgent',
    canonicalId: `configured-agent:${role.roleName}`,
    label: role.roleName,
    description: role.description,
    presentation: 'mention',
    roleName: role.roleName,
    uri: `subagent://${encodeURIComponent(role.roleName)}`,
    ...(role.nicknameCandidates ? { nicknameCandidates: role.nicknameCandidates } : {})
  }
}

function skillReference(skill: CodexSkillCatalogEntry): ComposerContextReference {
  return {
    version: COMPOSER_CONTEXT_CATALOG_VERSION,
    kind: 'skill',
    canonicalId: `skill:${skill.path}`,
    label: skill.displayName ?? skill.name,
    description: skill.description,
    presentation: 'mention',
    name: skill.name,
    path: skill.path,
    ...(skill.scope ? { scope: skill.scope } : {})
  }
}

function pluginReference(plugin: CodexPluginCatalogEntry): ComposerContextReference {
  return {
    version: COMPOSER_CONTEXT_CATALOG_VERSION,
    kind: 'plugin',
    canonicalId: `plugin:${plugin.id}`,
    label: plugin.displayName ?? plugin.name,
    description: plugin.description,
    presentation: 'mention',
    pluginId: plugin.id,
    uri: plugin.mentionPath,
    mentionName: plugin.mentionName
  }
}

function appReference(app: CodexAppCatalogEntry): ComposerContextReference {
  return {
    version: COMPOSER_CONTEXT_CATALOG_VERSION,
    kind: 'app',
    canonicalId: `app:${app.id}`,
    label: app.name,
    description: app.description,
    presentation: 'mention',
    appId: app.id,
    uri: app.mentionPath,
    mentionName: app.mentionName,
    ...(app.pluginDisplayNames ? { pluginDisplayNames: app.pluginDisplayNames } : {})
  }
}

function appEnabled(app: CodexAppCatalogEntry): boolean {
  return app.enabled ?? app.isEnabled ?? false
}

function appAccessible(app: CodexAppCatalogEntry): boolean {
  return app.accessible ?? app.isAccessible ?? false
}

function staticPartsForSections(
  sectionIds: ReadonlySet<ComposerContextSectionId>
): Set<StaticCatalogPart> {
  const parts = new Set<StaticCatalogPart>()
  if (sectionIds.has('agents')) parts.add('configuredAgents')
  for (const part of staticCatalogParts) {
    if (part !== 'configuredAgents' && sectionIds.has(part)) parts.add(part)
  }
  return parts
}

function staticCacheKey(
  part: StaticCatalogPart,
  input: ComposerContextCatalogRequest & { cwd: string }
): string {
  const hostId =
    input.projectSelection?.projectKind === 'remote' ? input.projectSelection.hostId : 'local'
  if (part === 'apps') return `${part}\0${hostId}`
  if (part === 'configuredAgents') {
    return `${part}\0${hostId}\0${input.cwd}\0${projectSelectionCacheKey(input.projectSelection)}`
  }
  return `${part}\0${hostId}\0${input.cwd}`
}

function projectSelectionCacheKey(selection: ProjectSelection | undefined): string {
  if (!selection) return 'none'
  switch (selection.projectKind) {
    case 'local':
      return `local:${selection.projectId}`
    case 'remote':
      return `remote:${selection.hostId}:${selection.projectId}`
    case 'path':
      return `path:${selection.path}`
    case 'projectless':
      return 'projectless'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
