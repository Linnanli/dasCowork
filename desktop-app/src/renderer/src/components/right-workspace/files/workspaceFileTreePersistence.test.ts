// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import {
  FILE_TREE_DEFAULT_WIDTH,
  FILE_TREE_MAX_EXPANDED_PATHS,
  fileTreePreferencesStorageKey,
  loadFileTreePreferences,
  persistFileTreePreferences,
  sanitizeFileTreePreferences
} from './workspaceFileTreePersistence'

describe('workspace file tree persistence', () => {
  it('keeps old visible/width storage values compatible', () => {
    window.localStorage.setItem(
      fileTreePreferencesStorageKey('workspace-1'),
      JSON.stringify({ visible: false, width: 312 })
    )

    expect(loadFileTreePreferences('workspace-1')).toEqual({
      visible: false,
      width: 312,
      expandedPaths: [],
      scrollTop: 0
    })
  })

  it('drops malformed, duplicate, unsafe, and excessive expanded paths', () => {
    const preferences = sanitizeFileTreePreferences({
      visible: 'yes',
      width: Number.NaN,
      scrollTop: -1,
      expandedPaths: ['src/', 'src', '../secret', 'src\\windows', ...Array(600).fill('shared')]
    })

    expect(preferences).toEqual({
      visible: true,
      width: FILE_TREE_DEFAULT_WIDTH,
      expandedPaths: ['src', 'shared'],
      scrollTop: 0
    })
  })

  it('limits persisted expanded paths and returns defaults for corrupt JSON', () => {
    persistFileTreePreferences('workspace-2', {
      visible: true,
      width: 280,
      expandedPaths: Array.from(
        { length: FILE_TREE_MAX_EXPANDED_PATHS + 1 },
        (_, index) => `dir-${index}`
      ),
      scrollTop: 99
    })
    expect(loadFileTreePreferences('workspace-2').expandedPaths).toHaveLength(
      FILE_TREE_MAX_EXPANDED_PATHS
    )

    window.localStorage.setItem(fileTreePreferencesStorageKey('workspace-3'), '{')
    expect(loadFileTreePreferences('workspace-3')).toEqual({
      visible: true,
      width: FILE_TREE_DEFAULT_WIDTH,
      expandedPaths: [],
      scrollTop: 0
    })
  })
})
