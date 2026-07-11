import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, isAbsolute, join, normalize, posix, relative, win32 } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const APP_SCHEME = 'app'
export const APP_RENDERER_HOST = '-'
export const APP_MEDIA_HOST = 'fs'
export const APP_MEDIA_PREFIX = '/@fs'
export const APP_RENDERER_ORIGIN = `${APP_SCHEME}://${APP_RENDERER_HOST}`
export const APP_MEDIA_ORIGIN = `${APP_SCHEME}://${APP_MEDIA_HOST}`

const staticMimeTypes: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

export const localMediaMimeTypes: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webm': 'video/webm',
  '.webp': 'image/webp'
}

type Platform = NodeJS.Platform
type FileStat = { isFile(): boolean; size: number }
type StatFile = (path: string) => Promise<FileStat>
type OpenFileStream = (path: string, options?: { start?: number; end?: number }) => Readable
type NetFetch = (url: string, init?: RequestInit) => Promise<Response>

export type AppProtocolRequest = {
  url: string
  headers: Headers
}

export type ProtocolRegistrar = {
  registerSchemesAsPrivileged(schemes: unknown[]): void
  handle(
    scheme: string,
    handler: (request: AppProtocolRequest) => Promise<Response> | Response
  ): void
}

export type AppMediaRequestDetails = {
  frame?: { url: string } | null
  resourceType: string
  webContentsId?: number
}

export type SessionRegistrar = {
  webRequest: {
    onBeforeRequest(
      filter: { urls: string[] },
      listener: (
        details: AppMediaRequestDetails,
        callback: (response: { cancel?: boolean }) => void
      ) => void
    ): void
  }
}

type ProtocolLogger = Pick<Console, 'warn'>

export type RegisterAppProtocolOptions = {
  protocol: ProtocolRegistrar
  session: SessionRegistrar
  rendererRoot: string
  devRendererUrl?: string
  platform?: Platform
  statFile?: StatFile
  openFileStream?: OpenFileStream
  netFetch?: NetFetch
  logger?: ProtocolLogger
}

export type CreateAppProtocolHandlerOptions = Omit<
  RegisterAppProtocolOptions,
  'protocol' | 'session' | 'devRendererUrl'
>

const privilegedProtocolRegistrars = new WeakSet<object>()
const registeredProtocolHandlers = new WeakSet<object>()

export function registerAppSchemePrivileges(protocol: ProtocolRegistrar): void {
  if (privilegedProtocolRegistrars.has(protocol)) return

  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true
      }
    }
  ])
  privilegedProtocolRegistrars.add(protocol)
}

export function registerAppProtocol(options: RegisterAppProtocolOptions): void {
  if (registeredProtocolHandlers.has(options.protocol)) return

  options.protocol.handle(APP_SCHEME, createAppProtocolHandler(options))
  const devRendererOrigin = httpOrigin(options.devRendererUrl)

  options.session.webRequest.onBeforeRequest(
    { urls: [`${APP_MEDIA_ORIGIN}/*`] },
    (details, callback) => {
      const allowed = isAllowedAppMediaRequest(details, devRendererOrigin)
      if (!allowed) {
        options.logger?.warn('blocked local media protocol request', {
          protocol: APP_SCHEME,
          resourceType: details.resourceType,
          status: 'cancelled',
          webContentsId: details.webContentsId
        })
      }
      callback({ cancel: !allowed })
    }
  )

  registeredProtocolHandlers.add(options.protocol)
}

export function createAppRendererUrl(): string {
  return `${APP_RENDERER_ORIGIN}/index.html`
}

export function toAppMediaUrl(
  fileUrlOrAbsolutePath: string,
  platform: Platform = process.platform
): string | null {
  let filePath = fileUrlOrAbsolutePath
  if (isFileUrl(fileUrlOrAbsolutePath)) {
    try {
      filePath = fileURLToPath(fileUrlOrAbsolutePath)
    } catch {
      return null
    }
  }

  const pathApi = platform === 'win32' ? win32 : posix
  if (!pathApi.isAbsolute(filePath)) return null

  const normalizedPath = pathApi.normalize(filePath)
  if (!mediaTypeForPath(normalizedPath, platform)) return null

  let urlPath = platform === 'win32' ? normalizedPath.replaceAll('\\', '/') : normalizedPath
  if (platform === 'win32' && /^[A-Za-z]:\//.test(urlPath)) urlPath = `/${urlPath}`
  if (!urlPath.startsWith('/')) urlPath = `/${urlPath}`

  const encodedPath = encodeURI(urlPath).replaceAll('#', '%23').replaceAll('?', '%3F')
  return `${APP_MEDIA_ORIGIN}${APP_MEDIA_PREFIX}${encodedPath}`
}

export function resolveAppMediaPath(
  appMediaUrl: string,
  platform: Platform = process.platform
): string | null {
  const rawPathname = rawPathnameFromAppUrl(appMediaUrl)
  if (!rawPathname || containsTraversal(rawPathname)) return null

  let url: URL
  try {
    url = new URL(appMediaUrl)
  } catch {
    return null
  }
  if (
    url.protocol !== `${APP_SCHEME}:` ||
    url.host !== APP_MEDIA_HOST ||
    !url.pathname.startsWith(APP_MEDIA_PREFIX)
  ) {
    return null
  }

  const encodedPath = url.pathname.slice(APP_MEDIA_PREFIX.length)
  if (!encodedPath) return null

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(encodedPath)
  } catch {
    return null
  }
  if (containsTraversal(decodedPath)) return null

  const normalizedPath = normalizeMediaPath(decodedPath, platform)
  if (!normalizedPath || !mediaTypeForPath(normalizedPath, platform)) return null
  return normalizedPath
}

