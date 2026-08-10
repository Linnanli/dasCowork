import { lazy, Suspense, useEffect, useState } from 'react'
import { Streamdown } from 'streamdown'

import type { LocalGitReviewFileContent } from '../../../../../shared/localGitApi'
import type { ReviewFileSection, ReviewWorkspaceController } from './reviewWorkspaceTypes'

type Props = {
  controller: ReviewWorkspaceController
  section: Extract<ReviewFileSection, { kind: 'snapshot' }>
}

const ReviewPdfPreview = lazy(async () => ({
  default: (await import('./ReviewPdfPreview')).ReviewPdfPreview
}))

export function ReviewRichPreview({ controller, section }: Props): React.JSX.Element | null {
  const [content, setContent] = useState<LocalGitReviewFileContent>()
  const [blobUrl, setBlobUrl] = useState<{ key: string; url: string }>()
  const supported = supportedPreview(section.file.path)

  useEffect(() => {
    let active = true
    void Promise.resolve().then(async () => {
      if (!controller.preferences.richPreview || !supported || !controller.target) {
        if (active) setContent(undefined)
        return
      }
      setContent(undefined)
      try {
        const result = await window.desktopApp.git.getReviewFileContent({
          target: controller.target,
          source: section.backendSource,
          snapshotGeneration: section.snapshotGeneration,
          file: {
            path: section.file.path,
            ...(section.file.previousPath ? { previousPath: section.file.previousPath } : {}),
            revision: section.file.revision
          },
          side: previewSide(section.file.changeKind)
        })
        if (active) setContent(result)
      } catch (cause) {
        if (active) {
          setContent({
            status: 'unsupported',
            reason: cause instanceof Error ? cause.message : '无法读取此文件的预览内容。'
          })
        }
      }
    })
    return () => {
      active = false
    }
  }, [controller.preferences.richPreview, controller.target, section.backendSource, section.file, section.snapshotGeneration, supported])

  useEffect(() => {
    if (content?.status !== 'media' || content.mimeType === 'application/pdf') return
    const url = URL.createObjectURL(new Blob([toArrayBuffer(base64ToBytes(content.base64))], { type: content.mimeType }))
    const timer = window.setTimeout(() => setBlobUrl({ key: content.base64, url }), 0)
    return () => {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
    }
  }, [content])

  if (!controller.preferences.richPreview || !supported) return null
  if (!content) return <p className="text-xs text-muted-foreground">正在读取富预览…</p>
  switch (content.status) {
    case 'text':
      return (
        <div className="prose prose-sm max-w-none rounded-md border bg-background p-3 dark:prose-invert">
          <Streamdown>{content.text}</Streamdown>
        </div>
      )
    case 'media':
      if (content.mimeType === 'application/pdf') {
        return (
          <Suspense fallback={<p className="text-xs text-muted-foreground">正在加载 PDF 预览…</p>}>
            <ReviewPdfPreview bytes={base64ToBytes(content.base64)} />
          </Suspense>
        )
      }
      return blobUrl?.key === content.base64 ? (
        <img className="max-h-[42rem] max-w-full rounded-md border object-contain" src={blobUrl.url} alt={section.file.path} />
      ) : null
    case 'too-large':
      return <p className="text-xs text-muted-foreground">文件超过 {formatBytes(content.maxBytes)}，无法显示富预览。</p>
    case 'stale':
      return <p className="text-xs text-muted-foreground">审阅快照已更新；请刷新后再试。</p>
    case 'unsupported':
      return <p className="text-xs text-muted-foreground">{content.reason}</p>
  }
}

function supportedPreview(path: string): boolean {
  return /\.(?:md|mdx|png|jpe?g|gif|webp|pdf)$/iu.test(path)
}

function previewSide(changeKind: string): 'before' | 'after' {
  return changeKind === 'deleted' ? 'before' : 'after'
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function formatBytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`
}
