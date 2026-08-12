import { SearchIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { ReviewFileGroup } from './reviewWorkspaceTypes'

type Props = {
  groups: readonly ReviewFileGroup[]
  onSelect(path: string): void
}

export function ReviewJumpToFileMenu({ groups, onSelect }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const matches = useMemo(() => fuzzyFileMatches(groups, query).slice(0, 20), [groups, query])

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="跳转到文件" title="跳转到文件">
          <SearchIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-2">
        <Input
          autoFocus
          aria-label="跳转到文件"
          className="h-8 text-xs"
          placeholder="跳转到文件..."
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
        />
        <div role="listbox" className="mt-2 max-h-72 overflow-auto">
          {matches.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">没有匹配的文件</div>
          ) : (
            matches.map((group) => (
              <button
                key={group.path}
                type="button"
                role="option"
                className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none"
                onClick={() => {
                  onSelect(group.path)
                  setOpen(false)
                  setQuery('')
                }}
              >
                <span className="block truncate font-medium">{basename(group.path)}</span>
                <span className="block truncate text-muted-foreground">{group.path}</span>
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function fuzzyFileMatches(
  groups: readonly ReviewFileGroup[],
  query: string
): ReviewFileGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return [...groups]
    .filter((group) => !group.path.startsWith('Unable to load '))
    .map((group) => ({ group, score: scorePath(group.path, normalizedQuery) }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score || left.group.path.localeCompare(right.group.path))
    .map((item) => item.group)
}

function scorePath(path: string, query: string): number {
  if (!query) return 1
  const lowerPath = path.toLocaleLowerCase()
  const fileName = basename(lowerPath)
  if (fileName === query) return 100
  if (fileName.startsWith(query)) return 80
  if (fileName.includes(query)) return 60
  if (lowerPath.includes(query)) return 30
  return fuzzyContains(lowerPath, query) ? 10 : -1
}

function fuzzyContains(value: string, query: string): boolean {
  let offset = 0
  for (const char of query) {
    const next = value.indexOf(char, offset)
    if (next === -1) return false
    offset = next + 1
  }
  return true
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
