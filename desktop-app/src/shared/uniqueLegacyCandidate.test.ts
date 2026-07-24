import { describe, expect, it } from 'vitest'

import { selectUniqueLegacyCandidate } from './uniqueLegacyCandidate'

describe('selectUniqueLegacyCandidate', () => {
  const candidates = [
    { id: 'one', compareKey: 'shared' },
    { id: 'two', compareKey: 'different' },
    { id: 'three', compareKey: 'shared' }
  ]

  it('returns the only matching candidate', () => {
    expect(
      selectUniqueLegacyCandidate(candidates, (candidate) => candidate.compareKey === 'different')
    ).toEqual({
      candidate: candidates[1],
      matchingCandidates: [candidates[1]]
    })
  })

  it('rejects ambiguous and missing matches while preserving correlation candidates', () => {
    expect(
      selectUniqueLegacyCandidate(candidates, (candidate) => candidate.compareKey === 'shared')
    ).toEqual({
      candidate: undefined,
      matchingCandidates: [candidates[0], candidates[2]]
    })
    expect(
      selectUniqueLegacyCandidate(candidates, (candidate) => candidate.compareKey === 'missing')
    ).toEqual({
      candidate: undefined,
      matchingCandidates: []
    })
  })
})
