import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  localContextPickerPayloadSchema,
  localContextReferenceSchema,
  localContextReferenceListSchema,
  type LocalContextPickerKind,
  type LocalContextReference
} from '../shared/codexIpcApi'
import { mediaTypeForPath, toAppMediaUrl } from './localMediaProtocol'

type LocalContextDialogKind = LocalContextPickerKind | 'files' | 'folders'

export type LocalContextPickerDialogOptions = {
  properties: Array<'openFile' | 'openDirectory' | 'multiSelections'>
}

export type LocalContextPickerDependencies = {
  choosePickerKind?: () => Promise<'files' | 'folders' | null>
  showOpenDialog(options: LocalContextPickerDialogOptions): Promise<{
    canceled: boolean
    filePaths: string[]
  }>
  stat(path: string): Promise<{
    isFile(): boolean
    isDirectory(): boolean
  }>
}

export async function pickLocalContext(
  dependencies: LocalContextPickerDependencies,
  pickerKind: LocalContextPickerKind
): Promise<LocalContextReference[]> {
  const dialogKind = dependencies.choosePickerKind
    ? await dependencies.choosePickerKind()
    : pickerKind
  if (dialogKind === null) return []

  const result = await dependencies.showOpenDialog({
    properties: dialogPropertiesFor(dialogKind)
  })

  if (result.canceled) return []

  const references: LocalContextReference[] = []
  const seenPaths = new Set<string>()

  for (const path of result.filePaths) {
    if (seenPaths.has(path)) continue
    seenPaths.add(path)

    const parsedPath = localContextReferenceSchema.safeParse({
      kind: 'file',
      path,
      label: path,
      fileUrl: pathToFileURL(path).href
    })
    if (!parsedPath.success) continue

    let stats: Awaited<ReturnType<LocalContextPickerDependencies['stat']>>
    try {
      stats = await dependencies.stat(path)
    } catch (error) {
      if (isMissingPathError(error)) continue
      throw new Error(`Unable to inspect selected path: ${errorMessage(error)}`)
    }

    const selectedKind = selectedPathKind(stats)
    if (!acceptsSelectedKind(dialogKind, selectedKind)) continue

    const label = basename(path) || path
    const fileUrl = pathToFileURL(path).href
    const mediaType = selectedKind === 'file' ? mediaTypeForPath(path) : undefined
    const previewUrl = mediaType?.startsWith('image/') ? toAppMediaUrl(path) : null

    references.push(
      mediaType && previewUrl
        ? { kind: 'image', path, label, mediaType, previewUrl }
        : { kind: selectedKind, path, label, fileUrl }
    )
  }

  return localContextReferenceListSchema.parse(references)
}

function selectedPathKind(
  stats: Awaited<ReturnType<LocalContextPickerDependencies['stat']>>
): 'file' | 'folder' | null {
  if (stats.isFile()) return 'file'
  if (stats.isDirectory()) return 'folder'
  return null
}

export function createPickLocalContextHandler(dependencies: LocalContextPickerDependencies) {
  return async (_event: unknown, payload: unknown): Promise<LocalContextReference[]> => {
    const { kind } = localContextPickerPayloadSchema.parse(payload)
    return pickLocalContext(dependencies, kind)
  }
}

function dialogPropertiesFor(
  kind: LocalContextDialogKind
): LocalContextPickerDialogOptions['properties'] {
  if (kind === 'files') return ['openFile', 'multiSelections']
  if (kind === 'folders') return ['openDirectory', 'multiSelections']
  return ['openFile', 'openDirectory', 'multiSelections']
}

function acceptsSelectedKind(
  dialogKind: LocalContextDialogKind,
  selectedKind: 'file' | 'folder' | null
): selectedKind is 'file' | 'folder' {
  if (selectedKind === null) return false
  if (dialogKind === 'files') return selectedKind === 'file'
  if (dialogKind === 'folders') return selectedKind === 'folder'
  return true
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
