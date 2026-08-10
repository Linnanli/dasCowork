import { Document, Page, pdfjs } from 'react-pdf'
import { useState } from 'react'

import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export function ReviewPdfPreview({ bytes }: { bytes: Uint8Array }): React.JSX.Element {
  const [pages, setPages] = useState<number>()
  const [error, setError] = useState<string>()
  return (
    <div className="overflow-auto rounded-md border bg-muted/10 p-3">
      <Document
        file={{ data: bytes }}
        loading={<p className="text-xs text-muted-foreground">正在加载 PDF…</p>}
        error={<p role="alert" className="text-xs text-destructive">{error ?? '无法预览此 PDF。'}</p>}
        onLoadSuccess={({ numPages }) => setPages(numPages)}
        onLoadError={(cause) => setError(cause instanceof Error ? cause.message : '无法预览此 PDF。')}
      >
        {Array.from({ length: pages ?? 0 }, (_, index) => (
          <Page key={index} pageNumber={index + 1} className="mb-3 last:mb-0" />
        ))}
      </Document>
      {pages ? <p className="mt-2 text-xs text-muted-foreground">{pages} 页</p> : null}
    </div>
  )
}
