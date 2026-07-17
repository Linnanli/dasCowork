import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { parse } from 'smol-toml'
import { z } from 'zod'

import type { ProjectSelection } from '../../shared/projects/projectTypes'
import type { ProjectService } from '../projects/ProjectService'

export type LocalAgentRoleCatalogEntry = {
  roleName: string
  description?: string
  nicknameCandidates?: string[]
}

type AgentRoleDeclaration = {
  description?: string
  configFile?: string
  nicknameCandidates?: string[]
}

type LoadedAgentRole = LocalAgentRoleCatalogEntry & {
  sourcePath: string
}

type ProjectServiceLike = Pick<ProjectService, 'resolveNewThreadTarget'>

export type LocalAgentRoleCatalogOptions = {
  codexHome: string
  projectService: ProjectServiceLike
  warn?: (message: string) => void
}

const agentRoleDeclarationSchema = z
  .object({
    description: z.string().optional(),
    config_file: z.string().optional(),
    nickname_candidates: z.array(z.string()).optional()
  })
  .passthrough()

const agentRoleFileSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    developer_instructions: z.string().optional(),
    nickname_candidates: z.array(z.string()).optional()
  })
  .passthrough()

const agentRuntimeSettings = new Set([
  'max_threads',
  'max_depth',
  'job_max_runtime_seconds',
  'interrupt_message'
])

export function resolveCodexHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir()
): string {
  return env.CODEX_HOME?.trim() || join(userHome, '.codex')
}

export class LocalAgentRoleCatalog {
  private readonly warn: (message: string) => void

  constructor(private readonly options: LocalAgentRoleCatalogOptions) {
    this.warn = options.warn ?? (() => undefined)
  }

  async listAgentRoles(input: {
    cwd: string
    projectSelection?: ProjectSelection
  }): Promise<LocalAgentRoleCatalogEntry[]> {
    if (input.projectSelection?.projectKind === 'remote') return []

    const globalRoles = await this.loadLayer([this.options.codexHome], 'global')
    const projectRoots = await this.resolveProjectRoots(input.projectSelection)
    const projectRoles = await this.loadLayer(
      projectRoots.map((root) => join(root, '.codex')),
      'project'
    )

    const merged = new Map(globalRoles)
    for (const [roleName, projectRole] of projectRoles) {
      const globalRole = merged.get(roleName)
      merged.set(roleName, mergeRoles(projectRole, globalRole))
    }

    return [...merged.values()]
      .flatMap((role) => {
        const description = nonEmptyString(role.description)
        if (!description) {
          this.warn(
            `Ignoring agent role "${role.roleName}" from ${role.sourcePath}: missing description`
          )
          return []
        }
        return [
          {
            roleName: role.roleName,
            description,
            ...(role.nicknameCandidates ? { nicknameCandidates: role.nicknameCandidates } : {})
          }
        ]
      })
      .sort((left, right) => left.roleName.localeCompare(right.roleName))
  }

  private async resolveProjectRoots(selection: ProjectSelection | undefined): Promise<string[]> {
    if (!selection || selection.projectKind === 'projectless') return []

    try {
      const target = await this.options.projectService.resolveNewThreadTarget({
        selection,
        prompt: ''
      })
      return target.hostId === 'local' ? uniquePaths(target.workspaceRoots) : []
    } catch (error) {
      this.warn(`Unable to resolve project roots for agent roles: ${errorMessage(error)}`)
      return []
    }
  }

  private async loadLayer(
    configRoots: string[],
    layerName: 'global' | 'project'
  ): Promise<Map<string, LoadedAgentRole>> {
    const roles = new Map<string, LoadedAgentRole>()

    for (const configRoot of uniquePaths(configRoots)) {
      const { declaredRoles, referencedFiles } = await this.loadDeclaredRoles(configRoot)
      for (const role of declaredRoles) this.addFirstRole(roles, role, layerName)

      const roleFiles = await this.collectTomlFiles(join(configRoot, 'agents'))
      for (const roleFile of roleFiles) {
        if (referencedFiles.has(resolve(roleFile))) continue
        const role = await this.loadRoleFile(roleFile, undefined, true)
        if (role) this.addFirstRole(roles, role, layerName)
      }
    }

    return roles
  }

