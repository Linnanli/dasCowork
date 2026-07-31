import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  type AssistantState,
  MessagePrimitive,
  ThreadPrimitive,
  type Unstable_DirectiveFormatter,
  type QuoteMessagePartProps,
  type TextMessagePartProps,
  type ToolCallMessagePartStatus,
  type Unstable_SlashCommand,
  type Unstable_TriggerItem,
  unstable_defaultDirectiveFormatter,
  unstable_useSlashCommandAdapter,
  getExternalStoreMessages,
  useExternalStoreRuntime,
  useAui,
  useAuiEvent,
  useAuiState,
  type AppendMessage,
  type ThreadMessage,
  type ThreadMessageLike
} from '@assistant-ui/react'
import { getToolName, isToolUIPart, type UIMessage, type UIMessagePart } from 'ai'
import { type DirectiveChipProps } from '@assistant-ui/react-lexical'
import { Streamdown } from 'streamdown'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { MessageTiming } from '@/components/assistant-ui/message-timing'
import { ComposerAttachments, UserMessageAttachments } from '@/components/assistant-ui/attachment'
import { ComposerAddContextPopover } from '@/components/assistant-ui/composer-add-context-popover'
import { ComposerTurnStatusCard } from '@/components/assistant-ui/composer-turn-status-card'
import {
  ComposerReviewMode,
  type ComposerReviewSelection
} from '@/components/local-git-review/ComposerReviewMode'
import { ConversationChangesRow } from '@/components/local-git-review/ConversationChangesRow'
import {
  GitRepositoryProvider,
  useGitRepository
} from '@/components/local-git-review/GitRepositoryProvider'
import { LocalBranchSwitcher } from '@/components/local-git-review/LocalBranchSwitcher'
import { LocalGitReviewProvider } from '@/components/local-git-review/LocalGitReviewProvider'
import { ConversationTurnErrorBoundary } from '@/components/conversation/ConversationTurnErrorBoundary'
import { ConversationRecoveryStatus } from '@/components/conversation/ConversationRecoveryStatus'
import { WorkspaceRecoveryBanner } from '@/components/conversation/WorkspaceRecoveryBanner'
import { ContextLexicalInput } from '@/composer/contextLexicalInput'
import { ComposerContextSuggestionProvider } from '@/composer/composerContextSuggestionController'
import { ToolFallback } from '@/components/assistant-ui/tool-fallback'
import { buildCodeReviewPrompt } from '@/lib/codeReviewPrompt'
import {
  CollapsedActivityDetails,
  McpToolCallDetails,
  ReviewCommentsDetails,
  SpecialEntryRenderer,
  UnknownPartRenderer,
  WebSearchDetails
} from '@/components/render-units/renderUnitDetails'
import { ToolActivityGroupShell } from '@/components/render-units/toolActivityGroupShell'
import {
  MultiAgentToolItemDetails,
  SubagentActivityGroup,
  type OpenSubagentConversation
} from '@/components/render-units/subagentActivity'
import { renderUnitAttributes } from '@/components/render-units/renderUnitAttributes'
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  HelpCircleIcon,
  MessageSquareIcon,
  PackageIcon,
  PanelLeftIcon,
  PencilIcon,
  PlusIcon,
  PuzzleIcon,
  QuoteIcon,
  SlashIcon,
  SparklesIcon,
  SquareIcon,
  WrenchIcon
} from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type FC,
  type ReactNode
} from 'react'

import { ModelSelector } from './components/assistant-ui'
import { ServerRequestPanel } from './components/assistant-ui/server-request-panel'
import { QueuedFollowUpList, QueuedFollowUpPausedBanner } from './components/queued-follow-ups'
import { Button } from './components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './components/ui/dialog'
import { ComposerProjectCard } from './projects/ComposerProjectCard'
import { useProjectState, type ProjectStateController } from './projects/useProjectState'
import { SidebarRoot } from './sidebar/SidebarRoot'
import {
  useConversationState,
  type ConversationStateController
} from './sidebar/useConversationState'
import { cn } from './lib/utils'
import { blockedAssistantMessageText, pendingAssistantMessageText } from './lib/assistantMessages'
import {
  buildAssistantRenderUnits,
  type AssistantMessagePhase,
  type AssistantRenderUnit,
  type ToolItem
} from './lib/assistantRenderUnits'
import { buildComposerTurnStatus, withoutComposerStatusRenderUnits } from './lib/composerTurnStatus'
import {
  buildToolActivityDisplayModel,
  buildToolItemDisplay,
  type ToolItemDisplay
} from './lib/toolActivityDisplay'
import { scrollToRenderTarget } from './lib/renderUnitNavigation'
import { useCodexIpcAssistantRuntime } from './hooks/useCodexIpcAssistantRuntime'
import { steerFollowUpItemWithTranscript } from './hooks/useConversationFollowUpCoordinator'
import {
  useConversationFollowUps,
  type ConversationFollowUpsController
} from './hooks/useConversationFollowUps'
import type { ActiveConversationContext } from './lib/ElectronIpcChatTransport'
import type {
  ConversationChatEntry,
  ConversationScrollSnapshot
} from './runtime/ConversationChatRegistry'
import {
  type ConversationTranscriptController,
  safeTurnErrorMessage,
  type CodexTurnMessageMetadata,
  type ConversationTranscriptMessage
} from './runtime/ConversationTranscriptController'
import type { ConversationDraftAttachment } from './runtime/ConversationDraftStore'
import { captureConversationScroll, restoreConversationScroll } from './runtime/conversationScroll'
import { createQueuedFollowUpSnapshot } from './runtime/queuedFollowUpSnapshot'
import { restoreQueuedFollowUpToComposerDraft } from './runtime/restoreQueuedFollowUpToComposer'
import type {
  CodexApprovalRequest,
  CodexApprovalResponse,
  LocalContextPickerKind
} from '../../shared/codexIpcApi'
import type {
  FollowUpMode,
  MaterializedQueuedUserMessage,
  QueuedUserMessageSnapshot,
  QueuedFollowUpTrustedContext,
  QueuedUserMessageSnapshotInput
} from '../../shared/codexFollowUpApi'
import type { ProjectSelection } from '../../shared/projects/projectTypes'
import type { ModelOption } from './components/assistant-ui'
import {
  composerContextDirectiveFormatter,
  parseComposerContextReferences
} from './composer/composerContextDirectiveFormatter'
import { buildComposerGlobalSearchResult } from './composer/composerGlobalSearch'
import {
  type ComposerContextCatalogState,
  useComposerContextCatalog
} from './composer/useComposerContextCatalog'
import { useComposerContextSearch } from './composer/useComposerContextSearch'
import {
  type ComposerContextIdentityIndex,
  ComposerContextIdentityProvider,
  useComposerContextIdentityIndex
} from './composer/composerContextIdentity'
import {
  createLocalImageAttachment,
  createLocalPathAttachment,
  imageAttachmentAdapter,
  localPathAttachmentIdentityFromId
} from './composer/imageAttachmentAdapter'

type CodexSidebarProps = {
  collapsed: boolean
  nativeBackdrop: boolean
  projectState: ProjectStateController
  conversationState: ConversationStateController
  onNewChat: () => void
}

type HeaderProps = {
  activeConversation?: ActiveConversationContext
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

type ComposerProps = {
  activeConversation?: ActiveConversationContext
  models: readonly ModelOption[]
  selectedModelId: string | undefined
  modelSelectionError?: string
  onSelectedModelChange: (modelId: string) => void
  projectState: ProjectStateController
  disabled?: boolean
  followUps: ConversationFollowUpsController
  onSteerFollowUp: (
    itemId: string,
    message:
      | MaterializedQueuedUserMessage
      | QueuedUserMessageSnapshot
      | QueuedUserMessageSnapshotInput
  ) => Promise<void>
  onStartInlineReview: (prompt: string) => Promise<void>
  onStartDetachedReview: (prompt: string) => Promise<void>
}

type ChatThreadProps = ComposerProps & {
  approvalRequests: readonly CodexApprovalRequest[]
  onRespondApproval: (
    request: CodexApprovalRequest,
    response: CodexApprovalResponse
  ) => Promise<void>
  onRejectApproval: (request: CodexApprovalRequest) => Promise<void>
  onSnoozeApproval: (request: CodexApprovalRequest) => Promise<void>
  hasBlockingRequest: boolean
  loading: boolean
  loadError?: Error
  onRetryLoad: () => void
  onOpenConversation: OpenSubagentConversation
  scrollSnapshot?: ConversationScrollSnapshot
  onScrollSnapshotChange: (snapshot: ConversationScrollSnapshot) => void
  recoveryPhase: ConversationChatEntry['recoveryPhase']
  recoveryError?: Error
  onCreateNewTask: () => void
}

type ComposerComponentProps = ComposerProps & {
  composerContextCatalog: ComposerContextCatalogState
  editingFollowUp: EditingFollowUpSession | null
  onEditingFollowUpChange: (editingFollowUp: EditingFollowUpSession | null) => void
  queueAttached: boolean
  reservedEditingItemId?: string
}

type EditingFollowUpSession = {
  itemId: string
  contextReferences: QueuedUserMessageSnapshotInput['contextReferences']
  trustedContext: QueuedFollowUpTrustedContext
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
}

type IconComponent = FC<{ className?: string }>

const directiveChipIcons: Record<string, IconComponent> = {
  file: FileIcon,
  folder: FolderIcon,
  chat: MessageSquareIcon,
  agent: BotIcon,
  agentRole: BotIcon,
  skill: SparklesIcon,
  plugin: PuzzleIcon,
  app: PackageIcon
}

type DirectiveBehaviorProps = {
  formatter?: Unstable_DirectiveFormatter
  onInserted?: (item: Unstable_TriggerItem) => void
}

type ActionBehaviorProps = {
  formatter?: Unstable_DirectiveFormatter
  onExecute: (item: Unstable_TriggerItem) => void
  removeOnExecute?: boolean
}

type ComposerTriggerPopoverBaseProps = Omit<
  ComponentPropsWithoutRef<typeof ComposerPrimitive.Unstable_TriggerPopover>,
  'children'
> & {
  backLabel?: string
  emptyCategoriesLabel?: string
  emptyItemsLabel?: string
  fallbackIcon?: IconComponent
  iconMap?: Record<string, IconComponent>
}

type ComposerTriggerPopoverProps = ComposerTriggerPopoverBaseProps &
  (
    | {
        action?: never
        directive: DirectiveBehaviorProps
      }
    | {
        action: ActionBehaviorProps
        directive?: never
      }
  )

type RenderTargetScrollEventDetail = {
  targetId?: unknown
  behavior?: ScrollBehavior
  focus?: boolean
}

const noopSlashCommand = (): void => {}

const slashCommands: readonly Unstable_SlashCommand[] = [
  {
    id: 'explain-changes',
    label: '解释改动',
    description: '总结当前工作区里的主要变化',
    icon: 'FileText',
    execute: noopSlashCommand
  },
  {
    id: 'draft-pr',
    label: '生成 PR 描述',
    description: '整理背景、范围和验证信息',
    icon: 'Pencil',
    execute: noopSlashCommand
  },
  {
    id: 'review-risks',
    label: '审查风险',
    description: '查找潜在回归和遗漏测试',
    icon: 'HelpCircle',
    execute: noopSlashCommand
  }
]

const slashIconMap: Record<string, IconComponent> = {
  FileText: FileTextIcon,
  HelpCircle: HelpCircleIcon,
  Pencil: PencilIcon
}

const streamdownPlugins = { code, math, mermaid, cjk }

const sidebarBaseClass =
  'hidden h-full shrink-0 flex-col overflow-hidden transition-all duration-200 md:flex'

const nativeBackdropSurfaceClass =
  'bg-background/50 bg-clip-padding backdrop-blur-xl [@media(prefers-reduced-transparency:reduce)]:bg-background [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none dark:bg-background/30'

const sidebarGlassClass =
  'shadow-[0_18px_60px_-48px_rgba(15,23,42,0.75)] dark:shadow-[0_18px_60px_-48px_rgba(0,0,0,0.95)]'
const activeConversationStorageKey = 'das-cowork.active-conversation.v1'

function useNativeBackdrop(): boolean {
  return window.desktopApp.environment.platform === 'darwin'
}

function readActiveConversationId(): string | undefined {
  try {
    const value = window.sessionStorage.getItem(activeConversationStorageKey)
    return value && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

function writeActiveConversationId(conversationId: string): void {
  try {
    window.sessionStorage.setItem(activeConversationStorageKey, conversationId)
  } catch {
    // Session storage is a renderer convenience only; conversation history remains canonical.
  }
}

function clearActiveConversationId(): void {
  try {
    window.sessionStorage.removeItem(activeConversationStorageKey)
  } catch {
    // Session storage is a renderer convenience only; conversation history remains canonical.
  }
}

async function runTranscriptAction(
  controller: ConversationTranscriptController,
  action: () => Promise<void>
): Promise<void> {
  try {
    await action()
  } catch (error) {
    // Model and transport failures are already represented in the transcript.
    // assistant-ui does not observe these promises, so avoid a duplicate
    // renderer error after the controller has settled the turn.
    if (controller.getSnapshot().status !== 'error') throw error
  }
}

function createCodeReviewMessage(prompt: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: prompt }]
  }
}

