import { CheckIcon, ChevronDownIcon, GitBranchIcon, GitCommitIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type {
  LocalBranchSummary,
  LocalGitCommitSummary,
  LocalGitTarget
} from '../../../../../shared/localGitApi'
import { displaySourceIdentity, sourceLabel } from './reviewWorkspaceModel'
import type { ReviewDisplaySource } from './reviewWorkspaceTypes'

type Props = {
  target?: LocalGitTarget
  value: ReviewDisplaySource
  lastTurnId?: string
  onChange(source: ReviewDisplaySource): void
}

export function ReviewSourceMenu({ lastTurnId, onChange, target, value }: Props): React.JSX.Element {
  const [commits, setCommits] = useState<readonly LocalGitCommitSummary[]>([])
  const [branches, setBranches] = useState<readonly string[]>([])
  const [loadingSources, setLoadingSources] = useState(false)
  const [sourceError, setSourceError] = useState<string>()
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredCommits = useMemo(
    () =>
      commits
        .filter((commit) => `${commit.sha} ${commit.subject}`.toLocaleLowerCase().includes(normalizedQuery))
        .slice(0, 12),
    [commits, normalizedQuery]
  )
  const filteredBranches = useMemo(
    () => branches.filter((branch) => branch.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 12),
    [branches, normalizedQuery]
  )

  const loadSources = useCallback(() => {
    if (!target) return
    let active = true
    void Promise.resolve().then(async () => {
      if (!active) return
      setLoadingSources(true)
      setSourceError(undefined)
      const [commitResult, branchResult] = await Promise.allSettled([
        window.desktopApp.git.listCommits({ target, limit: 20 }),
        window.desktopApp.git.listBranches({ target })
      ])
      if (!active) return
      if (commitResult.status === 'fulfilled') setCommits(commitResult.value)
      if (branchResult.status === 'fulfilled') setBranches(branchOptions(branchResult.value))
      const failures = [commitResult, branchResult].filter((result) => result.status === 'rejected')
      if (failures.length > 0) {
        setSourceError(
          failures[0]?.status === 'rejected' && failures[0].reason instanceof Error
            ? failures[0].reason.message
            : '无法读取提交或分支来源。'
        )
      }
      setLoadingSources(false)
    })
    return () => {
      active = false
    }
  }, [target])

  useEffect(() => {
    return loadSources()
  }, [loadSources])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="max-w-64 justify-start" aria-label="选择审阅来源">
          <span className="min-w-0 flex-1 truncate">{sourceLabel(value)}</span>
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <div className="p-1.5" onKeyDown={(event) => event.stopPropagation()}>
          <Input
            aria-label="搜索审阅来源"
            className="h-7 text-xs"
            placeholder="搜索提交或分支..."
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <SourceItem
          value={value}
          source={{ type: 'last-turn', turnId: lastTurnId ?? 'unavailable' }}
          disabled={!lastTurnId}
          label="上一轮"
          onChange={() => {
            if (lastTurnId) onChange({ type: 'last-turn', turnId: lastTurnId })
          }}
        />
        <SourceItem value={value} source={{ type: 'uncommitted' }} label="未提交" onChange={() => onChange({ type: 'uncommitted' })} />
        <SourceItem value={value} source={{ type: 'unstaged' }} label="未暂存" onChange={() => onChange({ type: 'unstaged' })} />
        <SourceItem value={value} source={{ type: 'staged' }} label="已暂存" onChange={() => onChange({ type: 'staged' })} />
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-[11px] text-muted-foreground">已提交</div>
        {loadingSources ? <div className="px-2 py-1 text-xs text-muted-foreground">Loading...</div> : null}
        {sourceError ? (
          <DropdownMenuItem onSelect={() => void loadSources()}>
            {sourceError}（重试）
          </DropdownMenuItem>
        ) : null}
        {filteredCommits.map((commit) => (
          <DropdownMenuItem
            key={commit.sha}
            onSelect={() => onChange({ type: 'commit', commitSha: commit.sha })}
            className="items-start"
          >
            <GitCommitIcon className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{commit.subject}</span>
              <span className="block text-[11px] text-muted-foreground">{commit.sha.slice(0, 7)}</span>
            </span>
            {displaySourceIdentity(value) === `commit:${commit.sha}` ? <CheckIcon /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-[11px] text-muted-foreground">分支</div>
        {filteredBranches.map((branch) => (
          <DropdownMenuItem key={branch} onSelect={() => onChange({ type: 'branch', baseBranch: branch })}>
            <GitBranchIcon />
            <span className="min-w-0 flex-1 truncate">{branch}</span>
            {displaySourceIdentity(value) === `branch:${branch}` ? <CheckIcon /> : null}
          </DropdownMenuItem>
        ))}
        {!loadingSources && !sourceError && filteredCommits.length === 0 && filteredBranches.length === 0 && normalizedQuery ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">没有匹配的提交或分支</div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SourceItem({
  disabled,
  label,
  onChange,
  source,
  value
}: {
  disabled?: boolean
  label: string
  source: ReviewDisplaySource
  value: ReviewDisplaySource
  onChange(): void
}): React.JSX.Element {
  const selected =
    source.type === 'last-turn'
      ? value.type === 'last-turn'
      : displaySourceIdentity(value) === displaySourceIdentity(source)
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onChange}>
      <span className="min-w-0 flex-1">{label}</span>
      {selected ? <CheckIcon /> : null}
    </DropdownMenuItem>
  )
}

function branchOptions(summary: LocalBranchSummary): string[] {
  return [
    ...new Set(
      [summary.defaultBase, ...summary.recent, ...summary.local].filter(
        (branch): branch is string => Boolean(branch)
      )
    )
  ]
}
