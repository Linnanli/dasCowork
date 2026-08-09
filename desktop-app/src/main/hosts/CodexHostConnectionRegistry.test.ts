import { describe, expect, it, vi } from 'vitest'

import { CodexHostConnectionRegistry } from './CodexHostConnectionRegistry'

describe('CodexHostConnectionRegistry', () => {
  it('reuses one separately-owned process connection per safe remote host and shuts it down', async () => {
    const shutdown = vi.fn(async () => undefined)
    const createProcessClient = vi.fn(() => ({ shutdown }) as never)
    const registry = new CodexHostConnectionRegistry({ createProcessClient })

    expect(registry.getProcessClient('work-host')).toBe(registry.getProcessClient('work-host'))
    expect(createProcessClient).toHaveBeenCalledOnce()
    expect(() => registry.getProcessClient('invalid host')).toThrow('Invalid SSH host alias')
    expect(
      () => new CodexHostConnectionRegistry({ remoteCodexCommand: 'codex; unsafe' }).getProcessClient('work-host')
    ).toThrow('Remote Codex command')
    await registry.shutdown()
    expect(shutdown).toHaveBeenCalledOnce()
  })
})