async function sendCodeReviewMessage(
  controller: ConversationTranscriptController,
  prompt: string
): Promise<void> {
  let sendError: unknown
  await runTranscriptAction(controller, async () => {
    try {
      await controller.sendMessage(createCodeReviewMessage(prompt))
    } catch (error) {
      sendError = error
      throw error
    }
  })
  if (sendError) throw sendError
}

function App(): React.JSX.Element {
  const storedProjectState = useProjectState()
  const storedProjectSelection = storedProjectState.state?.activeProjectSelection
  const persistProjectSelection = storedProjectState.selectProject
  const {
    activeEntry,
    serverRequests,
    activeServerRequests,
    respondToServerRequest,
    rejectServerRequest,
    snoozeServerRequest,
    models,
    selectedModelId,
    modelSelectionError,
    setSelectedModelId,
    activeConversation,
    startNewConversation,
    prepareNewConversation,
    activateConversation,
    restoreActiveConversation,
    restoreSingleActiveConversation,
    openConversation,
    setActiveProjectSelection,
    setActiveDraft,
    setActiveDraftAttachments,
    setActiveScroll,
    syncConversationMetadata,
    getConversationIndicator
  } = useCodexIpcAssistantRuntime({
    projectSelection: storedProjectSelection
  })
  const projectSelectionRevision = useRef(0)
  const selectProject = useCallback(
    async (selection: ProjectSelection) => {
      const revision = ++projectSelectionRevision.current
      const previousSelection = storedProjectSelection
      setActiveProjectSelection(selection)
      try {
        await persistProjectSelection(selection)
      } catch (error) {
        if (projectSelectionRevision.current === revision) {
          setActiveProjectSelection(previousSelection)
        }
        throw error
      }
    },
    [persistProjectSelection, setActiveProjectSelection, storedProjectSelection]
  )
  const projectState: ProjectStateController = {
    ...storedProjectState,
    selectProject
  }
  const visibleApprovalRequests = useMemo(() => {
    const activeRequestIds = new Set(activeServerRequests.map((request) => request.id))
    const contextlessRequests = serverRequests.filter(
      (request) => !request.context?.threadId && !activeRequestIds.has(request.id)
    )
    return [...activeServerRequests, ...contextlessRequests]
  }, [activeServerRequests, serverRequests])
  const conversationState = useConversationState({
    openConversation,
    getConversationIndicator,
    syncConversationMetadata
  })
  const restoredActiveConversation = useRef(false)
  const restoringActiveConversation = useRef(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const nativeBackdrop = useNativeBackdrop()

  useEffect(() => {
    if (!conversationState.state.loaded || restoredActiveConversation.current) return
    const conversationId = readActiveConversationId()
    if (!conversationId) {
      restoringActiveConversation.current = true
      void restoreSingleActiveConversation().finally(() => {
        restoredActiveConversation.current = true
        restoringActiveConversation.current = false
      })
      return
    }
    const conversation = conversationState.state.conversations.find(
      (candidate) => candidate.id === conversationId || candidate.threadId === conversationId
    )
    if (conversation) {
      restoredActiveConversation.current = true
      restoringActiveConversation.current = true
      void openConversation({ conversationId: conversation.id }).then(
        () => {
          restoringActiveConversation.current = false
        },
        () => {
          restoringActiveConversation.current = false
        }
      )
      return
    }

    restoringActiveConversation.current = true
    void restoreActiveConversation(conversationId).then(
      (restored) => {
        if (!restored) clearActiveConversationId()
        restoredActiveConversation.current = true
        restoringActiveConversation.current = false
      },
      () => {
        clearActiveConversationId()
        restoredActiveConversation.current = true
        restoringActiveConversation.current = false
      }
    )
  }, [
    conversationState.state.conversations,
    conversationState.state.loaded,
    openConversation,
    restoreActiveConversation,
    restoreSingleActiveConversation
  ])

  useEffect(() => {
    const activeConversationId = activeConversation?.threadId ?? activeConversation?.conversationId
    if (activeConversationId) {
      writeActiveConversationId(activeConversationId)
      return
    }
    if (
      activeEntry.status === 'submitted' ||
      activeEntry.status === 'streaming' ||
      (activeEntry.newConversation && activeEntry.messages.length > 0)
    ) {
      writeActiveConversationId(activeEntry.localId)
      return
    }
    if (!restoredActiveConversation.current || restoringActiveConversation.current) return
  }, [
    activeConversation?.conversationId,
    activeConversation?.threadId,
    activeEntry.localId,
    activeEntry.messages.length,
    activeEntry.newConversation,
    activeEntry.status
  ])

  useEffect(() => {
    const handleRenderTargetScroll = (event: Event): void => {
      const detail = (event as CustomEvent<RenderTargetScrollEventDetail>).detail
      if (typeof detail?.targetId !== 'string' || detail.targetId.length === 0) return

      void scrollToRenderTarget(detail.targetId, {
        behavior: detail.behavior,
        focus: detail.focus
      })
    }

    window.addEventListener('codex:scroll-render-target', handleRenderTargetScroll)
    return () => window.removeEventListener('codex:scroll-render-target', handleRenderTargetScroll)
  }, [])

  const toggleSidebar = (): void => {
    setSidebarCollapsed((collapsed) => !collapsed)
  }
  const handleSelectedModelChange = (modelId: string): void => {
    void setSelectedModelId(modelId).catch(() => undefined)
  }
  const handleStartNewConversation = (): void => {
    clearActiveConversationId()
    startNewConversation()
  }
  const startDetachedCodeReview = useCallback(
    async (prompt: string): Promise<void> => {
      const entry = prepareNewConversation(
        activeConversation?.projectSelection ?? storedProjectSelection
      )
      try {
        await sendCodeReviewMessage(entry.controller, prompt)
      } catch (error) {
        if (activeConversation?.conversationId) {
          writeActiveConversationId(activeConversation.conversationId)
        }
        throw error
      }
      clearActiveConversationId()
      activateConversation(entry)
    },
    [activateConversation, activeConversation, prepareNewConversation, storedProjectSelection]
  )
  const handleOpenConversation = useCallback<OpenSubagentConversation>(
    (conversationId) => {
      void openConversation({ conversationId })
    },
    [openConversation]
  )

  return (
    <main
      className={cn(
        'flex h-screen w-full text-foreground',
        nativeBackdrop ? 'bg-background/10 dark:bg-background/10' : 'bg-muted/30'
      )}
    >
      <CodexSidebar
        collapsed={sidebarCollapsed}
        nativeBackdrop={nativeBackdrop}
        projectState={projectState}
        conversationState={conversationState}
        onNewChat={handleStartNewConversation}
      />
      <section
        data-slot="app-main-section"
        className={cn(
          'flex min-w-0 flex-1 flex-col overflow-hidden p-2 transition-[padding] duration-200',
          nativeBackdrop && nativeBackdropSurfaceClass,
          !sidebarCollapsed && 'md:pl-0'
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/50 bg-background shadow-[0_18px_60px_-48px_rgba(15,23,42,0.75)]">
          <ActiveConversationPane
            key={activeEntry.localId}
            activeConversation={activeConversation}
            entry={activeEntry}
            approvalRequests={visibleApprovalRequests}
            hasBlockingRequest={visibleApprovalRequests.length > 0}
            models={models}
            selectedModelId={selectedModelId}
            modelSelectionError={modelSelectionError}
            onDraftChange={setActiveDraft}
            onDraftAttachmentsChange={setActiveDraftAttachments}
            onRetryLoad={() => {
              void openConversation({ conversationId: activeEntry.localId })
            }}
            onOpenConversation={handleOpenConversation}
            onScrollSnapshotChange={setActiveScroll}
            onSelectedModelChange={handleSelectedModelChange}
            onCreateNewTask={handleStartNewConversation}
            onStartDetachedReview={startDetachedCodeReview}
            onRejectApproval={rejectServerRequest}
            onSnoozeApproval={snoozeServerRequest}
            onRespondApproval={respondToServerRequest}
            projectState={projectState}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
          />
        </div>
      </section>
    </main>
  )
}

function ActiveConversationPane({
  activeConversation,
  entry,
  approvalRequests,
  hasBlockingRequest,
  models,
  selectedModelId,
  modelSelectionError,
  onDraftChange,
  onDraftAttachmentsChange,
  onRetryLoad,
  onOpenConversation,
  onScrollSnapshotChange,
  onSelectedModelChange,
  onCreateNewTask,
  onStartDetachedReview,
  onRejectApproval,
  onSnoozeApproval,
  onRespondApproval,
  projectState,
  sidebarCollapsed,
  onToggleSidebar
}: {
  activeConversation: ActiveConversationContext | undefined
  entry: ConversationChatEntry
  approvalRequests: readonly CodexApprovalRequest[]
  hasBlockingRequest: boolean
  models: readonly ModelOption[]
  selectedModelId: string | undefined
  modelSelectionError?: string
  onDraftChange: (draft: string) => void
  onDraftAttachmentsChange: (attachments: readonly ConversationDraftAttachment[]) => void
  onRetryLoad: () => void
  onOpenConversation: OpenSubagentConversation
  onScrollSnapshotChange: (snapshot: ConversationScrollSnapshot) => void
  onSelectedModelChange: (modelId: string) => void
  onCreateNewTask: () => void
  onStartDetachedReview: (prompt: string) => Promise<void>
  onRejectApproval: (request: CodexApprovalRequest) => Promise<void>
  onSnoozeApproval: (request: CodexApprovalRequest) => Promise<void>
  onRespondApproval: (
    request: CodexApprovalRequest,
    response: CodexApprovalResponse
  ) => Promise<void>
  projectState: ProjectStateController
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}): React.JSX.Element {
  const reloadInFlight = useRef<{ entryId: string; request: symbol } | null>(null)
  const runtime = useExternalStoreRuntime<ConversationTranscriptMessage>({
    messages: entry.messages,
    isRunning: entry.status === 'submitted' || entry.status === 'streaming',
    isDisabled: !entry.loaded,
    convertMessage: (message, index) =>
      transcriptMessageToThreadMessageLike(
        message,
        index === entry.messages.length - 1 &&
          (entry.status === 'submitted' || entry.status === 'streaming')
      ),
    onNew: async (message) => {
      await runTranscriptAction(entry.controller, () =>
        entry.controller.sendMessage(appendMessageToUIMessage(message), {
          metadata: message.runConfig
        })
      )
    },
    onEdit: async (message) => {
      await runTranscriptAction(entry.controller, () =>
        entry.controller.editMessage(message.parentId, appendMessageToUIMessage(message), {
          metadata: message.runConfig
        })
      )
    },
    onReload: async (parentId, config) => {
      if (reloadInFlight.current?.entryId === entry.localId) return
      const request = Symbol('conversation-reload')
      reloadInFlight.current = { entryId: entry.localId, request }
      try {
        await entry.controller.regenerate(parentId, { metadata: config.runConfig })
      } catch {
        // The controller projects the failure back into the transcript. The
        // assistant-ui reload action does not observe this promise, so do not
        // leak a duplicate unhandled rejection into the renderer.
      } finally {
        if (reloadInFlight.current?.request === request) reloadInFlight.current = null
      }
    },
    onCancel: () => entry.controller.stop(),
    adapters: { attachments: imageAttachmentAdapter }
  })
  const conversationKey = entry.context.threadId ?? entry.context.conversationId
  const followUps = useConversationFollowUps({
    api: window.desktopApp.followUps,
    conversationKey
  })
  const steerFollowUp = useCallback(
    async (
      itemId: string,
      message:
        | MaterializedQueuedUserMessage
        | QueuedUserMessageSnapshot
        | QueuedUserMessageSnapshotInput
    ): Promise<void> => {
      await steerFollowUpItemWithTranscript(message, entry, () => followUps.steerItem(itemId))
    },
    [entry, followUps]
  )
  const gitRepositoryIdentity = useMemo(
    () => ({
      conversationId: activeConversation?.conversationId ?? entry.context.conversationId,
      ...((activeConversation?.threadId ?? entry.context.threadId)
        ? { threadId: activeConversation?.threadId ?? entry.context.threadId }
        : {})
    }),
    [
      activeConversation?.conversationId,
      activeConversation?.threadId,
      entry.context.conversationId,
      entry.context.threadId
    ]
  )
  const preSendProjectKey =
    activeConversation?.threadId || entry.context.threadId
      ? undefined
      : JSON.stringify(projectState.state?.activeProjectSelection ?? null)
  const startInlineCodeReview = useCallback(
    async (prompt: string): Promise<void> => {
      await sendCodeReviewMessage(entry.controller, prompt)
    },
    [entry.controller]
  )

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ConversationDraftBridge
        draft={entry.draft}
        draftAttachments={entry.draftAttachments}
        status={entry.status}
        onDraftChange={onDraftChange}
        onDraftAttachmentsChange={onDraftAttachmentsChange}
      />
      <ConversationFocusBridge entryId={entry.localId} />
      <Header
        activeConversation={activeConversation}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
      />
      <GitRepositoryProvider identity={gitRepositoryIdentity} preSendProjectKey={preSendProjectKey}>
        <LocalGitReviewProvider>
          <ChatThread
            activeConversation={activeConversation}
            approvalRequests={approvalRequests}
            disabled={!entry.loaded}
            followUps={followUps}
            hasBlockingRequest={hasBlockingRequest}
            loading={entry.status === 'loading'}
            loadError={!entry.loaded ? entry.error : undefined}
            models={models}
            selectedModelId={selectedModelId}
            modelSelectionError={modelSelectionError}
            onSteerFollowUp={steerFollowUp}
            onRetryLoad={onRetryLoad}
            onOpenConversation={onOpenConversation}
            onScrollSnapshotChange={onScrollSnapshotChange}
            onSelectedModelChange={onSelectedModelChange}
            onCreateNewTask={onCreateNewTask}
            onStartInlineReview={startInlineCodeReview}
            onStartDetachedReview={onStartDetachedReview}
            onRejectApproval={onRejectApproval}
            onSnoozeApproval={onSnoozeApproval}
            onRespondApproval={onRespondApproval}
            projectState={projectState}
            scrollSnapshot={entry.scroll}
            recoveryPhase={entry.recoveryPhase}
            recoveryError={entry.recoveryError}
          />
        </LocalGitReviewProvider>
      </GitRepositoryProvider>
    </AssistantRuntimeProvider>
  )
}

function CodexSidebar({
  collapsed,
  nativeBackdrop,
  projectState,
  conversationState,
  onNewChat
}: CodexSidebarProps): React.JSX.Element {
  return (
    <aside
      data-slot="codex-sidebar"
      className={cn(
        sidebarBaseClass,
        nativeBackdrop && nativeBackdropSurfaceClass,
        nativeBackdrop && sidebarGlassClass,
        collapsed ? 'w-12' : 'w-65'
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-1">
          <div className="mt-2 flex h-12 shrink-0 items-center justify-center">
            <BrandMark />
          </div>
          <IconButton className="size-8" label="新对话" title="新对话" onClick={onNewChat}>
            <PlusIcon className="size-4" />
          </IconButton>
        </div>
      ) : (
        <>
          <div className="mt-2 flex h-12 shrink-0 items-center px-4">
            <Logo />
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <SidebarRoot
              nativeBackdrop={nativeBackdrop}
              projectState={projectState}
              conversationState={conversationState}
              onNewChat={onNewChat}
            />
          </div>
        </>
      )}
    </aside>
  )
}

function Logo(): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 text-sm">
      <BrandMark />
      <span className="min-w-0 truncate text-foreground/90">Codex</span>
    </div>
  )
}

