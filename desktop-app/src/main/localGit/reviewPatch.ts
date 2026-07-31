import { posix as pathPosix } from 'node:path'

const diffPathPrefixes = ['+++ ', '--- ', 'rename from ', 'rename to ', 'copy from ', 'copy to ']

export type ParsedPatchPath = {
  path: string
}

export function validateGitPatch(patch: string): ParsedPatchPath[] {
  if (patch.includes('\0')) throw new Error('patch must not contain NUL bytes')
  const paths = new Map<string, ParsedPatchPath>()

  for (const line of patch.split(/\r?\n/u)) {
    for (const prefix of diffPathPrefixes) {
      if (!line.startsWith(prefix)) continue
      const raw = line.slice(prefix.length).trim()
      if (raw === '/dev/null') continue
      const path = normalizeDiffPath(raw)
      assertSafeRepoRelativePath(path)
      paths.set(path, { path })
    }

    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line)
      if (!match) throw new Error('unsupported git diff header')
      for (const rawPath of [match[1], match[2]]) {
        const path = unquoteDiffPath(rawPath)
        assertSafeRepoRelativePath(path)
        paths.set(path, { path })
      }
    }
  }

  return [...paths.values()]
}

export function extractFilePatch(patch: string, filePath: string): string {
  const sections = splitFilePatches(patch)
  const section = sections.find((candidate) => candidate.paths.includes(filePath))
  if (!section) throw new Error(`patch for file not found: ${filePath}`)
  return section.patch
}

export function extractHunkPatch(patch: string, filePath: string, hunkIndex: number): string {
  const section = splitFilePatches(patch).find((candidate) => candidate.paths.includes(filePath))
  if (!section) throw new Error(`patch for file not found: ${filePath}`)
  const lines = section.patch.split(/\n/u)
  const hunkStarts = lines
    .map((line, index) => (line.startsWith('@@ ') ? index : -1))
    .filter((index) => index >= 0)
  const hunkStart = hunkStarts[hunkIndex]
  if (hunkStart === undefined) throw new Error(`hunk not found: ${hunkIndex}`)
  const nextHunkStart = hunkStarts.find((index) => index > hunkStart) ?? lines.length
  const firstHunkStart = hunkStarts[0] ?? hunkStart
  return [...lines.slice(0, firstHunkStart), ...lines.slice(hunkStart, nextHunkStart)].join('\n')
}

export function pathsFromPatch(patch: string): string[] {
  return validateGitPatch(patch).map((entry) => entry.path)
}

function splitFilePatches(patch: string): Array<{ patch: string; paths: string[] }> {
  const lines = patch.split(/\n/u)
  const starts = lines
    .map((line, index) => (line.startsWith('diff --git ') ? index : -1))
    .filter((index) => index >= 0)
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? lines.length
    const section = lines.slice(start, end).join('\n')
    return {
      patch: section.endsWith('\n') ? section : `${section}\n`,
      paths: pathsFromPatchHeader(lines[start])
    }
  })
}

function pathsFromPatchHeader(line: string): string[] {
  const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line)
  if (!match) return []
  return [unquoteDiffPath(match[1]), unquoteDiffPath(match[2])]
}

function normalizeDiffPath(raw: string): string {
  const withoutPrefix = raw.startsWith('a/') || raw.startsWith('b/') ? raw.slice(2) : raw
  return unquoteDiffPath(withoutPrefix)
}

function unquoteDiffPath(path: string): string {
  if (path.startsWith('"') && path.endsWith('"')) {
    return path
      .slice(1, -1)
      .replace(/\\"/gu, '"')
      .replace(/\\t/gu, '\t')
      .replace(/\\n/gu, '\n')
      .replace(/\\\\/gu, '\\')
  }
  return path
}

export function assertSafeRepoRelativePath(path: string): void {
  if (!path || path.includes('\0')) throw new Error('path must be a non-empty relative path')
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path)) {
    throw new Error(`absolute paths are not allowed: ${path}`)
  }
  if (path.startsWith('..') || path.includes('/../') || path.includes('\\')) {
    throw new Error(`path must stay inside the repository: ${path}`)
  }
  if (pathPosix.normalize(path) !== path) {
    throw new Error(`path must be normalized: ${path}`)
  }
}
