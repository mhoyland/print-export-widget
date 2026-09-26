import type { Layout } from '../config'
import { renderLayoutToCanvas, type RenderOptions } from './exportRenderer'

// The generated preview document runs in its own browser tab, entirely outside the React/ExB tree
// (see openPrintPreview below), so it can't call hooks.useTranslation itself — the caller (widget.tsx)
// translates these labels and passes the finished strings in instead.
export interface PrintPreviewLabels {
  preparingPreviewTitle: string
  preparingPreviewBody: string
  printPreviewFailedTitle: string
  printPreviewFailedBody: string
  print: string
  downloadPng: string
  actualSize: string
  close: string
}

// Modeled directly on how the built-in "Near Me" widget's own "Export to PDF" actually works (see
// print-export-widget-spec.md Phase 11) — there is no PDF-generation library anywhere in Experience
// Builder, so this composites the page via renderLayoutToCanvas(), opens the result in a new,
// isolated browser tab sized to the exact physical page, and lets the browser's own Print dialog
// (Save as PDF, an actual printer, whatever the user has) do the rest.
const CSS_PAGE_SIZE: { [size in Layout['pageSize']]: string } = {
  letter: 'letter',
  // "Tabloid" and "ledger" are the same physical 11×17in page, named for portrait vs landscape use —
  // but only "ledger" is an actual CSS @page size keyword ("tabloid" isn't recognized at all). The
  // explicit `${orientation}` keyword appended below still controls the final portrait/landscape
  // result regardless, so this doesn't depend on ledger's own "landscape by default" convention.
  tabloid: 'ledger',
  a4: 'A4',
  a3: 'A3'
}

// The window is opened synchronously, before any `await`, and filled in afterward via document.write
// rather than the more obvious `Blob` + `URL.createObjectURL` + `window.open(url)` sequence (what
// Near Me's own report.tsx does). Opening *after* an awaited async step is a well-known way to trip
// popup blockers in stricter browsers (notably Safari, which only allows window.open within the
// synchronous portion of a user-gesture handler) — opening a blank window immediately and writing
// into it once rendering finishes sidesteps that risk entirely while landing on the exact same
// end result: one isolated tab with Print/Close controls.
export async function openPrintPreview (options: RenderOptions & { labels: PrintPreviewLabels }): Promise<void> {
  const previewWindow = window.open('', '_blank')
  if (!previewWindow) {
    throw new Error('Could not open the print preview — your browser may have blocked the pop-up.')
  }
  writeDocument(previewWindow, buildLoadingHtml(options.labels))

  try {
    const canvas = await renderLayoutToCanvas(options)
    const dataUrl = canvas.toDataURL('image/png')
    writeDocument(previewWindow, buildPreviewHtml(options.layout, dataUrl, options.labels))
  } catch (error) {
    writeDocument(previewWindow, buildErrorHtml(options.labels))
    throw error
  }
}

function writeDocument (target: Window, html: string): void {
  target.document.open()
  target.document.write(html)
  target.document.close()
}

function buildLoadingHtml (labels: PrintPreviewLabels): string {
  return baseHtml(labels.preparingPreviewTitle, `<p>${escapeHtml(labels.preparingPreviewBody)}</p>`)
}

function buildErrorHtml (labels: PrintPreviewLabels): string {
  return baseHtml(labels.printPreviewFailedTitle, `<p>${escapeHtml(labels.printPreviewFailedBody)}</p>`)
}

function baseHtml (title: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body { font-family: sans-serif; padding: 24px; color: #333; }</style>
</head><body>${bodyHtml}</body></html>`
}

function buildPreviewHtml (layout: Layout, imageDataUrl: string, labels: PrintPreviewLabels): string {
  const pageSize = CSS_PAGE_SIZE[layout.pageSize] ?? CSS_PAGE_SIZE.letter
  const orientation = layout.orientation === 'landscape' ? 'landscape' : 'portrait'
  const title = escapeHtml(layout.name || 'Print Preview')
  const fileName = escapeHtml(`${layout.name || 'export'}.png`)

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: ${pageSize} ${orientation}; margin: 0; }
  html, body { margin: 0; padding: 0; background: #cccccc; height: 100%; }
  body { display: flex; flex-direction: column; min-height: 100vh; box-sizing: border-box; }
  .toolbar {
    position: sticky; top: 0; z-index: 1; flex-shrink: 0;
    display: flex; gap: 10px; align-items: center;
    padding: 10px 16px; background: #2b2b2b;
    font-family: sans-serif; font-size: 14px;
  }
  .toolbar button, .toolbar a {
    padding: 6px 14px; border-radius: 4px; border: none; cursor: pointer;
    font-size: 13px; text-decoration: none; color: #fff; background: #555;
  }
  .toolbar button.primary { background: #1976d2; }
  /* Distinct from .primary (Print's "main action" blue) so a toggled-on state doesn't read as another
     primary action — a darker, recessed look instead, the standard "pressed toggle button" convention. */
  .toolbar button.active { background: #333; box-shadow: inset 0 0 0 2px #888; }
  /* Default: the whole page fits on screen at once, scaled down as needed. */
  .page-wrap {
    flex: 1; min-height: 0; overflow: auto; box-sizing: border-box;
    display: flex; justify-content: center; align-items: center; padding: 24px;
  }
  img {
    max-width: 100%; max-height: 100%; object-fit: contain;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.2); background: #fff; display: block;
  }
  /* Toggled by the "actual size" button below — shows the image at its real pixel size, scrolling
     within .page-wrap (starting top-left, not centered) rather than the whole page scrolling. */
  body.actual-size .page-wrap { justify-content: flex-start; align-items: flex-start; }
  body.actual-size img { max-width: none; max-height: none; }
  @media print {
    .toolbar { display: none; }
    html, body { background: #fff; height: auto; }
    body { display: block; }
    .page-wrap { flex: none; overflow: visible; display: block; padding: 0; }
    img { max-width: none; max-height: none; width: 100%; box-shadow: none; object-fit: fill; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button id="printButton" class="primary" type="button">${escapeHtml(labels.print)}</button>
    <a id="downloadLink" href="${imageDataUrl}" download="${fileName}">${escapeHtml(labels.downloadPng)}</a>
    <button id="actualSizeButton" type="button">${escapeHtml(labels.actualSize)}</button>
    <button id="closeButton" type="button">${escapeHtml(labels.close)}</button>
  </div>
  <div class="page-wrap">
    <img src="${imageDataUrl}" alt="${title}">
  </div>
  <script>
    document.getElementById('printButton').addEventListener('click', function () { window.print() })
    document.getElementById('closeButton').addEventListener('click', function () { window.close() })
    document.getElementById('actualSizeButton').addEventListener('click', function () {
      document.body.classList.toggle('actual-size')
      this.classList.toggle('active')
    })
  </script>
</body>
</html>`
}

function escapeHtml (value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