export function mediaTypeForPath(
  filePath: string,
  platform: Platform = process.platform
): string | undefined {
  const pathApi = platform === 'win32' ? win32 : posix
  return localMediaMimeTypes[pathApi.extname(filePath).toLowerCase()]
}

export function isAllowedAppMediaRequest(
  details: AppMediaRequestDetails,
  devRendererOrigin?: string
): boolean {
  if (details.resourceType !== 'image' && details.resourceType !== 'media') return false
  const frameOrigin = frameOriginFromUrl(details.frame?.url)
  return frameOrigin === APP_RENDERER_ORIGIN || frameOrigin === devRendererOrigin
}

export function frameOriginFromUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === `${APP_SCHEME}:`) return `${APP_SCHEME}://${url.host}`
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin
    return null
  } catch {
    return null
  }
}

export function parseByteRange(
  rangeHeader: string,
  size: number
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
  if (!match) return null
  const [, startText = '', endText = ''] = match
  if (!startText && !endText) return null

  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || size === 0) return null
    return { start: Math.max(size - suffixLength, 0), end: size - 1 }
  }

  const start = Number(startText)
  const end = endText ? Number(endText) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null
  }
  return { start, end: Math.min(end, size - 1) }
}

export function createAppProtocolHandler(
  options: CreateAppProtocolHandlerOptions
): (request: AppProtocolRequest) => Promise<Response> {
  const platform = options.platform ?? process.platform
  const statFile = options.statFile ?? stat
  const openFileStream = options.openFileStream ?? createReadStream

  return async (request) => {
    const resolved = resolveProtocolFile(request.url, options.rendererRoot, platform)
    if (!resolved) {
      logRejectedProtocolRequest(options.logger, request.url, 'not-allowed')
      return notFoundResponse()
    }

    let fileStat: FileStat
    try {
      fileStat = await statFile(resolved.path)
    } catch {
      logRejectedProtocolRequest(options.logger, request.url, 'not-found')
      return notFoundResponse()
    }
    if (!fileStat.isFile()) {
      logRejectedProtocolRequest(options.logger, request.url, 'not-file')
      return notFoundResponse()
    }

    if (resolved.mediaType.startsWith('video/')) {
      return videoResponse(request, resolved.path, resolved.mediaType, fileStat, openFileStream)
    }

    if (platform === 'win32' && options.netFetch) {
      const response = await options.netFetch(localPathToFileUrl(resolved.path, platform))
      const headers = new Headers(response.headers)
      headers.set('Content-Length', String(fileStat.size))
      headers.set('Content-Type', resolved.mediaType)
      return new Response(response.body, { status: response.status, headers })
    }

    return streamResponse(resolved.path, resolved.mediaType, fileStat.size, openFileStream)
  }
}

