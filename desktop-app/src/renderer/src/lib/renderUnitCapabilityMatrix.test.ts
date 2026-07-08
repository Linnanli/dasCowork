import { describe, expect, it } from 'vitest'

import { RENDER_UNIT_CAPABILITY_MATRIX } from './renderUnitCapabilityMatrix'

type CapabilityStatus = (typeof RENDER_UNIT_CAPABILITY_MATRIX)[string]['fallbackLevel']

function isCompletionBlockingStatus(status: CapabilityStatus): boolean {
  return status === 'temporary' || status === 'legacy-tool'
}

describe('RENDER_UNIT_CAPABILITY_MATRIX', () => {
  it('keeps Phase 2 P0 and P1 entries out of fallback or temporary modes', () => {
    const unresolved = Object.entries(RENDER_UNIT_CAPABILITY_MATRIX).filter(([, capability]) => {
      const highPriority = capability.priority === 'P0' || capability.priority === 'P1'
      const countedAsDone = capability.phase2Done !== false
      return (
        highPriority &&
        countedAsDone &&
        (capability.renderMode === 'fallback' ||
          isCompletionBlockingStatus(capability.fallbackLevel))
      )
    })

    expect(unresolved).toEqual([])
  })

  it('keeps scoped-out Phase 2 gaps explicit with dated follow-ups', () => {
    const scopedOut = Object.entries(RENDER_UNIT_CAPABILITY_MATRIX).filter(
      ([, capability]) => capability.phase2Done === false
    )

    expect(scopedOut).toEqual([])
  })

  it('documents every known-null and fallback entry with a reason and test owner', () => {
    const undocumented = Object.entries(RENDER_UNIT_CAPABILITY_MATRIX).filter(([, capability]) => {
      const needsReason =
        capability.renderMode === 'known-null' || capability.renderMode === 'fallback'
      return needsReason && (!capability.reason || !capability.testOwner)
    })

    expect(undocumented).toEqual([])
  })

  it('routes generated images and turn diffs to custom renderers', () => {
    expect(RENDER_UNIT_CAPABILITY_MATRIX.imageGeneration).toMatchObject({
      renderMode: 'custom',
      renderer: 'GeneratedImageEntryUnit'
    })
    expect(RENDER_UNIT_CAPABILITY_MATRIX.turnDiff).toMatchObject({
      renderMode: 'custom',
      renderer: 'TurnDiffEntryUnit'
    })
    expect(RENDER_UNIT_CAPABILITY_MATRIX.exploration).toMatchObject({
      renderMode: 'custom',
      renderer: 'ExplorationEntryUnit',
      fallbackLevel: 'none'
    })
  })

  it('marks Phase 2 renderers as complete in the matrix', () => {
    const phase2Entries = [
      'todo-list',
      'todoList',
      'turn-diff',
      'turnDiff',
      'generated-image',
      'imageGeneration',
      'exploration',
      'endResources',
      'reviewComments',
      'review-comments'
    ]

    for (const itemType of phase2Entries) {
      expect(RENDER_UNIT_CAPABILITY_MATRIX[itemType]).toMatchObject({
        renderMode: 'custom',
        fallbackLevel: 'none'
      })
    }
  })

  it('documents resource and review comment renderers as client-derived', () => {
    expect(RENDER_UNIT_CAPABILITY_MATRIX.endResources.reason).toMatch(/Client-derived/)
    expect(RENDER_UNIT_CAPABILITY_MATRIX.endResources.reason).toMatch(
      /does not define this ThreadItem/
    )
    expect(RENDER_UNIT_CAPABILITY_MATRIX.reviewComments.reason).toMatch(/Client-derived/)
    expect(RENDER_UNIT_CAPABILITY_MATRIX.reviewComments.reason).toMatch(
      /does not define this ThreadItem/
    )
    expect(RENDER_UNIT_CAPABILITY_MATRIX['review-comments'].reason).toMatch(/Legacy/)
  })

  it('keeps P3 worked-for and realtime transcript as intentional non-text-thread gaps', () => {
    expect(RENDER_UNIT_CAPABILITY_MATRIX['worked-for']).toMatchObject({
      renderMode: 'fallback',
      fallbackLevel: 'intentional',
      priority: 'P3'
    })
    expect(RENDER_UNIT_CAPABILITY_MATRIX['worked-for'].reason).toMatch(/No app-server ThreadItem/)

    expect(RENDER_UNIT_CAPABILITY_MATRIX['realtime-transcript']).toMatchObject({
      renderMode: 'known-null',
      fallbackLevel: 'intentional',
      priority: 'P3'
    })
    expect(RENDER_UNIT_CAPABILITY_MATRIX['realtime-transcript'].reason).toMatch(
      /experimental thread\/realtime/
    )
  })
})
