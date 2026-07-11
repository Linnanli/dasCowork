import { useState, type ReactNode } from 'react'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ClockIcon,
  CombineIcon,
  FileIcon,
  FilePenIcon,
  ImageIcon,
  LinkIcon,
  ListChecksIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  Undo2Icon,
  WrenchIcon,
  type LucideIcon
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { DiffViewer } from '@/components/assistant-ui/diff-viewer'
import { toolGroupIconMap } from '@/components/assistant-ui/tool-group'
import type { AssistantRenderUnit, McpSourceMetadata } from '@/lib/assistantRenderUnits'
import type { ToolActivityDetailRow } from '@/lib/toolActivityDisplay'
import {
  extractToolInput,
  extractThreadItem,
  isToolPartActive,
  type ToolGroupSummary
} from '@/lib/toolGroupSummary'
import { cn } from '@/lib/utils'
import { renderUnitAttributes } from './renderUnitAttributes'

type AnyRecord = Record<string, unknown>
type EntryUnit = Extract<AssistantRenderUnit, { type: 'entry' }>

const CODEX_PROVIDER_ID = '@janole/ai-sdk-provider-codex-asp'
const MAX_VISIBLE_ROWS = 3
const MAX_VISIBLE_DIFF_FILES = 3
const LARGE_DIFF_TEXT_LENGTH = 50_000
const WebSearchIcon = toolGroupIconMap['web-search']

export function CollapsedActivityDetails({
  detailRows,
  summary
}: {
  detailRows?: readonly ToolActivityDetailRow[]
  summary?: ToolGroupSummary
}): React.JSX.Element | null {
  const rows: readonly ToolActivityDetailRow[] = detailRows ?? legacySummaryRows(summary)

  if (rows.length === 0) return null

  return (
    <div data-slot="collapsed-activity-details" className="space-y-1 text-xs text-muted-foreground">
      <ul className="space-y-1">
        {rows.slice(0, 4).map((row) => (
          <li key={`${row.label ?? ''}:${row.value}`} className="min-w-0 truncate">
            {row.label ? `${row.label}：${row.value}` : row.value}
          </li>
        ))}
      </ul>
    </div>
  )
}

function legacySummaryRows(summary: ToolGroupSummary | undefined): ToolActivityDetailRow[] {
  return [
    summary?.sourceSummary ? { label: '来源', value: summary.sourceSummary } : undefined,
    ...(summary?.details ?? []).map((value) => ({ value }))
  ].filter(isDefined)
}

export function McpToolCallDetails({
  parts,
  mcpSource
}: {
  parts: readonly AnyRecord[]
  mcpSource?: McpSourceMetadata
}): React.JSX.Element {
  return (
    <div data-slot="mcp-rich-output" className="space-y-2">
      <McpSourceBadge source={mcpSource} />
      {parts.map((part, index) => (
        <McpToolCallDetail
          key={String(part.toolCallId ?? extractThreadItem(part)?.id ?? index)}
          part={part}
          index={index}
        />
      ))}
    </div>
  )
}

export function WebSearchDetails({ parts }: { parts: readonly AnyRecord[] }): React.JSX.Element {
  const items = parts.map(webSearchDetailForPart)
  const hasAnyTarget = items.some(({ target }) => target)

  if (!hasAnyTarget) {
    return (
      <p data-slot="web-search-detail-fallback" className="text-xs text-muted-foreground">
        搜索详情暂不可用
      </p>
    )
  }

  return (
    <ol data-slot="web-search-details" className="space-y-1">
      {items.map(({ part, item, target }, index) => {
        const active = isToolPartActive(part) || isActiveStatus(item?.status)

        return (
          <li
            key={String(item?.id ?? part.toolCallId ?? index)}
            className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
          >
            <WebSearchIcon
              aria-hidden
              data-slot="web-search-detail-icon"
              className="size-3.5 shrink-0"
            />
            <span className="shrink-0 leading-none font-normal">
              {active ? '正在搜索网页' : '已搜索网页'}
            </span>
            <span className="min-w-0 truncate leading-none font-normal">{target}</span>
          </li>
        )
      })}
    </ol>
  )
}

function webSearchDetailForPart(part: AnyRecord): {
  part: AnyRecord
  item?: AnyRecord
  target?: string
} {
  const item = extractThreadItem(part)
  const input = extractToolInput(part)
  const action = item?.action ?? webSearchActionFromInput(input)
  const query = stringValue(item?.query) ?? webSearchQueryFromInput(input)

  return {
    part,
    item,
    target: webSearchUrl(action) ?? query
  }
}

export function SpecialEntryRenderer({ unit }: { unit: EntryUnit }): React.JSX.Element | null {
  const item = unit.item
  if (!item) return null

  switch (unit.itemType) {
    case 'todoList':
      return <TodoListEntryUnit unit={unit} />
    case 'turnDiff':
      return <TurnDiffEntryUnit unit={unit} />
    case 'imageGeneration':
      return <GeneratedImageEntryUnit unit={unit} />
    case 'endResources':
      return <EndResourceCardsUnit unit={unit} />
    case 'reviewComments':
      return <ReviewCommentsEntryUnit unit={unit} />
    case 'automaticApprovalReview':
      return <AutomaticApprovalReviewEntryUnit unit={unit} />
    case 'streamError':
    case 'systemError':
      return <ErrorEntryUnit unit={unit} />
    case 'permissionRequest':
    case 'mcpServerElicitation':
    case 'userInputResponse':
    case 'remoteTaskCreated':
    case 'personalityChanged':
    case 'modelChanged':
    case 'modelRerouted':
    case 'worktreeInit':
    case 'automationUpdate':
    case 'sleep':
    case 'loadedTool':
    case 'subAgentActivity':
      return <CompactEntryUnit unit={unit} />
    case 'contextCompaction':
      return <ContextCompactionEntryUnit unit={unit} />
    default:
      return null
  }
}

