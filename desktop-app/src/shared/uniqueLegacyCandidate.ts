export type UniqueLegacyCandidateSelection<T> = {
  readonly candidate: T | undefined
  readonly matchingCandidates: readonly T[]
}

export function selectUniqueLegacyCandidate<T>(
  candidates: readonly T[],
  matches: (candidate: T) => boolean
): UniqueLegacyCandidateSelection<T> {
  const matchingCandidates = candidates.filter(matches)
  return {
    candidate: matchingCandidates.length === 1 ? matchingCandidates[0] : undefined,
    matchingCandidates
  }
}
