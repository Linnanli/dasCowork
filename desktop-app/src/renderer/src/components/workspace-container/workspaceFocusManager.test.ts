// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { adjacentWorkspaceTabId, isWorkspaceEditableTarget } from './workspaceFocusManager'

describe('workspace focus manager', () => {
  it('cycles through tabs in either direction', () => {
    expect(adjacentWorkspaceTabId(['A', 'B', 'C'], 'C', 1)).toBe('A')
    expect(adjacentWorkspaceTabId(['A', 'B', 'C'], 'A', -1)).toBe('C')
  })

  it('does not claim text input, CodeMirror, or xterm shortcuts', () => {
    const input = document.createElement('input')
    const codeMirror = document.createElement('div')
    codeMirror.className = 'cm-content'
    expect(isWorkspaceEditableTarget(input)).toBe(true)
    expect(isWorkspaceEditableTarget(codeMirror)).toBe(true)
    expect(isWorkspaceEditableTarget(document.createElement('button'))).toBe(false)
  })
})
