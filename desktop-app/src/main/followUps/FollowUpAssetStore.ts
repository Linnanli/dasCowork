import { createHash, randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM,
  FOLLOW_UP_QUEUE_MAX_TOTAL_ASSET_BYTES,
  type FollowUpAssetInput,
  type FollowUpLocalImageInput,
  type FollowUpPersistedAsset
} from '../../shared/codexFollowUpApi'
import { mediaTypeForPath } from '../localMediaProtocol'
import type {
  LocalImageCapabilityRequest,
  LocalImageFileIdentity
} from '../localImageCapabilityStore'

export type FollowUpAssetStoreLimits = {
  maxBytesPerItem: number
  maxTotalBytes: number
}

export type FollowUpAssetStoreOptions = Partial<FollowUpAssetStoreLimits> & {
  authorizeLocalImages?: (requests: readonly LocalImageCapabilityRequest[]) => void
  openFile?: (path: string, flags: 'r') => Promise<FileHandle>
}

export type FollowUpAssetToPersist =
  | FollowUpAssetInput
  | FollowUpLocalImageInput
  | FollowUpPersistedAsset

export type MaterializedFollowUpAsset = {
  id: string
  displayName: string
  mediaType: string
  dataUrl: string
  sizeBytes: number
  sha256: string
}

export type DurableFollowUpAsset = Omit<MaterializedFollowUpAsset, 'dataUrl'> & {
  fileUrl: string
}

export type PrepareFollowUpAssetOptions = {
  allowedExistingRelativePaths?: readonly string[]
}

export class FollowUpAssetCapacityError extends Error {
  constructor(
    readonly code: 'item-assets-too-large' | 'queue-assets-too-large',
    message: string
  ) {
    super(message)
    this.name = 'FollowUpAssetCapacityError'
  }
}

export type PreparedFollowUpAssets = {
  readonly assets: FollowUpPersistedAsset[]
  commit(): Promise<void>
  rollback(): Promise<void>
  finalize(): Promise<void>
}

export class FollowUpAssetStore {
  private readonly limits: FollowUpAssetStoreLimits

  constructor(
    private readonly rootPath: string,
    private readonly options: FollowUpAssetStoreOptions = {}
  ) {
    this.limits = {
      maxBytesPerItem: options.maxBytesPerItem ?? FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM,
      maxTotalBytes: options.maxTotalBytes ?? FOLLOW_UP_QUEUE_MAX_TOTAL_ASSET_BYTES
    }
  }

