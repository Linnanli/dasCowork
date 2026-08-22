import { isAbsolute } from 'node:path'

import type { ThreadProjectAssignment } from '../../shared/projects/projectTypes'
import {
  codexDesktopInstructionCatalog,
  type CodexDesktopInstructionCapability,
  type CodexDesktopInstructionSection,
  type CodexDesktopInstructionSectionId
} from './codexDesktopInstructionCatalog'

const appContextPattern = /<app-context>([\s\S]*?)<\/app-context>/gu

export type CodexDesktopInstructionCapabilities = Partial<
  Record<CodexDesktopInstructionCapability, boolean>
>

export type ComposeCodexDesktopInstructionsInput = {
  system?: string
  projectAssignment?: ThreadProjectAssignment
  capabilities?: CodexDesktopInstructionCapabilities
  availableToolNames?: readonly string[]
}

export type ComposeCodexDesktopInstructionsResult = {
  instructions?: string
  includedSectionIds: CodexDesktopInstructionSectionId[]
}

type ComposedInstructionSection = {
  id: CodexDesktopInstructionSectionId
  marker: string
  content: string
  mergeFragments?: readonly string[]
}

type SectionContent = Pick<ComposedInstructionSection, 'content' | 'mergeFragments'>

/**
 * Builds the desktop-only developer instructions after main has resolved the
 * execution target. The caller never supplies paths or capability claims from
 * renderer IPC.
 */
export function composeCodexDesktopInstructions({
  system,
  projectAssignment,
  capabilities = {},
  availableToolNames = []
}: ComposeCodexDesktopInstructionsInput): ComposeCodexDesktopInstructionsResult {
  const availableTools = new Set(availableToolNames)
  const sections = codexDesktopInstructionCatalog.flatMap((section) => {
    const rendered = sectionContent(section, projectAssignment, capabilities, availableTools)
    return rendered ? [{ id: section.id, marker: section.marker, ...rendered }] : []
  })
  if (system) {
    const existingContexts = [...system.matchAll(appContextPattern)]
    if (existingContexts.length > 0) {
      return mergeExistingAppContexts(system, existingContexts, sections)
    }
  }

  const appContext = joinInstructionParts(sections.map((section) => section.content))
  const baseInstructions = system && system.trim().length > 0 ? system : undefined
  const instructions = [baseInstructions, appContext ? wrapAppContext(appContext) : undefined]
    .filter((value): value is string => Boolean(value))
    .join('\n\n')

  return {
    ...(instructions ? { instructions } : {}),
    includedSectionIds: sections.map((section) => section.id)
  }
}

function sectionContent(
  section: CodexDesktopInstructionSection,
  projectAssignment: ThreadProjectAssignment | undefined,
  capabilities: CodexDesktopInstructionCapabilities,
  availableToolNames: ReadonlySet<string>
): SectionContent | undefined {
  if (section.capability === 'projectlessAssignment') {
    const content = projectlessInstruction(section, projectAssignment)
    return content ? { content } : undefined
  }
  if (section.toolInstructions) {
    const enabledInstructions = section.toolInstructions
      .filter((instruction) => availableToolNames.has(instruction.toolName))
      .map((instruction) => instruction.content)
    if (enabledInstructions.length === 0) return undefined
    return {
      content: [section.contentTemplate, ...enabledInstructions].join('\n'),
      mergeFragments: enabledInstructions
    }
  }
  if (
    !section.defaultEnabled &&
    (!section.capability || capabilities[section.capability] !== true)
  ) {
    return undefined
  }
  return { content: section.contentTemplate }
}

function projectlessInstruction(
  section: CodexDesktopInstructionSection,
  projectAssignment: ThreadProjectAssignment | undefined
): string | undefined {
  if (projectAssignment?.projectKind !== 'projectless') return undefined

  const { cwd, workspaceRoot, outputDirectory } = projectAssignment
  if (
    !isTrustedAbsolutePath(cwd) ||
    !isTrustedAbsolutePath(workspaceRoot) ||
    !isTrustedAbsolutePath(outputDirectory)
  ) {
    return undefined
  }

  return section.contentTemplate
    .replaceAll('{{cwd}}', cwd)
    .replaceAll('{{workspaceRoot}}', workspaceRoot)
    .replaceAll('{{outputDirectory}}', outputDirectory)
}

function isTrustedAbsolutePath(value: string | null): value is string {
  return typeof value === 'string' && isAbsolute(value)
}

function includedSectionIdsFrom(context: string): CodexDesktopInstructionSectionId[] {
  return codexDesktopInstructionCatalog
    .filter((section) => context.includes(section.marker))
    .map((section) => section.id)
}

function mergeExistingAppContexts(
  system: string,
  existingContexts: RegExpMatchArray[],
  sections: readonly ComposedInstructionSection[]
): ComposeCodexDesktopInstructionsResult {
  const existingContent = joinInstructionParts(existingContexts.map((context) => context[1] ?? ''))
  const mergedContent = mergeEnabledSections(existingContent, sections)

  if (existingContexts.length === 1 && mergedContent === existingContent) {
    return {
      instructions: system,
      includedSectionIds: includedSectionIdsFrom(existingContent)
    }
  }

  let replacedFirstContext = false
  const instructions = system.replace(appContextPattern, () => {
    if (replacedFirstContext) return ''
    replacedFirstContext = true
    return wrapAppContext(mergedContent)
  })

  return {
    instructions,
    includedSectionIds: includedSectionIdsFrom(mergedContent)
  }
}

function mergeEnabledSections(
  existingContent: string,
  sections: readonly ComposedInstructionSection[]
): string {
  let mergedContent = existingContent

  for (const section of sections) {
    if (!mergedContent.includes(section.marker)) {
      mergedContent = joinInstructionParts([mergedContent, section.content])
      continue
    }
    if (section.mergeFragments) {
      mergedContent = mergeSectionFragments(mergedContent, section.marker, section.mergeFragments)
    }
  }

  return mergedContent
}

function mergeSectionFragments(
  context: string,
  sectionMarker: string,
  fragments: readonly string[]
): string {
  const missingFragments = fragments.filter((fragment) => !context.includes(fragment))
  if (missingFragments.length === 0) return context

  const markerIndex = context.indexOf(sectionMarker)
  const searchFrom = markerIndex + sectionMarker.length
  const nextHeadingOffset = context.slice(searchFrom).search(/\n#{1,6}\s/u)
  const insertionIndex = nextHeadingOffset < 0 ? context.length : searchFrom + nextHeadingOffset
  const beforeInsertion = context.slice(0, insertionIndex).trimEnd()
  const afterInsertion = context.slice(insertionIndex)

  return `${beforeInsertion}\n${missingFragments.join('\n')}${afterInsertion}`
}

function joinInstructionParts(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n\n')
}

function wrapAppContext(content: string): string {
  return `<app-context>\n${content.trim()}\n</app-context>`
}