function BrandMark(): React.JSX.Element {
  return (
    <div className="grid size-5 shrink-0 place-items-center rounded-md bg-primary text-[11px] text-primary-foreground">
      C
    </div>
  )
}

function Header({
  activeConversation,
  sidebarCollapsed,
  onToggleSidebar
}: HeaderProps): React.JSX.Element {
  const toggleLabel = sidebarCollapsed ? '显示侧栏' : '隐藏侧栏'

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-4">
      <IconButton
        className="hidden md:grid"
        label={toggleLabel}
        title={toggleLabel}
        onClick={onToggleSidebar}
      >
        <PanelLeftIcon className="size-4" />
      </IconButton>
      <ConversationContextText activeConversation={activeConversation} />
      {!activeConversation ? <ThreadTitle /> : null}
      <div className="ml-auto" />
    </header>
  )
}

function ConversationContextText({
  activeConversation
}: {
  activeConversation?: ActiveConversationContext
}): React.JSX.Element | null {
  if (!activeConversation) return null

  const title = activeConversation.title ?? 'New Chat'

  return (
    <span className="min-w-0 truncate text-sm font-medium text-foreground" title={title}>
      {title}
    </span>
  )
}

function ThreadTitle(): React.JSX.Element | null {
  const title = useAuiState(
    (state) =>
      state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId)?.title
  )

  if (!title) return null

  return <span className="min-w-0 truncate text-sm font-medium">{title}</span>
}

function isNewChatView(state: AssistantState): boolean {
  return state.thread.messages.length === 0 && (!state.thread.isLoading || state.threads.isLoading)
}

function latestRunningAssistantMessage(
  state: AssistantState
): AssistantState['thread']['messages'][number] | undefined {
  return state.thread.messages.findLast(
    (message) => message.role === 'assistant' && message.status?.type === 'running'
  )
}

function ChatThread({
  activeConversation,
  approvalRequests,
  disabled,
  followUps,
  hasBlockingRequest,
  loading,
  loadError,
  models,
  selectedModelId,
  modelSelectionError,
  onRetryLoad,
  onOpenConversation,
  onSelectedModelChange,
  onSteerFollowUp,
  onStartInlineReview,
  onStartDetachedReview,
  projectState,
  scrollSnapshot,
  onScrollSnapshotChange,
  recoveryPhase,
  recoveryError,
  onCreateNewTask,
  onRejectApproval,
  onSnoozeApproval,
  onRespondApproval
}: ChatThreadProps): React.JSX.Element {
  const isEmpty = useAuiState(isNewChatView)
  const showNewConversationView = isEmpty && !loading && !loadError
  const canChangeProject = showNewConversationView && !activeConversation?.threadId
  const viewportRef = useRef<HTMLDivElement>(null)
  const aui = useAui()
  const composerText = useAuiState((state) => state.composer.text)
  const composerAttachments = useAuiState((state) => state.composer.attachments)
  const [editingFollowUp, setEditingFollowUp] = useState<EditingFollowUpSession | null>(null)
  useConversationScrollRestoration(viewportRef, scrollSnapshot, onScrollSnapshotChange)
  const effectiveProjectSelection = activeConversation
    ? activeConversation.projectSelection
    : projectState.state?.activeProjectSelection
  const gitRepository = useGitRepository()
  const projectBranchTarget = gitRepository.status === 'ready' ? gitRepository.target : undefined
  const hasSelectedProject = Boolean(
    effectiveProjectSelection && effectiveProjectSelection.projectKind !== 'projectless'
  )
  const composerContextCatalog = useComposerContextCatalog({
    cwd: resolveComposerCwd(activeConversation, projectState),
    enabled: hasConversationProjectContext(activeConversation, projectState),
    projectSelection: effectiveProjectSelection,
    threadId: activeConversation?.threadId
  })
  const runningAssistantMessage = useAuiState(latestRunningAssistantMessage)
  const composerTurnStatus = useMemo(() => {
    if (!runningAssistantMessage) return null
    const renderModel = buildAssistantRenderUnits({
      content: runningAssistantMessage.content,
      parts: runningAssistantMessage.parts,
      status: runningAssistantMessage.status,
      hasBlockingRequest,
      workspaceCwd: activeConversation?.cwd ?? undefined,
      canOpenLocalPaths: activeConversation?.projectSelection?.projectKind !== 'remote'
    })
    return buildComposerTurnStatus(renderModel.units)
  }, [activeConversation, hasBlockingRequest, runningAssistantMessage])
  const visibleFollowUpItems = followUps.items.filter(
    (item) => item.status !== 'editing' && item.status !== 'steering'
  )
  const reservedEditingItem = followUps.items.find((item) => item.status === 'editing')
  const beginEditingFollowUp = useCallback(
    async (itemId: string): Promise<void> => {
      const hasComposerDraft = composerText.trim().length > 0 || composerAttachments.length > 0
      if (hasComposerDraft && !window.confirm('输入框中已有内容。要用排队消息替换当前草稿吗？')) {
        return
      }

      if (editingFollowUp && editingFollowUp.itemId !== itemId) {
        await followUps.cancelEdit(editingFollowUp.itemId)
        setEditingFollowUp(null)
      }
      const prepared = await followUps.beginEdit(itemId)
      try {
        const restored = restoreQueuedFollowUpToComposerDraft(prepared.message)
        await aui.composer().reset()
        aui.composer().setText(restored.text)
        for (const attachment of restored.attachments) {
          await aui.composer().addAttachment(attachment)
        }
        setEditingFollowUp({
          itemId,
          contextReferences: prepared.message.contextReferences,
          trustedContext: prepared.message.trustedContext
        })
        window.requestAnimationFrame(() =>
          document.querySelector<HTMLElement>('.aui-lexical-input')?.focus()
        )
      } catch (error) {
        await followUps.cancelEdit(itemId)
        throw error
      }
    },
    [aui, composerAttachments.length, composerText, editingFollowUp, followUps]
  )

  return (
    <ComposerContextIdentityProvider index={composerContextCatalog.identityIndex}>
      <ThreadPrimitive.Root
        className="aui-root aui-thread-root @container flex h-full min-h-0 flex-1 flex-col bg-background"
        style={{
          ['--thread-max-width' as string]: '48rem',
          ['--composer-padding' as string]: '8px'
        }}
      >
        <ThreadPrimitive.Viewport
          ref={viewportRef}
          turnAnchor="top"
          scrollToBottomOnInitialize={!scrollSnapshot}
          scrollToBottomOnThreadSwitch={false}
          data-slot="aui_thread-viewport"
          className={cn(
            'relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4',
            showNewConversationView && 'justify-center'
          )}
        >
          {loadError ? (
            <div
              data-slot="conversation-load-error"
              role="alert"
              className="mx-auto mb-6 flex w-full max-w-(--thread-max-width) items-center justify-between gap-4 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <span>无法加载此对话：{loadError.message}</span>
              <Button type="button" size="sm" variant="secondary" onClick={onRetryLoad}>
                重试
              </Button>
            </div>
          ) : null}
          {showNewConversationView ? <ThreadWelcome /> : null}
          <div data-slot="aui_message-group" className="mb-14 flex flex-col gap-y-6 empty:hidden">
            <ThreadPrimitive.Messages>
              {({ message }) => {
                if (message.composer.isEditing) return <EditComposer />
                if (message.role === 'user') return <UserMessage />
                return (
                  <AssistantMessage
                    hasBlockingRequest={hasBlockingRequest}
                    workspaceCwd={activeConversation?.cwd ?? undefined}
                    canOpenLocalPaths={
                      activeConversation?.projectSelection?.projectKind !== 'remote'
                    }
                    onOpenConversation={onOpenConversation}
                  />
                )
              }}
            </ThreadPrimitive.Messages>
          </div>
          <ThreadPrimitive.ViewportFooter
            className={cn(
              'aui-thread-viewport-footer mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible bg-background pb-4 md:pb-6',
              !showNewConversationView && 'sticky bottom-0 mt-auto rounded-t-xl'
            )}
          >
            <ThreadScrollToBottom />
            <ConversationRecoveryStatus phase={recoveryPhase} error={recoveryError} />
            <WorkspaceRecoveryBanner
              conversationId={activeConversation?.conversationId}
              threadId={activeConversation?.threadId}
              onCreateNewTask={onCreateNewTask}
            />
            <ComposerTurnStatusCard status={composerTurnStatus} />
            <div data-slot="composer-project-stack" className="flex w-full flex-col">
              <ConversationChangesRow />
              {reservedEditingItem && !editingFollowUp ? (
                <div
                  data-slot="queued-follow-up-edit-recovery"
                  className="mb-2 flex items-center justify-between rounded-xl border border-border/60 bg-muted/60 px-3 py-2 text-xs"
                >
                  <span>有一条排队消息处于编辑保留状态。</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => void beginEditingFollowUp(reservedEditingItem.id)}
                    >
                      继续编辑
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => void followUps.cancelEdit(reservedEditingItem.id)}
                    >
                      恢复到队列
                    </Button>
                  </div>
                </div>
              ) : null}
              <QueuedFollowUpPausedBanner
                item={visibleFollowUpItems[0]}
                busy={followUps.pendingItemIds.has(visibleFollowUpItems[0]?.id ?? '')}
                onResume={followUps.resume}
              />
              <QueuedFollowUpList
                items={visibleFollowUpItems}
                conversationKey={followUps.state?.conversationKey}
                defaultMode={followUps.defaultMode}
                pendingItemIds={followUps.pendingItemIds}
                announcement={followUps.announcement}
                onEdit={(item) => beginEditingFollowUp(item.id)}
                onDelete={followUps.deleteItem}
                onMoveUp={followUps.moveUp}
                onMoveDown={followUps.moveDown}
                onReorder={followUps.reorder}
                onSteer={async (itemId) => {
                  const message = await followUps.materializeItem(itemId)
                  return onSteerFollowUp(itemId, message)
                }}
                onRetry={followUps.retry}
                onToggleQueueing={() =>
                  followUps.setDefaultMode(followUps.defaultMode === 'queue' ? 'steer' : 'queue')
                }
                onRequestComposerFocus={() =>
                  document.querySelector<HTMLElement>('.aui-lexical-input')?.focus()
                }
              />
              {followUps.error ? (
                <p role="alert" className="px-2 py-1 text-xs text-destructive">
                  {followUps.error}
                </p>
              ) : null}
              {canChangeProject ? (
                <ComposerProjectCard
                  activeSelection={effectiveProjectSelection}
                  projectState={projectState}
                  trailingControl={
                    hasSelectedProject ? (
                      <LocalBranchSwitcher target={projectBranchTarget} />
                    ) : undefined
                  }
                />
              ) : null}
              {approvalRequests.length > 0 ? (
                <ServerRequestPanel
                  onInteraction={onSnoozeApproval}
                  onReject={onRejectApproval}
                  onRespond={onRespondApproval}
                  requests={approvalRequests}
                />
              ) : (
                <Composer
                  activeConversation={activeConversation}
                  composerContextCatalog={composerContextCatalog}
                  disabled={disabled}
                  followUps={followUps}
                  models={models}
                  selectedModelId={selectedModelId}
                  modelSelectionError={modelSelectionError}
                  onSelectedModelChange={onSelectedModelChange}
                  onSteerFollowUp={onSteerFollowUp}
                  onStartInlineReview={onStartInlineReview}
                  onStartDetachedReview={onStartDetachedReview}
                  projectState={projectState}
                  editingFollowUp={editingFollowUp}
                  onEditingFollowUpChange={setEditingFollowUp}
                  queueAttached={visibleFollowUpItems.length > 0}
                  reservedEditingItemId={reservedEditingItem?.id}
                />
              )}
            </div>
            {showNewConversationView ? (
              <div className="aui-thread-welcome-suggestions-shell min-h-19">
                <AuiIf condition={(state) => state.composer.isEmpty}>
                  <ThreadSuggestions />
                </AuiIf>
              </div>
            ) : null}
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </ComposerContextIdentityProvider>
  )
}