  async prepare(
    ownerKey: string,
    inputs: readonly FollowUpAssetToPersist[],
    options: PrepareFollowUpAssetOptions = {}
  ): Promise<PreparedFollowUpAssets> {
    const itemDirectoryPrefix = stableDirectoryName(ownerKey)
    const itemDirectoryName = `${itemDirectoryPrefix}-${randomUUID()}`
    const finalDirectory = join(this.rootPath, itemDirectoryName)
    const temporaryDirectory = join(this.rootPath, `.tmp-${itemDirectoryName}-${randomUUID()}`)
    const preparedInputs: PreparedAssetInput[] = []
    let itemBytes = 0

    try {
      for (const input of inputs) {
        const prepared = await this.preflightAssetInput(input, options.allowedExistingRelativePaths)
        preparedInputs.push(prepared)
        assertItemCapacity(
          prepared.sizeBytes,
          this.limits.maxBytesPerItem - itemBytes,
          this.limits.maxBytesPerItem
        )
        itemBytes += prepared.sizeBytes
      }

      const currentTotalBytes = await managedAssetDirectoriesSize(this.rootPath)
      const replacedBytes = await replaceableAssetDirectorySize(
        this.rootPath,
        itemDirectoryPrefix,
        options.allowedExistingRelativePaths ?? []
      )
      if (currentTotalBytes - replacedBytes + itemBytes > this.limits.maxTotalBytes) {
        throw new FollowUpAssetCapacityError(
          'queue-assets-too-large',
          `Queued attachments exceed the ${this.limits.maxTotalBytes} byte total limit.`
        )
      }

      const authorizationRequests = preparedInputs.flatMap((input) =>
        input.authorization ? [input.authorization] : []
      )
      if (authorizationRequests.length > 0) {
        if (!this.options.authorizeLocalImages) {
          throw new Error('Queued local image authorization is not configured.')
        }
        this.options.authorizeLocalImages(authorizationRequests)
      }

      const decodedAssets: DecodedAsset[] = []
      for (const input of preparedInputs) {
        decodedAssets.push({
          id: input.id,
          displayName: input.displayName,
          mediaType: input.mediaType,
          data: await input.read()
        })
      }

      await mkdir(temporaryDirectory, { recursive: true })
      const assets: FollowUpPersistedAsset[] = []
      for (const asset of decodedAssets) {
        const fileName = `${stableDirectoryName(asset.id)}.bin`
        const temporaryPath = join(temporaryDirectory, fileName)
        await writeFile(temporaryPath, asset.data, { flag: 'wx' })
        assets.push({
          kind: 'persisted-asset',
          id: asset.id,
          displayName: asset.displayName,
          mediaType: asset.mediaType,
          relativePath: `${itemDirectoryName}/${fileName}`,
          sizeBytes: asset.data.byteLength,
          sha256: sha256(asset.data)
        })
      }

      return createPreparedTransaction({
        rootPath: this.rootPath,
        temporaryDirectory,
        finalDirectory,
        itemDirectoryPrefix,
        assets
      })
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    } finally {
      await Promise.allSettled(preparedInputs.map((input) => input.close()))
    }
  }

  async validate(assets: readonly FollowUpPersistedAsset[]): Promise<void> {
    await this.materialize(assets)
  }

  async materialize(
    assets: readonly FollowUpPersistedAsset[]
  ): Promise<MaterializedFollowUpAsset[]> {
    const materialized: MaterializedFollowUpAsset[] = []
    for (const asset of assets) {
      const data = await this.readValidatedAsset(asset)
      materialized.push({
        id: asset.id,
        displayName: asset.displayName,
        mediaType: asset.mediaType,
        dataUrl: `data:${asset.mediaType};base64,${data.toString('base64')}`,
        sizeBytes: data.byteLength,
        sha256: asset.sha256
      })
    }
    return materialized
  }

  async materializeForHistory(
    ownerKey: string,
    assets: readonly FollowUpPersistedAsset[]
  ): Promise<DurableFollowUpAsset[]> {
    const ownerDirectory = join(
      this.rootPath,
      HISTORY_ASSET_DIRECTORY,
      stableDirectoryName(ownerKey)
    )
    const materialized: DurableFollowUpAsset[] = []
    for (const asset of assets) {
      const data = await this.readValidatedAsset(asset)
      const fileName = `${stableDirectoryName(asset.id)}-${asset.sha256}${extensionForMediaType(
        asset.mediaType
      )}`
      const assetPath = join(ownerDirectory, fileName)
      await ensureDurableFile(assetPath, data)
      materialized.push({
        id: asset.id,
        displayName: asset.displayName,
        mediaType: asset.mediaType,
        fileUrl: pathToFileURL(assetPath).href,
        sizeBytes: data.byteLength,
        sha256: asset.sha256
      })
    }
    return materialized
  }

  async deleteAssets(assets: readonly FollowUpPersistedAsset[]): Promise<void> {
    const directories = new Set<string>()
    for (const asset of assets) {
      resolveAssetPath(this.rootPath, asset.relativePath)
      const directory = asset.relativePath.split('/')[0]
      if (!directory || !isManagedAssetDirectory(directory)) {
        throw new Error('Queued attachment is not stored in a managed asset directory.')
      }
      directories.add(directory)
    }
    await Promise.all(
      [...directories].map((directory) =>
        rm(join(this.rootPath, directory), { recursive: true, force: true })
      )
    )
  }

