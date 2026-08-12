import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ReviewFileTypeIcon } from './ReviewFileTypeIcon'
import { reviewFileType } from './reviewFileType'

describe('reviewFileType', () => {
  it.each([
    ['src/ReviewFileBlock.tsx', 'react'],
    ['src/reviewFileType.ts', 'typescript'],
    ['src/index.js', 'javascript'],
    ['src/main.rs', 'rust'],
    ['package.json', 'json'],
    ['docs/architecture.md', 'markdown'],
    ['scripts/bootstrap.zsh', 'bash'],
    ['assets/logo.svg', 'svg'],
    ['Dockerfile', 'docker'],
    ['Makefile', 'default'],
    ['unknown-file', 'default']
  ] as const)('classifies %s as %s', (path, expectedType) => {
    expect(reviewFileType(path)).toBe(expectedType)
  })

  it('renders the resolved file-type icon as a decorative header icon', () => {
    const markup = renderToStaticMarkup(<ReviewFileTypeIcon path="src/reviewFileType.ts" />)

    expect(markup).toContain('data-slot="review-file-type-icon"')
    expect(markup).toContain('data-file-type="typescript"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('viewBox="0 0 16 16"')
    expect(markup).toContain('M8.1 9.64h.95')
    expect(markup).toContain(
      'color:var(--trees-file-icon-color-typescript, var(--trees-file-icon-color, light-dark(#1a85d4, #69b1ff)))'
    )
  })

  it('renders the reference React atom for TSX files', () => {
    const markup = renderToStaticMarkup(<ReviewFileTypeIcon path="src/ReviewFileBlock.tsx" />)

    expect(markup).toContain('data-file-type="react"')
    expect(markup).toContain('M8 2.55c1.3-.99')
  })
})
