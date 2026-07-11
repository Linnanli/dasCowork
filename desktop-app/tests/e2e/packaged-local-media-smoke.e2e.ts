import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

import { toAppMediaUrl } from '../../src/main/localMediaProtocol'
import { closeApp, launchApp } from './support/app'
import { startMockBackend, type MockBackend } from './support/mockBackend'

const packagedExecutable = process.env.DASCOWORK_PACKAGED_APP_EXECUTABLE

test.describe('packaged local media smoke', () => {
  test.skip(!packagedExecutable, 'run through npm run test:e2e:packaged')

  let app: ElectronApplication | undefined
  let backend: MockBackend
  let tempDir: string

  test.afterEach(async () => {
    await closeApp(app)
    await backend?.close()
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test('loads asar renderer assets and a local image from the unpacked executable', async () => {
    backend = await startMockBackend({ responses: [] })
    tempDir = await mkdtemp(join(tmpdir(), 'dascowork-packaged-media-'))
    const imagePath = join(tempDir, 'packaged-smoke.png')
    await writeFile(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    )

    app = await launchApp(backend, [], {
      executablePath: packagedExecutable,
      args: [],
      cwd: process.cwd()
    })
    const page = await app.firstWindow()

    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    await expect.poll(() => page.url()).toBe('app://-/index.html')
    await expect(
      page.evaluate(() => ({
        scripts: [...document.scripts].map((script) => script.src),
        styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map(
          (link) => (link as HTMLLinkElement).href
        )
      }))
    ).resolves.toMatchObject({
      scripts: [expect.stringMatching(/^app:\/\/-\/assets\/.+\.js$/)],
      styles: [expect.stringMatching(/^app:\/\/-\/assets\/.+\.css$/)]
    })

    await expect(
      page.evaluate(
        (url) =>
          new Promise((resolve) => {
            const image = new Image()
            image.onload = () => resolve({ loaded: true, width: image.naturalWidth })
            image.onerror = () => resolve({ loaded: false, width: 0 })
            image.src = url
          }),
        toAppMediaUrl(imagePath)!
      )
    ).resolves.toEqual({ loaded: true, width: 1 })
  })
})
