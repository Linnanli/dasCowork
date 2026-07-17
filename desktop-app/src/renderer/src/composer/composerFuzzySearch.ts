type MatchRange = {
  startOffset: number
  endOffset: number
}

const noMatch = -2_147_483_648
const maxPatternLength = 100
const pathSeparatorPlaceholder = '\0'
const hardSeparators = ['/', '\\'] as const
const startMatchBonus = 10_000

export type ComposerFuzzyScorer = (value: string) => number

// This is the reference app's word/path-boundary matcher, limited to its IGNORE_CASE mode.
export function createComposerFuzzyScorer(query: string): ComposerFuzzyScorer {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return () => 0

  const hasPathSeparator = containsHardSeparator(trimmedQuery)
  const mainPattern = hasPathSeparator ? pathAwarePattern(trimmedQuery) : `*${trimmedQuery}`
  const fallbackPattern = trailingPathSegment(trimmedQuery)
  const matcher = new CompositeMatcher(
    new PatternMatcher(mainPattern, hardSeparators.join('')),
    hasPathSeparator && trimmedQuery !== fallbackPattern
      ? new PatternMatcher(fallbackPattern, hardSeparators.join(''))
      : undefined,
    hasPathSeparator
  )

  return (value) => {
    const degree = matcher.matchingDegree(value)
    if (degree === noMatch) return 0
    return Math.max(1, degree * 10 - value.length)
  }
}

class CompositeMatcher {
  constructor(
    private readonly mainMatcher: PatternMatcher,
    private readonly fallbackMatcher: PatternMatcher | undefined,
    private readonly normalizePathSeparators: boolean
  ) {}

  matchingDegree(value: string): number {
    const matchValue = this.normalizePathSeparators ? pathNormalizedValue(value) : value
    const mainMatch = this.mainMatcher.match(matchValue)
    if (mainMatch) {
      return addStartMatchBonus(
        this.mainMatcher.matchingDegree(matchValue, false, mainMatch),
        mainMatch
      )
    }
    if (!this.fallbackMatcher) return noMatch

    const fallbackMatch = this.fallbackMatcher.match(matchValue)
    return fallbackMatch
      ? addStartMatchBonus(
          this.fallbackMatcher.matchingDegree(matchValue, false, fallbackMatch),
          fallbackMatch
        )
      : noMatch
  }
}

class PatternMatcher {
  private readonly patternCharacters: string[]
  private readonly isLowerCase: boolean[]
  private readonly isUpperCase: boolean[]
  private readonly isWordSeparator: boolean[]
  private readonly upperCaseCharacters: string[]
  private readonly lowerCaseCharacters: string[]
  private readonly hardSeparators: string[]
  private readonly mixedCase: boolean
  private readonly hasSeparators: boolean
  private readonly hasDots: boolean
  private readonly meaningfulCharacters: string[]
  private readonly minNameLength: number

  constructor(pattern: string, hardSeparators: string) {
    const normalizedPattern = pattern.endsWith('* ') ? pattern.slice(0, -2) : pattern
    this.patternCharacters = Array.from(normalizedPattern)
    this.isLowerCase = Array.from({ length: this.patternCharacters.length }, () => false)
    this.isUpperCase = Array.from({ length: this.patternCharacters.length }, () => false)
    this.isWordSeparator = Array.from({ length: this.patternCharacters.length }, () => false)
    this.upperCaseCharacters = Array.from({ length: this.patternCharacters.length }, () => '')
    this.lowerCaseCharacters = Array.from({ length: this.patternCharacters.length }, () => '')
    this.hardSeparators = Array.from(hardSeparators)

    const meaningfulCharacters: string[] = []
    let sawMeaningfulCharacter = false
    let sawLowerCase = false
    let sawUpperCaseAfterMeaningfulCharacter = false
    let hasDots = false
    let hasSeparators = false

    for (let index = 0; index < this.patternCharacters.length; index += 1) {
      const character = this.patternCharacters[index]
      const separator = isWordSeparator(character)
      const upperCase = isUpperCaseLetter(character)
      const lowerCase = isLowerCaseLetter(character)
      const upper = character.toUpperCase()
      const lower = character.toLowerCase()

      if (lowerCase) sawLowerCase = true
      if (character === '.') hasDots = true
      if (sawMeaningfulCharacter && upperCase) sawUpperCaseAfterMeaningfulCharacter = true
      if (!isWildcard(character)) {
        sawMeaningfulCharacter = true
        meaningfulCharacters.push(lower, upper)
      }
      if (sawMeaningfulCharacter && separator) hasSeparators = true

      this.isWordSeparator[index] = separator
      this.isUpperCase[index] = upperCase
      this.isLowerCase[index] = lowerCase
      this.upperCaseCharacters[index] = upper
      this.lowerCaseCharacters[index] = lower
    }

    this.hasDots = hasDots
    this.mixedCase = sawLowerCase && sawUpperCaseAfterMeaningfulCharacter
    this.hasSeparators = hasSeparators
    this.meaningfulCharacters = meaningfulCharacters
    this.minNameLength = meaningfulCharacters.length / 2
  }

