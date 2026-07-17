import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LocalAgentRoleCatalog, resolveCodexHome } from './LocalAgentRoleCatalog'
import type { ProjectService } from '../projects/ProjectService'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('LocalAgentRoleCatalog', () => {
  it('uses CODEX_HOME when present and otherwise falls back to the user home', () => {
    expect(resolveCodexHome({ CODEX_HOME: ' /custom/codex ' }, '/home/user')).toBe('/custom/codex')
    expect(resolveCodexHome({}, '/home/user')).toBe('/home/user/.codex')
  })

  it('loads valid global and nested project roles with full TOML parsing', async () => {
    const root = await temporaryDirectory()
    const codexHome = join(root, 'codex-home')
    const projectRoot = join(root, 'project')
    const externalAgents = join(root, 'external-agents')
    await mkdir(join(codexHome, 'agents'), { recursive: true })
    await mkdir(join(projectRoot, '.codex', 'agents', 'nested'), { recursive: true })
    await mkdir(externalAgents, { recursive: true })
    await writeFile(
      join(codexHome, 'agents', 'reviewer.toml'),
      [
        'name = "reviewer"',
        'description = """Reviews',
        'code with \\"quotes\\"."""',
        'developer_instructions = "Review carefully."',
        'nickname_candidates = ["Ada", "Code-Scout"]'
      ].join('\n')
    )
    await writeFile(
      join(projectRoot, '.codex', 'agents', 'nested', 'tester.toml'),
      [
        'name = "tester"',
        'description = "Tests project behavior"',
        'developer_instructions = "Run tests."'
      ].join('\n')
    )
    await writeFile(
      join(externalAgents, 'leaked.toml'),
      [
        'name = "leaked"',
        'description = "Must not be followed"',
        'developer_instructions = "Do not load."'
      ].join('\n')
    )
    await symlink(externalAgents, join(projectRoot, '.codex', 'agents', 'linked'))

    const projectService = {
      resolveNewThreadTarget: vi.fn(async () => ({
        hostId: 'local',
        cwd: projectRoot,
        workspaceRoots: [projectRoot],
        workspaceKind: 'project' as const
      }))
    }
    const catalog = new LocalAgentRoleCatalog({ codexHome, projectService })

    await expect(
      catalog.listAgentRoles({
        cwd: projectRoot,
        projectSelection: { projectKind: 'path', path: projectRoot }
      })
    ).resolves.toEqual([
      {
        roleName: 'reviewer',
        description: 'Reviews\ncode with "quotes".',
        nicknameCandidates: ['Ada', 'Code-Scout']
      },
      { roleName: 'tester', description: 'Tests project behavior' }
    ])
  })

  it('supports legacy declarations, relative config_file paths, and project overrides', async () => {
    const root = await temporaryDirectory()
    const codexHome = join(root, 'codex-home')
    const projectRoot = join(root, 'project')
    await mkdir(join(codexHome, 'agents'), { recursive: true })
    await mkdir(join(projectRoot, '.codex', 'agents'), { recursive: true })
    await writeFile(
      join(codexHome, 'config.toml'),
      [
        '[agents]',
        'max_threads = 8',
        'max_depth = 4',
        'job_max_runtime_seconds = 60',
        'interrupt_message = "stop"',
        '',
        '[agents.reviewer]',
        'description = "Global review"',
        'nickname_candidates = ["Ada"]',
        '',
        '[agents.architect]',
        'description = "Global architecture"',
        'nickname_candidates = ["Arch"]'
      ].join('\n')
    )
    await writeFile(
      join(projectRoot, '.codex', 'config.toml'),
      [
        '[agents.reviewer]',
        'description = "Project review"',
        '',
        '[agents.architect]',
        'config_file = "agents/architect.toml"'
      ].join('\n')
    )
    await writeFile(
      join(projectRoot, '.codex', 'agents', 'architect.toml'),
      [
        'name = "architect"',
        'description = "Project architecture"',
        'developer_instructions = "Design the project."'
      ].join('\n')
    )

    const warn = vi.fn()
    const catalog = new LocalAgentRoleCatalog({
      codexHome,
      projectService: localProjectService(projectRoot),
      warn
    })

    await expect(
      catalog.listAgentRoles({
        cwd: projectRoot,
        projectSelection: { projectKind: 'path', path: projectRoot }
      })
    ).resolves.toEqual([
      {
        roleName: 'architect',
        description: 'Project architecture',
        nicknameCandidates: ['Arch']
      },
      {
        roleName: 'reviewer',
        description: 'Project review',
        nicknameCandidates: ['Ada']
      }
    ])
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('duplicate project agent role'))
  })

  it('keeps the first valid duplicate and isolates malformed or incomplete files', async () => {
    const root = await temporaryDirectory()
    const codexHome = join(root, 'codex-home')
    const agentsDirectory = join(codexHome, 'agents')
    await mkdir(agentsDirectory, { recursive: true })
    await writeFile(join(agentsDirectory, 'broken.toml'), 'name = "broken')
    await writeFile(
      join(agentsDirectory, 'a-first.toml'),
      'name = "reviewer"\ndescription = "First"\ndeveloper_instructions = "Review."'
    )
    await writeFile(
      join(agentsDirectory, 'b-second.toml'),
      'name = "reviewer"\ndescription = "Second"\ndeveloper_instructions = "Review."'
    )
    await writeFile(
      join(agentsDirectory, 'missing-name.toml'),
      'description = "No name"\ndeveloper_instructions = "Review."'
    )
    await writeFile(
      join(agentsDirectory, 'missing-instructions.toml'),
      'name = "no-instructions"\ndescription = "No instructions"'
    )
    await writeFile(
      join(agentsDirectory, 'missing-description.toml'),
      'name = "no-description"\ndeveloper_instructions = "Work."'
    )
    await writeFile(
      join(agentsDirectory, 'valid.toml'),
      'name = "tester"\ndescription = "Valid"\ndeveloper_instructions = "Test."'
    )
    await writeFile(
      join(agentsDirectory, 'reserved.toml'),
      'name = "max_threads"\ndescription = "Not a role"\ndeveloper_instructions = "Ignore."'
    )
    const warn = vi.fn()
    const catalog = new LocalAgentRoleCatalog({
      codexHome,
      projectService: localProjectService(join(root, 'unused')),
      warn
    })

    await expect(
      catalog.listAgentRoles({ cwd: '', projectSelection: { projectKind: 'projectless' } })
    ).resolves.toEqual([
      { roleName: 'reviewer', description: 'First' },
      { roleName: 'tester', description: 'Valid' }
    ])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate global agent role'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing developer_instructions'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing description'))
  })

  it('returns no local roles for remote projects', async () => {
    const root = await temporaryDirectory()
    const codexHome = join(root, 'codex-home')
    await mkdir(join(codexHome, 'agents'), { recursive: true })
    await writeFile(
      join(codexHome, 'agents', 'reviewer.toml'),
      'name = "reviewer"\ndescription = "Local"\ndeveloper_instructions = "Review."'
    )
    const projectService = localProjectService(join(root, 'project'))
    const catalog = new LocalAgentRoleCatalog({ codexHome, projectService })

    await expect(
      catalog.listAgentRoles({
        cwd: '/srv/project',
        projectSelection: {
          projectKind: 'remote',
          projectId: 'remote-project',
          hostId: 'ssh-host'
        }
      })
    ).resolves.toEqual([])
    expect(projectService.resolveNewThreadTarget).not.toHaveBeenCalled()
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dascowork-agent-roles-'))
  temporaryDirectories.push(directory)
  return directory
}

function localProjectService(projectRoot: string): Pick<ProjectService, 'resolveNewThreadTarget'> {
  return {
    resolveNewThreadTarget: vi.fn(async () => ({
      hostId: 'local',
      cwd: projectRoot,
      workspaceRoots: [projectRoot],
      workspaceKind: 'project' as const
    }))
  }
}
