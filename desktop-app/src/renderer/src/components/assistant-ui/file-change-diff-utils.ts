export type FileChangeDiffEntry = {
  path: string
  kind?: 'add' | 'delete' | 'update'
  patch?: string
}

export function fileChangeHasRenderableDiff(file: FileChangeDiffEntry): boolean {
  return (
    file.kind === 'add' || file.kind === 'delete' || Boolean(fileChangePatch(file.path, file.patch))
  )
}

export function fileChangePatch(path: string, patch: string | undefined): string | undefined {
  if (!patch?.trim()) return undefined

  const normalizedPath = path.replace(/^[/\\]+/, '') || 'file'
  const hasFileHeaders = /^(?:diff --git |--- )/m.test(patch)
  const diff = hasFileHeaders ? patch : `--- a/${normalizedPath}\n+++ b/${normalizedPath}\n${patch}`
  if (/^@@/m.test(diff)) return diff

  const lines = diff.split('\n')
  const additions = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  const deletions = lines.filter((line) => line.startsWith('-') && !line.startsWith('---'))
  if (additions.length === 0 && deletions.length === 0) return diff

  const oldStart = deletions.length > 0 ? 1 : 0
  const newStart = additions.length > 0 ? 1 : 0
  const newHeaderIndex = lines.findIndex((line) => line.startsWith('+++'))
  if (newHeaderIndex < 0) return diff

  return [
    ...lines.slice(0, newHeaderIndex + 1),
    `@@ -${oldStart},${deletions.length} +${newStart},${additions.length} @@`,
    ...lines.slice(newHeaderIndex + 1)
  ].join('\n')
}