  private async loadDeclaredRoles(configRoot: string): Promise<{
    declaredRoles: LoadedAgentRole[]
    referencedFiles: Set<string>
  }> {
    const configPath = join(configRoot, 'config.toml')
    const config = await this.readTomlObject(configPath)
    if (!config) return { declaredRoles: [], referencedFiles: new Set() }

    const agents = recordValue(config.agents)
    if (!agents) return { declaredRoles: [], referencedFiles: new Set() }

    const declaredRoles: LoadedAgentRole[] = []
    const referencedFiles = new Set<string>()
    for (const [roleName, rawDeclaration] of Object.entries(agents)) {
      if (agentRuntimeSettings.has(roleName)) continue

      const normalizedRoleName = nonEmptyString(roleName)
      const parsedDeclaration = agentRoleDeclarationSchema.safeParse(rawDeclaration)
      if (!normalizedRoleName || !parsedDeclaration.success) {
        this.warn(`Ignoring invalid agent declaration "${roleName}" in ${configPath}`)
        continue
      }

      const declaration = this.normalizeDeclaration(parsedDeclaration.data, roleName, configPath)
      if (!declaration) continue

      if (!declaration.configFile) {
        declaredRoles.push({
          roleName: normalizedRoleName,
          sourcePath: configPath,
          ...(declaration.description ? { description: declaration.description } : {}),
          ...(declaration.nicknameCandidates
            ? { nicknameCandidates: declaration.nicknameCandidates }
            : {})
        })
        continue
      }

      const referencedPath = resolve(dirname(configPath), declaration.configFile)
      referencedFiles.add(referencedPath)
      const fileRole = await this.loadRoleFile(referencedPath, normalizedRoleName, false)
      if (!fileRole) continue

      declaredRoles.push({
        roleName: fileRole.roleName,
        sourcePath: fileRole.sourcePath,
        ...((fileRole.description ?? declaration.description)
          ? { description: fileRole.description ?? declaration.description }
          : {}),
        ...((fileRole.nicknameCandidates ?? declaration.nicknameCandidates)
          ? {
              nicknameCandidates: fileRole.nicknameCandidates ?? declaration.nicknameCandidates
            }
          : {})
      })
    }

    return { declaredRoles, referencedFiles }
  }

  private normalizeDeclaration(
    declaration: z.infer<typeof agentRoleDeclarationSchema>,
    roleName: string,
    configPath: string
  ): AgentRoleDeclaration | null {
    const description = optionalNonEmptyString(declaration.description)
    if (declaration.description !== undefined && !description) {
      this.warn(`Ignoring agent declaration "${roleName}" in ${configPath}: empty description`)
      return null
    }

    const configFile = optionalNonEmptyString(declaration.config_file)
    if (declaration.config_file !== undefined && !configFile) {
      this.warn(`Ignoring agent declaration "${roleName}" in ${configPath}: empty config_file`)
      return null
    }

    const nicknameCandidates = normalizeNicknameCandidates(declaration.nickname_candidates)
    if (declaration.nickname_candidates !== undefined && !nicknameCandidates) {
      this.warn(
        `Ignoring agent declaration "${roleName}" in ${configPath}: invalid nickname_candidates`
      )
      return null
    }

    return {
      ...(description ? { description } : {}),
      ...(configFile ? { configFile } : {}),
      ...(nicknameCandidates ? { nicknameCandidates } : {})
    }
  }