function ConversationDraftBridge({
  draft,
  draftAttachments,
  status,
  onDraftChange,
  onDraftAttachmentsChange
}: {
  draft: string
  draftAttachments: readonly ConversationDraftAttachment[]
  status: ConversationChatEntry['status']
  onDraftChange: (draft: string) => void
  onDraftAttachmentsChange: (attachments: readonly ConversationDraftAttachment[]) => void
}): null {
  const aui = useAui()
  const composerText = useAuiState((state) => state.composer.text)
  const composerAttachments = useAuiState((state) => state.composer.attachments)
  const initialDraft = useRef(draft)
  const initialDraftAttachments = useRef(draftAttachments)
  const hydrated = useRef(false)
  const latestDraft = useRef({ text: draft, attachments: [...draftAttachments] })
  const pendingSend = useRef<{
    text: string
    attachments: ConversationDraftAttachment[]
  } | null>(null)

  useAuiEvent('composer.send', () => {
    pendingSend.current = {
      text: latestDraft.current.text,
      attachments: latestDraft.current.attachments.map((attachment) => ({ ...attachment }))
    }
  })

  useLayoutEffect(() => {
    aui.composer().setText(initialDraft.current)
    const markHydrated = (): void => {
      hydrated.current = true
    }
    void Promise.all(
      initialDraftAttachments.current.map((attachment) =>
        aui.composer().addAttachment(
          createLocalPathAttachment({
            capabilityToken: attachment.capabilityToken,
            fileUrl: attachment.fileUrl,
            kind: attachment.kind,
            label: attachment.label,
            path: attachment.path
          })
        )
      )
    ).then(markHydrated, markHydrated)
  }, [aui])

  useEffect(() => {
    if (!hydrated.current || pendingSend.current) return
    latestDraft.current.text = composerText
    onDraftChange(composerText)
  }, [composerAttachments.length, composerText, onDraftChange])

  useEffect(() => {
    if (!hydrated.current || pendingSend.current) return
    const attachments = localDraftAttachments(composerAttachments)
    latestDraft.current.attachments = attachments
    onDraftAttachmentsChange(attachments)
  }, [composerAttachments, onDraftAttachmentsChange])

  useEffect(() => {
    const snapshot = pendingSend.current
    if (!snapshot) return

    const storedDraftWasCleared = draft.length === 0 && draftAttachments.length === 0
    if ((status === 'streaming' || status === 'ready') && storedDraftWasCleared) {
      pendingSend.current = null
      const nextAttachments = localDraftAttachments(composerAttachments)
      latestDraft.current = { text: composerText, attachments: nextAttachments }
      onDraftChange(composerText)
      onDraftAttachmentsChange(nextAttachments)
      return
    }
    if (status !== 'error') return

    const currentAttachments = localDraftAttachments(composerAttachments)
    if (composerText.length > 0 || composerAttachments.length > 0) {
      latestDraft.current = { text: composerText, attachments: currentAttachments }
      pendingSend.current = null
      onDraftChange(composerText)
      onDraftAttachmentsChange(currentAttachments)
      return
    }

    aui.composer().setText(snapshot.text)
    const restoreDraft = (): void => {
      latestDraft.current = snapshot
      pendingSend.current = null
      onDraftChange(snapshot.text)
      onDraftAttachmentsChange(snapshot.attachments)
    }
    void Promise.all(
      snapshot.attachments.map((attachment) =>
        aui.composer().addAttachment(createLocalPathAttachment(attachment))
      )
    ).then(restoreDraft, restoreDraft)
  }, [
    aui,
    composerAttachments,
    composerText,
    draft,
    draftAttachments,
    onDraftAttachmentsChange,
    onDraftChange,
    status
  ])

  return null
}

function localDraftAttachments(
  attachments: readonly { id: string; name: string }[]
): ConversationDraftAttachment[] {
  return attachments.flatMap((attachment): ConversationDraftAttachment[] => {
    const identity = localPathAttachmentIdentityFromId(attachment.id)
    if (!identity) return []
    return [{ ...identity, label: attachment.name }]
  })
}

function ConversationFocusBridge({ entryId }: { entryId: string }): null {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLElement>('.aui-lexical-input')
      input?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [entryId])
  return null
}

function useConversationScrollRestoration(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  snapshot: ConversationScrollSnapshot | undefined,
  onSnapshotChange: (snapshot: ConversationScrollSnapshot) => void
): void {
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let restoreFrame = 0
    const layoutFrame = window.requestAnimationFrame(() => {
      if (!snapshot) return
      restoreFrame = window.requestAnimationFrame(() => {
        restoreConversationScroll(viewport, snapshot)
      })
    })

    return () => {
      window.cancelAnimationFrame(layoutFrame)
      window.cancelAnimationFrame(restoreFrame)
      onSnapshotChange(captureConversationScroll(viewport))
    }
  }, [onSnapshotChange, snapshot, viewportRef])
}

function ThreadWelcome(): React.JSX.Element {
  return (
    <section className="aui-thread-welcome-root mx-auto mb-6 flex w-full max-w-(--thread-max-width) flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner duration-200 animate-in fade-in slide-in-from-bottom-1 text-2xl font-semibold tracking-[-0.02em]">
        How can I help you today?
      </h1>
    </section>
  )
}

type SuggestionGroup = {
  label: string
  icon: ReactNode
  options: { label: string; prompt: string }[]
}

const suggestionGroups: SuggestionGroup[] = [
  {
    label: '代码',
    icon: <PencilIcon size={15} />,
    options: [
      { label: '解释当前改动', prompt: '请解释当前工作区里的主要改动。' },
      { label: '生成 PR 描述', prompt: '请根据当前改动生成一份 PR 描述。' },
      { label: '找潜在风险', prompt: '请审查当前改动里可能的风险。' }
    ]
  },
  {
    label: '任务',
    icon: <ActivityIcon size={15} />,
    options: [
      { label: '列出下一步', prompt: '请根据当前上下文列出最小下一步。' },
      { label: '总结线程', prompt: '请总结这个线程目前的目标和状态。' },
      { label: '整理待办', prompt: '请把当前任务整理成可执行的待办清单。' }
    ]
  }
]

const suggestionChipClass =
  'aui-thread-welcome-suggestion h-auto gap-1.5 rounded-full border border-border/60 px-3.5 py-1.5 text-sm font-normal whitespace-nowrap text-foreground transition-colors hover:bg-muted [&_svg]:size-4'