  matchingDegree(
    value: string,
    preferStart = false,
    match: MatchRange[] | null = this.match(value)
  ): number {
    if (!match) return noMatch
    if (match.length === 0) return 0

    const firstRange = match[0]
    const startsAtBeginning = firstRange.startOffset === 0
    const preferBeginning = startsAtBeginning && preferStart
    let caseScore = 0
    let previousPatternIndex = -1
    let skippedWordCount = 0
    let nextWordStartIndex = 0
    let matchedUpperCaseWordStart = false

    for (const range of match) {
      for (let valueIndex = range.startOffset; valueIndex < range.endOffset; valueIndex += 1) {
        const startsNewRange = valueIndex === range.startOffset && range !== firstRange
        let atWordStart = false
        while (nextWordStartIndex <= valueIndex) {
          if (nextWordStartIndex === valueIndex) atWordStart = true
          else if (startsNewRange) skippedWordCount += 1
          nextWordStartIndex = nextWordStart(value, nextWordStartIndex)
        }

        const character = value[valueIndex]
        previousPatternIndex = findCharacter(
          this.patternCharacters,
          character,
          previousPatternIndex + 1,
          this.patternCharacters.length,
          true
        )
        if (previousPatternIndex < 0) break

        if (atWordStart) {
          matchedUpperCaseWordStart =
            character === this.patternCharacters[previousPatternIndex] &&
            this.isUpperCase[previousPatternIndex]
        }
        caseScore += this.evaluateCaseMatching(
          preferBeginning,
          previousPatternIndex,
          matchedUpperCaseWordStart,
          valueIndex,
          startsNewRange,
          atWordStart,
          character
        )
      }
    }

    const startOffset = firstRange.startOffset
    const hasHardSeparatorBeforeMatch =
      findAnyCharacter(value, this.hardSeparators, 0, startOffset) >= 0
    const startsAtWordBoundary =
      startOffset === 0 || (isWordStart(value, startOffset) && !isWordStart(value, startOffset - 1))
    const endsAtValueEnd = match[match.length - 1].endOffset === value.length

    return (
      (startsAtWordBoundary ? 1_000 : 0) +
      caseScore -
      match.length -
      skippedWordCount * 10 +
      (hasHardSeparatorBeforeMatch ? 0 : 2) +
      (startsAtBeginning ? 1 : 0) +
      (endsAtValueEnd ? 1 : 0)
    )
  }

  match(value: string): MatchRange[] | null {
    if (value.length < this.minNameLength) return null
    if (this.patternCharacters.length > maxPatternLength) return this.matchBySubstring(value)

    let matchedMeaningfulCharacters = 0
    for (
      let valueIndex = 0;
      valueIndex < value.length && matchedMeaningfulCharacters < this.meaningfulCharacters.length;
      valueIndex += 1
    ) {
      const character = value[valueIndex]
      if (
        character === this.meaningfulCharacters[matchedMeaningfulCharacters] ||
        character === this.meaningfulCharacters[matchedMeaningfulCharacters + 1]
      ) {
        matchedMeaningfulCharacters += 2
      }
    }
    if (matchedMeaningfulCharacters < this.minNameLength * 2) return null

    const match = this.matchWildcards(value, 0, 0)
    return match?.reverse() ?? null
  }

