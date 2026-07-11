import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

import { toAppMediaUrl } from '../../src/main/localMediaProtocol'
import { closeApp, collectRendererLogs, launchApp } from './support/app'
import { startMockBackend, type MockBackend } from './support/mockBackend'

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

test.describe('local media app protocol', () => {
  let app: ElectronApplication | undefined
  let backend: MockBackend
  let page: Page
  let tempDir: string
  let imageUrl: string
  let textUrl: string
  const logs: string[] = []

  test.beforeEach(async () => {
    backend = await startMockBackend({ responses: [] })
    tempDir = await mkdtemp(join(tmpdir(), 'dascowork-local-media-e2e-'))
    const imagePath = join(tempDir, 'image space.png')
    const textPath = join(tempDir, 'secret.txt')
    await Promise.all([writeFile(imagePath, onePixelPng), writeFile(textPath, 'do not expose')])
    imageUrl = toAppMediaUrl(imagePath)!
    textUrl = `app://fs/@fs${textPath}`
    app = await launchApp(backend, logs)
    page = await app.firstWindow()
    collectRendererLogs(page, logs)
  })

  test.afterEach(async () => {
    await closeApp(app)
    await backend.close()
    await rm(tempDir, { recursive: true, force: true })
  })

  test('loads the production renderer and first-party image through app URLs', async () => {
    await expect.poll(() => page.url()).toBe('app://-/index.html')

    await expect(loadImage(page, imageUrl)).resolves.toMatchObject({
      loaded: true,
      width: 1,
      height: 1
    })
    await expect(loadImage(page, textUrl)).resolves.toMatchObject({ loaded: false })
  })

  test('blocks xhr, main-frame navigation, and external HTTP frames', async () => {
    await expect(
      page.evaluate(async (url) => {
        try {
          await fetch(url)
          return 'loaded'
        } catch {
          return 'blocked'
        }
      }, imageUrl)
    ).resolves.toBe('blocked')

    const mainFrameNavigation = await app!.evaluate(async ({ BrowserWindow }, url) => {
      const window = new BrowserWindow({ show: false })
      try {
        await window.loadURL(url)
        return 'loaded'
      } catch {
        return 'blocked'
      } finally {
        window.destroy()
      }
    }, imageUrl)
    expect(mainFrameNavigation).toBe('blocked')

    const server = await startExternalImagePage(imageUrl)
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('HTTP server has no port')
      const externalResult = await app!.evaluate(async ({ BrowserWindow }, url) => {
        const window = new BrowserWindow({ show: false })
        try {
          await window.loadURL(url)
          return await window.webContents.executeJavaScript(
            "new Promise(resolve => { const started = Date.now(); const check = () => { if (document.title !== 'pending' || Date.now() - started > 1000) resolve(document.title); else setTimeout(check, 20); }; check(); })"
          )
        } finally {
          window.destroy()
        }
      }, `http://127.0.0.1:${address.port}/`)
      expect(externalResult).toBe('blocked')
    } finally {
      await closeServer(server)
    }
  })

  test('keeps the application-level protocol registration after macOS window recreation', async () => {
    test.skip(process.platform !== 'darwin', 'macOS activate lifecycle only')

    const recreatedWindow = app!.waitForEvent('window')
    await app!.evaluate(({ app, BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
      setTimeout(() => app.emit('activate'), 50)
    })
    page = await recreatedWindow

    await expect.poll(() => page.url()).toBe('app://-/index.html')
    await expect(loadImage(page, imageUrl)).resolves.toMatchObject({ loaded: true, width: 1 })
  })
})

function loadImage(
  page: Page,
  url: string
): Promise<{ loaded: boolean; width: number; height: number }> {
  return page.evaluate(
    (source) =>
      new Promise((resolve) => {
        const image = new Image()
        image.onload = () =>
          resolve({ loaded: true, width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => resolve({ loaded: false, width: 0, height: 0 })
        image.src = source
      }),
    url
  )
}

async function startExternalImagePage(imageUrl: string): Promise<Server> {
  const server = createServer((_, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><title>pending</title><img src="${imageUrl}"><script>
      const image = document.querySelector('img');
      image.onload = () => { document.title = 'loaded' };
      image.onerror = () => { document.title = 'blocked' };
    </script>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