export function UnknownPartRenderer({
  part,
  unit
}: {
  part: AnyRecord
  unit: Extract<AssistantRenderUnit, { type: 'unknown' }>
}): React.JSX.Element | null {
  if (part.type === 'file' && stringValue(part.mediaType)?.startsWith('image/')) {
    return <GeneratedImageFileUnit part={part} unit={unit} />
  }

  return null
}

function McpToolCallDetail({ part, index }: { part: AnyRecord; index: number }): React.JSX.Element {
  const item = extractThreadItem(part)
  const result = recordValue(item?.result)
  const progressOutput = stringValue(recordValue(part.result)?.output)
  const error = item?.error ?? (result?.isError === true ? result : undefined)
  const statusLabel = mcpStatusLabel(part, item)
  const sourceLabel = mcpItemSourceLabel(item, part)
  const tool = stringValue(item?.tool) ?? mcpToolFromToolName(stringValue(part.toolName))

  return (
    <section
      data-slot="mcp-call-detail"
      className="min-w-0 rounded-md border border-border/50 bg-background/60 px-3 py-2"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {[sourceLabel, tool].filter(Boolean).join(' / ') || `MCP 工具 ${index + 1}`}
          </p>
          <p className="text-xs text-muted-foreground">{statusLabel}</p>
        </div>
        {error ? (
          <span className="shrink-0 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
            错误
          </span>
        ) : null}
      </div>

      <McpArguments item={item} />
      {progressOutput ? (
        <p className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
          {progressOutput}
        </p>
      ) : null}
      <McpResultContent result={result} error={error} />
      <RawOutputToggle value={item?.result ?? item?.error ?? recordValue(part.result) ?? part} />
    </section>
  )
}

function McpArguments({ item }: { item?: AnyRecord }): React.JSX.Element | null {
  if (item?.arguments === undefined) return null
  return (
    <div className="mt-2">
      <p className="text-[11px] font-medium text-muted-foreground">参数</p>
      <JsonPreview value={item.arguments} className="mt-1 max-h-24" />
    </div>
  )
}

function McpResultContent({
  result,
  error
}: {
  result?: AnyRecord
  error: unknown
}): React.JSX.Element {
  if (error) {
    return (
      <div className="mt-2 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-sm text-destructive">
        {errorText(error)}
      </div>
    )
  }

  const content = arrayValue(result?.content)
  const structuredContent = result?.structuredContent ?? result?.structured_content

  if (content.length > 0) {
    return (
      <div className="mt-2 space-y-2">
        {content.map((block, index) => (
          <McpContentBlock key={index} block={block} />
        ))}
      </div>
    )
  }

  if (structuredContent !== undefined) {
    return (
      <div className="mt-2">
        <p className="text-[11px] font-medium text-muted-foreground">结构化结果</p>
        <JsonPreview value={structuredContent} className="mt-1" />
      </div>
    )
  }

  if (result) {
    const resultKeys = Object.keys(result).filter((key) => key !== 'isError')
    if (resultKeys.length > 0) return <JsonPreview value={result} className="mt-2" />
  }

  return (
    <p className="mt-2 rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
      暂无内容
    </p>
  )
}

function McpContentBlock({ block }: { block: unknown }): React.JSX.Element {
  const record = recordValue(block)
  const type = stringValue(record?.type)

  if (type === 'text') {
    return (
      <p className="whitespace-pre-wrap rounded-md bg-muted/30 px-2.5 py-2 text-sm">
        {stringValue(record?.text) ?? ''}
      </p>
    )
  }

  if (type === 'image') {
    const src = mediaSrc(record)
    return src ? (
      <img
        alt={stringValue(record?.altText) ?? stringValue(record?.name) ?? 'MCP image'}
        className="max-h-72 max-w-full rounded-md border object-contain"
        src={src}
      />
    ) : (
      <JsonFallback label="图片内容缺少 preview" value={record} />
    )
  }

  if (type === 'audio') {
    const src = mediaSrc(record)
    return src ? (
      <audio className="w-full" controls src={src} />
    ) : (
      <JsonFallback label="音频内容" value={record} />
    )
  }

  if (type === 'resource_link') {
    const title = stringValue(record?.title) ?? stringValue(record?.name) ?? '资源链接'
    const uri = stringValue(record?.uri) ?? stringValue(record?.url)
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/50 px-2.5 py-2 text-sm">
        <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate font-medium">{title}</p>
          {uri ? <p className="truncate text-xs text-muted-foreground">{uri}</p> : null}
        </div>
      </div>
    )
  }

  if (type === 'resource' || type === 'embedded_resource') {
    const resource = recordValue(record?.resource) ?? record
    const title =
      stringValue(resource?.title) ??
      stringValue(resource?.name) ??
      stringValue(resource?.uri) ??
      '嵌入资源'
    const text = stringValue(resource?.text) ?? stringValue(resource?.blob)
    return (
      <div className="rounded-md border border-border/50 px-2.5 py-2 text-sm">
        <p className="font-medium">{title}</p>
        {text ? (
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{text}</p>
        ) : (
          <JsonPreview value={resource} className="mt-2" />
        )}
      </div>
    )
  }

  return <JsonFallback label={type ? `未知内容：${type}` : '未知内容'} value={record ?? block} />
}

function McpSourceBadge({ source }: { source?: McpSourceMetadata }): React.JSX.Element | null {
  if (!source) return null
  const sourceLabelMap: Record<McpSourceMetadata['sourceType'], string> = {
    app: 'App',
    server: 'Server',
    browser: 'Browser',
    'computer-use': 'Computer Use',
    'node-repl': 'Node'
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="rounded-sm border border-border/60 px-1.5 py-0.5">
        {sourceLabelMap[source.sourceType]}
      </span>
      <span className="min-w-0 truncate">{source.label}</span>
      {source.pluginId ? <span className="truncate">plugin:{source.pluginId}</span> : null}
    </div>
  )
}