  private evaluateCaseMatching(
    preferStart: boolean,
    patternIndex: number,
    matchedUpperCaseWordStart: boolean,
    valueIndex: number,
    startsNewRange: boolean,
    atWordStart: boolean,
    character: string
  ): number {
    if (startsNewRange && atWordStart && this.isLowerCase[patternIndex]) return -10
    if (character === this.patternCharacters[patternIndex]) {
      if (this.isUpperCase[patternIndex]) return 50
      if (valueIndex === 0 && preferStart) return 150
      return atWordStart ? 1 : 0
    }
    return atWordStart || (this.isLowerCase[patternIndex] && matchedUpperCaseWordStart) ? -1 : 0
  }

  private matchBySubstring(value: string): MatchRange[] | null {
    const startsWithWildcard = this.isPatternCharacter(0, '*')
    const plainPattern = this.patternCharacters.filter((character) => character !== '*').join('')
    if (value.length < plainPattern.length) return null

    if (startsWithWildcard) {
      const index = indexOfIgnoreCase(value, plainPattern, 0, value.length)
      return index >= 0 ? [{ startOffset: index, endOffset: index + plainPattern.length }] : null
    }
    return equalsIgnoreCase(value, 0, plainPattern.length, plainPattern)
      ? [{ startOffset: 0, endOffset: plainPattern.length }]
      : null
  }

  private matchWildcards(
    value: string,
    patternIndex: number,
    valueIndex: number
  ): MatchRange[] | null {
    let nextPatternIndex = patternIndex
    if (valueIndex < 0) return null
    if (!this.isWildcard(nextPatternIndex)) {
      return nextPatternIndex === this.patternCharacters.length
        ? []
        : this.matchFragment(value, nextPatternIndex, valueIndex)
    }

    do nextPatternIndex += 1
    while (this.isWildcard(nextPatternIndex))

    if (nextPatternIndex === this.patternCharacters.length) {
      if (
        this.isTrailingSpacePattern() &&
        valueIndex !== value.length &&
        (nextPatternIndex < 2 || !this.isUpperCaseOrDigit(nextPatternIndex - 2))
      ) {
        const spaceIndex = value.indexOf(' ', valueIndex)
        return spaceIndex >= 0 ? [{ startOffset: spaceIndex, endOffset: spaceIndex + 1 }] : null
      }
      return []
    }

    return this.matchSkippingWords(
      value,
      nextPatternIndex,
      this.findNextPatternCharacter(value, valueIndex, nextPatternIndex),
      true
    )
  }

  private isTrailingSpacePattern(): boolean {
    return this.isPatternCharacter(this.patternCharacters.length - 1, ' ')
  }

  private isUpperCaseOrDigit(patternIndex: number): boolean {
    return this.isUpperCase[patternIndex] || isDigit(this.patternCharacters[patternIndex])
  }

  private matchSkippingWords(
    value: string,
    patternIndex: number,
    valueIndex: number,
    canSkipWords: boolean
  ): MatchRange[] | null {
    let currentValueIndex = valueIndex
    let longestFragment = 0

    while (currentValueIndex >= 0) {
      const matchingFragmentLength = this.seemsLikeFragmentStart(
        value,
        patternIndex,
        currentValueIndex
      )
        ? this.maxMatchingFragment(value, patternIndex, currentValueIndex)
        : 0

      if (
        matchingFragmentLength > longestFragment ||
        (currentValueIndex + matchingFragmentLength === value.length &&
          this.isTrailingSpacePattern())
      ) {
        if (!this.isMiddleMatch(value, patternIndex, currentValueIndex)) {
          longestFragment = matchingFragmentLength
        }
        const match = this.matchInsideFragment(
          value,
          patternIndex,
          currentValueIndex,
          matchingFragmentLength
        )
        if (match) return match
      }

      const nextOccurrence = this.findNextPatternCharacter(
        value,
        currentValueIndex + 1,
        patternIndex
      )
      currentValueIndex = canSkipWords
        ? nextOccurrence
        : this.checkForSpecialCharacters(value, currentValueIndex + 1, nextOccurrence, patternIndex)
    }

    return null
  }

  private findNextPatternCharacter(
    value: string,
    valueIndex: number,
    patternIndex: number
  ): number {
    return !this.isPatternCharacter(patternIndex - 1, '*') && !this.isWordSeparator[patternIndex]
      ? this.indexOfWordStart(value, patternIndex, valueIndex)
      : this.indexOfIgnoreCase(value, valueIndex, patternIndex)
  }

