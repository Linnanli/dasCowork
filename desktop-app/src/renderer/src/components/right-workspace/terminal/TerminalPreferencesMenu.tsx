import { LoaderCircleIcon, SettingsIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover'
import type { TerminalWorkspaceShellOption } from '../../../../../shared/terminalWorkspaceApi'
import {
  currentTerminalShellId,
  preferredTerminalShellId,
  saveTerminalShellPreference
} from './terminalPreferences'
import {
  terminalFontPreferences,
  saveTerminalFontPreferences,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN
} from './terminalTheme'

export function TerminalPreferencesMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [shells, setShells] = useState<readonly TerminalWorkspaceShellOption[]>([])
  const [shellId, setShellId] = useState<string>(() => currentTerminalShellId() ?? '')
  const [loadingShells, setLoadingShells] = useState(false)
  const [shellError, setShellError] = useState<string>()
  const [fontFamily, setFontFamily] = useState(() => terminalFontPreferences().fontFamily)
  const [fontSize, setFontSize] = useState(() => String(terminalFontPreferences().fontSize))

  useEffect(() => {
    if (!open) return
    let active = true
    void window.desktopApp.workspace.terminal
      .listShells()
      .then((options) => {
        if (!active) return
        setShells(options)
        setShellId(preferredTerminalShellId(options) ?? '')
      })
      .catch((cause) => {
        if (!active) return
        setShellError(cause instanceof Error ? cause.message : '无法读取 Shell 列表。')
      })
      .finally(() => {
        if (active) setLoadingShells(false)
      })

    return () => {
      active = false
    }
  }, [open])

  const shellOptions = shells.map(shellOptionFromApi)

  const updateOpen = (nextOpen: boolean): void => {
    if (nextOpen) {
      const preferences = terminalFontPreferences()
      setFontFamily(preferences.fontFamily)
      setFontSize(String(preferences.fontSize))
      setLoadingShells(true)
      setShellError(undefined)
    }
    setOpen(nextOpen)
  }

  const saveShell = (nextShellId: string): void => {
    setShellId(nextShellId)
    saveTerminalShellPreference(nextShellId)
  }

  const saveFont = (): void => {
    const parsedFontSize = Number(fontSize)
    saveTerminalFontPreferences({
      fontFamily,
      fontSize: Number.isFinite(parsedFontSize) ? parsedFontSize : TERMINAL_FONT_SIZE_MIN
    })
    const preferences = terminalFontPreferences()
    setFontFamily(preferences.fontFamily)
    setFontSize(String(preferences.fontSize))
  }

  return (
    <Popover open={open} onOpenChange={updateOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="终端偏好" title="终端偏好">
          <SettingsIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4 p-3">
        <PopoverHeader>
          <PopoverTitle>终端偏好</PopoverTitle>
        </PopoverHeader>

        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Shell
          <Combobox
            disabled={loadingShells || shellOptions.length === 0}
            emptyText="没有可用 Shell"
            onValueChange={saveShell}
            options={shellOptions}
            placeholder={loadingShells ? '读取中' : '选择 Shell'}
            searchPlaceholder="搜索 Shell…"
            value={shellId}
          />
        </label>
        {loadingShells ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            读取 Shell
          </div>
        ) : null}
        {shellError ? <p className="text-xs text-destructive">{shellError}</p> : null}

        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          字体
          <Input
            aria-label="终端字体"
            value={fontFamily}
            onChange={(event) => setFontFamily(event.currentTarget.value)}
          />
        </label>

        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          字号
          <Input
            aria-label="终端字号"
            inputMode="numeric"
            max={TERMINAL_FONT_SIZE_MAX}
            min={TERMINAL_FONT_SIZE_MIN}
            type="number"
            value={fontSize}
            onChange={(event) => setFontSize(event.currentTarget.value)}
          />
        </label>

        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={saveFont}>
            保存字体
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function shellOptionFromApi(option: TerminalWorkspaceShellOption): ComboboxOption {
  return {
    label: option.label,
    value: option.id
  }
}