function ThreadSuggestions(): React.JSX.Element {
  const aui = useAui()
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null)
  const expandedGroup = suggestionGroups.find((group) => group.label === expandedLabel)

  const sendPrompt = (prompt: string): void => {
    if (aui.thread().getState().isRunning) return
    aui.thread().append({
      content: [{ type: 'text', text: prompt }],
      runConfig: aui.composer().getState().runConfig
    })
  }

  const toggleGroup = (label: string): void => {
    setExpandedLabel((currentLabel) => (currentLabel === label ? null : label))
  }

  return (
    <div className="aui-thread-welcome-suggestions flex w-full flex-col gap-2 px-4">
      <div className="w-full overflow-x-auto">
        <div className="mx-auto flex w-max items-center gap-2">
          {suggestionGroups.map((group) => (
            <button
              key={group.label}
              className={cn(suggestionChipClass, group.label === expandedLabel && 'bg-muted')}
              type="button"
              onClick={() => toggleGroup(group.label)}
            >
              {group.icon}
              {group.label}
            </button>
          ))}
        </div>
      </div>
      {expandedGroup ? (
        <div className="w-full overflow-x-auto duration-200 animate-in fade-in slide-in-from-top-1">
          <div className="mx-auto flex w-max items-center gap-2">
            {expandedGroup.options.map((option) => (
              <button
                key={option.label}
                className={suggestionChipClass}
                type="button"
                onClick={() => sendPrompt(option.prompt)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ThreadScrollToBottom(): React.JSX.Element {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <IconButton
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 size-10 self-center rounded-full border border-border bg-background p-0 shadow-sm disabled:invisible"
        label="滚动到底部"
        title="滚动到底部"
      >
        <ArrowDownIcon className="size-4" />
      </IconButton>
    </ThreadPrimitive.ScrollToBottom>
  )
}

function AssistantMessage({
  hasBlockingRequest,
  workspaceCwd,
  canOpenLocalPaths,
  onOpenConversation
}: {
  hasBlockingRequest: boolean
  workspaceCwd?: string
  canOpenLocalPaths: boolean
  onOpenConversation: OpenSubagentConversation
}): React.JSX.Element {
  const message = useAuiState((state) => state.message)
  const isThreadRunning = useAuiState((state) => state.thread.isRunning)
  const textPartMetadata = useMemo(() => codexTextPartMetadataFor(message), [message])
  const turnDurationMs = useMemo(() => codexTurnDurationFor(message), [message])
  const renderModel = useMemo(
    () =>
      buildAssistantRenderUnits({
        content: message.content,
        parts: message.parts,
        status: message.status,
        textPhases: textPartMetadata.map((metadata) => metadata.phase),
        hasBlockingRequest,
        workspaceCwd,
        canOpenLocalPaths,
        processDurationMs:
          message.metadata?.timing?.totalStreamTime ??
          turnDurationMs ??
          textPartMetadata.find((metadata) => metadata.turnDurationMs !== undefined)?.turnDurationMs
      }),
    [canOpenLocalPaths, hasBlockingRequest, message, textPartMetadata, turnDurationMs, workspaceCwd]
  )
  const isThinkingOnly = renderModel.isThinkingOnly
  const visibleUnits = withoutComposerStatusRenderUnits(renderModel.units, {
    keepTurnDiff: message.status?.type === 'complete'
  })
  const wasCancelled =
    message.status?.type === 'incomplete' && message.status.reason === 'cancelled'

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="relative mx-auto w-full max-w-(--thread-max-width) duration-150 animate-in fade-in slide-in-from-bottom-1"
    >
      <div
        data-slot="aui_assistant-message-content"
        className={cn(
          'wrap-break-word px-2 leading-relaxed text-foreground',
          isThinkingOnly && 'shimmer text-foreground/60 motion-reduce:animate-none'
        )}
      >
        {isThinkingOnly ? (
          pendingAssistantMessageText
        ) : (
          <>
            {visibleUnits.map((unit) => (
              <ConversationTurnErrorBoundary
                key={unit.key}
                resetKey={`${message.id}:${unit.key}`}
                renderUnitKind={unit.type}
              >
                <AssistantRenderUnitView unit={unit} onOpenConversation={onOpenConversation} />
              </ConversationTurnErrorBoundary>
            ))}
          </>
        )}
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root
            data-slot="aui_assistant-message-error"
            role="alert"
            aria-live="polite"
            className="border-destructive/20 bg-destructive/5 text-destructive mt-2 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
          >
            <ErrorPrimitive.Message className="min-w-0 flex-1 wrap-break-word" />
            <ActionBarPrimitive.Reload asChild>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={isThreadRunning}
                data-slot="aui_assistant-message-retry"
              >
                重试
              </Button>
            </ActionBarPrimitive.Reload>
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
        {wasCancelled ? (
          <p
            data-slot="aui_assistant-message-cancelled"
            role="status"
            className="mt-2 text-sm text-muted-foreground"
          >
            已取消
          </p>
        ) : null}
      </div>
      {isThinkingOnly ? null : (
        // Keep the autohidden action bar from changing the following message's position.
        <div
          data-slot="aui_assistant-message-footer"
          className="ml-2 mt-1.5 flex h-8 items-center -mb-8"
        >
          <AssistantActionBar />
        </div>
      )}
    </MessagePrimitive.Root>
  )
}

type ExternalAISDKMessage = {
  parts?: readonly { type?: unknown; providerMetadata?: unknown }[]
  metadata?: unknown
}

function appendMessageToUIMessage(message: AppendMessage): UIMessage {
  const inputParts = [
    ...message.content.filter((part) => part.type !== 'file'),
    ...(message.attachments?.flatMap((attachment) =>
      attachment.content.map((part) => ({
        ...part,
        filename: attachment.name
      }))
    ) ?? [])
  ]
  const parts = inputParts.map((part): UIMessagePart<Record<string, unknown>, never> => {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text }
      case 'image':
        return {
          type: 'file',
          url: part.image,
          mediaType: 'image/png',
          ...(part.filename ? { filename: part.filename } : {})
        }
      case 'file':
        return {
          type: 'file',
          url: part.data,
          mediaType: part.mimeType,
          ...(part.filename ? { filename: part.filename } : {})
        }
      case 'data':
        return {
          type: `data-${part.name}`,
          data: part.data
        }
      default:
        throw new Error(`Unsupported composer message part: ${part.type}`)
    }
  })

  return {
    id: crypto.randomUUID(),
    role: message.role,
    parts,
    ...(message.metadata === undefined ? {} : { metadata: message.metadata })
  }
}

function transcriptMessageToThreadMessageLike(
  message: ConversationTranscriptMessage,
  running: boolean
): ThreadMessageLike & {
  readonly convertConfig?: { readonly joinStrategy: 'none' }
} {
  const content = message.parts.flatMap((part): unknown[] => {
    if (part.type === 'step-start') return []
    if (part.type === 'text') return [{ type: 'text', text: part.text }]
    if (part.type === 'reasoning') return [{ type: 'reasoning', text: part.text }]
    if (isToolUIPart(part)) {
      const input =
        part.input && typeof part.input === 'object' && !Array.isArray(part.input) ? part.input : {}
      const result =
        part.state === 'output-available'
          ? part.output
          : part.state === 'output-error'
            ? { error: part.errorText }
            : undefined
      return [
        {
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: getToolName(part),
          args: input,
          argsText: JSON.stringify(input),
          result,
          isError: part.state === 'output-error' || part.state === 'output-denied',
          ...('approval' in part && part.approval ? { approval: part.approval } : {})
        }
      ]
    }
    if (part.type === 'source-url') {
      return [
        {
          type: 'source',
          sourceType: 'url',
          id: part.sourceId,
          url: part.url,
          ...(part.title ? { title: part.title } : {}),
          ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {})
        }
      ]
    }
    if (part.type === 'source-document') {
      return [
        {
          type: 'source',
          sourceType: 'document',
          id: part.sourceId,
          title: part.title,
          mediaType: part.mediaType,
          ...(part.filename ? { filename: part.filename } : {}),
          ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {})
        }
      ]
    }
    if (part.type === 'file') {
      return message.role === 'user'
        ? []
        : [
            {
              type: 'file',
              data: part.url,
              mimeType: part.mediaType,
              ...(part.filename ? { filename: part.filename } : {})
            }
          ]
    }
    if (part.type.startsWith('data-')) {
      return [
        {
          type: 'data',
          name: part.type.slice('data-'.length),
          data: 'data' in part ? part.data : undefined
        }
      ]
    }
    return []
  }) as Exclude<ThreadMessageLike['content'], string>
  const attachments =
    message.role === 'user'
      ? message.parts.flatMap((part, index) => {
          if (part.type !== 'file') return []
          const image = part.mediaType.startsWith('image/')
          return [
            {
              id: String(index),
              type: image ? ('image' as const) : ('file' as const),
              name: part.filename ?? 'file',
              content: image
                ? [
                    {
                      type: 'image' as const,
                      image: part.url,
                      filename: part.filename
                    }
                  ]
                : [
                    {
                      type: 'file' as const,
                      data: part.url,
                      mimeType: part.mediaType,
                      filename: part.filename
                    }
                  ],
              contentType: part.mediaType,
              status: { type: 'complete' as const }
            }
          ]
        })
      : undefined

  return {
    id: message.renderId,
    role: message.role,
    content,
    ...(attachments ? { attachments } : {}),
    ...(message.metadata === undefined
      ? {}
      : { metadata: message.metadata as ThreadMessageLike['metadata'] }),
    ...(message.role === 'assistant'
      ? {
          status: assistantMessageStatus(message.metadata, running),
          convertConfig: { joinStrategy: 'none' as const }
        }
      : {})
  }
}

function assistantMessageStatus(
  metadata: unknown,
  running: boolean
): NonNullable<ThreadMessageLike['status']> {
  if (running) return { type: 'running' }

  const codexTurn = codexTurnMetadataFor(metadata)
  if (codexTurn?.status === 'failed') {
    return {
      type: 'incomplete',
      reason: 'error',
      error: safeTurnErrorMessage(codexTurn.error?.message)
    }
  }
  if (codexTurn?.status === 'interrupted') {
    return { type: 'incomplete', reason: 'cancelled' }
  }
  return { type: 'complete', reason: 'stop' }
}

function codexTurnMetadataFor(metadata: unknown): CodexTurnMessageMetadata | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const codexTurn = (metadata as Record<string, unknown>).codexTurn
  if (!codexTurn || typeof codexTurn !== 'object' || Array.isArray(codexTurn)) return undefined
  const candidate = codexTurn as Record<string, unknown>
  if (
    typeof candidate.turnId !== 'string' ||
    (candidate.status !== 'failed' && candidate.status !== 'interrupted')
  ) {
    return undefined
  }

  const rawError = candidate.error
  const error =
    rawError && typeof rawError === 'object' && !Array.isArray(rawError)
      ? (rawError as Record<string, unknown>)
      : undefined
  return {
    turnId: candidate.turnId,
    status: candidate.status,
    ...(error && typeof error.message === 'string'
      ? {
          error: {
            message: error.message,
            ...(typeof error.additionalDetails === 'string' || error.additionalDetails === null
              ? { additionalDetails: error.additionalDetails }
              : {}),
            ...('codexErrorInfo' in error ? { codexErrorInfo: error.codexErrorInfo } : {})
          }
        }
      : {})
  }
}

type CodexTextPartMetadata = {
  phase?: AssistantMessagePhase
  turnDurationMs?: number
}

const CODEX_PROVIDER_ID = '@janole/ai-sdk-provider-codex-asp'

function codexTextPartMetadataFor(message: ThreadMessage): readonly CodexTextPartMetadata[] {
  return getExternalStoreMessages<ExternalAISDKMessage>(message).flatMap((externalMessage) =>
    (externalMessage.parts ?? []).flatMap((part) => {
      if (part.type !== 'text') return []
      return [messageMetadataFromProviderMetadata(part.providerMetadata)]
    })
  )
}

function codexTurnDurationFor(message: ThreadMessage): number | undefined {
  return getExternalStoreMessages<ExternalAISDKMessage>(message)
    .map((externalMessage) => externalMessage.metadata)
    .map((metadata) =>
      metadata && typeof metadata === 'object'
        ? (metadata as Record<string, unknown>).codexTurnDurationMs
        : undefined
    )
    .find(
      (durationMs): durationMs is number =>
        typeof durationMs === 'number' && Number.isFinite(durationMs)
    )
}

function messageMetadataFromProviderMetadata(providerMetadata: unknown): CodexTextPartMetadata {
  if (!providerMetadata || typeof providerMetadata !== 'object') return {}
  const codexMetadata = (providerMetadata as Record<string, unknown>)[CODEX_PROVIDER_ID]
  if (!codexMetadata || typeof codexMetadata !== 'object') return {}
  const metadata = codexMetadata as Record<string, unknown>
  const phase = metadata.messagePhase
  const turnDurationMs = metadata.turnDurationMs
  return {
    ...(phase === 'commentary' || phase === 'final_answer' ? { phase } : {}),
    ...(typeof turnDurationMs === 'number' && Number.isFinite(turnDurationMs)
      ? { turnDurationMs }
      : {})
  }
}

function UserMessage(): React.JSX.Element {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      data-role="user"
      className="mx-auto grid w-full max-w-(--thread-max-width) auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 animate-in fade-in slide-in-from-bottom-1 [&:where(>*)]:col-start-2"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer rounded-xl bg-muted px-4 py-2 text-foreground wrap-break-word empty:hidden">
          <MessagePrimitive.Quote>{(quote) => <QuoteBlock {...quote} />}</MessagePrimitive.Quote>
          <MessagePrimitive.Parts components={{ Text: DirectiveText }} />
        </div>
        <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2 peer-empty:hidden">
          <UserActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  )
}

function QuoteBlock({ text }: QuoteMessagePartProps): React.JSX.Element {
  return (
    <div data-slot="quote-block" className="mb-2 flex items-start gap-1.5">
      <QuoteIcon
        data-slot="quote-block-icon"
        className="mt-0.5 size-3 shrink-0 text-muted-foreground/60"
      />
      <p
        data-slot="quote-block-text"
        className="line-clamp-2 min-w-0 text-sm text-muted-foreground/80 italic"
      >
        {text}
      </p>
    </div>
  )
}

function DirectiveText({ text }: TextMessagePartProps): React.JSX.Element {
  const segments = composerContextDirectiveFormatter.parse(text)
  const identityIndex = useComposerContextIdentityIndex()

  if (segments.length === 1 && segments[0]?.kind === 'text') return <>{text}</>

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return (
            <span key={index} className="whitespace-pre-wrap">
              {segment.text}
            </span>
          )
        }

        return (
          <span
            key={index}
            className="aui-directive-chip inline-flex items-baseline rounded-md bg-blue-100 px-1.5 py-0.5 text-[13px] leading-none font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
            data-directive-id={segment.id}
            data-directive-type={segment.type}
          >
            {displayDirectiveLabel(segment.type, segment.id, segment.label, identityIndex)}
          </span>
        )
      })}
    </>
  )
}

function displayDirectiveLabel(
  directiveType: string,
  directiveId: string,
  fallbackLabel: string,
  identityIndex: ComposerContextIdentityIndex
): string {
  if (directiveType !== 'app' && directiveType !== 'plugin') return fallbackLabel
  const identity = identityIndex.get(directiveId)
  return identity?.type === directiveType ? identity.displayLabel : fallbackLabel
}

function AssistantRenderUnitView({
  unit,
  onOpenConversation
}: {
  unit: AssistantRenderUnit
  onOpenConversation: OpenSubagentConversation
}): React.JSX.Element | null {
  switch (unit.type) {
    case 'message-thinking':
      return (
        <span
          data-slot="message-thinking-unit"
          className="inline-flex max-w-full min-w-0 items-center overflow-hidden text-sm text-muted-foreground"
          {...renderUnitAttributes(unit)}
        >
          <span aria-hidden className="h-4 w-0 shrink-0" />
          <span className="shimmer min-w-0 flex-1 truncate select-none leading-none motion-reduce:animate-none">
            {pendingAssistantMessageText}
          </span>
        </span>
      )
    case 'text':
      return <AssistantText text={unit.text} unit={unit} />
    case 'review-comments':
      return <ReviewCommentsDetails unit={unit} />
    case 'reasoning-group':
      return <ReasoningGroupUnit unit={unit} onOpenConversation={onOpenConversation} />
    case 'subagent-activity-group':
      return <SubagentActivityGroup unit={unit} onOpenConversation={onOpenConversation} />
    case 'entry':
      return <EntryUnit unit={unit} />
    case 'tool-group':
      return <ToolGroupUnit unit={unit} onOpenConversation={onOpenConversation} />
    case 'unknown':
      return <UnknownUnit unit={unit} />
  }
}

function ReasoningGroupUnit({
  unit,
  onOpenConversation
}: {
  unit: Extract<AssistantRenderUnit, { type: 'reasoning-group' }>
  onOpenConversation: OpenSubagentConversation
}): React.JSX.Element {
  const isActive = unit.active === true
  const completedTurnDiffs = isActive ? [] : unit.children.filter(isCompletedTurnDiffEntry)
  const processChildren =
    completedTurnDiffs.length === 0
      ? unit.children
      : unit.children.filter((child) => !isCompletedTurnDiffEntry(child))
  const [completedProcessOpen, setCompletedProcessOpen] = useState(false)
  const measuredDurationMs = useReasoningElapsedDuration(isActive)
  let label = isActive
    ? `已处理 · 耗时 ${formatProcessedDuration(measuredDurationMs ?? 0)}`
    : processedDurationLabel(unit.durationMs ?? measuredDurationMs)
  if (unit.state === 'blocked') label = blockedAssistantMessageText

  return (
    <Collapsible
      data-slot="reasoning-group"
      open={isActive || completedProcessOpen}
      onOpenChange={isActive ? undefined : setCompletedProcessOpen}
      disabled={isActive}
      className="group/reasoning my-2 w-full"
      {...renderUnitAttributes(unit)}
    >
      <div data-slot="reasoning-group-header">
        <CollapsibleTrigger
          data-slot="reasoning-group-trigger"
          disabled={isActive}
          className={cn(
            'group/trigger flex w-fit items-center gap-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground',
            isActive && 'cursor-default hover:text-muted-foreground'
          )}
        >
          <span data-slot="reasoning-group-label" className="relative inline-block">
            {label}
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 transition-transform duration-200 group-data-[state=closed]/trigger:-rotate-90"
          />
        </CollapsibleTrigger>
      </div>
      <hr data-slot="reasoning-group-divider" className="mb-4 border-border" />
      <CollapsibleContent
        data-slot="reasoning-group-content"
        className="overflow-hidden outline-none data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
      >
        <div className="min-w-0 space-y-4">
          {processChildren.map((child) => (
            <div key={child.key} data-slot="reasoning-process-item" className="min-w-0">
              <AssistantRenderUnitView unit={child} onOpenConversation={onOpenConversation} />
            </div>
          ))}
        </div>
      </CollapsibleContent>
      {completedTurnDiffs.map((child) => (
        <div key={child.key} data-slot="completed-turn-diff" className="min-w-0">
          <AssistantRenderUnitView unit={child} onOpenConversation={onOpenConversation} />
        </div>
      ))}
    </Collapsible>
  )
}