  private checkForSpecialCharacters(
    value: string,
    startIndex: number,
    candidateIndex: number,
    patternIndex: number
  ): number {
    if (candidateIndex < 0) return -1
    if (
      !this.hasSeparators &&
      !this.mixedCase &&
      findAnyCharacter(value, this.hardSeparators, startIndex, candidateIndex) !== -1
    ) {
      return -1
    }
    if (
      this.hasDots &&
      !this.isPatternCharacter(patternIndex - 1, '.') &&
      findExactCharacter(value, '.', startIndex, candidateIndex) !== -1
    ) {
      return -1
    }
    return candidateIndex
  }

  private seemsLikeFragmentStart(value: string, patternIndex: number, valueIndex: number): boolean {
    if (
      !this.isUpperCase[patternIndex] ||
      isUpperCaseLetter(value[valueIndex]) ||
      isWordStart(value, valueIndex)
    ) {
      return true
    }
    return !this.mixedCase
  }

  private charactersEqual(
    patternCharacter: string,
    patternIndex: number,
    valueCharacter: string,
    ignoreCase: boolean
  ): boolean {
    if (patternCharacter === valueCharacter) return true
    return (
      ignoreCase &&
      (this.lowerCaseCharacters[patternIndex] === valueCharacter ||
        this.upperCaseCharacters[patternIndex] === valueCharacter)
    )
  }

  private matchFragment(
    value: string,
    patternIndex: number,
    valueIndex: number
  ): MatchRange[] | null {
    const length = this.maxMatchingFragment(value, patternIndex, valueIndex)
    return length === 0 ? null : this.matchInsideFragment(value, patternIndex, valueIndex, length)
  }

  private maxMatchingFragment(value: string, patternIndex: number, valueIndex: number): number {
    if (!this.isFirstCharacterMatching(value, valueIndex, patternIndex)) return 0

    let length = 1
    while (
      valueIndex + length < value.length &&
      patternIndex + length < this.patternCharacters.length
    ) {
      const valueCharacter = value[valueIndex + length]
      if (
        !this.charactersEqual(
          this.patternCharacters[patternIndex + length],
          patternIndex + length,
          valueCharacter,
          true
        )
      ) {
        if (this.isSkippingDigitBetweenPatternDigits(patternIndex + length, valueCharacter)) {
          return 0
        }
        break
      }
      length += 1
    }
    return length
  }

  private isSkippingDigitBetweenPatternDigits(
    patternIndex: number,
    valueCharacter: string
  ): boolean {
    return (
      isDigit(this.patternCharacters[patternIndex]) &&
      isDigit(this.patternCharacters[patternIndex - 1]) &&
      isDigit(valueCharacter)
    )
  }

  private matchInsideFragment(
    value: string,
    patternIndex: number,
    valueIndex: number,
    matchingLength: number
  ): MatchRange[] | null {
    const minimumFragmentLength = this.isMiddleMatch(value, patternIndex, valueIndex) ? 3 : 1
    return (
      this.improveCamelHumps(
        value,
        patternIndex,
        valueIndex,
        matchingLength,
        minimumFragmentLength
      ) ??
      this.findLongestMatchingPrefix(
        value,
        patternIndex,
        valueIndex,
        matchingLength,
        minimumFragmentLength
      )
    )
  }

  private isMiddleMatch(value: string, patternIndex: number, valueIndex: number): boolean {
    return !this.isPatternCharacter(patternIndex - 1, '*') ||
      this.isWildcard(patternIndex + 1) ||
      !isAlphaNumeric(value[valueIndex])
      ? false
      : !isWordStart(value, valueIndex)
  }

  private findLongestMatchingPrefix(
    value: string,
    patternIndex: number,
    valueIndex: number,
    matchingLength: number,
    minimumFragmentLength: number
  ): MatchRange[] | null {
    if (patternIndex + matchingLength >= this.patternCharacters.length) {
      return [{ startOffset: valueIndex, endOffset: valueIndex + matchingLength }]
    }

    let length = matchingLength
    while (
      length >= minimumFragmentLength ||
      (length > 0 && this.isWildcard(patternIndex + length))
    ) {
      let laterMatch: MatchRange[] | null = null
      if (this.isWildcard(patternIndex + length)) {
        laterMatch = this.matchWildcards(value, patternIndex + length, valueIndex + length)
      } else {
        let nextOccurrence = this.findNextPatternCharacter(
          value,
          valueIndex + length + 1,
          patternIndex + length
        )
        nextOccurrence = this.checkForSpecialCharacters(
          value,
          valueIndex + length,
          nextOccurrence,
          patternIndex + length
        )
        if (nextOccurrence >= 0) {
          laterMatch = this.matchSkippingWords(value, patternIndex + length, nextOccurrence, false)
        }
      }
      if (laterMatch) return mergeMatchRange(laterMatch, valueIndex, length)
      length -= 1
    }

    return null
  }

