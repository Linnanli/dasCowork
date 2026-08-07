import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  APP_MEDIA_ORIGIN,
  APP_RENDERER_ORIGIN,
  createAppProtocolHandler,
  createAppRendererUrl,
  frameOriginFromUrl,
  isAllowedAppMediaRequest,
  parseByteRange,
  registerAppProtocol,
  registerAppSchemePrivileges,
  resolveAppMediaPath,
  toAppMediaUrl,
  type AppMediaRequestDetails,
  type AppProtocolRequest
} from './localMediaProtocol'

describe('app protocol registration', () => {
  it('registers only the required scheme privileges and is idempotent', () => {
    const registerSchemesAsPrivileged = vi.fn()
    const protocol = { registerSchemesAsPrivileged, handle: vi.fn() }

    registerAppSchemePrivileges(protocol)
    registerAppSchemePrivileges(protocol)

    expect(registerSchemesAsPrivileged).toHaveBeenCalledOnce()
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: 'app',
        privileges: {
          standard: true,
          secure: true,
          stream: true,
          supportFetchAPI: true
        }
      }
    ])
    expect(registerSchemesAsPrivileged.mock.calls[0]![0][0].privileges).not.toHaveProperty(
      'bypassCSP'
    )
    expect(registerSchemesAsPrivileged.mock.calls[0]![0][0].privileges).not.toHaveProperty(
      'corsEnabled'
    )
  })

  it('registers one handler and one first-party request guard', () => {
    const handle = vi.fn()
    const onBeforeRequest = vi.fn()
    const protocol = { registerSchemesAsPrivileged: vi.fn(), handle }
    const session = { webRequest: { onBeforeRequest } }

    registerAppProtocol({
      protocol,
      session,
      rendererRoot: '/renderer',
      devRendererUrl: 'http://localhost:5173/path',
      logger: { warn: vi.fn() }
    })
    registerAppProtocol({ protocol, session, rendererRoot: '/renderer' })

    expect(handle).toHaveBeenCalledOnce()
    expect(handle).toHaveBeenCalledWith('app', expect.any(Function))
    expect(onBeforeRequest).toHaveBeenCalledOnce()
    expect(onBeforeRequest.mock.calls[0]![0]).toEqual({ urls: [`${APP_MEDIA_ORIGIN}/*`] })

    const listener = onBeforeRequest.mock.calls[0]![1]
    expect(
      requestDecision(listener, { frame: { url: 'app://-/index.html' }, resourceType: 'image' })
    ).toEqual({ cancel: false })
    expect(
      requestDecision(listener, {
        frame: { url: 'http://localhost:5173/chat' },
        resourceType: 'media'
      })
    ).toEqual({ cancel: false })
    expect(
      requestDecision(listener, {
        frame: { url: 'https://example.com/' },
        resourceType: 'image'
      })
    ).toEqual({ cancel: true })
  })
})

describe('app media request policy', () => {
  it.each([
    [{ frame: { url: 'app://-/index.html' }, resourceType: 'image' }, undefined],
    [{ frame: { url: 'app://-/index.html' }, resourceType: 'media' }, undefined],
    [
      { frame: { url: 'http://localhost:5173/chat' }, resourceType: 'image' },
      'http://localhost:5173'
    ],
    [{ frame: { url: 'app://-/index.html' }, resourceType: 'subFrame' }, undefined]
  ] as const)('allows first-party image, media, and PDF frame requests', (details, devOrigin) => {
    expect(isAllowedAppMediaRequest(details, devOrigin)).toBe(true)
  })

  it.each([
    { frame: { url: 'https://example.com' }, resourceType: 'image' },
    { frame: { url: 'app://webview/index.html' }, resourceType: 'image' },
    { frame: null, resourceType: 'image' },
    { frame: { url: 'app://-/index.html' }, resourceType: 'mainFrame' },
    { frame: { url: 'app://-/index.html' }, resourceType: 'xhr' }
  ])('rejects non-first-party or non-media requests', (details) => {
    expect(isAllowedAppMediaRequest(details)).toBe(false)
  })

  it('derives a stable custom-scheme origin instead of relying on URL.origin', () => {
    expect(new URL('app://-/index.html').origin).toBe('null')
    expect(frameOriginFromUrl('app://-/index.html')).toBe(APP_RENDERER_ORIGIN)
    expect(frameOriginFromUrl('file:///tmp/index.html')).toBeNull()
  })
})

