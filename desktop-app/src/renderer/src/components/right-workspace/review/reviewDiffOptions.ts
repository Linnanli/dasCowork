import type { FileDiffOptions } from '@pierre/diffs'
import type { ReviewWorkspacePreferences } from './reviewWorkspaceTypes'

export function reviewDiffOptions<LAnnotation = undefined>(
  preferences: Pick<ReviewWorkspacePreferences, 'diffMode' | 'lineDiffType' | 'wrap' | 'fullFiles'>
): FileDiffOptions<LAnnotation> {
  return {
    disableFileHeader: true,
    diffStyle: preferences.diffMode,
    overflow: preferences.wrap ? 'wrap' : 'scroll',
    lineDiffType: preferences.lineDiffType,
    expandUnchanged: preferences.fullFiles,
    hunkSeparators: 'line-info-basic',
    themeType: 'system'
  }
}
