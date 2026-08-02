'use client'

/* eslint-disable react-refresh/only-export-components -- parser helpers are tested with the sync plugin */

import { useEffect, useMemo, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $createTextNode,
  $createParagraphNode,
  $isElementNode,
  type LexicalEditor
} from 'lexical'
import {
  unstable_defaultDirectiveFormatter,
  useAui,
  type Unstable_DirectiveFormatter,
  type Unstable_DirectiveSegment
} from '@assistant-ui/react'
import { $createDirectiveNodeWithFormatter } from '@assistant-ui/react-lexical'

type ParsedSegment = {
  readonly segment: Unstable_DirectiveSegment
  readonly formatter: Unstable_DirectiveFormatter
}

type CompositeParser = (text: string) => readonly ParsedSegment[]

/** Ordered, identity-deduped: the Composer formatter, then the default tail. */
export function collectFormatters(
  propFormatter: Unstable_DirectiveFormatter | undefined
): readonly Unstable_DirectiveFormatter[] {
  const ordered: Unstable_DirectiveFormatter[] = []
  const seen = new Set<Unstable_DirectiveFormatter>()
  const push = (f: Unstable_DirectiveFormatter | undefined): void => {
    if (!f || seen.has(f)) return
    seen.add(f)
    ordered.push(f)
  }
  push(propFormatter)
  push(unstable_defaultDirectiveFormatter)
  return ordered
}

/** First formatter whose parse yields a mention wins; else first formatter's plain-text. */
export function composeParsers(
  formatters: readonly Unstable_DirectiveFormatter[]
): CompositeParser {
  const ordered = formatters.length ? formatters : [unstable_defaultDirectiveFormatter]
  return (text: string): readonly ParsedSegment[] => {
    const fallbackFormatter = ordered[0] ?? unstable_defaultDirectiveFormatter
    const fallbackSegments = fallbackFormatter.parse(text)
    if (fallbackSegments.some((segment) => segment.kind === 'mention')) {
      return fallbackSegments.map((segment) => ({ segment, formatter: fallbackFormatter }))
    }

    for (const formatter of ordered.slice(1)) {
      const segments = formatter.parse(text)
      if (segments.some((s) => s.kind === 'mention')) {
        return segments.map((segment) => ({ segment, formatter }))
      }
    }
    return fallbackSegments.map((segment) => ({ segment, formatter: fallbackFormatter }))
  }
}

function syncRuntimeToLexical(
  editor: LexicalEditor,
  runtimeText: string,
  parse: CompositeParser,
  onComplete: () => void
): void {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()

      if (runtimeText.length === 0) {
        root.append($createParagraphNode())
        root.selectEnd()
        return
      }

      const lines = runtimeText.split('\n')
      for (const line of lines) {
        const paragraph = $createParagraphNode()
        const segments = parse(line)

        for (const { segment, formatter } of segments) {
          if (segment.kind === 'text') {
            if (segment.text.length > 0) {
              paragraph.append($createTextNode(segment.text))
            }
          } else {
            paragraph.append(
              $createDirectiveNodeWithFormatter(
                {
                  id: segment.id,
                  type: segment.type,
                  label: segment.label
                },
                formatter
              )
            )
          }
        }

        root.append(paragraph)
      }

      root.selectEnd()
    },
    { onUpdate: onComplete, tag: SYNC_TAG }
  )
}

const SYNC_TAG = 'aui-sync'

/** Bidirectional sync between Lexical and ComposerRuntime with composite directive parsing. */
export function ComposerLexicalSyncPlugin({
  formatter: propFormatter
}: {
  formatter?: Unstable_DirectiveFormatter | undefined
} = {}): null {
  const [editor] = useLexicalComposerContext()
  const aui = useAui()
  const formatters = useMemo(() => collectFormatters(propFormatter), [propFormatter])

  const parser = useMemo(() => composeParsers(formatters), [formatters])
  const parserRef = useRef<CompositeParser>(parser)

  useEffect(() => {
    parserRef.current = parser
  }, [parser])

  const isSyncingFromLexicalRef = useRef(false)
  const isSyncingFromRuntimeRef = useRef(false)
  const lastSyncedTextRef = useRef('')

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, tags }) => {
      if (isSyncingFromRuntimeRef.current) return
      if (tags.has(SYNC_TAG)) return

      editorState.read(() => {
        isSyncingFromLexicalRef.current = true

        try {
          const rootNode = $getRoot()
          let fullText = ''

          for (const paragraph of rootNode.getChildren()) {
            if (fullText.length > 0) {
              fullText += '\n'
            }
            if (!$isElementNode(paragraph)) continue
            for (const child of paragraph.getChildren()) {
              fullText += child.getTextContent()
            }
          }

          const composer = aui.composer()

          if (fullText !== lastSyncedTextRef.current) {
            lastSyncedTextRef.current = fullText
            composer.setText(fullText)
          }
        } finally {
          isSyncingFromLexicalRef.current = false
        }
      })
    })
  }, [editor, aui])

  useEffect(() => {
    const composerRuntime = aui.composer().__internal_getRuntime?.()
    if (!composerRuntime) return

    const initialText = composerRuntime.getState().text
    if (initialText && initialText !== lastSyncedTextRef.current) {
      isSyncingFromRuntimeRef.current = true
      lastSyncedTextRef.current = initialText
      syncRuntimeToLexical(editor, initialText, parserRef.current, () => {
        isSyncingFromRuntimeRef.current = false
      })
    }

    return composerRuntime.subscribe(() => {
      if (isSyncingFromLexicalRef.current) return

      const runtimeText = composerRuntime.getState().text

      if (runtimeText === lastSyncedTextRef.current) return

      isSyncingFromRuntimeRef.current = true
      lastSyncedTextRef.current = runtimeText
      syncRuntimeToLexical(editor, runtimeText, parserRef.current, () => {
        isSyncingFromRuntimeRef.current = false
      })
    })
  }, [editor, aui])

  return null
}