function TodoListEntryUnit({ unit }: { unit: EntryUnit }): React.JSX.Element {
  const item = unit.item ?? {}
  const todos = todoItems(item)
  const completed = todos.filter((todo) => isCompleteTodoStatus(todo.status)).length
  const current = todos.find((todo) => !isCompleteTodoStatus(todo.status))

  return (
    <RenderUnitCard unit={unit} slot="todo-list-entry-unit">
      <div className="flex items-start gap-2">
        <ListChecksIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            待办进度 {completed}/{todos.length || 0}
          </p>
          {current ? (
            <p className="truncate text-xs text-muted-foreground">当前：{current.label}</p>
          ) : null}
          {todos.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {todos.slice(0, 5).map((todo, index) => (
                <li key={`${todo.label}:${index}`} className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      isCompleteTodoStatus(todo.status) ? 'bg-emerald-500' : 'bg-muted-foreground'
                    )}
                  />
                  <span className="min-w-0 truncate">{todo.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">待办详情暂不可用</p>
          )}
        </div>
      </div>
    </RenderUnitCard>
  )
}

function TurnDiffEntryUnit({ unit }: { unit: EntryUnit }): React.JSX.Element {
  const item = unit.item ?? {}
  const files = diffFiles(item)
  const { added, removed } = diffLineTotals(files)
  const diffTextLength = files.reduce((total, file) => total + (file.diff?.length ?? 0), 0)
  const largeDiff = isDiffTruncated(item) || diffTextLength > LARGE_DIFF_TEXT_LENGTH
  const cwd = turnDiffCwd(item)
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? files : files.slice(0, MAX_VISIBLE_DIFF_FILES)

  return (
    <Card
      data-slot="turn-diff-entry-unit"
      className="mt-6 gap-0 rounded-2xl py-0 shadow-none"
      {...renderUnitAttributes(unit)}
    >
      <CardHeader className="grid-cols-[auto_1fr_auto] items-center gap-3 border-b px-3 py-3 sm:px-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background">
          <FilePenIcon aria-hidden className="size-5 text-muted-foreground" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="text-base tracking-tight sm:text-lg">
            已编辑 {files.length} 个文件
          </CardTitle>
          {added > 0 || removed > 0 ? (
            <CardDescription
              data-slot="turn-diff-line-summary"
              className="mt-0.5 flex items-center gap-2 text-sm tabular-nums"
            >
              {added > 0 ? (
                <span className="text-emerald-500 dark:text-emerald-400">+{added}</span>
              ) : null}
              {removed > 0 ? (
                <span className="text-red-500 dark:text-red-400">-{removed}</span>
              ) : null}
            </CardDescription>
          ) : null}
        </div>
        <CardAction
          aria-hidden
          data-slot="turn-diff-static-actions"
          className="col-start-auto row-span-1 row-start-auto hidden shrink-0 items-center gap-5 self-auto justify-self-auto text-sm sm:flex"
        >
          <span className="inline-flex items-center gap-1.5">
            撤销 <Undo2Icon className="size-4" strokeWidth={1.8} />
          </span>
          <span className="rounded-xl border border-border px-3 py-1.5">审核</span>
        </CardAction>
      </CardHeader>
      {largeDiff ? (
        <CardContent className="border-b bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground sm:px-6">
          大 diff 已折叠，只显示文件摘要
        </CardContent>
      ) : null}
      {files.length > 0 ? (
        <CardContent className="px-0">
          <Table>
            <TableBody>
              {visible.map((file, index) => (
                <TurnDiffFileRow key={`${file.path}:${index}`} file={file} cwd={cwd} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      ) : (
        <CardContent className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
          暂未取得文件明细
        </CardContent>
      )}
      {expanded || files.length > visible.length ? (
        <CardFooter className="p-0">
          <TurnDiffShowMoreButton
            expanded={expanded}
            hiddenCount={files.length - visible.length}
            onClick={() => setExpanded((value) => !value)}
          />
        </CardFooter>
      ) : null}
    </Card>
  )
}

function TurnDiffFileRow({
  file,
  cwd
}: {
  file: DiffFile
  cwd: string | undefined
}): React.JSX.Element {
  const openPath = resolveTurnDiffFilePath(file.path, cwd)
  const displayPath = displayTurnDiffFilePath(file.path, cwd)
  const handleOpen = (): void => {
    if (!openPath) return
    void window.desktopApp.codex.openLocalPath({ path: openPath }).catch(() => undefined)
  }

  return (
    <TableRow>
      <TableCell className="p-0">
        <HoverCard openDelay={150} closeDelay={100}>
          <HoverCardTrigger asChild>
            <span className="block min-w-0">
              <Button
                aria-label={openPath ? `打开 ${file.path}` : `无法打开 ${file.path}`}
                disabled={!openPath}
                type="button"
                title={openPath ? `打开 ${openPath}` : '缺少工作目录，无法打开相对路径'}
                variant="ghost"
                className="h-auto w-full min-w-0 justify-start gap-4 rounded-none px-4 py-3 text-left font-normal transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:px-6"
                onClick={handleOpen}
              >
                <span
                  data-slot="turn-diff-file-path"
                  className="min-w-0 flex-1 truncate text-sm text-foreground/80 sm:text-base"
                >
                  {displayPath}
                </span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums">
                  <span className="text-emerald-500 dark:text-emerald-400">+{file.added}</span>
                  <span className="text-red-500 dark:text-red-400">-{file.removed}</span>
                </span>
              </Button>
            </span>
          </HoverCardTrigger>
          <HoverCardContent
            align="start"
            className="w-[48rem] max-w-[calc(100vw-2rem)] max-h-[min(32rem,70vh)] overflow-y-auto p-0"
            side="top"
            sideOffset={8}
          >
            <DiffViewer patch={file.diff} size="sm" variant="muted" />
          </HoverCardContent>
        </HoverCard>
      </TableCell>
    </TableRow>
  )
}

function GeneratedImageEntryUnit({ unit }: { unit: EntryUnit }): React.JSX.Element {
  const item = unit.item ?? {}
  const images = imageEntriesFromItem(item)
  const pending = images.length === 0 || images.every((image) => !image.src)

  return (
    <RenderUnitCard unit={unit} slot="generated-image-entry-unit">
      <div className="flex items-start gap-2">
        <ImageIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {pending ? '正在生成图片' : `已生成 ${images.length} 张图片`}
          </p>
          <ImageGallery images={images.length > 0 ? images : [{ alt: '图片生成中' }]} />
        </div>
      </div>
    </RenderUnitCard>
  )
}

function GeneratedImageFileUnit({
  part,
  unit
}: {
  part: AnyRecord
  unit: Extract<AssistantRenderUnit, { type: 'unknown' }>
}): React.JSX.Element {
  const metadata = recordValue(recordValue(part.providerMetadata)?.[CODEX_PROVIDER_ID])
  const image = {
    src: imageSourceFromPart(part),
    alt: stringValue(metadata?.revisedPrompt) ?? stringValue(part.name) ?? '生成图片',
    savedPath: stringValue(metadata?.savedPath)
  }

  return (
    <RenderUnitCard unit={unit} slot="generated-image-file-unit">
      <div className="flex items-start gap-2">
        <ImageIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">已生成图片</p>
          <ImageGallery images={[image]} />
        </div>
      </div>
    </RenderUnitCard>
  )
}

function EndResourceCardsUnit({ unit }: { unit: EntryUnit }): React.JSX.Element {
  const resources = arrayValue(unit.item?.resources ?? unit.item?.items).map(resourceCardData)
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? resources : resources.slice(0, MAX_VISIBLE_ROWS)

  return (
    <RenderUnitCard unit={unit} slot="end-resource-cards-unit">
      <p className="text-sm font-medium">最终资源</p>
      {resources.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">资源详情暂不可用</p>
      ) : (
        <div className="mt-2 space-y-2">
          {visible.map((resource, index) => (
            <ResourceCard key={`${resource.label}:${index}`} resource={resource} />
          ))}
          <ShowMoreButton
            expanded={expanded}
            hiddenCount={resources.length - visible.length}
            onClick={() => setExpanded((value) => !value)}
          />
        </div>
      )}
    </RenderUnitCard>
  )
}

function ReviewCommentsEntryUnit({ unit }: { unit: EntryUnit }): React.JSX.Element {
  const comments = arrayValue(unit.item?.comments)
    .map(recordValue)
    .filter(isDefined)
    .sort(compareReviewCommentPriority)
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? comments : comments.slice(0, MAX_VISIBLE_ROWS)

  return (
    <RenderUnitCard unit={unit} slot="review-comments-entry-unit">
      <p className="text-sm font-medium">
        审查评论 {comments.length > 0 ? `${comments.length} 条` : ''}
      </p>
      {comments.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">评论详情暂不可用</p>
      ) : (
        <div className="mt-2 space-y-2">
          {visible.map((comment, index) => (
            <ReviewCommentRow
              key={`${stringValue(comment.file) ?? index}:${index}`}
              comment={comment}
            />
          ))}
          <ShowMoreButton
            expanded={expanded}
            hiddenCount={comments.length - visible.length}
            onClick={() => setExpanded((value) => !value)}
          />
        </div>
      )}
    </RenderUnitCard>
  )
}

function AutomaticApprovalReviewEntryUnit({ unit }: { unit: EntryUnit }): React.JSX.Element {
  const item = unit.item ?? {}
  const outcome =
    stringValue(item.outcome) ?? stringValue(item.result) ?? stringValue(item.decision)
  const status = stringValue(item.status)
  const label = automaticApprovalLabel(outcome ?? status)
  const denied = outcome === 'denied' || outcome === 'rejected'
  const Icon = denied ? ShieldXIcon : ShieldCheckIcon

  return (
    <RenderUnitCard unit={unit} slot="automatic-approval-review-entry-unit">
      <div className="flex items-start gap-2">
        <Icon
          className={cn(
            'mt-0.5 size-4 shrink-0',
            denied ? 'text-destructive' : 'text-muted-foreground'
          )}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {stringValue(item.rationale) ? (
            <p className="mt-1 text-xs text-muted-foreground">{stringValue(item.rationale)}</p>
          ) : null}
        </div>
      </div>
    </RenderUnitCard>
  )
}

function ErrorEntryUnit({ unit }: { unit: EntryUnit }): React.JSX.Element {
  const item = unit.item ?? {}
  const message =
    stringValue(item.message) ?? stringValue(item.error) ?? stringValue(item.reason) ?? '发生错误'

  return (
    <RenderUnitCard
      unit={unit}
      slot="error-entry-unit"
      className="border-destructive/25 bg-destructive/5"
    >
      <div className="flex items-start gap-2 text-destructive">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {unit.itemType === 'streamError' ? '流式响应错误' : '系统错误'}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs">{message}</p>
        </div>
      </div>
    </RenderUnitCard>
  )
}

function CompactEntryUnit({ unit }: { unit: EntryUnit }): React.JSX.Element {
  const item = unit.item ?? {}
  const content = compactEntryContent(unit.itemType, item)
  const Icon = content.icon
  const title = unit.active && unit.summary?.label ? unit.summary.label : content.title

  return (
    <RenderUnitCard unit={unit} slot="compact-entry-unit">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          {content.detail ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {content.detail}
            </p>
          ) : null}
        </div>
      </div>
    </RenderUnitCard>
  )
}

function ContextCompactionEntryUnit({ unit }: { unit: EntryUnit }): React.JSX.Element {
  return (
    <div
      data-slot="context-compaction-entry-unit"
      className="my-2 flex w-full items-center gap-2 py-1.5 text-sm text-muted-foreground"
      {...renderUnitAttributes(unit)}
    >
      <CombineIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="leading-none font-normal">上下文已自动压缩</span>
    </div>
  )
}

function RenderUnitCard({
  unit,
  slot,
  className,
  children
}: {
  unit: AssistantRenderUnit
  slot: string
  className?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      data-slot={slot}
      className={cn(
        'my-1 min-w-0 rounded-md border border-border/50 bg-muted/20 px-3 py-2',
        className
      )}
      {...renderUnitAttributes(unit)}
    >
      {children}
    </div>
  )
}

function ImageGallery({ images }: { images: readonly ImageEntry[] }): React.JSX.Element {
  const [preview, setPreview] = useState<ImageEntry | undefined>()
  const visible = images.slice(0, 4)
  const overflow = images.length - visible.length

  return (
    <div data-slot="generated-image-gallery" className="mt-2 space-y-2">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
        {visible.map((image, index) => (
          <Button
            aria-label={image.src ? `预览 ${image.alt ?? '生成图片'}` : (image.alt ?? '图片生成中')}
            key={`${image.src ?? image.alt ?? 'pending'}:${index}`}
            className="group relative aspect-square h-auto min-w-0 w-full justify-start overflow-hidden rounded-md border bg-muted/35 p-0 text-left hover:bg-muted/35"
            variant="ghost"
            type="button"
            onClick={() => image.src && setPreview(image)}
            disabled={!image.src}
          >
            {image.src ? (
              <img
                alt={image.alt ?? '生成图片'}
                className="size-full object-cover"
                src={image.src}
              />
            ) : (
              <div className="flex size-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
                {image.alt ?? '等待图片'}
              </div>
            )}
            {index === visible.length - 1 && overflow > 0 ? (
              <span className="absolute inset-0 flex items-center justify-center bg-background/75 text-sm font-medium">
                +{overflow}
              </span>
            ) : null}
          </Button>
        ))}
      </div>
      {images.some((image) => image.alt || image.savedPath) ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          {images.slice(0, 2).map((image, index) => (
            <p key={`${image.alt ?? image.savedPath ?? index}`} className="truncate">
              {image.alt ?? image.savedPath}
            </p>
          ))}
        </div>
      ) : null}
      {preview ? (
        <div
          data-slot="generated-image-preview"
          className="rounded-md border bg-background p-2 shadow-sm"
        >
          <img
            alt={preview.alt ?? '生成图片预览'}
            className="max-h-96 w-full rounded object-contain"
            src={preview.src}
          />
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            onClick={() => setPreview(undefined)}
          >
            关闭预览
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function ResourceCard({ resource }: { resource: ResourceCardData }): React.JSX.Element {
  const Icon = resource.icon
  const handleOpen = (): void => {
    if (resource.openUrl) {
      void window.desktopApp.codex.openExternalHttpUrl(resource.openUrl).catch(() => undefined)
      return
    }
    if (resource.openPath) {
      void window.desktopApp.codex
        .openLocalPath({ path: resource.openPath, line: resource.line })
        .catch(() => undefined)
    }
  }
  const canOpen = Boolean(resource.openUrl || resource.openPath)

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/50 px-2.5 py-2 text-sm">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{resource.label}</p>
        {resource.detail ? (
          <p className="truncate text-xs text-muted-foreground">{resource.detail}</p>
        ) : null}
      </div>
      <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
        {resource.kind}
      </span>
      {canOpen ? (
        <Button
          aria-label={`打开 ${resource.label}`}
          size="icon-xs"
          variant="ghost"
          type="button"
          onClick={handleOpen}
        >
          <LinkIcon className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

function ReviewCommentRow({ comment }: { comment: AnyRecord }): React.JSX.Element {
  const priority = stringValue(comment.priority) ?? stringValue(comment.severity) ?? 'P2'
  const title = stringValue(comment.title) ?? '审查建议'
  const body = stringValue(comment.body) ?? stringValue(comment.preview) ?? ''
  const file = stringValue(comment.file) ?? stringValue(comment.path)
  const line = numberValue(comment.line) ?? numberValue(comment.startLine)
  const location = [file, line ? `:${line}` : ''].filter(Boolean).join('')
  const openPath = localFilePath(file)
  const handleOpen = (): void => {
    if (!openPath) return
    void window.desktopApp.codex.openLocalPath({ path: openPath, line }).catch(() => undefined)
  }

  return (
    <div className="min-w-0 rounded-md border border-border/50 px-2.5 py-2 text-sm" title={body}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium">
          {priority}
        </span>
        <p className="min-w-0 flex-1 truncate font-medium">{title}</p>
        {openPath ? (
          <Button
            aria-label={`打开 ${location}`}
            size="icon-xs"
            variant="ghost"
            type="button"
            onClick={handleOpen}
          >
            <FileIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {location ? <p className="mt-1 truncate text-xs text-muted-foreground">{location}</p> : null}
      {body ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{body}</p> : null}
    </div>
  )
}

function ShowMoreButton({
  expanded,
  hiddenCount,
  onClick
}: {
  expanded: boolean
  hiddenCount: number
  onClick: () => void
}): React.JSX.Element | null {
  if (expanded || hiddenCount > 0) {
    return (
      <Button size="sm" variant="ghost" type="button" onClick={onClick}>
        {expanded ? '收起' : `显示更多 ${hiddenCount} 条`}
      </Button>
    )
  }
  return null
}

function TurnDiffShowMoreButton({
  expanded,
  hiddenCount,
  onClick
}: {
  expanded: boolean
  hiddenCount: number
  onClick: () => void
}): React.JSX.Element | null {
  if (expanded || hiddenCount > 0) {
    return (
      <Button
        aria-expanded={expanded}
        className="h-auto w-full justify-start gap-2 rounded-none px-4 py-3 text-left text-sm font-normal transition-colors hover:bg-muted/50 sm:px-6"
        variant="ghost"
        type="button"
        onClick={onClick}
      >
        {expanded ? '收起文件' : `再显示 ${hiddenCount} 个文件`}
        <ChevronDownIcon
          aria-hidden
          className={cn('size-4 transition-transform', expanded && 'rotate-180')}
          strokeWidth={2}
        />
      </Button>
    )
  }
  return null
}

function RawOutputToggle({ value }: { value: unknown }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? '隐藏原始输出' : '查看原始输出'}
      </Button>
      {open ? <JsonPreview value={value} className="mt-2 max-h-64" /> : null}
    </div>
  )
}

function JsonPreview({
  value,
  className
}: {
  value: unknown
  className?: string
}): React.JSX.Element {
  return (
    <pre
      className={cn(
        'max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap break-words text-foreground/90',
        className
      )}
    >
      {safeJson(value)}
    </pre>
  )
}

function JsonFallback({ label, value }: { label: string; value: unknown }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border/50 px-2.5 py-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <JsonPreview value={value} className="mt-1" />
    </div>
  )
}

type TodoItem = {
  label: string
  status?: string
}

type DiffFile = {
  path: string
  diff?: string
  added: number
  removed: number
}

type ImageEntry = {
  src?: string
  alt?: string
  savedPath?: string
}

type ResourceCardData = {
  kind: string
  label: string
  detail?: string
  openUrl?: string
  openPath?: string
  line?: number
  icon: LucideIcon
}

function todoItems(item: AnyRecord): TodoItem[] {
  return arrayValue(item.items ?? item.tasks ?? item.todos).map((todo, index) => {
    const record = recordValue(todo)
    return {
      label:
        stringValue(record?.label) ??
        stringValue(record?.text) ??
        stringValue(record?.title) ??
        stringValue(record?.content) ??
        `任务 ${index + 1}`,
      status: stringValue(record?.status)
    }
  })
}

function isCompleteTodoStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'complete' || status === 'done'
}

function diffFiles(item: AnyRecord): DiffFile[] {
  const explicitFiles = arrayValue(item.files ?? item.changes)
  if (explicitFiles.length === 0) {
    const unifiedDiff = stringValue(item.diff) ?? stringValue(item.unifiedDiff)
    return unifiedDiff ? parseUnifiedDiffFiles(unifiedDiff, stringValue(item.path)) : []
  }

  return explicitFiles.map((file, index) => {
    const record = recordValue(file)
    const diff = stringValue(record?.diff) ?? stringValue(record?.patch)
    const lineCounts = countDiffLines(diff)
    return {
      path:
        stringValue(record?.path) ??
        stringValue(record?.file) ??
        stringValue(record?.filename) ??
        `文件 ${index + 1}`,
      diff,
      added: numberValue(record?.added) ?? numberValue(record?.additions) ?? lineCounts.added,
      removed: numberValue(record?.removed) ?? numberValue(record?.deletions) ?? lineCounts.removed
    }
  })
}

function parseUnifiedDiffFiles(diff: string, fallbackPath: string | undefined): DiffFile[] {
  const files: DiffFile[] = []
  let current:
    | {
        path?: string
        lines: string[]
      }
    | undefined

  const flush = (): void => {
    if (!current) return
    const fileDiff = current.lines.join('\n')
    const lineCounts = countDiffLines(fileDiff)
    files.push({
      path: current.path ?? fallbackPath ?? `diff-${files.length + 1}`,
      diff: fileDiff,
      added: lineCounts.added,
      removed: lineCounts.removed
    })
  }

  for (const line of diff.split('\n')) {
    const gitMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (gitMatch) {
      flush()
      current = { path: gitMatch[2], lines: [line] }
      continue
    }

    if (!current) current = { path: fallbackPath, lines: [] }
    const newPathMatch = /^\+\+\+ (?:b\/)?(.+)$/.exec(line)
    if (newPathMatch && newPathMatch[1] !== '/dev/null') current.path = newPathMatch[1]
    current.lines.push(line)
  }

  flush()
  return files
}

function diffLineTotals(files: readonly DiffFile[]): { added: number; removed: number } {
  return {
    added: files.reduce((total, file) => total + file.added, 0),
    removed: files.reduce((total, file) => total + file.removed, 0)
  }
}

function countDiffLines(diff: string | undefined): { added: number; removed: number } {
  if (!diff) return { added: 0, removed: 0 }
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added += 1
    if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

function isDiffTruncated(item: AnyRecord): boolean {
  return item.truncated === true || (numberValue(item.originalLength) ?? 0) > LARGE_DIFF_TEXT_LENGTH
}

function turnDiffCwd(item: AnyRecord): string | undefined {
  const metadata = recordValue(item.metadata)
  const context = recordValue(item.context)
  const thread = recordValue(item.thread)
  return localFilePath(
    stringValue(item.cwd) ??
      stringValue(item.threadCwd) ??
      stringValue(item.workspaceRoot) ??
      stringValue(metadata?.cwd) ??
      stringValue(context?.cwd) ??
      stringValue(thread?.cwd)
  )
}

function resolveTurnDiffFilePath(path: string, cwd: string | undefined): string | undefined {
  const absolutePath = localFilePath(path)
  if (absolutePath) return absolutePath
  if (!cwd) return undefined

  const relativePath = safeRelativeLocalPath(path)
  if (!relativePath) return undefined
  return joinLocalPath(cwd, relativePath)
}

function displayTurnDiffFilePath(path: string, cwd: string | undefined): string {
  const normalizedPath = path.replace(/\\/g, '/').replace(/^[ab]\//, '')
  const normalizedCwd = cwd?.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedCwd) return normalizedPath

  const caseInsensitive = /^[A-Za-z]:\//.test(normalizedPath) || /^[A-Za-z]:\//.test(normalizedCwd)
  const pathForComparison = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath
  const cwdForComparison = caseInsensitive ? normalizedCwd.toLowerCase() : normalizedCwd
  if (pathForComparison === cwdForComparison) return '.'

  const projectPrefix = `${cwdForComparison}/`
  if (pathForComparison.startsWith(projectPrefix)) {
    return normalizedPath.slice(normalizedCwd.length + 1)
  }

  return normalizedPath
}

function safeRelativeLocalPath(path: string): string | undefined {
  if (!path || path.includes('\0') || hasUrlScheme(path)) return undefined
  const withoutDiffPrefix = path.replace(/\\/g, '/').replace(/^[ab]\//, '')
  const segments = withoutDiffPrefix.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0) return undefined
  if (segments.some((segment) => segment === '.' || segment === '..')) return undefined
  return segments.join('/')
}

function joinLocalPath(base: string, relativePath: string): string {
  const trimmedBase = base.replace(/[\\/]+$/, '')
  if (/^[A-Za-z]:[\\/]/.test(trimmedBase)) {
    return `${trimmedBase}\\${relativePath.replace(/\//g, '\\')}`
  }
  return `${trimmedBase}/${relativePath}`
}

function imageEntriesFromItem(item: AnyRecord): ImageEntry[] {
  const explicitImages = arrayValue(item.images)
  if (explicitImages.length > 0) {
    return explicitImages.map((image) => {
      const record = recordValue(image)
      return {
        src: imageSrcFromRecord(record),
        alt:
          stringValue(record?.alt) ?? stringValue(record?.altText) ?? stringValue(record?.prompt),
        savedPath: stringValue(record?.savedPath)
      }
    })
  }

  return [
    {
      src: imageSrcFromRecord(item),
      alt:
        stringValue(item.alt) ??
        stringValue(item.altText) ??
        stringValue(item.revisedPrompt) ??
        stringValue(item.prompt),
      savedPath: stringValue(item.savedPath)
    }
  ]
}

function imageSourceFromPart(part: AnyRecord): string | undefined {
  const url = stringValue(part.url)
  if (url) return safeRenderableImageSrc(url)
  const data = stringValue(part.data)
  const mediaType = stringValue(part.mediaType) ?? 'image/png'
  if (!data) return undefined
  return data.startsWith('data:') ? data : `data:${mediaType};base64,${data}`
}

function imageSrcFromRecord(record: AnyRecord | undefined): string | undefined {
  if (!record) return undefined
  const src =
    stringValue(record.previewSrc) ??
    stringValue(record.src) ??
    stringValue(record.url) ??
    stringValue(record.imageUrl) ??
    stringValue(record.result)
  if (!src) return undefined
  const safeSrc = safeRenderableImageSrc(src)
  if (safeSrc) return safeSrc
  if (hasUrlScheme(src)) return undefined
  return `data:image/png;base64,${src}`
}

function resourceCardData(value: unknown): ResourceCardData {
  const record = recordValue(value)
  const type = stringValue(record?.type) ?? stringValue(record?.kind) ?? 'unknown'
  const url = stringValue(record?.url)
  const path = localFilePath(stringValue(record?.path) ?? stringValue(record?.file))
  const label =
    stringValue(record?.title) ??
    stringValue(record?.name) ??
    stringValue(record?.path) ??
    url ??
    '未命名资源'
  const detail = stringValue(record?.path) ?? url ?? stringValue(record?.id)
  const openUrl = externalHttpUrl(url)

  if (type === 'google-drive') return { kind: 'Drive', label, detail, icon: LinkIcon, openUrl }
  if (type === 'appgen-app') return { kind: 'App', label, detail, icon: WrenchIcon }
  if (type === 'website') return { kind: 'Website', label, detail, icon: LinkIcon, openUrl }
  if (type === 'file') return { kind: 'File', label, detail, icon: FileIcon, openPath: path }
  return { kind: '未知', label, detail, icon: FileIcon }
}

function compactEntryContent(
  itemType: string | undefined,
  item: AnyRecord
): { title: string; detail?: string; icon: LucideIcon } {
  switch (itemType) {
    case 'permissionRequest':
      return {
        title: '权限请求',
        detail:
          stringValue(item.reason) ??
          stringValue(item.message) ??
          permissionSummary(item.permissions),
        icon: ShieldCheckIcon
      }
    case 'mcpServerElicitation':
      return {
        title: stringValue(item.title) ?? 'MCP 需要输入',
        detail: stringValue(item.message) ?? stringValue(item.prompt),
        icon: WrenchIcon
      }
    case 'userInputResponse':
      return {
        title: '已提交输入',
        detail: stringValue(item.summary) ?? stringValue(item.response) ?? stringValue(item.text),
        icon: CheckCircle2Icon
      }
    case 'worktreeInit':
      return {
        title: '工作区已准备',
        detail: stringValue(item.path) ?? stringValue(item.cwd) ?? stringValue(item.branch),
        icon: FileIcon
      }
    case 'automationUpdate':
      return {
        title: stringValue(item.title) ?? '自动化已更新',
        detail: stringValue(item.summary) ?? stringValue(item.name) ?? stringValue(item.action),
        icon: ClockIcon
      }
    case 'modelChanged':
      return {
        title: '模型已切换',
        detail: [stringValue(item.from), stringValue(item.to)].filter(Boolean).join(' → '),
        icon: WrenchIcon
      }
    case 'modelRerouted':
      return {
        title: '模型已重新路由',
        detail: stringValue(item.reason) ?? stringValue(item.to),
        icon: WrenchIcon
      }
    case 'sleep':
      return {
        title: '等待完成',
        detail: durationLabel(numberValue(item.durationMs)),
        icon: ClockIcon
      }
    case 'loadedTool':
      return {
        title: '已加载工具定义',
        detail: stringValue(item.name) ?? stringValue(item.toolName) ?? stringValue(item.title),
        icon: WrenchIcon
      }
    case 'subAgentActivity':
      return {
        title: '子任务活动',
        detail: [stringValue(item.kind), stringValue(item.agentPath)].filter(Boolean).join(' · '),
        icon: WrenchIcon
      }
    default:
      return {
        title: stringValue(item.title) ?? stringValue(item.name) ?? '状态更新',
        detail: stringValue(item.summary) ?? stringValue(item.message) ?? stringValue(item.text),
        icon: ClockIcon
      }
  }
}

function compareReviewCommentPriority(left: AnyRecord, right: AnyRecord): number {
  return priorityRank(left) - priorityRank(right)
}

function priorityRank(comment: AnyRecord): number {
  const priority = stringValue(comment.priority) ?? stringValue(comment.severity) ?? 'P9'
  const match = priority.match(/\d+/)
  return match ? Number(match[0]) : 9
}

function automaticApprovalLabel(value: string | undefined): string {
  if (value === 'approved' || value === 'allowed') return '自动审批已通过'
  if (value === 'denied' || value === 'rejected') return '自动审批已拒绝'
  if (value === 'timedOut' || value === 'timed-out' || value === 'timeout') return '自动审批已超时'
  if (value === 'aborted') return '自动审批已中止'
  return '自动审批审核中'
}

function permissionSummary(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return safeJson(value)
}

function durationLabel(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  if (value < 1000) return `${value}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function mcpStatusLabel(part: AnyRecord, item: AnyRecord | undefined): string {
  if (isToolPartActive(part) || isActiveStatus(item?.status)) return '正在调用'
  if (item?.error) return '调用失败'
  if (stringValue(item?.status) === 'failed') return '调用失败'
  return '调用完成'
}

function mcpItemSourceLabel(item: AnyRecord | undefined, part: AnyRecord): string | undefined {
  const appContext = recordValue(item?.appContext)
  return (
    stringValue(appContext?.displayName) ??
    stringValue(appContext?.appName) ??
    stringValue(appContext?.name) ??
    stringValue(item?.server) ??
    mcpServerFromToolName(stringValue(part.toolName))
  )
}

function mcpServerFromToolName(toolName: string | undefined): string | undefined {
  if (!toolName?.startsWith('mcp:')) return undefined
  const body = toolName.slice('mcp:'.length)
  return body.split('/')[0] || undefined
}

function mcpToolFromToolName(toolName: string | undefined): string | undefined {
  if (!toolName?.startsWith('mcp:')) return undefined
  const slashIndex = toolName.indexOf('/')
  return slashIndex >= 0 ? toolName.slice(slashIndex + 1) || undefined : undefined
}

function webSearchUrl(action: unknown): string | undefined {
  return stringValue(recordValue(action)?.url)
}

function webSearchQueryFromInput(input: unknown): string | undefined {
  const record = recordValue(input)
  if (!record) return undefined

  const directQuery = stringValue(record.query)
  if (directQuery) return directQuery

  const action = recordValue(record.action)
  const actionQuery = stringValue(action?.query)
  if (actionQuery) return actionQuery

  const firstSearchQuery = arrayValue(record.search_query).map(recordValue).find(isDefined)
  const searchQuery = stringValue(firstSearchQuery?.q) ?? stringValue(firstSearchQuery?.query)
  if (searchQuery) return searchQuery

  const commands = recordValue(record.commands)
  const commandSearchQuery = arrayValue(commands?.search_query).map(recordValue).find(isDefined)
  return stringValue(commandSearchQuery?.q) ?? stringValue(commandSearchQuery?.query)
}

function webSearchActionFromInput(input: unknown): unknown {
  const record = recordValue(input)
  if (!record) return undefined
  return record.action ?? record.actionType
}

function mediaSrc(record: AnyRecord | undefined): string | undefined {
  if (!record) return undefined
  const url = stringValue(record.url) ?? stringValue(record.uri)
  if (url) return safeRenderableMediaSrc(url)
  const data = stringValue(record.data)
  if (!data) return undefined
  if (data.startsWith('data:')) return data
  return `data:${stringValue(record.mimeType) ?? stringValue(record.mediaType) ?? 'application/octet-stream'};base64,${data}`
}

function safeRenderableImageSrc(src: string | undefined): string | undefined {
  if (!src) return undefined
  return isSafeDomMediaSrc(src) ? src : undefined
}

function safeRenderableMediaSrc(src: string | undefined): string | undefined {
  if (!src) return undefined
  return isSafeDomMediaSrc(src) ? src : undefined
}

function isSafeDomMediaSrc(src: string): boolean {
  return src.startsWith('data:')
}

function hasUrlScheme(src: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(src)
}

function externalHttpUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

function localFilePath(path: string | undefined): string | undefined {
  if (!path || path.includes('\0')) return undefined
  if (path.startsWith('/')) return path
  if (/^[A-Za-z]:[\\/]/.test(path)) return path
  if (hasUrlScheme(path)) return undefined
  return undefined
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  const record = recordValue(error)
  return (
    stringValue(record?.message) ??
    stringValue(record?.error) ??
    stringValue(record?.reason) ??
    safeJson(error)
  )
}

function safeJson(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isActiveStatus(status: unknown): boolean {
  if (status === 'inProgress' || status === 'running') return true
  const record = recordValue(status)
  return (
    record?.type === 'inProgress' ||
    record?.type === 'running' ||
    record?.type === 'requires-action'
  )
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function recordValue(value: unknown): AnyRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as AnyRecord) : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