describe('app media URLs', () => {
  it.each([
    ['/tmp/image space #? 中文.png', 'linux'],
    ['C:\\Users\\alice\\image space #?.PNG', 'win32'],
    ['\\\\server\\share\\folder\\image.webp', 'win32']
  ] as const)('round trips absolute media paths: %s', (path, platform) => {
    const url = toAppMediaUrl(path, platform)

    expect(url).toMatch(/^app:\/\/fs\/@fs\//)
    expect(resolveAppMediaPath(url!, platform)).toBe(path)
  })

  it('converts file URLs and rejects non-media, relative, and malformed inputs', () => {
    expect(toAppMediaUrl('file:///tmp/image.png', 'linux')).toBe('app://fs/@fs/tmp/image.png')
    expect(toAppMediaUrl('/tmp/readme.txt', 'linux')).toBeNull()
    expect(toAppMediaUrl('relative/image.png', 'linux')).toBeNull()
    expect(toAppMediaUrl('file://%', 'linux')).toBeNull()
  })

  it.each([
    'app://other/@fs/tmp/image.png',
    'app://fs/wrong/tmp/image.png',
    'app://fs/@fs/tmp/%2e%2e/secret.png',
    'app://fs/@fs/tmp/%252e%252e/secret.png',
    'app://fs/@fs/tmp/readme.txt',
    'app://fs/@fs/%'
  ])('rejects invalid media URLs: %s', (url) => {
    expect(resolveAppMediaPath(url, 'linux')).toBeNull()
  })

  it('uses the production renderer URL', () => {
    expect(createAppRendererUrl()).toBe('app://-/index.html')
  })
})

describe('app protocol responses', () => {
  let rendererRoot: string
  let mediaRoot: string

  beforeEach(async () => {
    rendererRoot = await mkdtemp(join(tmpdir(), 'renderer-protocol-'))
    mediaRoot = await mkdtemp(join(tmpdir(), 'media-protocol-'))
    await mkdir(join(rendererRoot, 'assets'))
    await Promise.all([
      writeFile(join(rendererRoot, 'index.html'), '<!doctype html>'),
      writeFile(join(rendererRoot, 'assets', 'app.js'), 'export {}'),
      writeFile(join(rendererRoot, 'assets', 'app.css'), 'body{}'),
      writeFile(join(rendererRoot, 'assets', 'config.json'), '{}'),
      writeFile(join(rendererRoot, 'assets', 'module.wasm'), Buffer.from([0, 97, 115, 109])),
      writeFile(join(rendererRoot, 'assets', 'font.woff2'), Buffer.from([1, 2])),
      writeFile(join(rendererRoot, 'assets', 'logo.png'), Buffer.from([3, 4])),
      writeFile(join(rendererRoot, 'assets', 'unknown.bin'), Buffer.from([5, 6])),
      writeFile(join(mediaRoot, 'photo.png'), Buffer.from([10, 11, 12])),
      writeFile(join(mediaRoot, 'clip.mp4'), Buffer.from('0123456789')),
      writeFile(join(mediaRoot, 'readme.txt'), 'secret')
    ])
    await mkdir(join(mediaRoot, 'folder.png'))
  })

  afterEach(async () => {
    await Promise.all([
      rm(rendererRoot, { recursive: true, force: true }),
      rm(mediaRoot, { recursive: true, force: true })
    ])
  })

  it.each([
    ['index.html', 'text/html'],
    ['assets/app.js', 'text/javascript'],
    ['assets/app.css', 'text/css'],
    ['assets/config.json', 'application/json'],
    ['assets/module.wasm', 'application/wasm'],
    ['assets/font.woff2', 'font/woff2'],
    ['assets/logo.png', 'image/png']
  ])('serves first-party static asset %s with its explicit MIME type', async (path, mediaType) => {
    const response = await handler()(request(`app://-/${path}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(mediaType)
    expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0)
  })

  it.each([
    'app://-/../outside.js',
    'app://-/%2e%2e/outside.js',
    'app://-/%252e%252e/outside.js',
    'app://-/assets/unknown.bin',
    'app://unknown/index.html'
  ])('returns 404 for unsafe or unsupported static URLs: %s', async (url) => {
    expect((await handler()(request(url))).status).toBe(404)
  })

  it('streams allowed local images and rejects non-files or unsupported types', async () => {
    const imageResponse = await handler()(request(toAppMediaUrl(join(mediaRoot, 'photo.png'))!))

    expect(imageResponse.status).toBe(200)
    expect(imageResponse.headers.get('content-type')).toBe('image/png')
    expect(imageResponse.headers.get('content-length')).toBe('3')
    expect(new Uint8Array(await imageResponse.arrayBuffer())).toEqual(new Uint8Array([10, 11, 12]))

    for (const path of ['readme.txt', 'missing.png', 'folder.png']) {
      const url = `app://fs/@fs${join(mediaRoot, path)}`
      expect((await handler()(request(url))).status).toBe(404)
    }
  })

  it('supports full and single-range video responses', async () => {
    const url = toAppMediaUrl(join(mediaRoot, 'clip.mp4'))!
    const full = await handler()(request(url))
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(full.headers.get('content-length')).toBe('10')
    expect(await full.text()).toBe('0123456789')

    const range = await handler()(request(url, 'bytes=2-5'))
    expect(range.status).toBe(206)
    expect(range.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(range.headers.get('content-length')).toBe('4')
    expect(await range.text()).toBe('2345')
  })

  it.each([
    ['bytes=4-', '456789'],
    ['bytes=-3', '789'],
    ['bytes=8-99', '89']
  ])('supports %s', async (rangeHeader, expected) => {
    const response = await handler()(
      request(toAppMediaUrl(join(mediaRoot, 'clip.mp4'))!, rangeHeader)
    )

    expect(response.status).toBe(206)
    expect(await response.text()).toBe(expected)
  })

  it.each(['bytes=20-30', 'bytes=5-4', 'bytes=0-1,4-5', 'items=0-1', 'bytes=-0'])(
    'returns 416 for invalid range %s',
    async (rangeHeader) => {
      const response = await handler()(
        request(toAppMediaUrl(join(mediaRoot, 'clip.mp4'))!, rangeHeader)
      )

      expect(response.status).toBe(416)
      expect(response.headers.get('content-range')).toBe('bytes */10')
    }
  )

  it('uses net.fetch for non-video files on Windows', async () => {
    const netFetch = vi.fn(async () => new Response('abc', { status: 200 }))
    const windowsPath = 'C:\\Users\\alice\\photo.png'
    const windowsHandler = createAppProtocolHandler({
      rendererRoot: 'C:\\renderer',
      platform: 'win32',
      statFile: vi.fn(async () => ({ isFile: () => true, size: 3 })),
      openFileStream: vi.fn(() => Readable.from([])),
      netFetch
    })

    const response = await windowsHandler(request(toAppMediaUrl(windowsPath, 'win32')!))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe('3')
    expect(netFetch).toHaveBeenCalledWith('file:///C:/Users/alice/photo.png')
  })

  it('parses valid byte ranges without I/O', () => {
    expect(parseByteRange('bytes=0-0', 10)).toEqual({ start: 0, end: 0 })
    expect(parseByteRange('bytes=-20', 10)).toEqual({ start: 0, end: 9 })
    expect(parseByteRange('bytes=10-', 10)).toBeNull()
  })

  it('logs rejected requests without exposing their full local path', async () => {
    const warn = vi.fn()
    const privatePath = join(mediaRoot, 'private', 'missing.png')
    const response = await createAppProtocolHandler({ rendererRoot, logger: { warn } })(
      request(toAppMediaUrl(privatePath)!)
    )

    expect(response.status).toBe(404)
    expect(warn).toHaveBeenCalledWith('local app protocol request rejected', {
      protocol: 'app',
      host: 'fs',
      extension: '.png',
      status: 'not-found'
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain(privatePath)
  })

  function handler(): ReturnType<typeof createAppProtocolHandler> {
    return createAppProtocolHandler({ rendererRoot })
  }
})

function request(url: string, range?: string): AppProtocolRequest {
  const headers = new Headers()
  if (range) headers.set('range', range)
  return { url, headers }
}

function requestDecision(
  listener: (
    details: AppMediaRequestDetails,
    callback: (response: { cancel?: boolean }) => void
  ) => void,
  details: AppMediaRequestDetails
): { cancel?: boolean } | undefined {
  let decision: { cancel?: boolean } | undefined
  listener(details, (response) => {
    decision = response
  })
  return decision
}