function isCompletedTurnDiffEntry(
  unit: AssistantRenderUnit
): unit is Extract<AssistantRenderUnit, { type: 'entry' }> {
  return unit.type === 'entry' && unit.itemType === 'turnDiff' && unit.item?.status === 'completed'
}

type ReasoningTimerState = {
  active: boolean
  startedAt?: number
  updatedAt: number
  completedDurationMs?: number
}

function useReasoningElapsedDuration(isActive: boolean): number | undefined {
  const [timer, setTimer] = useState<ReasoningTimerState>(() => {
    const now = Date.now()
    return {
      active: isActive,
      startedAt: isActive ? now : undefined,
      updatedAt: now
    }
  })
  const wasActive = useRef(isActive)
  const startTimer = useEffectEvent(() => {
    const startedAt = Date.now()
    setTimer({ active: true, startedAt, updatedAt: startedAt })
  })
  const stopTimer = useEffectEvent(() => {
    setTimer((current) => {
      if (!current.active || current.startedAt === undefined) return current
      const completedAt = Date.now()
      return {
        active: false,
        updatedAt: completedAt,
        completedDurationMs: Math.max(0, completedAt - current.startedAt)
      }
    })
  })

  useEffect(() => {
    if (!wasActive.current && isActive) startTimer()
    if (wasActive.current && !isActive) stopTimer()
    wasActive.current = isActive
  }, [isActive])

  useEffect(() => {
    if (!isActive) return

    const intervalId = window.setInterval(() => {
      setTimer((current) => (current.active ? { ...current, updatedAt: Date.now() } : current))
    }, 1_000)

    return () => window.clearInterval(intervalId)
  }, [isActive])

  if (isActive) {
    if (!timer.active || timer.startedAt === undefined) return 0
    return Math.max(0, timer.updatedAt - timer.startedAt)
  }

  return timer.completedDurationMs
}

function processedDurationLabel(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return '已处理'
  return `已处理 · 耗时 ${formatProcessedDuration(durationMs)}`
}

function formatProcessedDuration(durationMs: number): string {
  const roundedSeconds = Math.max(0, Math.round(durationMs / 1000))
  const totalSeconds = durationMs > 0 ? Math.max(1, roundedSeconds) : 0

  if (durationMs < 60_000) return `${totalSeconds} 秒`

  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)

  if (durationMs < 3_600_000) return `${totalMinutes} 分 ${seconds} 秒`

  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  return `${hours} 小时 ${minutes} 分 ${seconds} 秒`
}

function AssistantText({
  text,
  unit
}: {
  text: string
  unit?: AssistantRenderUnit
}): React.JSX.Element {
  return (
    <div data-slot="assistant-render-text" {...renderUnitAttributes(unit)}>
      <Streamdown caret="block" mode="streaming" plugins={streamdownPlugins}>
        {text}
      </Streamdown>
    </div>
  )
}

function ToolGroupUnit({
  unit,
  onOpenConversation
}: {
  unit: Extract<AssistantRenderUnit, { type: 'tool-group' }>
  onOpenConversation: OpenSubagentConversation
}): React.JSX.Element {
  const displayModel = buildToolActivityDisplayModel(unit)

  return (
    <ToolActivityGroupShell
      unit={unit}
      slot="tool-group-unit"
      display={displayModel.group}
      defaultOpen={false}
    >
      <CollapsedActivityDetails detailRows={displayModel.group.detailRows} />
      {unit.dynamicMetadata?.hasRegistryMetadata === false ? (
        <p className="text-xs text-muted-foreground">动态工具缺少完整显示元数据</p>
      ) : null}
      {unit.children.map((item, index) => (
        <ToolItemRenderer
          key={`${item.id}:${index}`}
          item={item}
          display={displayModel.items[index] ?? buildToolItemDisplay(item, unit)}
          index={index}
          group={unit}
          onOpenConversation={onOpenConversation}
        />
      ))}
    </ToolActivityGroupShell>
  )
}

function ToolItemRenderer({
  item,
  display,
  index,
  group,
  onOpenConversation
}: {
  item: ToolItem
  display: ToolItemDisplay
  index: number
  group: Extract<AssistantRenderUnit, { type: 'tool-group' }>
  onOpenConversation: OpenSubagentConversation
}): React.JSX.Element {
  if (item.kind === 'mcpToolCall') {
    return <McpToolCallDetails parts={[item.rawPart]} mcpSource={item.source ?? group.mcpSource} />
  }

  if (item.kind === 'webSearch') {
    return <WebSearchDetails parts={[item.rawPart]} />
  }

  if (item.kind === 'collabAgentToolCall' || item.kind === 'collabToolCall') {
    return <MultiAgentToolItemDetails item={item} onOpenConversation={onOpenConversation} />
  }

  return (
    <>
      {renderToolPart(
        item.rawPart,
        index,
        undefined,
        item.dynamicMetadata ?? group.dynamicMetadata,
        item,
        display
      )}
    </>
  )
}

function EntryUnit({
  unit
}: {
  unit: Extract<AssistantRenderUnit, { type: 'entry' }>
}): React.JSX.Element | null {
  if (unit.renderMode === 'known-null') return null

  if (unit.renderMode === 'text') {
    const text = entryText(unit)
    return text ? <AssistantText text={text} unit={unit} /> : null
  }

  if (unit.renderMode === 'custom') {
    return <SpecialEntryRenderer unit={unit} />
  }

  return (
    <div data-slot="entry-unit" {...renderUnitAttributes(unit)}>
      <AssistantToolPart part={unit.part} unit={unit} />
    </div>
  )
}

function UnknownUnit({
  unit
}: {
  unit: Extract<AssistantRenderUnit, { type: 'unknown' }>
}): React.JSX.Element {
  if (isRenderableUnknownPart(unit.part)) {
    return <UnknownPartRenderer part={unit.part} unit={unit} />
  }

  return (
    <div
      aria-hidden="true"
      className="hidden"
      data-slot="unknown-render-unit"
      {...renderUnitAttributes(unit)}
    />
  )
}

function isRenderableUnknownPart(part: Record<string, unknown>): boolean {
  return part.type === 'file' && stringRecordValue(part, 'mediaType')?.startsWith('image/') === true
}

function entryText(unit: Extract<AssistantRenderUnit, { type: 'entry' }>): string | undefined {
  const item = unit.item
  return (
    stringRecordValue(item, 'message') ??
    stringRecordValue(item, 'text') ??
    stringRecordValue(item, 'content') ??
    stringRecordValue(unit.part, 'text')
  )
}

function AssistantToolPart({
  part,
  unit
}: {
  part: Record<string, unknown>
  unit: Extract<AssistantRenderUnit, { type: 'entry' }>
}): ReactNode {
  return renderToolPart(part, unit.partIndex, unit)
}

function renderToolPart(
  part: Record<string, unknown>,
  index: number,
  unit?: Extract<AssistantRenderUnit, { type: 'entry' }>,
  _dynamicMetadata?: unknown,
  item?: ToolItem,
  display?: ToolItemDisplay
): ReactNode {
  const toolUI = part.toolUI as ReactNode | undefined
  if (toolUI) return toolUI

  const activeStatus = toolStatusForPart(part)
  const itemDisplay = display ?? (item ? buildToolItemDisplay(item) : undefined)

  return (
    <ToolFallback
      {...(part as React.ComponentProps<typeof ToolFallback>)}
      key={String(part.toolCallId ?? index)}
      toolName={stringRecordValue(part, 'toolName') ?? unit?.itemType ?? 'unknown_tool'}
      status={activeStatus ?? { type: 'complete' }}
      display={itemDisplay}
      summaryLabel={itemDisplay?.label ?? item?.label ?? unit?.summary?.label}
      summaryIcon={itemDisplay?.icon ?? unit?.summary?.icon}
    />
  )
}

function toolStatusForPart(part: Record<string, unknown>): ToolCallMessagePartStatus | undefined {
  if (isToolCallStatus(part.status)) return part.status
  if (part.preliminary === true) return { type: 'running' }

  return toolStatusForAiSdkState(part.state)
}

function toolStatusForAiSdkState(state: unknown): ToolCallMessagePartStatus | undefined {
  if (state === 'approval-requested') return { type: 'requires-action', reason: 'interrupt' }
  if (
    state === 'input-streaming' ||
    state === 'input-available' ||
    state === 'approval-responded'
  ) {
    return { type: 'running' }
  }
  if (state === 'output-error') return { type: 'incomplete', reason: 'error' }
  if (state === 'output-available' || state === 'output-denied') return { type: 'complete' }
  return undefined
}

function stringRecordValue(
  value: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const result = value?.[key]
  return typeof result === 'string' ? result : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isToolCallStatus(value: unknown): value is ToolCallMessagePartStatus {
  if (!isRecord(value)) return false
  return (
    value.type === 'running' ||
    value.type === 'complete' ||
    value.type === 'requires-action' ||
    value.type === 'incomplete'
  )
}

function UserActionBar(): React.JSX.Element {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <IconButton className="aui-user-action-edit" label="编辑" title="编辑">
          <PencilIcon className="size-4" />
        </IconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  )
}

function EditComposer(): React.JSX.Element {
  return (
    <ComposerContextSuggestionProvider>
      <MessagePrimitive.Root
        data-slot="aui_edit-composer-wrapper"
        className="mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2"
      >
        <ComposerPrimitive.Unstable_TriggerPopoverRoot>
          <ComposerPrimitive.Root className="aui-edit-composer-root ml-auto flex w-full max-w-[85%] flex-col rounded-3xl border border-border/60 bg-background shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:border-muted-foreground/15 dark:bg-muted/30 dark:shadow-none">
            <ContextLexicalInput
              autoFocus
              directiveChip={DirectiveChip}
              formatter={composerContextDirectiveFormatter}
              className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base text-foreground outline-none [&_.aui-directive-chip]:inline-flex [&_.aui-directive-chip]:items-baseline [&_.aui-directive-chip]:gap-1 [&_.aui-directive-chip]:rounded-md [&_.aui-directive-chip]:bg-blue-100 [&_.aui-directive-chip]:px-1.5 [&_.aui-directive-chip]:py-0.5 [&_.aui-directive-chip]:text-[13px] [&_.aui-directive-chip]:leading-none [&_.aui-directive-chip]:font-medium [&_.aui-directive-chip]:text-blue-700 [&_.aui-directive-chip-icon]:self-center [&_.aui-lexical-input]:min-h-lh [&_.aui-lexical-input]:outline-none dark:[&_.aui-directive-chip]:bg-blue-900/50 dark:[&_.aui-directive-chip]:text-blue-300"
            />
            <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
              <ComposerPrimitive.Cancel asChild>
                <button
                  className="h-8 rounded-full px-3.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  type="button"
                >
                  取消
                </button>
              </ComposerPrimitive.Cancel>
              <ComposerPrimitive.Send asChild>
                <button
                  className="h-8 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  type="button"
                >
                  更新
                </button>
              </ComposerPrimitive.Send>
            </div>
          </ComposerPrimitive.Root>
        </ComposerPrimitive.Unstable_TriggerPopoverRoot>
      </MessagePrimitive.Root>
    </ComposerContextSuggestionProvider>
  )
}

function AssistantActionBar(): React.JSX.Element {
  return (
    <ActionBarPrimitive.Root
      className="flex items-center gap-1 text-muted-foreground duration-200 animate-in fade-in"
      hideWhenRunning
      autohide="not-last"
    >
      <ActionBarPrimitive.Copy asChild>
        <IconButton label="复制" title="复制">
          <AuiIf condition={(state) => state.message.isCopied}>
            <CheckIcon className="size-4" />
          </AuiIf>
          <AuiIf condition={(state) => !state.message.isCopied}>
            <CopyIcon className="size-4" />
          </AuiIf>
        </IconButton>
      </ActionBarPrimitive.Copy>
      <MessageTiming />
    </ActionBarPrimitive.Root>
  )
}

