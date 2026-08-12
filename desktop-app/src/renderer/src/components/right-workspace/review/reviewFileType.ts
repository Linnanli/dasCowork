import { createFileTreeIconResolver } from '@pierre/trees'

import { REFERENCE_FILE_TYPE_ICONS, type ReviewFileType } from './referenceFileTypeIcons'

const FILE_ICON_RESOLVER = createFileTreeIconResolver()

function isReviewFileType(value: string): value is ReviewFileType {
  return value in REFERENCE_FILE_TYPE_ICONS
}

export function reviewFileType(path: string): ReviewFileType {
  const token = FILE_ICON_RESOLVER.resolveIcon('file-tree-icon-file', path).token
  return token && isReviewFileType(token) ? token : 'default'
}