  private improveCamelHumps(
    value: string,
    patternIndex: number,
    valueIndex: number,
    matchingLength: number,
    minimumFragmentLength: number
  ): MatchRange[] | null {
    for (let length = minimumFragmentLength; length < matchingLength; length += 1) {
      if (
        this.isUppercasePatternAgainstLowercaseValue(
          value,
          patternIndex + length,
          valueIndex + length
        )
      ) {
        const laterMatch = this.findUppercaseMatchFurther(
          value,
          patternIndex + length,
          valueIndex + length
        )
        if (laterMatch) return mergeMatchRange(laterMatch, valueIndex, length)
      }
    }
    return null
  }

  private isUppercasePatternAgainstLowercaseValue(
    value: string,
    patternIndex: number,
    valueIndex: number
  ): boolean {
    return (
      this.isUpperCase[patternIndex] && this.patternCharacters[patternIndex] !== value[valueIndex]
    )
  }

  private findUppercaseMatchFurther(
    value: string,
    patternIndex: number,
    valueIndex: number
  ): MatchRange[] | null {
    return this.matchWildcards(
      value,
      patternIndex,
      this.indexOfWordStart(value, patternIndex, valueIndex)
    )
  }

  private isFirstCharacterMatching(
    value: string,
    valueIndex: number,
    patternIndex: number
  ): boolean {
    if (valueIndex >= value.length) return false
    return this.charactersEqual(
      this.patternCharacters[patternIndex],
      patternIndex,
      value[valueIndex],
      true
    )
  }

  private isWildcard(patternIndex: number): boolean {
    return (
      patternIndex >= 0 &&
      patternIndex < this.patternCharacters.length &&
      isWildcard(this.patternCharacters[patternIndex])
    )
  }

  private isPatternCharacter(patternIndex: number, character: string): boolean {
    return (
      patternIndex >= 0 &&
      patternIndex < this.patternCharacters.length &&
      this.patternCharacters[patternIndex] === character
    )
  }

  private indexOfWordStart(value: string, patternIndex: number, valueIndex: number): number {
    if (
      valueIndex >= value.length ||
      (this.mixedCase &&
        this.isLowerCase[patternIndex] &&
        !(patternIndex > 0 && this.isWordSeparator[patternIndex - 1]))
    ) {
      return -1
    }

    let currentIndex = valueIndex
    const patternCharacterIsNotAlphaNumeric = !isAlphaNumeric(this.patternCharacters[patternIndex])
    while (true) {
      currentIndex = this.indexOfIgnoreCase(value, currentIndex, patternIndex)
      if (currentIndex < 0) return -1
      if (patternCharacterIsNotAlphaNumeric || isWordStart(value, currentIndex)) {
        return currentIndex
      }
      currentIndex += 1
    }
  }

  private indexOfIgnoreCase(value: string, valueIndex: number, patternIndex: number): number {
    const patternCharacter = this.patternCharacters[patternIndex]
    if (isSingleAsciiCharacter(patternCharacter)) {
      const upper = this.upperCaseCharacters[patternIndex]
      const lower = this.lowerCaseCharacters[patternIndex]
      for (let index = valueIndex; index < value.length; index += 1) {
        const valueCharacter = value[index]
        if (valueCharacter === upper || valueCharacter === lower) return index
      }
      return -1
    }
    return findExactCharacter(value, patternCharacter, valueIndex, value.length)
  }
}

function pathAwarePattern(query: string): string {
  let pattern = `*${query}`
  for (const separator of hardSeparators) {
    pattern = pattern.split(separator).join(`*${pathSeparatorPlaceholder}*`)
  }
  return pattern
}

function trailingPathSegment(query: string): string {
  let lastSeparator = -1
  for (const separator of hardSeparators) {
    const index = query.lastIndexOf(separator)
    if (index >= 0 && index < query.length - 1) lastSeparator = Math.max(lastSeparator, index)
  }
  return query.slice(lastSeparator + 1)
}

