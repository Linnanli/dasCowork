import { describe, expect, it } from 'vitest'

import type { FileWorkspaceEntry } from '../../../../../shared/fileWorkspaceApi'
import {
  buildWorkspaceFileSearchTreeModel,
  buildWorkspaceFileTreeModel,
  normalizeWorkspaceDirectoryPath,
  workspacePathFromTreePath
} from './workspaceFileTreeModel'

function entry(path: string, kind: FileWorkspaceEntry['kind'] = 'file'): FileWorkspaceEntry {
  return {
    path,
    kind,
    name: path.split('/').at(-1) ?? path,
    size: 0,
    mtimeMs: 0
  }
}

describe('buildWorkspaceFileTreeModel', () => {
  it('uses trailing slashes only for expandable directories and keeps stable ordering', () => {
    const model = buildWorkspaceFileTreeModel({
      '': {
        path: '',
        truncated: false,
        entries: [entry('zebra.ts'), entry('src', 'directory'), entry('alpha.ts')]
      },
      src: {
        path: 'src',
        truncated: false,
        entries: [entry('src/link', 'symlink'), entry('src/index.ts')]
      }
    })

    expect(model.paths).toEqual(['alpha.ts', 'src/', 'src/index.ts', 'src/link', 'zebra.ts'])
    expect(model.entriesByTreePath.get('src/')?.kind).toBe('directory')
    expect(model.entriesByTreePath.get('src/link')?.kind).toBe('symlink')
  })

  it('does not create a root pseudo-entry and records each truncated directory', () => {
    const model = buildWorkspaceFileTreeModel({
      '': { path: '', truncated: true, entries: [entry('src', 'directory')] },
      src: { path: 'src', truncated: true, entries: [] }
    })

    expect(model.paths).toEqual(['src/'])
    expect([...model.truncatedDirectoryPaths]).toEqual(['', 'src'])
  })

  it('drops invalid entries and deduplicates a broken file/directory collision in favor of a directory', () => {
    const model = buildWorkspaceFileTreeModel({
      '': {
        path: '',
        truncated: false,
        entries: [entry('../secret'), entry('src'), entry('src', 'directory')]
      }
    })

    expect(model.paths).toEqual(['src/'])
  })
})

describe('buildWorkspaceFileSearchTreeModel', () => {
  it('renders file-search matches through the tree model with their ancestor directories', () => {
    const model = buildWorkspaceFileSearchTreeModel([
      { path: 'src/components/index.ts', kind: 'path', preview: 'index.ts' },
      { path: 'src/index.ts', kind: 'path', preview: 'index.ts' },
      { path: 'README.md', kind: 'path', preview: 'README.md' }
    ])

    expect(model.paths).toEqual([
      'README.md',
      'src/',
      'src/components/',
      'src/components/index.ts',
      'src/index.ts'
    ])
    expect(model.entriesByTreePath.get('src/')?.kind).toBe('directory')
    expect(model.entriesByTreePath.get('src/components/index.ts')?.kind).toBe('file')
  })

  it('deduplicates repeated path and content matches for the same file', () => {
    const model = buildWorkspaceFileSearchTreeModel([
      { path: 'src/index.ts', kind: 'path', preview: 'index.ts' },
      { path: 'src/index.ts', kind: 'content', line: 3, preview: 'export {}' }
    ])

    expect(model.paths).toEqual(['src/', 'src/index.ts'])
  })
})

describe('workspace tree path normalization', () => {
  it.each(['', '/src', '../src', 'src/../secret', 'src\\index.ts'])(
    'rejects invalid file paths: %s',
    (path) => {
      expect(workspacePathFromTreePath(path)).toBeUndefined()
    }
  )

  it('normalizes directory paths and removes only their tree marker', () => {
    expect(normalizeWorkspaceDirectoryPath('src///')).toBe('src')
    expect(workspacePathFromTreePath('/')).toBe('')
    expect(workspacePathFromTreePath('src/')).toBe('src')
  })
})
