// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reactPdfMock = vi.hoisted(() => ({
  pdfjs: { GlobalWorkerOptions: {} as { workerSrc?: string } }
}))

vi.mock('react-pdf', () => ({
  Document: ({ children, onLoadSuccess }: { children: React.ReactNode; onLoadSuccess(input: { numPages: number }): void }) => (
    <button type="button" onClick={() => onLoadSuccess({ numPages: 1 })}>{children}</button>
  ),
  Page: ({ pageNumber }: { pageNumber: number }) => <canvas aria-label={`PDF page ${pageNumber}`} />,
  pdfjs: reactPdfMock.pdfjs
}))

import { ReviewPdfPreview } from './ReviewPdfPreview'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('ReviewPdfPreview', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('configures a local worker URL and renders PDF pages after loading', async () => {
    await act(async () => {
      root.render(<ReviewPdfPreview bytes={new Uint8Array([37, 80, 68, 70])} />)
    })

    expect(reactPdfMock.pdfjs.GlobalWorkerOptions.workerSrc).toContain('pdf.worker.min')
    await act(async () => {
      container.querySelector('button')?.click()
    })
    expect(container.querySelector('[aria-label="PDF page 1"]')).not.toBeNull()
    expect(container.textContent).toContain('1 页')
  })
})
