import { stat as nodeStat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UIMessage } from 'ai'

import {
  COMPOSER_CONTEXT_CATALOG_VERSION,
  LOCAL_FILE_ATTACHMENT_MEDIA_TYPE,
  LOCAL_FOLDER_ATTACHMENT_MEDIA_TYPE,
  isSafeLocalOpenPath,
  localAttachmentValidationRequestSchema,
  localAttachmentValidationResultSchema,
  type LocalAttachmentReference,
  type LocalAttachmentValidationResult
} from '../../shared/codexIpcApi'

type FileStatLike = {
  isFile(): boolean
  isDirectory(): boolean
}

export type LocalAttachmentValidatorOptions = {
  stat?: (path: string) => Promise<FileStatLike>
}

export async function validateLocalAttachmentsInLatestUserMessage(
  messages: readonly UIMessage[],
  options: LocalAttachmentValidatorOptions = {}
): Promise<number> {
  const references = localAttachmentReferencesInLatestUserMessage(messages)
  if (references.length === 0) return 0

  const result = await validateLocalAttachments(
    { version: COMPOSER_CONTEXT_CATALOG_VERSION, references },
    options
  )
  if (!result.valid) {
    const invalid = result.entries.find((entry) => !entry.valid)
    throw new Error(
      invalid?.error
        ? `Invalid local attachment “${invalid.reference.label}”: ${invalid.error}`
        : 'Invalid local attachment'
    )
  }
  return references.length
}

function localAttachmentReferencesInLatestUserMessage(
  messages: readonly UIMessage[]
): LocalAttachmentReference[] {
  let latestUserMessage: UIMessage | undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserMessage = messages[index]
      break
    }
  }
  if (!latestUserMessage) return []

  return latestUserMessage.parts.flatMap((part): LocalAttachmentReference[] => {
    if (!part || typeof part !== 'object' || part.type !== 'file') return []
    const mediaType = 'mediaType' in part ? part.mediaType : undefined
    const kind =
      mediaType === LOCAL_FILE_ATTACHMENT_MEDIA_TYPE
        ? 'file'
        : mediaType === LOCAL_FOLDER_ATTACHMENT_MEDIA_TYPE
          ? 'folder'
          : undefined
    if (!kind) return []

    const url = 'url' in part ? part.url : undefined
    if (typeof url !== 'string') {
      throw new Error('Invalid local attachment: file URL is missing')
    }
    let path: string
    try {
      path = fileURLToPath(url)
    } catch {
      throw new Error('Invalid local attachment: file URL is invalid')
    }
    const filename = 'filename' in part ? part.filename : undefined
    const label = typeof filename === 'string' && filename.trim() ? filename.trim() : basename(path)
    return [{ kind, path, fileUrl: url, label }]
  })
}

export async function validateLocalAttachments(
  payload: unknown,
  options: LocalAttachmentValidatorOptions = {}
): Promise<LocalAttachmentValidationResult> {
  const request = localAttachmentValidationRequestSchema.parse(payload)
  const stat = options.stat ?? nodeStat
  const entries = await Promise.all(
    request.references.map(async (reference) => {
      const error = await validationError(reference, stat)
      return {
        reference,
        valid: error === undefined,
        ...(error ? { error } : {})
      }
    })
  )

  return localAttachmentValidationResultSchema.parse({
    version: COMPOSER_CONTEXT_CATALOG_VERSION,
    valid: entries.every((entry) => entry.valid),
    entries
  })
}

async function validationError(
  reference: LocalAttachmentReference,
  stat: (path: string) => Promise<FileStatLike>
): Promise<string | undefined> {
  if (!isSafeLocalOpenPath(reference.path)) return 'path must be an absolute local path'
  if (reference.kind !== 'image') {
    let fileUrlPath: string
    try {
      fileUrlPath = fileURLToPath(reference.fileUrl)
    } catch {
      return 'file URL is invalid'
    }
    if (resolve(fileUrlPath) !== resolve(reference.path)) {
      return 'file URL does not match the local path'
    }
  }

  let fileStat: FileStatLike
  try {
    fileStat = await stat(reference.path)
  } catch {
    return 'path does not exist or is not readable'
  }

  if (reference.kind === 'folder') {
    return fileStat.isDirectory() ? undefined : 'expected a folder'
  }
  return fileStat.isFile() ? undefined : 'expected a file'
}

export function createValidateLocalAttachmentsHandler(
  options: LocalAttachmentValidatorOptions = {}
): (_event: unknown, payload: unknown) => Promise<LocalAttachmentValidationResult> {
  return (_event, payload) => validateLocalAttachments(payload, options)
}