  async deleteAll(): Promise<void> {
    await rm(this.rootPath, { recursive: true, force: true })
  }

  async cleanupTemporaryDirectories(): Promise<void> {
    let entries
    try {
      entries = await readdir(this.rootPath, { withFileTypes: true })
    } catch (error) {
      if (isFileNotFoundError(error)) return
      throw error
    }

    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            (entry.name.startsWith('.tmp-') || entry.name.startsWith('.backup-'))
        )
        .map((entry) => rm(join(this.rootPath, entry.name), { recursive: true, force: true }))
    )
  }

  async reconcileReferencedAssets(relativePaths: readonly string[]): Promise<void> {
    await this.cleanupTemporaryDirectories()
    const referencedDirectories = new Set(
      relativePaths.map((relativePath) => relativePath.split('/')[0]).filter(Boolean)
    )
    let entries
    try {
      entries = await readdir(this.rootPath, { withFileTypes: true })
    } catch (error) {
      if (isFileNotFoundError(error)) return
      throw error
    }
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            isManagedAssetDirectory(entry.name) &&
            !referencedDirectories.has(entry.name)
        )
        .map((entry) => rm(join(this.rootPath, entry.name), { recursive: true, force: true }))
    )
  }

  private async preflightAssetInput(
    input: FollowUpAssetToPersist,
    allowedExistingRelativePaths: readonly string[] = []
  ): Promise<PreparedAssetInput> {
    if ('kind' in input && input.kind === 'local-image') {
      if (!isAbsolute(input.path)) {
        throw new Error('Queued local image path must be absolute.')
      }
      if (mediaTypeForPath(input.path) !== input.mediaType) {
        throw new Error('Queued local image type does not match its selected file.')
      }

      const { handle, metadata: before } = await openRegularFile(
        input.path,
        input.displayName,
        this.options.openFile
      )
      const identity = fileIdentity(before)
      return {
        id: input.id,
        displayName: input.displayName,
        mediaType: input.mediaType,
        sizeBytes: before.size,
        authorization: {
          token: input.capabilityToken,
          path: input.path,
          mediaType: input.mediaType,
          identity
        },
        async read(): Promise<Buffer> {
          const data = await handle.readFile()
          const after = await handle.stat()
          if (data.byteLength !== before.size || !sameFileIdentity(identity, fileIdentity(after))) {
            throw new Error(`Queued attachment changed while being copied: ${input.displayName}`)
          }
          return data
        },
        async close(): Promise<void> {
          await handle.close()
        }
      }
    }
    if ('encoding' in input) {
      const sizeBytes = validatedBase64Size(input.data)
      return {
        id: input.id,
        displayName: input.displayName,
        mediaType: input.mediaType,
        sizeBytes,
        async read(): Promise<Buffer> {
          return Buffer.from(input.data, 'base64')
        },
        close: () => Promise.resolve()
      }
    }

    if (!allowedExistingRelativePaths.includes(input.relativePath)) {
      throw new Error('Cannot transfer an attachment owned by another queue item.')
    }

    const { handle, metadata: before } = await openRegularFile(
      resolveAssetPath(this.rootPath, input.relativePath),
      input.displayName,
      this.options.openFile
    )
    if (before.size !== input.sizeBytes) {
      await handle.close()
      throw new Error(`Queued attachment is unavailable or changed: ${input.displayName}`)
    }
    const identity = fileIdentity(before)
    return {
      id: input.id,
      displayName: input.displayName,
      mediaType: input.mediaType,
      sizeBytes: input.sizeBytes,
      async read(): Promise<Buffer> {
        const data = await handle.readFile()
        const after = await handle.stat()
        if (
          data.byteLength !== input.sizeBytes ||
          sha256(data) !== input.sha256 ||
          !sameFileIdentity(identity, fileIdentity(after))
        ) {
          throw new Error(`Queued attachment is unavailable or changed: ${input.displayName}`)
        }
        return data
      },
      async close(): Promise<void> {
        await handle.close()
      }
    }
  }

  private async readValidatedAsset(asset: FollowUpPersistedAsset): Promise<Buffer> {
    const assetPath = resolveAssetPath(this.rootPath, asset.relativePath)
    let data: Buffer
    try {
      data = await readFile(assetPath)
    } catch (error) {
      if (!isFileNotFoundError(error)) throw error
      throw new Error(`Queued attachment is unavailable or changed: ${asset.displayName}`)
    }
    if (data.byteLength !== asset.sizeBytes || sha256(data) !== asset.sha256) {
      throw new Error(`Queued attachment is unavailable or changed: ${asset.displayName}`)
    }
    return data
  }
}

