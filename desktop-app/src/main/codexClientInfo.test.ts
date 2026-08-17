import { describe, expect, it } from 'vitest'

import packageJson from '../../package.json'
import { createCodexClientInfo, desktopAppVersion } from './codexClientInfo'

describe('Codex client info', () => {
  it('uses the package version as the single version source', () => {
    expect(desktopAppVersion).toBe(packageJson.version)
    expect(createCodexClientInfo('client_name', 'Client title')).toEqual({
      name: 'client_name',
      title: 'Client title',
      version: packageJson.version
    })
  })
})
