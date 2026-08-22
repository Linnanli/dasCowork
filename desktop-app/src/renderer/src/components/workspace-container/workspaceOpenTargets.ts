import type { LocalGitReviewSource } from '../../../../shared/localGitApi'

import type { WorkspaceJsonValue, WorkspacePanelId, WorkspaceTabRecord } from './workspaceTypes'

export type WorkspaceOpenMode = 'preview' | 'pinned'

export type WorkspaceOpenTarget =
  | { type: 'file'; relativePath: string; title?: string }
  | { type: 'review'; source?: LocalGitReviewSource }
  | { type: 'terminal'; id?: string; title?: string }
  | { type: 'browser'; id?: string; title?: string; url?: string }

export type WorkspaceOpenOptions = {
  panelId?: WorkspacePanelId
  mode?: WorkspaceOpenMode
  /** Replaces the initially empty Files workspace with the selected file. */
  replaceTabId?: string
  insertAfterTabId?: string
  insertAtStart?: boolean
}

export function createWorkspaceDescriptor(
  target: WorkspaceOpenTarget,
  options: Pick<WorkspaceOpenOptions, 'mode'> = {}
): WorkspaceTabRecord {
  switch (target.type) {
    case 'file': {
      const relativePath = normalizeRelativePath(target.relativePath)
      const isExplorer = !relativePath
      return {
        id: isExplorer ? 'files:explorer' : `file:${relativePath}`,
        kind: 'file',
        title: target.title ?? (isExplorer ? 'Files' : basename(relativePath)),
        props: { relativePath },
        isPreview: !isExplorer && options.mode !== 'pinned',
        isClosable: true
      }
    }
    case 'review':
      return {
        id: 'review',
        kind: 'review',
        title: 'Review',
        props: target.source ? { source: target.source as unknown as WorkspaceJsonValue } : {},
        isPreview: false,
        isClosable: true
      }
    case 'terminal':
      return {
        id: target.id ?? `terminal:${randomId()}`,
        kind: 'terminal',
        title: target.title ?? 'Terminal',
        props: {},
        isPreview: false,
        isClosable: true
      }
    case 'browser':
      return {
        id: target.id ?? `browser:${randomId()}`,
        kind: 'browser',
        title: target.title ?? 'New tab',
        props: target.url ? { url: target.url } : {},
        isPreview: false,
        isClosable: true
      }
  }
}

export function normalizeRelativePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+/gu, '/')
}

function basename(path: string): string {
  return path.split('/').at(-1) || path
}

function randomId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}