  private async loadRoleFile(
    filePath: string,
    roleNameHint: string | undefined,
    requireDeveloperInstructions: boolean
  ): Promise<LoadedAgentRole | null> {
    const rawRole = await this.readTomlObject(filePath)
    if (!rawRole) return null

    const parsed = agentRoleFileSchema.safeParse(rawRole)
    if (!parsed.success) {
      this.warn(`Ignoring invalid agent role file ${filePath}`)
      return null
    }

    const explicitName = optionalNonEmptyString(parsed.data.name)
    if (parsed.data.name !== undefined && !explicitName) {
      this.warn(`Ignoring agent role file ${filePath}: empty name`)
      return null
    }
    const roleName = explicitName ?? roleNameHint
    if (!roleName) {
      this.warn(`Ignoring agent role file ${filePath}: missing name`)
      return null
    }
    if (agentRuntimeSettings.has(roleName)) {
      this.warn(`Ignoring agent role file ${filePath}: reserved runtime setting name`)
      return null
    }

    const developerInstructions = optionalNonEmptyString(parsed.data.developer_instructions)
    if (
      (requireDeveloperInstructions && !developerInstructions) ||
      (parsed.data.developer_instructions !== undefined && !developerInstructions)
    ) {
      this.warn(`Ignoring agent role file ${filePath}: missing developer_instructions`)
      return null
    }

    const description = optionalNonEmptyString(parsed.data.description)
    if (parsed.data.description !== undefined && !description) {
      this.warn(`Ignoring agent role file ${filePath}: empty description`)
      return null
    }

    const nicknameCandidates = normalizeNicknameCandidates(parsed.data.nickname_candidates)
    if (parsed.data.nickname_candidates !== undefined && !nicknameCandidates) {
      this.warn(`Ignoring agent role file ${filePath}: invalid nickname_candidates`)
      return null
    }

    return {
      roleName,
      sourcePath: filePath,
      ...(description ? { description } : {}),
      ...(nicknameCandidates ? { nicknameCandidates } : {})
    }
  }

  private async readTomlObject(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const parsed = parse(await readFile(filePath, 'utf8'))
      const record = recordValue(parsed)
      if (!record) this.warn(`Ignoring TOML file ${filePath}: expected a table`)
      return record
    } catch (error) {
      if (!isNotFound(error))
        this.warn(`Unable to read agent TOML ${filePath}: ${errorMessage(error)}`)
      return null
    }
  }

  private async collectTomlFiles(directory: string): Promise<string[]> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (!isNotFound(error)) {
        this.warn(`Unable to scan agent directory ${directory}: ${errorMessage(error)}`)
      }
      return []
    }

    const files: string[] = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) files.push(...(await this.collectTomlFiles(path)))
      else if (entry.isFile() && extname(entry.name) === '.toml') files.push(path)
    }
    return files
  }

  private addFirstRole(
    roles: Map<string, LoadedAgentRole>,
    role: LoadedAgentRole,
    layerName: 'global' | 'project'
  ): void {
    const existing = roles.get(role.roleName)
    if (!existing) {
      roles.set(role.roleName, role)
      return
    }
    this.warn(
      `Ignoring duplicate ${layerName} agent role "${role.roleName}" from ${role.sourcePath}; first declared in ${existing.sourcePath}`
    )
  }
}

function mergeRoles(primary: LoadedAgentRole, fallback?: LoadedAgentRole): LoadedAgentRole {
  return {
    roleName: primary.roleName,
    sourcePath: primary.sourcePath,
    ...((primary.description ?? fallback?.description)
      ? { description: primary.description ?? fallback?.description }
      : {}),
    ...((primary.nicknameCandidates ?? fallback?.nicknameCandidates)
      ? { nicknameCandidates: primary.nicknameCandidates ?? fallback?.nicknameCandidates }
      : {})
  }
}

function normalizeNicknameCandidates(value: string[] | undefined): string[] | null | undefined {
  if (value === undefined) return undefined
  if (value.length === 0) return null

  const normalized = value.map((candidate) => candidate.trim())
  if (
    normalized.some(
      (candidate) => candidate.length === 0 || !/^[A-Za-z0-9 _-]+$/u.test(candidate)
    ) ||
    new Set(normalized).size !== normalized.length
  ) {
    return null
  }
  return normalized
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function optionalNonEmptyString(value: string | undefined): string | undefined {
  return value === undefined ? undefined : (nonEmptyString(value) ?? undefined)
}

function nonEmptyString(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter((path) => path.trim()).map((path) => resolve(path)))]
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