type PreparedAssetInput = {
  id: string
  displayName: string
  mediaType: string
  sizeBytes: number
  authorization?: LocalImageCapabilityRequest
  read(): Promise<Buffer>
  close(): Promise<void>
}

type DecodedAsset = {
  id: string
  displayName: string
  mediaType: string
  data: Buffer
}

function createPreparedTransaction(input: {
  rootPath: string
  temporaryDirectory: string
  finalDirectory: string
  itemDirectoryPrefix: string
  assets: FollowUpPersistedAsset[]
}): PreparedFollowUpAssets {
  let committed = false
  let finalized = false

  return {
    assets: input.assets,
    async commit(): Promise<void> {
      if (committed) return
      await mkdir(input.rootPath, { recursive: true })
      await rename(input.temporaryDirectory, input.finalDirectory)
      committed = true
    },
    async rollback(): Promise<void> {
      if (finalized) return
      if (!committed) {
        await rm(input.temporaryDirectory, { recursive: true, force: true })
        return
      }

      await rm(input.finalDirectory, { recursive: true, force: true })
      committed = false
    },
    async finalize(): Promise<void> {
      if (finalized) return
      await rm(input.temporaryDirectory, { recursive: true, force: true })
      await deleteOwnedItemDirectories(
        input.rootPath,
        input.itemDirectoryPrefix,
        input.finalDirectory
      )
      finalized = true
    }
  }
}

function resolveAssetPath(rootPath: string, relativePath: string): string {
  const resolvedRoot = resolve(rootPath)
  const resolvedPath = resolve(resolvedRoot, relativePath)
  const relation = relative(resolvedRoot, resolvedPath)
  if (relation === '' || relation.startsWith(`..${sep}`) || relation === '..') {
    throw new Error('Queued attachment path escapes the follow-up asset directory.')
  }
  return resolvedPath
}

function stableDirectoryName(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

const HISTORY_ASSET_DIRECTORY = 'history'

const MEDIA_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff'
}

function extensionForMediaType(mediaType: string): string {
  return MEDIA_TYPE_EXTENSIONS[mediaType] ?? '.bin'
}

async function ensureDurableFile(path: string, data: Buffer): Promise<void> {
  try {
    const existing = await readFile(path)
    if (existing.byteLength !== data.byteLength || sha256(existing) !== sha256(data)) {
      throw new Error('Durable queued attachment content does not match its immutable name.')
    }
    return
  } catch (error) {
    if (!isFileNotFoundError(error)) throw error
  }

  await mkdir(resolve(path, '..'), { recursive: true })
  const temporaryPath = `${path}.tmp-${randomUUID()}`
  try {
    await writeFile(temporaryPath, data, { flag: 'wx' })
    await rename(temporaryPath, path)
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error
    const existing = await readFile(path)
    if (existing.byteLength !== data.byteLength || sha256(existing) !== sha256(data)) {
      throw new Error('Durable queued attachment content does not match its immutable name.')
    }
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function validatedBase64Size(value: string): number {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error('Queued attachment data is not valid base64.')
  }
  const paddingBytes = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - paddingBytes
}

async function openRegularFile(
  path: string,
  displayName: string,
  openFile: (path: string, flags: 'r') => Promise<FileHandle> = open
): Promise<{ handle: FileHandle; metadata: Stats }> {
  const handle = await openFile(path, 'r')
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile()) {
      throw new Error(`Queued attachment is no longer available: ${displayName}`)
    }
    return { handle, metadata: metadata as Stats }
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
}

