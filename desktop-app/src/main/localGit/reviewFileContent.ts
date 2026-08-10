import { relative, resolve } from 'node:path'

import { LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES } from '../../shared/localGitApi'
import type {
  LocalGitReviewFile,
  LocalGitReviewFileContent,
  LocalGitReviewContentSide,
  LocalGitReviewSource
} from './types'
import type { WorktreeRepository } from './GitManager'

export async function readReviewFileContent({
  repository,
  source,
  file,
  side
}: {
  repository: WorktreeRepository
  source: Exclude<LocalGitReviewSource, { type: 'last-turn' }>
  file: LocalGitReviewFile
  side: LocalGitReviewContentSide
}): Promise<LocalGitReviewFileContent> {
  if (file.conflicted) {
    return { status: 'unsupported', reason: '此文件不能安全地作为富预览读取。' }
  }
  const mimeType = supportedMimeType(file.path)
  if (!mimeType) return { status: 'unsupported', reason: '此文件类型暂不支持富预览。' }
  const path = side === 'before' ? (file.previousPath ?? file.path) : file.path
  const readResult = await readSourceBytes(repository, source, side, path)
  if (readResult === 'too-large') {
    return { status: 'too-large', maxBytes: LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES }
  }
  if (!readResult) return { status: 'unsupported', reason: '当前审阅来源没有可读取的文件内容。' }
  const bytes = readResult
  if (bytes.length > LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES) {
    return {
      status: 'too-large',
      maxBytes: LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES,
      size: bytes.length
    }
  }
  if (mimeType === 'text/markdown') {
    try {
      return {
        status: 'text',
        mimeType,
        text: new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      }
    } catch {
      return { status: 'unsupported', reason: 'Markdown 文件不是有效的 UTF-8 文本。' }
    }
  }
  return { status: 'media', mimeType, base64: Buffer.from(bytes).toString('base64') }
}

async function readSourceBytes(
  repository: WorktreeRepository,
  source: Exclude<LocalGitReviewSource, { type: 'last-turn' }>,
  side: LocalGitReviewContentSide,
  path: string
): Promise<Uint8Array | 'too-large' | undefined> {
  const spec = await gitObjectSpec(repository, source, side, path)
  if (!spec) {
    return shouldReadWorktreeFile(source, side)
      ? readVerifiedWorktreeFile(repository, path)
      : undefined
  }
  const readBytes = repository.host.runGitBytes
  if (!readBytes) return undefined
  const result = await readBytes(['show', '--no-ext-diff', '--format=', spec], repository.root, {
    maxOutputBytes: LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES + 1
  })
  if (!result.success && result.stderr.includes('output exceeded limit')) return 'too-large'
  return result.success ? result.stdout : undefined
}

async function gitObjectSpec(
  repository: WorktreeRepository,
  source: Exclude<LocalGitReviewSource, { type: 'last-turn' }>,
  side: LocalGitReviewContentSide,
  path: string
): Promise<string | undefined> {
  switch (source.type) {
    case 'unstaged':
      return side === 'before' ? `:${path}` : undefined
    case 'staged':
      return side === 'before' ? `HEAD:${path}` : `:${path}`
    case 'commit':
      return side === 'before' ? `${source.commitSha}^:${path}` : `${source.commitSha}:${path}`
    case 'branch':
      if (side === 'after') return `HEAD:${path}`
      return resolveBranchMergeBase(repository, source.baseBranch).then((mergeBase) =>
        mergeBase ? `${mergeBase}:${path}` : undefined
      )
  }
}

function shouldReadWorktreeFile(
  source: Exclude<LocalGitReviewSource, { type: 'last-turn' }>,
  side: LocalGitReviewContentSide
): boolean {
  return source.type === 'unstaged' && side === 'after'
}

async function resolveBranchMergeBase(
  repository: WorktreeRepository,
  baseBranch: string
): Promise<string | undefined> {
  const result = await repository.git(['merge-base', baseBranch, 'HEAD'])
  const mergeBase = result.stdout.trim()
  return result.success && mergeBase ? mergeBase : undefined
}

async function readVerifiedWorktreeFile(
  repository: WorktreeRepository,
  relativePath: string
): Promise<Uint8Array | 'too-large' | undefined> {
  const readBytes = repository.host.readFileBytes
  const resolveFile = repository.host.realpathFile
  if (!readBytes || !resolveFile) return undefined
  const absolutePath = resolve(repository.root, relativePath)
  const normalizedRelative = relative(repository.root, absolutePath)
  if (
    !normalizedRelative ||
    normalizedRelative.startsWith('..') ||
    normalizedRelative.includes('..\\')
  ) {
    return undefined
  }
  try {
    const [realRoot, realPath] = await Promise.all([
      resolveFile(repository.root),
      resolveFile(absolutePath)
    ])
    const resolvedRelative = relative(realRoot, realPath)
    if (
      !resolvedRelative ||
      resolvedRelative.startsWith('..') ||
      resolvedRelative.includes('..\\')
    ) {
      return undefined
    }
    const bytes = await readBytes(realPath, {
      maxBytes: LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES + 1
    })
    return bytes.length > LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES ? 'too-large' : bytes
  } catch {
    return undefined
  }
}

function supportedMimeType(path: string): string | undefined {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLocaleLowerCase()
  switch (extension) {
    case 'md':
    case 'mdx':
      return 'text/markdown'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'pdf':
      return 'application/pdf'
    default:
      return undefined
  }
}