function DirectiveChip({
  directiveId,
  directiveType,
  label
}: DirectiveChipProps): React.JSX.Element {
  const identityIndex = useComposerContextIdentityIndex()
  const Icon =
    directiveType === 'command' ? undefined : (directiveChipIcons[directiveType] ?? WrenchIcon)

  return (
    <span
      className="aui-directive-chip"
      data-directive-id={directiveId}
      data-directive-type={directiveType}
    >
      {Icon ? (
        <span className="aui-directive-chip-icon">
          <Icon className="size-3" />
        </span>
      ) : null}
      <span className="aui-directive-chip-label">
        {displayDirectiveLabel(directiveType, directiveId, label, identityIndex)}
      </span>
    </span>
  )
}

function resolveTriggerIcon(
  iconKey: string | undefined,
  iconMap: Record<string, IconComponent> | undefined,
  fallbackIcon: IconComponent
): IconComponent {
  if (iconKey && iconMap?.[iconKey]) return iconMap[iconKey]
  return fallbackIcon
}

function TriggerPopoverCategories({
  emptyLabel,
  fallbackIcon,
  iconMap
}: {
  emptyLabel: string
  fallbackIcon: IconComponent
  iconMap?: Record<string, IconComponent>
}): React.JSX.Element {
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverCategories>
      {(categories) => (
        <div className="flex flex-col py-1" data-slot="composer-trigger-popover-categories">
          {categories.map((category) => {
            const Icon = resolveTriggerIcon(category.id, iconMap, fallbackIcon)

            return (
              <ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
                key={category.id}
                categoryId={category.id}
                className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm transition-colors outline-none hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" />
                  {category.label}
                </span>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </ComposerPrimitive.Unstable_TriggerPopoverCategoryItem>
            )
          })}
          {categories.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</div>
          ) : null}
        </div>
      )}
    </ComposerPrimitive.Unstable_TriggerPopoverCategories>
  )
}

function TriggerPopoverItems({
  backLabel,
  emptyLabel,
  fallbackIcon,
  iconMap
}: {
  backLabel: string
  emptyLabel: string
  fallbackIcon: IconComponent
  iconMap?: Record<string, IconComponent>
}): React.JSX.Element {
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverItems>
      {(items) => (
        <div className="flex flex-col" data-slot="composer-trigger-popover-items">
          <ComposerPrimitive.Unstable_TriggerPopoverBack className="flex cursor-pointer items-center gap-1.5 border-b px-3 py-2 text-xs text-muted-foreground uppercase transition-colors hover:bg-accent">
            <ChevronLeftIcon className="size-3.5" />
            {backLabel}
          </ComposerPrimitive.Unstable_TriggerPopoverBack>

          <div className="py-1">
            {items.map((item, index) => {
              const iconKey =
                typeof item.metadata?.icon === 'string' ? item.metadata.icon : undefined
              const Icon = resolveTriggerIcon(iconKey, iconMap, fallbackIcon)

              return (
                <ComposerPrimitive.Unstable_TriggerPopoverItem
                  key={item.id}
                  item={item}
                  index={index}
                  className="flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-2 text-start transition-colors outline-none hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="size-3.5 text-primary" />
                    {item.label}
                  </span>
                  {item.description ? (
                    <span className="ms-5.5 text-xs leading-tight text-muted-foreground">
                      {item.description}
                    </span>
                  ) : null}
                </ComposerPrimitive.Unstable_TriggerPopoverItem>
              )
            })}
            {items.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</div>
            ) : null}
          </div>
        </div>
      )}
    </ComposerPrimitive.Unstable_TriggerPopoverItems>
  )
}

function ComposerTriggerPopover({
  action,
  backLabel = '返回',
  className,
  directive,
  emptyCategoriesLabel = '没有可用项目',
  emptyItemsLabel = '没有匹配项',
  fallbackIcon = SlashIcon,
  iconMap,
  ...props
}: ComposerTriggerPopoverProps): React.JSX.Element {
  return (
    <ComposerPrimitive.Unstable_TriggerPopover
      className={cn(
        'aui-composer-trigger-popover absolute bottom-full start-0 z-50 mb-2 w-64 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg',
        className
      )}
      data-slot="composer-trigger-popover"
      {...props}
    >
      {directive ? (
        <ComposerPrimitive.Unstable_TriggerPopover.Directive
          formatter={directive.formatter ?? unstable_defaultDirectiveFormatter}
          onInserted={directive.onInserted}
        />
      ) : (
        <ComposerPrimitive.Unstable_TriggerPopover.Action
          formatter={action.formatter ?? unstable_defaultDirectiveFormatter}
          onExecute={action.onExecute}
          removeOnExecute={action.removeOnExecute}
        />
      )}
      <TriggerPopoverCategories
        emptyLabel={emptyCategoriesLabel}
        fallbackIcon={fallbackIcon}
        iconMap={iconMap}
      />
      <TriggerPopoverItems
        backLabel={backLabel}
        emptyLabel={emptyItemsLabel}
        fallbackIcon={fallbackIcon}
        iconMap={iconMap}
      />
    </ComposerPrimitive.Unstable_TriggerPopover>
  )
}