function assertItemCapacity(
  assetBytes: number,
  remainingBytes: number,
  maxBytesPerItem: number
): void {
  if (assetBytes <= remainingBytes) return
  throw new FollowUpAssetCapacityError(
    'item-assets-too-large',
    `Queued attachments exceed the ${maxBytesPerItem} byte per-message limit.`
  )
}

function fileIdentity(metadata: {
  dev: number
  ino: number
  size: number
  mtimeMs: number
}): LocalImageFileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs
  }
}

function sameFileIdentity(left: LocalImageFileIdentity, right: LocalImageFileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  )
}

async function directorySize(path: string): Promise<number> {
  let metadata
  try {
    metadata = await stat(path)
  } catch (error) {
    if (isFileNotFoundError(error)) return 0
    throw error
  }

  if (!metadata.isDirectory()) {
    return metadata.size
  }

  const entries = await readdir(path, { withFileTypes: true })
  const sizes = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.tmp-') && !entry.name.startsWith('.backup-'))
      .map((entry) => directorySize(join(path, entry.name)))
  )
  return sizes.reduce((total, size) => total + size, 0)
}

async function replaceableAssetDirectorySize(
  rootPath: string,
  itemDirectoryPrefix: string,
  allowedExistingRelativePaths: readonly string[]
): Promise<number> {
  const allowedDirectories = new Set(
    allowedExistingRelativePaths.map((relativePath) => {
      resolveAssetPath(rootPath, relativePath)
      const directory = relativePath.split('/')[0]
      if (!directory || !isManagedAssetDirectory(directory)) {
        throw new Error('Queued attachment is not stored in a managed asset directory.')
      }
      return directory
    })
  )
  let entries
  try {
    entries = await readdir(rootPath, { withFileTypes: true })
  } catch (error) {
    if (isFileNotFoundError(error)) return 0
    throw error
  }
  const sizes = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name === itemDirectoryPrefix ||
            entry.name.startsWith(`${itemDirectoryPrefix}-`) ||
            allowedDirectories.has(entry.name))
      )
      .map((entry) => directorySize(join(rootPath, entry.name)))
  )
  return sizes.reduce((total, size) => total + size, 0)
}

async function managedAssetDirectoriesSize(rootPath: string): Promise<number> {
  let entries
  try {
    entries = await readdir(rootPath, { withFileTypes: true })
  } catch (error) {
    if (isFileNotFoundError(error)) return 0
    throw error
  }
  const sizes = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && isManagedAssetDirectory(entry.name))
      .map((entry) => directorySize(join(rootPath, entry.name)))
  )
  return sizes.reduce((total, size) => total + size, 0)
}

async function deleteOwnedItemDirectories(
  rootPath: string,
  itemDirectoryPrefix: string,
  keepPath?: string
): Promise<void> {
  let entries
  try {
    entries = await readdir(rootPath, { withFileTypes: true })
  } catch (error) {
    if (isFileNotFoundError(error)) return
    throw error
  }
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name === itemDirectoryPrefix ||
            entry.name.startsWith(`${itemDirectoryPrefix}-`)) &&
          join(rootPath, entry.name) !== keepPath
      )
      .map((entry) => rm(join(rootPath, entry.name), { recursive: true, force: true }))
  )
}

function isManagedAssetDirectory(name: string): boolean {
  return /^[a-f0-9]{32}(?:-[0-9a-f-]{36})?$/u.test(name)
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  )
}
