import type { ComposerSuggestionSection, ComposerSuggestionView } from './composerSuggestionTypes'

export function selectComposerSuggestionSections(
  rootSections: readonly ComposerSuggestionSection[],
  view: ComposerSuggestionView
): readonly ComposerSuggestionSection[] {
  if (view.type !== 'submenu') return rootSections

  const parentItem = rootSections
    .flatMap((section) => section.items)
    .find((item) => item.id === view.parentId)
  return parentItem?.submenus?.find((submenu) => submenu.id === view.id)?.sections ?? []
}
