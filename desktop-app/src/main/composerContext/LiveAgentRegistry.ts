import type { ComposerContextReference } from '../../shared/composerContext'

export type LiveAgentLifecycleEvent = {
  kind: 'started' | 'updated' | 'completed' | 'closed'
  threadId: string
  turnId?: string
  agentThreadId: string
  agentPath?: string
  status?: string
  toolCallId?: string
}

export type LiveAgentHistoryClientLike = {
  readThreadWithFullTurns(threadId: string): Promise<{
    turns?: readonly { items?: readonly unknown[] }[]
  }>
}

type LiveAgentEntry = {
  parentThreadId: string
  agentThreadId: string
  agentPath?: string
  status: Extract<ComposerContextReference, { kind: 'liveAgent' }>['status']
}

export class LiveAgentRegistry {
  private readonly entries = new Map<string, LiveAgentEntry>()
  private readonly liveObservedKeys = new Set<string>()
  private readonly bootstrappedThreadIds = new Set<string>()
  private readonly bootstrapPromises = new Map<string, Promise<void>>()

  constructor(private readonly historyClient?: LiveAgentHistoryClientLike) {}

  observe(event: LiveAgentLifecycleEvent): void {
    this.applyEvent(event, true)
  }

  private applyEvent(event: LiveAgentLifecycleEvent, live: boolean): void {
    const key = entryKey(event.threadId, event.agentThreadId)
    if (!live && this.liveObservedKeys.has(key)) return
    if (live) this.liveObservedKeys.add(key)
    if (event.kind === 'closed' || isRemovedStatus(event.status)) {
      this.entries.delete(key)
      return
    }

    const previous = this.entries.get(key)
    this.entries.set(key, {
      parentThreadId: event.threadId,
      agentThreadId: event.agentThreadId,
      agentPath: event.agentPath ?? previous?.agentPath,
      status: lifecycleStatus(event)
    })
  }

  async list(parentThreadId: string): Promise<ComposerContextReference[]> {
    await this.bootstrap(parentThreadId)
    return [...this.entries.values()]
      .filter((entry) => entry.parentThreadId === parentThreadId)
      .sort((left, right) => agentLabel(left).localeCompare(agentLabel(right)))
      .map((entry) => ({
        version: 1,
        kind: 'liveAgent',
        canonicalId: `live-agent:${entry.agentThreadId}`,
        label: agentLabel(entry),
        description: entry.status,
        presentation: 'mention',
        threadId: entry.agentThreadId,
        parentThreadId: entry.parentThreadId,
        uri: `agent://${encodeURIComponent(entry.agentThreadId)}`,
        ...(entry.agentPath ? { agentPath: entry.agentPath } : {}),
        status: entry.status
      }))
  }

  private async bootstrap(threadId: string): Promise<void> {
    if (!this.historyClient || this.bootstrappedThreadIds.has(threadId)) return
    const pending = this.bootstrapPromises.get(threadId)
    if (pending) return pending

    const promise = this.bootstrapFromHistory(threadId).finally(() => {
      this.bootstrapPromises.delete(threadId)
    })
    this.bootstrapPromises.set(threadId, promise)
    return promise
  }

  private async bootstrapFromHistory(threadId: string): Promise<void> {
    const thread = await this.historyClient!.readThreadWithFullTurns(threadId)
    for (const turn of thread.turns ?? []) {
      for (const item of turn.items ?? []) this.observeHistoryItem(threadId, item)
    }
    this.bootstrappedThreadIds.add(threadId)
  }

  private observeHistoryItem(parentThreadId: string, value: unknown): void {
    if (!isRecord(value)) return
    if (value.type === 'subAgentActivity') {
      const agentThreadId = stringValue(value.agentThreadId)
      if (!agentThreadId) return
      this.applyEvent(
        {
          kind: 'updated',
          threadId: parentThreadId,
          agentThreadId,
          agentPath: stringValue(value.agentPath),
          status: value.kind === 'interrupted' ? 'interrupted' : 'running'
        },
        false
      )
      return
    }
    if (value.type !== 'collabAgentToolCall' && value.type !== 'collabToolCall') return

    const tool = stringValue(value.tool)
    const agentStates = isRecord(value.agentsStates) ? value.agentsStates : {}
    const receiverThreadIds = [
      ...new Set([...stringArray(value.receiverThreadIds), ...Object.keys(agentStates)])
    ]
    for (const agentThreadId of receiverThreadIds) {
      const state = isRecord(agentStates[agentThreadId])
        ? stringValue(agentStates[agentThreadId].status)
        : undefined
      this.applyEvent(
        {
          kind: isCloseTool(tool) ? 'closed' : 'updated',
          threadId: parentThreadId,
          agentThreadId,
          status: state ?? stringValue(value.status)
        },
        false
      )
    }
  }
}

function lifecycleStatus(event: LiveAgentLifecycleEvent): LiveAgentEntry['status'] {
  const status = event.status?.toLowerCase()
  if (event.kind === 'completed' || status === 'completed') return 'completed'
  if (status === 'failed' || status === 'errored') return 'failed'
  if (status === 'interrupted') return 'interrupted'
  return 'running'
}

function isRemovedStatus(status: string | undefined): boolean {
  const normalized = status?.toLowerCase().replaceAll('_', '')
  return normalized === 'closed' || normalized === 'shutdown' || normalized === 'notfound'
}

function isCloseTool(tool: string | undefined): boolean {
  const normalized = tool?.toLowerCase().replaceAll('_', '')
  return normalized === 'closeagent' || normalized === 'closeagents'
}

function agentLabel(entry: LiveAgentEntry): string {
  if (entry.agentPath) {
    return entry.agentPath.split('/').filter(Boolean).at(-1) ?? entry.agentPath
  }
  return entry.agentThreadId
}

function entryKey(parentThreadId: string, agentThreadId: string): string {
  return `${parentThreadId}\0${agentThreadId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}