function pathNormalizedValue(value: string): string {
  let normalized = value
  for (const separator of hardSeparators) {
    normalized = normalized.split(separator).join(pathSeparatorPlaceholder)
  }
  return normalized
}

function containsHardSeparator(query: string): boolean {
  return hardSeparators.some((separator) => query.includes(separator))
}

function addStartMatchBonus(score: number, match: MatchRange[]): number {
  return match.length > 0 && match[0].startOffset === 0 ? score + startMatchBonus : score
}

function nextWordStart(value: string, index: number): number {
  if (index < value.length && isDigit(value[index])) return index + 1
  for (let nextIndex = index + 1; nextIndex <= value.length; nextIndex += 1) {
    if (nextIndex >= value.length) return value.length + 1
    if (isWordStart(value, nextIndex)) return nextIndex
  }
  return value.length + 1
}

function isWordStart(value: string, index: number): boolean {
  if (index < 0 || index >= value.length) return false
  const character = value[index]
  if (!isAlphaNumeric(character)) return false
  if (index === 0) return true

  const previousCharacter = value[index - 1]
  return (
    !isAlphaNumeric(previousCharacter) ||
    (isUpperCaseLetter(character) && isLowerCaseLetter(previousCharacter)) ||
    (isDigit(character) && !isDigit(previousCharacter))
  )
}

function findCharacter(
  value: readonly string[],
  character: string,
  startIndex: number,
  endIndex: number,
  ignoreCase: boolean
): number {
  if (!ignoreCase) {
    for (let index = startIndex; index < endIndex; index += 1) {
      if (value[index] === character) return index
    }
    return -1
  }

  const lower = character.toLowerCase()
  const upper = character.toUpperCase()
  for (let index = startIndex; index < endIndex; index += 1) {
    if (value[index] === lower || value[index] === upper) return index
  }
  return -1
}

function findAnyCharacter(
  value: string,
  characters: readonly string[],
  startIndex: number,
  endIndex: number
): number {
  for (let index = startIndex; index < endIndex; index += 1) {
    if (characters.includes(value[index])) return index
  }
  return -1
}

function findExactCharacter(
  value: string,
  character: string,
  startIndex: number,
  endIndex: number
): number {
  for (let index = startIndex; index < endIndex; index += 1) {
    if (value[index] === character) return index
  }
  return -1
}

function indexOfIgnoreCase(
  value: string,
  query: string,
  startIndex: number,
  endIndex: number
): number {
  const index = value.toLowerCase().indexOf(query.toLowerCase(), startIndex)
  return index < 0 || index + query.length > endIndex ? -1 : index
}

function equalsIgnoreCase(
  value: string,
  startIndex: number,
  length: number,
  query: string
): boolean {
  return (
    startIndex + length <= value.length &&
    value.slice(startIndex, startIndex + length).toLowerCase() === query.toLowerCase()
  )
}

function mergeMatchRange(ranges: MatchRange[], startOffset: number, length: number): MatchRange[] {
  if (ranges.length === 0) {
    return [{ startOffset, endOffset: startOffset + length }]
  }

  const lastRange = ranges[ranges.length - 1]
  if (lastRange.startOffset === startOffset + length) {
    ranges[ranges.length - 1] = { startOffset, endOffset: lastRange.endOffset }
  } else {
    ranges.push({ startOffset, endOffset: startOffset + length })
  }
  return ranges
}

function isWildcard(character: string): boolean {
  return character === ' ' || character === '*'
}

function isWordSeparator(character: string): boolean {
  return (
    character.trim().length === 0 ||
    character === '_' ||
    character === '-' ||
    character === ':' ||
    character === '+' ||
    character === '.' ||
    character === '/' ||
    character === '\\'
  )
}

function isUpperCaseLetter(character: string): boolean {
  return character.toUpperCase() === character && character.toLowerCase() !== character
}

function isLowerCaseLetter(character: string): boolean {
  return character.toLowerCase() === character && character.toUpperCase() !== character
}

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9'
}

function isAlphaNumeric(character: string): boolean {
  return /[a-z0-9]/iu.test(character)
}

function isSingleAsciiCharacter(character: string): boolean {
  return character.length === 1 && character.charCodeAt(0) <= 127
}