function Composer({
  activeConversation,
  composerContextCatalog,
  disabled,
  followUps,
  models,
  selectedModelId,
  modelSelectionError,
  onSelectedModelChange,
  onSteerFollowUp,
  onStartInlineReview,
  onStartDetachedReview,
  projectState,
  editingFollowUp,
  onEditingFollowUpChange,
  queueAttached,
  reservedEditingItemId
}: ComposerComponentProps): React.JSX.Element {
  const aui = useAui()
  const globalProjectSelection = projectState.state?.activeProjectSelection
  const conversationProjectSelection = activeConversation?.projectSelection
  const effectiveProjectSelection = activeConversation
    ? conversationProjectSelection
    : globalProjectSelection
  const isRemoteExecution = effectiveProjectSelection?.projectKind === 'remote'
  const gitRepository = useGitRepository()
  const gitTarget = gitRepository.status === 'ready' ? gitRepository.target : undefined
  const hasProjectContext = hasConversationProjectContext(activeConversation, projectState)
  const localContextPickerEnabled = !isRemoteExecution
  const [contextSearchOpen, setContextSearchOpen] = useState(false)
  const [reviewModeOpen, setReviewModeOpen] = useState(false)
  const [reviewModeError, setReviewModeError] = useState<string>()
  const [reviewDelivery, setReviewDelivery] = useState<'inline' | 'detached'>(() => {
    try {
      return window.localStorage.getItem('local-git-review.delivery') === 'detached'
        ? 'detached'
        : 'inline'
    } catch {
      return 'inline'
    }
  })
  const composerText = useAuiState((state) => state.composer.text)
  const composerAttachments = useAuiState((state) => state.composer.attachments)
  const isThreadRunning = useAuiState((state) => state.thread.isRunning)
  const [pausedSubmission, setPausedSubmission] = useState<{
    mode: FollowUpMode
    snapshot: QueuedUserMessageSnapshotInput
  } | null>(null)
  const selectedTaskIds = useMemo(
    () => [
      ...new Set(
        parseComposerContextReferences(composerText).flatMap((reference) =>
          reference.type === 'chat' ? [threadIdFromComposerReference(reference.path)] : []
        )
      )
    ],
    [composerText]
  )
  const composerContextSearch = useComposerContextSearch({
    cwd: resolveComposerCwd(activeConversation, projectState),
    enabled: contextSearchOpen && hasProjectContext,
    excludedThreadIds: selectedTaskIds,
    projectSelection: effectiveProjectSelection,
    query: composerContextCatalog.query,
    threadId: activeConversation?.threadId
  })
  const hasImageAttachments = useAuiState((state) =>
    state.composer.attachments.some((attachment) => attachment.type === 'image')
  )
  const hasLocalPathAttachments = useAuiState((state) =>
    state.composer.attachments.some((attachment) =>
      Boolean(localPathAttachmentIdentityFromId(attachment.id))
    )
  )
  const hasUnsendableAttachments = useAuiState((state) =>
    state.composer.attachments.some(
      (attachment) =>
        attachment.status.type === 'running' ||
        (attachment.status.type === 'incomplete' && attachment.status.reason === 'error')
    )
  )

  const modelContextTools = useMemo<Unstable_TriggerItem[]>(() => {
    const tools = aui.thread().getModelContext().tools
    if (!tools) return []
    return Object.entries(tools).map(([id, tool]) => ({
      id,
      type: 'tool',
      label: id,
      ...(tool.description ? { description: tool.description } : {}),
      metadata: { icon: 'tool' }
    }))
  }, [aui])
  const slash = unstable_useSlashCommandAdapter({
    commands: slashCommands,
    fallbackIcon: SlashIcon,
    iconMap: slashIconMap
  })
  const selectedModel = models.find((model) => model.id === selectedModelId)
  const selectedModelSupportsImages = selectedModel?.inputModalities?.includes('image') ?? true
  const cannotSendImages = hasImageAttachments && !selectedModelSupportsImages
  const pickLocalContext = useCallback(
    async (kind: LocalContextPickerKind): Promise<boolean> => {
      const references = await window.desktopApp.codex.pickLocalContext(kind)
      if (references.length === 0) return false

      const composer = aui.composer()
      for (const reference of references) {
        if (reference.kind === 'image') {
          await composer.addAttachment(
            createLocalImageAttachment({
              capabilityToken: reference.capabilityToken,
              label: reference.label,
              mediaType: reference.mediaType,
              path: reference.path,
              previewUrl: reference.previewUrl
            })
          )
          continue
        }
        await composer.addAttachment(
          createLocalPathAttachment({
            capabilityToken: reference.capabilityToken,
            fileUrl: reference.fileUrl,
            kind: reference.kind,
            label: reference.label,
            path: reference.path
          })
        )
      }

      return true
    },
    [aui]
  )
  const sendDisabled =
    disabled ||
    !hasProjectContext ||
    cannotSendImages ||
    hasUnsendableAttachments ||
    (isRemoteExecution && hasLocalPathAttachments) ||
    Boolean(reservedEditingItemId && !editingFollowUp)
  const hasComposerContent = composerText.trim().length > 0 || composerAttachments.length > 0
  const submitCodeReview = useCallback(
    async (selection: ComposerReviewSelection): Promise<void> => {
      if (!gitTarget) throw new Error('Choose a Git-backed conversation before starting a review')
      if (composerText.trim().length > 0 || composerAttachments.length > 0) {
        throw new Error('请先发送或清空输入框中的草稿和附件，再开始审核')
      }
      setReviewModeError(undefined)
      const reviewTarget =
        selection.type === 'uncommitted'
          ? selection
          : {
              type: 'base-branch' as const,
              ...(await window.desktopApp.git.resolveMergeBase({
                target: gitTarget,
                baseBranch: selection.baseBranch
              }))
            }
      const prompt = buildCodeReviewPrompt(reviewTarget)
      if (reviewDelivery === 'detached') {
        await onStartDetachedReview(prompt)
        setReviewModeOpen(false)
        return
      }
      await onStartInlineReview(prompt)
      setReviewModeOpen(false)
    },
    [
      composerAttachments.length,
      composerText,
      gitTarget,
      onStartDetachedReview,
      onStartInlineReview,
      reviewDelivery
    ]
  )
  let reviewDisabledReason: string | undefined
  if (!gitTarget) {
    reviewDisabledReason = '当前会话没有可审核的 Git 仓库'
  } else if (isThreadRunning) {
    reviewDisabledReason = '请等待当前任务完成后再开始审核'
  } else if (editingFollowUp) {
    reviewDisabledReason = '请先完成或取消正在编辑的排队消息'
  } else if (hasComposerContent) {
    reviewDisabledReason = '请先发送或清空输入框中的草稿和附件，再开始审核'
  }
  const updateReviewDelivery = (delivery: 'inline' | 'detached'): void => {
    setReviewDelivery(delivery)
    try {
      window.localStorage.setItem('local-git-review.delivery', delivery)
    } catch {
      // The preference only affects this renderer and remains optional.
    }
  }
  const enqueueRunningFollowUp = useCallback(
    async (mode: FollowUpMode) => {
      const id = editingFollowUp?.itemId ?? crypto.randomUUID()
      const cwd = resolveComposerCwd(activeConversation, projectState) ?? null
      const selection = effectiveProjectSelection
      const conversationKey =
        activeConversation?.threadId ??
        activeConversation?.conversationId ??
        followUps.state?.conversationKey
      if (!conversationKey) throw new Error('当前会话尚未准备好，无法保存追问')
      const hostId = selection?.projectKind === 'remote' ? selection.hostId : 'local'
      const snapshot = await createQueuedFollowUpSnapshot({
        id,
        text: composerText,
        attachments: composerAttachments,
        trustedContext:
          editingFollowUp?.trustedContext ??
          ({
            conversationId: activeConversation?.conversationId ?? conversationKey,
            ...(activeConversation?.threadId ? { threadId: activeConversation.threadId } : {}),
            ...(selection ? { projectSelection: selection } : {}),
            hostId,
            cwd,
            workspaceRoots: projectState.state?.activeWorkspaceRoots ?? (cwd ? [cwd] : [])
          } satisfies QueuedFollowUpTrustedContext)
      })
      if (editingFollowUp) snapshot.contextReferences = editingFollowUp.contextReferences
      if (!editingFollowUp && followUps.items[0]?.status === 'paused-interrupted') {
        setPausedSubmission({ mode, snapshot })
        return
      }
      if (editingFollowUp) {
        await followUps.commitEdit(editingFollowUp.itemId, snapshot)
        onEditingFollowUpChange(null)
        await aui.composer().reset()
      } else {
        await followUps.enqueue(snapshot, mode)
        await aui.composer().reset()
        if (mode === 'steer') await onSteerFollowUp(id, snapshot)
      }
    },
    [
      activeConversation,
      aui,
      composerAttachments,
      composerText,
      editingFollowUp,
      effectiveProjectSelection,
      followUps,
      onEditingFollowUpChange,
      onSteerFollowUp,
      projectState
    ]
  )

  const contextSections = useMemo(() => {
    const catalogSections = composerContextCatalog.sections.map((section) => {
      let items = section.items
      if (composerContextCatalog.loading) {
        items = []
      } else if (section.id === 'apps') {
        items = section.items.slice(0, 3)
      }
      return {
        id: section.id,
        label: composerContextSectionLabel(section.id),
        items,
        loading: composerContextCatalog.loading,
        error: section.error,
        onRetry: () => composerContextCatalog.refresh(section.id),
        preFiltered: true
      }
    })
    if (!composerContextCatalog.query.trim()) {
      return [
        ...catalogSections.filter((section) => section.id !== 'skills'),
        {
          id: 'files-and-tasks',
          label: 'Files and tasks',
          items: [],
          placeholder: '输入以搜索文件或任务',
          preFiltered: true
        },
        { id: 'tools', label: 'Tools', items: modelContextTools, preFiltered: true }
      ]
    }

    const dynamicSections = composerContextSearch.sections.map((section) => ({
      id: section.id,
      items: selectedTaskIds.length >= 3 && section.id === 'tasks' ? [] : section.items
    }))
    return buildComposerGlobalSearchResult({
      query: composerContextCatalog.query,
      sections: [...catalogSections, ...dynamicSections],
      loading: composerContextCatalog.loading || composerContextSearch.loading,
      sourceErrors: [
        ...catalogSections.flatMap((section) => (section.error ? [section.error] : [])),
        ...composerContextSearch.sections.flatMap((section) =>
          section.error ? [section.error] : []
        )
      ],
      warnings: selectedTaskIds.length >= 3 ? ['每条消息最多引用 3 个任务'] : []
    })
  }, [
    composerContextCatalog,
    composerContextSearch.loading,
    composerContextSearch.sections,
    modelContextTools,
    selectedTaskIds
  ])

  return (
    <ComposerContextSuggestionProvider>
      <Dialog
        open={pausedSubmission !== null}
        onOpenChange={(open) => {
          if (!open) setPausedSubmission(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>追问队列已暂停</DialogTitle>
            <DialogDescription>
              你刚刚停止了任务。请选择如何处理原来的追问，再继续提交这条新消息。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setPausedSubmission(null)}>
              取消
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  const pending = pausedSubmission
                  if (!pending) return
                  void (async () => {
                    await followUps.clear()
                    await followUps.enqueue(pending.snapshot, pending.mode)
                    setPausedSubmission(null)
                    await aui.composer().reset()
                  })()
                }}
              >
                清空旧队列并发送
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const pending = pausedSubmission
                  if (!pending) return
                  void (async () => {
                    await followUps.enqueue(pending.snapshot, pending.mode)
                    await followUps.resume()
                    setPausedSubmission(null)
                    await aui.composer().reset()
                  })()
                }}
              >
                保留旧队列并恢复
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <ComposerPrimitive.Root
          className="aui-composer-root relative flex w-full flex-col"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            if (reviewModeOpen) {
              event.preventDefault()
              setReviewModeOpen(false)
              setReviewModeError(undefined)
              return
            }
            if (isThreadRunning) {
              event.preventDefault()
              aui.composer().cancel()
            }
          }}
        >
          <div
            data-slot="aui_composer-shell"
            className={cn(
              'flex w-full flex-col gap-2 border border-border/60 bg-background p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:border-border focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] dark:bg-muted/70',
              queueAttached ? 'rounded-b-3xl rounded-t-none' : 'rounded-3xl'
            )}
          >
            {editingFollowUp ? (
              <div
                data-slot="queued-follow-up-editing"
                className="flex items-center justify-between gap-3 rounded-xl bg-muted/65 px-2.5 py-1.5 text-xs text-muted-foreground"
              >
                <span>正在编辑排队消息</span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    void (async () => {
                      await followUps.cancelEdit(editingFollowUp.itemId)
                      await aui.composer().reset()
                      onEditingFollowUpChange(null)
                    })()
                  }}
                >
                  取消编辑
                </Button>
              </div>
            ) : null}
            {!reviewModeOpen ? <ComposerAttachments /> : null}
            {reviewModeOpen ? (
              <ComposerReviewMode
                target={gitTarget}
                disabled={sendDisabled || isThreadRunning}
                delivery={reviewDelivery}
                error={reviewModeError}
                onCancel={() => {
                  setReviewModeOpen(false)
                  setReviewModeError(undefined)
                  window.requestAnimationFrame(() =>
                    document.querySelector<HTMLElement>('.aui-lexical-input')?.focus()
                  )
                }}
                onError={setReviewModeError}
                onDeliveryChange={updateReviewDelivery}
                onSubmit={submitCodeReview}
              />
            ) : (
              <ContextLexicalInput
                className="aui-composer-input relative max-h-32 min-h-10 w-full resize-none overflow-y-auto bg-transparent px-2.5 py-1 text-base leading-6 outline-none [&_.aui-directive-chip]:inline-flex [&_.aui-directive-chip]:items-baseline [&_.aui-directive-chip]:gap-1 [&_.aui-directive-chip]:rounded-md [&_.aui-directive-chip]:bg-blue-100 [&_.aui-directive-chip]:px-1.5 [&_.aui-directive-chip]:py-0.5 [&_.aui-directive-chip]:text-[13px] [&_.aui-directive-chip]:leading-none [&_.aui-directive-chip]:font-medium [&_.aui-directive-chip]:text-blue-700 [&_.aui-directive-chip-icon]:self-center [&_.aui-lexical-input]:min-h-lh [&_.aui-lexical-input]:outline-none [&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute [&_.aui-lexical-placeholder]:inset-x-0 [&_.aui-lexical-placeholder]:top-0 [&_.aui-lexical-placeholder]:truncate [&_.aui-lexical-placeholder]:px-2.5 [&_.aui-lexical-placeholder]:py-1 [&_.aui-lexical-placeholder]:text-muted-foreground/80 dark:[&_.aui-directive-chip]:bg-blue-900/50 dark:[&_.aui-directive-chip]:text-blue-300"
                directiveChip={DirectiveChip}
                formatter={composerContextDirectiveFormatter}
                placeholder="输入消息（@ 提及工具，/ 输入命令）"
              />
            )}
            <div className="aui-composer-action-wrapper flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-1">
                {!reviewModeOpen ? (
                  <ComposerAddContextPopover
                    localPickerEnabled={localContextPickerEnabled}
                    onOpenChange={setContextSearchOpen}
                    onQueryChange={composerContextCatalog.setQuery}
                    pickLocalContext={pickLocalContext}
                    sections={contextSections}
                  />
                ) : null}
                <ModelSelector
                  models={models}
                  value={selectedModelId}
                  onValueChange={onSelectedModelChange}
                  variant="ghost"
                  size="sm"
                />
                {isRemoteExecution &&
                (gitRepository.status === 'unavailable' || gitRepository.status === 'error') ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    data-slot="git-repository-retry"
                    title={
                      gitRepository.status === 'unavailable'
                        ? gitRepository.reason
                        : gitRepository.error.message
                    }
                    onClick={gitRepository.retry}
                  >
                    重试 Git
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={Boolean(reviewDisabledReason)}
                  aria-pressed={reviewModeOpen}
                  title={reviewDisabledReason ?? '开始代码审核'}
                  onClick={() => {
                    setReviewModeOpen(true)
                    setReviewModeError(undefined)
                  }}
                >
                  Review
                </Button>
                {modelSelectionError && (
                  <span
                    role="alert"
                    data-slot="model-selection-error"
                    className="text-destructive max-w-56 truncate text-xs"
                    title={modelSelectionError}
                  >
                    {modelSelectionError}
                  </span>
                )}
                {cannotSendImages ? (
                  <span
                    role="alert"
                    data-slot="composer-image-model-error"
                    className="max-w-56 truncate text-xs text-destructive"
                  >
                    移除照片或切换到支持图片的模型
                  </span>
                ) : null}
                {isRemoteExecution && hasLocalPathAttachments ? (
                  <span
                    role="alert"
                    data-slot="composer-remote-local-attachment-error"
                    className="max-w-64 truncate text-xs text-destructive"
                  >
                    移除本地文件附件后才能发送到远程项目
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                {!reviewModeOpen && !editingFollowUp ? (
                  <AuiIf condition={(state) => !state.thread.isRunning}>
                    <ComposerPrimitive.Send asChild>
                      <IconButton
                        className="aui-composer-send size-7 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                        disabled={sendDisabled}
                        label="发送消息"
                        title="发送消息"
                      >
                        <ArrowUpIcon className="size-4.5" />
                      </IconButton>
                    </ComposerPrimitive.Send>
                  </AuiIf>
                ) : null}
                {!reviewModeOpen && isThreadRunning && !hasComposerContent ? (
                  <ComposerPrimitive.Cancel asChild>
                    <IconButton
                      className="aui-composer-cancel size-7 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                      label="停止生成"
                      title="停止生成"
                    >
                      <SquareIcon className="size-3.5 fill-current" />
                    </IconButton>
                  </ComposerPrimitive.Cancel>
                ) : null}
                {!reviewModeOpen && (editingFollowUp || isThreadRunning) && hasComposerContent ? (
                  <>
                    <IconButton
                      className="size-7 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                      disabled={sendDisabled || followUps.loading}
                      label={
                        editingFollowUp
                          ? '保存编辑后的排队消息'
                          : followUps.defaultMode === 'queue'
                            ? '将追问加入队列'
                            : '立即调整当前任务'
                      }
                      title={
                        editingFollowUp
                          ? '保存到原来的队列位置'
                          : followUps.defaultMode === 'queue'
                            ? '排队（按住 Shift 单次引导）'
                            : '引导（按住 Shift 单次排队）'
                      }
                      onClick={(event) => {
                        const mode = editingFollowUp
                          ? followUps.defaultMode
                          : event.shiftKey
                            ? followUps.defaultMode === 'queue'
                              ? 'steer'
                              : 'queue'
                            : followUps.defaultMode
                        void enqueueRunningFollowUp(mode).catch(() => undefined)
                      }}
                    >
                      <ArrowUpIcon className="size-4.5" />
                    </IconButton>
                    <ComposerPrimitive.Cancel asChild>
                      <IconButton
                        className="size-7 rounded-full bg-transparent hover:bg-muted"
                        label="停止生成"
                        title="停止生成（Esc）"
                      >
                        <SquareIcon className="size-3 fill-current" />
                      </IconButton>
                    </ComposerPrimitive.Cancel>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          {!reviewModeOpen ? (
            <ComposerTriggerPopover char="/" emptyItemsLabel="没有匹配命令" {...slash} />
          ) : null}
        </ComposerPrimitive.Root>
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>
    </ComposerContextSuggestionProvider>
  )
}

function hasConversationProjectContext(
  activeConversation: ActiveConversationContext | undefined,
  projectState: ProjectStateController
): boolean {
  if (!activeConversation?.threadId) return projectState.state !== null
  return Boolean(
    activeConversation.threadId || activeConversation.projectSelection || activeConversation.cwd
  )
}

function resolveComposerCwd(
  activeConversation: ActiveConversationContext | undefined,
  projectState: ProjectStateController
): string | undefined {
  if (activeConversation?.cwd) return activeConversation.cwd
  const selection =
    activeConversation?.projectSelection ?? projectState.state?.activeProjectSelection
  if (selection?.projectKind === 'path') return selection.path
  if (selection?.projectKind === 'local') {
    const project = projectState.state?.localProjects[selection.projectId]
    return project?.defaultCwd ?? project?.writableRoots[0]
  }
  return projectState.state?.activeWorkspaceRoots?.[0]
}

function composerContextSectionLabel(sectionId: string): string {
  switch (sectionId) {
    case 'files':
      return 'Files'
    case 'chats':
      return 'Tasks'
    case 'tasks':
      return 'Tasks'
    case 'agents':
      return '智能体'
    case 'skills':
      return '技能'
    case 'plugins':
      return '插件'
    case 'apps':
      return 'Apps'
    default:
      return sectionId
  }
}

function threadIdFromComposerReference(uri: string): string {
  const encodedThreadId = uri.slice('thread://'.length)
  try {
    return decodeURIComponent(encodedThreadId)
  } catch {
    return encodedThreadId
  }
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, className, label, title, type, ...buttonProps },
  ref
): React.JSX.Element {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40',
        className
      )}
      type={type ?? 'button'}
      aria-label={label}
      title={title ?? label}
      {...buttonProps}
    >
      {children}
    </button>
  )
})

export default App
