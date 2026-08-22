import { posix, win32, type PlatformPath } from 'node:path'

import {
  codexOpenLocalPathPayloadSchema,
  isSafeLocalOpenPath,
  type CodexOpenLocalPathPayload
} from '../shared/codexIpcApi'

export type ShellOpenPath = (filePath: string) => Promise<string>
export type ShellRevealPath = (filePath: string) => void

export async function openLocalPath(
  request: CodexOpenLocalPathPayload,
  shellOpenPath: ShellOpenPath
): Promise<void> {
  const validatedRequest = codexOpenLocalPathPayloadSchema.parse(request)
  const resolvedPath = resolveLocalOpenPath(validatedRequest)
  const error = await shellOpenPath(resolvedPath)
  if (error) throw new Error(error)
}

export function createOpenLocalPathHandler(shellOpenPath: ShellOpenPath) {
  return async (_event: unknown, payload: unknown): Promise<void> => {
    const request = codexOpenLocalPathPayloadSchema.parse(payload)
    await openLocalPath(request, shellOpenPath)
  }
}

export function createRevealLocalPathHandler(shellRevealPath: ShellRevealPath) {
  return async (_event: unknown, payload: unknown): Promise<void> => {
    const request = codexOpenLocalPathPayloadSchema.parse(payload)
    shellRevealPath(resolveLocalOpenPath(request))
  }
}

export function resolveLocalOpenPath(request: CodexOpenLocalPathPayload): string {
  if (isSafeLocalOpenPath(request.path)) return request.path
  if (!request.cwd || !isSafeLocalOpenPath(request.cwd)) {
    throw new Error('relative paths require an absolute local cwd')
  }

  const pathApi = selectPathApi(request.cwd)
  const cwd = pathApi.resolve(request.cwd)
  const relativePath = stripWorkspaceBasename(request.path, cwd, pathApi)
  const resolvedPath = pathApi.resolve(cwd, relativePath)
  const pathFromCwd = pathApi.relative(cwd, resolvedPath)

  if (
    pathFromCwd === '..' ||
    pathFromCwd.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(pathFromCwd)
  ) {
    throw new Error('relative path must stay inside cwd')
  }

  return resolvedPath
}

function selectPathApi(cwd: string): PlatformPath {
  return /^[A-Za-z]:[\\/]/u.test(cwd) ? win32 : posix
}

function stripWorkspaceBasename(filePath: string, cwd: string, pathApi: PlatformPath): string {
  const normalizedPath = pathApi.normalize(filePath)
  const workspaceBasename = pathApi.basename(cwd)
  const firstSeparator = normalizedPath.indexOf(pathApi.sep)
  const firstSegment =
    firstSeparator === -1 ? normalizedPath : normalizedPath.slice(0, firstSeparator)

  if (firstSegment !== workspaceBasename) return normalizedPath
  return firstSeparator === -1 ? '.' : normalizedPath.slice(firstSeparator + 1)
}
