import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import {
  FOLLOW_UP_QUEUE_STATE_VERSION,
  followUpModeSchema,
  queuedFollowUpItemSchema,
  type FollowUpMode,
  type QueuedFollowUpItem
} from '../../shared/codexFollowUpApi'

export type StoredConversationFollowUpQueue = {
  archived: boolean
  interrupted?: boolean
  items: QueuedFollowUpItem[]
}

export type ConversationFollowUpQueueStoreState = {
  version: typeof FOLLOW_UP_QUEUE_STATE_VERSION
  revision: number
  defaultMode: FollowUpMode
  conversations: Record<string, StoredConversationFollowUpQueue>
}

type QueueStateWriter = (
  filePath: string,
  state: ConversationFollowUpQueueStoreState
) => Promise<void>

type QueueStoreDiskOptions = {
  initialState?: ConversationFollowUpQueueStoreState
  writeJsonAtomically?: QueueStateWriter
}

const storedConversationSchema = z.object({
  archived: z.boolean().default(false),
  interrupted: z.boolean().default(false),
  items: z.array(queuedFollowUpItemSchema).default([])
})

const queueStoreStateSchema = z.object({
  version: z.literal(FOLLOW_UP_QUEUE_STATE_VERSION),
  revision: z.number().int().nonnegative().default(0),
  defaultMode: followUpModeSchema.default('queue'),
  conversations: z.record(z.string(), storedConversationSchema).default({})
})

const legacyQueueStoreStateV1Schema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  defaultMode: followUpModeSchema.default('queue'),
  conversations: z.record(z.string(), storedConversationSchema).default({})
})

export function createDefaultConversationFollowUpQueueStoreState(): ConversationFollowUpQueueStoreState {
  return {
    version: FOLLOW_UP_QUEUE_STATE_VERSION,
    revision: 0,
    defaultMode: 'queue',
    conversations: {}
  }
}

function cloneState(
  state: ConversationFollowUpQueueStoreState
): ConversationFollowUpQueueStoreState {
  return JSON.parse(JSON.stringify(state)) as ConversationFollowUpQueueStoreState
}

export class ConversationFollowUpQueueStore {
  private state: ConversationFollowUpQueueStoreState
  private writeQueue = Promise.resolve()
  private loadedFromDisk = false

  private constructor(
    private readonly filePath?: string,
    initialState = createDefaultConversationFollowUpQueueStoreState(),
    private readonly writeQueueState: QueueStateWriter = writeJsonAtomically
  ) {
    this.state = recoverUncertainItems(parseState(initialState).state)
  }

  static inMemory(
    initialState?: ConversationFollowUpQueueStoreState
  ): ConversationFollowUpQueueStore {
    return new ConversationFollowUpQueueStore(undefined, initialState)
  }

  static onDisk(
    filePath: string,
    options?: ConversationFollowUpQueueStoreState | QueueStoreDiskOptions
  ): ConversationFollowUpQueueStore {
    const diskOptions = toDiskOptions(options)
    return new ConversationFollowUpQueueStore(
      filePath,
      diskOptions.initialState,
      diskOptions.writeJsonAtomically
    )
  }

  async getState(): Promise<ConversationFollowUpQueueStoreState> {
    if (this.filePath && !this.loadedFromDisk) {
      try {
        const contents = await readFile(this.filePath, 'utf8')
        const parsed = parseState(JSON.parse(contents))
        this.state = recoverUncertainItems(parsed.state)
        if (parsed.migrated) {
          await this.writeQueueState(this.filePath, cloneState(this.state))
        }
      } catch (error) {
        if (!isFileNotFoundError(error)) {
          throw error
        }
      }
      this.loadedFromDisk = true
    }

    return cloneState(this.state)
  }

  async setState(state: ConversationFollowUpQueueStoreState): Promise<void> {
    const parsedState = parseState(state).state
    const nextState = cloneState(parsedState)

    if (!this.filePath) {
      this.state = nextState
      this.loadedFromDisk = true
      return
    }

    const filePath = this.filePath
    const stateToWrite = cloneState(nextState)
    const writeState = (): Promise<void> => this.writeQueueState(filePath, stateToWrite)
    const queuedWrite = this.writeQueue.then(writeState, writeState)
    this.writeQueue = queuedWrite
    await queuedWrite
    this.state = nextState
    this.loadedFromDisk = true
  }
}

function parseState(value: unknown): {
  state: ConversationFollowUpQueueStoreState
  migrated: boolean
} {
  const current = queueStoreStateSchema.safeParse(value)
  if (current.success) {
    return {
      state: current.data as ConversationFollowUpQueueStoreState,
      migrated: false
    }
  }

  const legacy = legacyQueueStoreStateV1Schema.parse(value)
  return {
    state: {
      ...legacy,
      version: FOLLOW_UP_QUEUE_STATE_VERSION
    } as ConversationFollowUpQueueStoreState,
    migrated: true
  }
}

function recoverUncertainItems(
  state: ConversationFollowUpQueueStoreState
): ConversationFollowUpQueueStoreState {
  const recovered = cloneState(state)

  for (const queue of Object.values(recovered.conversations)) {
    queue.items = queue.items.map((item) => {
      if (item.status !== 'sending' && item.status !== 'steering') {
        return item
      }

      return {
        ...item,
        status: 'paused-recovery-uncertain',
        updatedAt: new Date().toISOString(),
        pause: {
          kind: 'recovery-uncertain',
          userMessage:
            'The app closed before delivery could be confirmed. Retry or delete this item.'
        },
        lease: undefined
      }
    })
  }

  return recovered
}

function toDiskOptions(
  options?: ConversationFollowUpQueueStoreState | QueueStoreDiskOptions
): QueueStoreDiskOptions {
  if (!options) {
    return {}
  }

  if (isQueueStoreDiskOptions(options)) {
    return options
  }

  return { initialState: options }
}

function isQueueStoreDiskOptions(
  options: ConversationFollowUpQueueStoreState | QueueStoreDiskOptions
): options is QueueStoreDiskOptions {
  return 'writeJsonAtomically' in options || 'initialState' in options
}

async function writeJsonAtomically(
  filePath: string,
  state: ConversationFollowUpQueueStoreState
): Promise<void> {
  const directory = dirname(filePath)
  const tempPath = join(
    directory,
    `.${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`
  )

  try {
    await mkdir(directory, { recursive: true })
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