function resolveProtocolFile(
  requestUrl: string,
  rendererRoot: string,
  platform: Platform
): { path: string; mediaType: string } | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${APP_SCHEME}:`) return null

  if (url.host === APP_MEDIA_HOST) {
    const path = resolveAppMediaPath(requestUrl, platform)
    const mediaType = path ? mediaTypeForPath(path, platform) : undefined
    return path && mediaType ? { path, mediaType } : null
  }

  if (url.host !== APP_RENDERER_HOST) return null
  const path = resolveStaticPath(requestUrl, rendererRoot)
  const mediaType = path ? staticMimeTypes[extname(path).toLowerCase()] : undefined
  return path && mediaType ? { path, mediaType } : null
}

function resolveStaticPath(requestUrl: string, rendererRoot: string): string | null {
  const rawPathname = rawPathnameFromAppUrl(requestUrl)
  if (!rawPathname || containsTraversal(rawPathname)) return null

  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (containsTraversal(decodedPath)) return null

  const relativeUrlPath = posix.normalize(decodedPath).replace(/^\/+/, '')
  const assetPath = !relativeUrlPath || relativeUrlPath === '.' ? 'index.html' : relativeUrlPath
  const resolvedPath = normalize(join(rendererRoot, ...assetPath.split('/')))
  const relativePath = relative(rendererRoot, resolvedPath)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null
  return resolvedPath
}

function normalizeMediaPath(decodedPath: string, platform: Platform): string | null {
  if (platform !== 'win32') {
    const normalizedPath = posix.normalize(decodedPath)
    return posix.isAbsolute(normalizedPath) ? normalizedPath : null
  }

  let windowsPath = decodedPath.replaceAll('/', '\\')
  if (/^\\[A-Za-z]:\\/.test(windowsPath)) windowsPath = windowsPath.slice(1)
  const normalizedPath = win32.normalize(windowsPath)
  return win32.isAbsolute(normalizedPath) ? normalizedPath : null
}

function streamResponse(
  path: string,
  mediaType: string,
  size: number,
  openFileStream: OpenFileStream
): Response {
  const body = Readable.toWeb(openFileStream(path)) as ReadableStream<Uint8Array>
  return new Response(body, {
    headers: {
      'Content-Length': String(size),
      'Content-Type': mediaType
    }
  })
}

function videoResponse(
  request: AppProtocolRequest,
  path: string,
  mediaType: string,
  fileStat: FileStat,
  openFileStream: OpenFileStream
): Response {
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': mediaType
  })
  const rangeHeader = request.headers.get('range')
  if (!rangeHeader) {
    headers.set('Content-Length', String(fileStat.size))
    const body = Readable.toWeb(openFileStream(path)) as ReadableStream<Uint8Array>
    return new Response(body, { headers })
  }

  const range = parseByteRange(rangeHeader, fileStat.size)
  if (!range) {
    headers.set('Content-Range', `bytes */${fileStat.size}`)
    return new Response(null, { status: 416, statusText: 'Range Not Satisfiable', headers })
  }

  headers.set('Content-Length', String(range.end - range.start + 1))
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${fileStat.size}`)
  const body = Readable.toWeb(openFileStream(path, range)) as ReadableStream<Uint8Array>
  return new Response(body, { status: 206, statusText: 'Partial Content', headers })
}

function notFoundResponse(): Response {
  return new Response(null, { status: 404, statusText: 'Not Found' })
}

function logRejectedProtocolRequest(
  logger: ProtocolLogger | undefined,
  requestUrl: string,
  status: 'not-allowed' | 'not-found' | 'not-file'
): void {
  if (!logger) return

  let host = 'invalid'
  let extension = ''
  try {
    const url = new URL(requestUrl)
    host = url.host
    extension = posix.extname(url.pathname).toLowerCase()
  } catch {
    // Keep the structured fallback values and never log the raw URL.
  }
  logger.warn('local app protocol request rejected', {
    protocol: APP_SCHEME,
    host,
    extension,
    status
  })
}

function rawPathnameFromAppUrl(value: string): string | null {
  if (!value.startsWith(`${APP_SCHEME}://`)) return null
  const authorityAndPath = value.slice(`${APP_SCHEME}://`.length)
  const slashIndex = authorityAndPath.indexOf('/')
  const rawPath = slashIndex >= 0 ? authorityAndPath.slice(slashIndex) : '/'
  return rawPath.split('?')[0]?.split('#')[0] ?? null
}

function containsTraversal(value: string): boolean {
  let candidate = value
  for (let pass = 0; pass < 3; pass += 1) {
    if (
      candidate
        .replaceAll('\\', '/')
        .split('/')
        .some((segment) => segment === '..' || /^\.\.[. ]+$/.test(segment))
    ) {
      return true
    }

    let decoded: string
    try {
      decoded = decodeURIComponent(candidate)
    } catch {
      return true
    }
    if (decoded === candidate) return false
    candidate = decoded
  }
  return candidate.includes('%')
}

function httpOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined
  } catch {
    return undefined
  }
}

function isFileUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'file:'
  } catch {
    return false
  }
}

function localPathToFileUrl(filePath: string, platform: Platform): string {
  if (platform !== 'win32') return pathToFileURL(filePath).href

  const normalizedPath = win32.normalize(filePath).replaceAll('\\', '/')
  if (normalizedPath.startsWith('//')) {
    const [host = '', ...segments] = normalizedPath.slice(2).split('/')
    return `file://${host}/${encodeFileUrlPath(segments.join('/'))}`
  }
  return `file:///${encodeFileUrlPath(normalizedPath)}`
}

function encodeFileUrlPath(value: string): string {
  return encodeURI(value).replaceAll('#', '%23').replaceAll('?', '%3F')
}
