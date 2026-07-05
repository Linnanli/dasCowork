import { describe, expect, it } from 'vitest'

import { summarizeToolGroup } from './toolGroupSummary'

describe('summarizeToolGroup', () => {
  it('summarizes completed command read actions from tool results', () => {
    const summary = summarizeToolGroup([
      commandResultPart('read-a', 'read'),
      commandResultPart('read-b', 'read'),
      commandResultPart('read-c', 'read')
    ])

    expect(summary).toEqual({ label: '已读取 3 个文件', icon: 'read-files', active: false })
  })

  it('summarizes running command actions from tool input', () => {
    const summary = summarizeToolGroup([
      {
        type: 'tool-call',
        toolName: 'codex_command_execution',
        status: { type: 'running' },
        argsText: JSON.stringify({
          command: 'rg "needle"',
          cwd: '/repo',
          commandActions: [{ type: 'search', command: 'rg "needle"', query: 'needle', path: null }]
        })
      }
    ])

    expect(summary).toEqual({ label: '正在搜索 1 次代码', icon: 'code-searching', active: true })
  })

  it('treats assistant-ui requires-action tool status as active', () => {
    const summary = summarizeToolGroup([
      {
        type: 'tool-call',
        toolName: 'codex_command_execution',
        status: { type: 'requires-action', reason: 'interrupt' },
        argsText: JSON.stringify({
          command: 'npm test',
          cwd: '/repo',
          commandActions: [{ type: 'unknown', command: 'npm test' }]
        })
      }
    ])

    expect(summary).toEqual({ label: '正在运行 1 条命令', icon: 'run-command', active: true })
  })

  it('summarizes file change actions by patch kind', () => {
    const summary = summarizeToolGroup([
      {
        type: 'tool-call',
        toolName: 'codex_file_change',
        result: {
          item: {
            type: 'fileChange',
            status: 'completed',
            changes: [
              { path: '/repo/new.ts', kind: { type: 'add' }, diff: '' },
              { path: '/repo/old.ts', kind: { type: 'delete' }, diff: '' },
              { path: '/repo/edit.ts', kind: { type: 'update', move_path: null }, diff: '' }
            ]
          }
        }
      }
    ])

    expect(summary).toEqual({
      label: '已创建 1 个文件，已编辑 1 个文件，已删除 1 个文件',
      icon: 'edit-files',
      active: false
    })
  })

  it('uses the web search icon when a grouped call includes web activity', () => {
    const summary = summarizeToolGroup([
      { type: 'tool-call', toolName: 'codex_web_search', status: { type: 'running' } },
      commandResultPart('read-a', 'read')
    ])

    expect(summary).toEqual({
      label: '已读取 1 个文件，正在搜索 1 次网页',
      icon: 'web-search',
      active: true
    })
  })

  it('falls back to a Chinese generic tool summary for unknown grouped calls', () => {
    const summary = summarizeToolGroup([
      { type: 'tool-call', toolName: 'unknown_tool_a' },
      { type: 'tool-call', toolName: 'unknown_tool_b' }
    ])

    expect(summary).toEqual({ label: '已调用 2 个工具', icon: 'generic-tool', active: false })
  })
})

function commandResultPart(id: string, actionType: string): unknown {
  return {
    type: 'tool-call',
    toolName: 'codex_command_execution',
    result: {
      item: {
        id,
        type: 'commandExecution',
        command: `tool ${id}`,
        cwd: '/repo',
        status: 'completed',
        commandActions: [
          { type: actionType, command: `tool ${id}`, name: id, path: `/repo/${id}.ts` }
        ]
      }
    }
  }
}
