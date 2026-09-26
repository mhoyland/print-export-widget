import type { DataRecord } from 'jimu-core'
import type { JimuMapView } from 'jimu-arcgis'
import type { Layout, LayoutElement, ImageElement, TextElement, AttributeTableElement, PopupElement } from '../config'
import { renderText } from './elementRenderers/renderText'
import { renderRect } from './elementRenderers/renderRect'
import { renderImage } from './elementRenderers/renderImage'
import { renderNorthArrow } from './elementRenderers/renderNorthArrow'
import { renderScaleBar } from './elementRenderers/renderScaleBar'
import { computeLegendGroups, paintLegend, type LegendGroup } from './elementRenderers/renderLegend'
import { renderAttributeTable } from './elementRenderers/renderAttributeTable'
import { renderPopup, type PopupData } from './elementRenderers/renderPopup'
import { paintContainer, traceRoundedRect } from './elementRenderers/paintContainer'
import { resolvePortalImageUrl } from './portalImage'
import { getPageSizePx } from './pageSize'
import { computePrintAreaRect } from './printArea'

export interface RenderOptions {
  view: __esri.MapView | __esri.SceneView
  jimuMapView: JimuMapView
  layout: Layout
  textOverrides?: { [elementId: string]: string }
}

// The page-pixel space every element's x/y/w/h already lives in (see pageSize.ts) works out to about
// 150dpi — fine for on-screen preview, but text/vector edges read as soft rather than crisp once
// actually printed or viewed as a PDF. Rather than changing that logical space (which would silently
// shrink/misplace every existing saved template's elements), the output canvas is rendered at a
// multiple of it instead — the same technique browsers use for crisp rendering on high-DPI screens:
// the canvas's physical pixel dimensions are scaled up, `ctx.scale()` maps the existing logical
// coordinates onto that larger surface, and every element renderer keeps working completely
// unchanged, since none of them know or care about this multiplier. 2x works out to ~300dpi, the
// standard print-quality benchmark, without the extra render time/file size 3x+ would add for very
// little further visible benefit on this kind of content (mostly text/vector, not photography).
const EXPORT_PIXEL_SCALE = 2

// Does all the actual compositing — screenshot the bound view, preload every element type's async
// data, paint everything in zIndex order — and returns the finished canvas. The sole caller is
// printPreview.ts, which both drives the Print Preview tab and its own PNG download link.
export async function renderLayoutToCanvas (options: RenderOptions): Promise<HTMLCanvasElement> {
  const { view, jimuMapView, layout, textOverrides = {} } = options
  const { w, h } = getPageSizePx(layout)

  const canvas = document.createElement('canvas')
  canvas.width = w * EXPORT_PIXEL_SCALE
  canvas.height = h * EXPORT_PIXEL_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is not available')
  ctx.scale(EXPORT_PIXEL_SCALE, EXPORT_PIXEL_SCALE)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  const mapFrame = layout.elements.find((element) => element.type === 'mapFrame')
  if (mapFrame) {
    // Cropped to the same centered, aspect-correct "print area" box the live view previews (see
    // PrintAreaOverlay.tsx / printArea.ts) — computed fresh here from the view's current container
    // size rather than threaded in from the caller, so this always matches whatever's on screen at
    // capture time. Matches the built-in Print widget's own behavior: the box always determines what's
    // captured, whether or not the "Show print area" checkbox has it visible. Without this crop,
    // takeScreenshot would stretch the view's full (unrelated-aspect-ratio) extent to fit the mapFrame's
    // pixel dimensions, distorting the map.
    const container = view.container
    const area = container ? computePrintAreaRect(container.clientWidth, container.clientHeight, mapFrame.w / mapFrame.h) : null
    const screenshot = await view.takeScreenshot({
      ...(area ? { area } : {}),
      width: Math.round(mapFrame.w * EXPORT_PIXEL_SCALE),
      height: Math.round(mapFrame.h * EXPORT_PIXEL_SCALE)
    })
    const mapImage = await loadImage(screenshot.dataUrl)
    // The screenshot always exactly fills mapFrame's own box (no letterboxing to worry about, unlike
    // renderImage's lockAspect case), so a corner radius clips the image itself rather than just
    // leaving a rounded gap around a still-square photo.
    if (mapFrame.cornerRadius) {
      ctx.save()
      traceRoundedRect(ctx, mapFrame.x, mapFrame.y, mapFrame.w, mapFrame.h, mapFrame.cornerRadius)
      ctx.clip()
      ctx.drawImage(mapImage, mapFrame.x, mapFrame.y, mapFrame.w, mapFrame.h)
      ctx.restore()
    } else {
      ctx.drawImage(mapImage, mapFrame.x, mapFrame.y, mapFrame.w, mapFrame.h)
    }
    // Painted after the image (not via the shared per-element loop below, which no-ops for mapFrame —
    // see paintElement's own comment) so the border isn't drawn first and then covered by the
    // screenshot; background fill is likewise moot in practice since the image already covers the
    // full box, but paintContainer is still called for the stroke this element's Container panel sets.
    paintContainer(ctx, mapFrame)
  }

  const images = await preloadImages(layout.elements)
  const attributeRows = await preloadAttributeTableRows(layout.elements, jimuMapView)
  const popupData = await preloadPopupData(layout.elements, jimuMapView)
  const hasLegend = layout.elements.some((element) => element.type === 'legend')
  const legendGroups = hasLegend ? await computeLegendGroups(view) : []

  const paintOrder = [...layout.elements].sort((a, b) => a.zIndex - b.zIndex)
  for (const element of paintOrder) {
    paintElement(ctx, element, { view, images, textOverrides, attributeRows, popupData, legendGroups })
  }

  return canvas
}

interface PaintContext {
  view: __esri.MapView | __esri.SceneView
  images: { [elementId: string]: HTMLImageElement }
  textOverrides: { [elementId: string]: string }
  attributeRows: { [elementId: string]: string[][] }
  popupData: { [elementId: string]: PopupData | null }
  legendGroups: LegendGroup[]
}

function paintElement (ctx: CanvasRenderingContext2D, element: LayoutElement, context: PaintContext): void {
  switch (element.type) {
    case 'text':
      renderText(ctx, applyTextOverride(element, context.textOverrides))
      break
    case 'image':
      renderImage(ctx, element, context.images[element.id])
      break
    case 'northArrow':
      renderNorthArrow(ctx, element, context.view)
      break
    case 'scaleBar':
      renderScaleBar(ctx, element, context.view)
      break
    case 'legend':
      paintLegend(ctx, element, context.legendGroups)
      break
    case 'attributeTable':
      renderAttributeTable(ctx, element, context.attributeRows[element.id] ?? [])
      break
    case 'popup':
      renderPopup(ctx, element, context.popupData[element.id] ?? null)
      break
    case 'rect':
      renderRect(ctx, element)
      break
    case 'mapFrame':
      // painted before the element loop (screenshot + its own Container border) rather than here
      break
  }
}

function applyTextOverride (element: TextElement, overrides: { [elementId: string]: string }): TextElement {
  const overrideText = overrides[element.id]
  return overrideText === undefined ? element : { ...element, text: overrideText }
}

// DataSource selection (jimu-core's DataSource.getSelectedRecords) is what stays in sync with a
// selection made anywhere else in the experience — e.g. a Select tool or another widget's list —
// so this is the "selected features" this element documents, not any raw ArcGIS Maps SDK highlight
// state. Resolved per element up front, in parallel, so the (synchronous) paint loop below can stay
// synchronous like every other element renderer.
async function preloadAttributeTableRows (elements: LayoutElement[], jimuMapView: JimuMapView): Promise<{ [elementId: string]: string[][] }> {
  const tableElements = elements.filter(
    (element): element is AttributeTableElement => element.type === 'attributeTable' && !!element.layerId && element.fields.length > 0
  )
  const entries = await Promise.all(tableElements.map(async (element) => {
    const rows = await fetchAttributeTableRows(element, jimuMapView)
    return [element.id, rows] as const
  }))
  return Object.fromEntries(entries)
}

async function fetchAttributeTableRows (element: AttributeTableElement, jimuMapView: JimuMapView): Promise<string[][]> {
  if (!jimuMapView) return []
  const jimuLayerView = jimuMapView.getAllJimuLayerViews().find((view) => view.layer?.id === element.layerId)
  if (!jimuLayerView) return []
  const dataSource = await jimuLayerView.getOrCreateLayerDataSource()
  const records = dataSource.getSelectedRecords()
  return records.map((record) => element.fields.map((field) => formatFieldValue(record.getFieldValue(field))))
}

// A PopupElement only ever shows a single feature — the layer's first currently selected one — so
// unlike attribute rows there's nothing to loop over per record; DataSource selection is the same
// cross-widget "selected features" concept as AttributeTableElement's, not raw ArcGIS Maps SDK
// highlight state (see preloadAttributeTableRows above).
async function preloadPopupData (elements: LayoutElement[], jimuMapView: JimuMapView): Promise<{ [elementId: string]: PopupData | null }> {
  const popupElements = elements.filter(
    (element): element is PopupElement => element.type === 'popup' && !!element.layerId && element.fields.length > 0
  )
  const entries = await Promise.all(popupElements.map(async (element) => {
    const data = await fetchPopupData(element, jimuMapView)
    return [element.id, data] as const
  }))
  return Object.fromEntries(entries)
}

async function fetchPopupData (element: PopupElement, jimuMapView: JimuMapView): Promise<PopupData | null> {
  if (!jimuMapView) return null
  const jimuLayerView = jimuMapView.getAllJimuLayerViews().find((view) => view.layer?.id === element.layerId)
  if (!jimuLayerView) return null
  const dataSource = await jimuLayerView.getOrCreateLayerDataSource()
  const records = dataSource.getSelectedRecords()
  if (records.length === 0) return null

  // "If multiple are selected then only use the first feature" — the rest are simply ignored rather
  // than picked some other way (e.g. by extent or attribute), matching the request as stated.
  const record = records[0]
  const values = Object.fromEntries(element.fields.map((field) => [field, formatFieldValue(record.getFieldValue(field))]))

  const schemaFields = dataSource.getSchema()?.fields ?? {}
  const rawNameToJimuName = Object.fromEntries(Object.values(schemaFields).map((field: any) => [field.name, field.jimuName]))
  const titleTemplate: string = element.title || (jimuLayerView.layer as any).popupTemplate?.title || element.name
  const title = substituteFieldPlaceholders(titleTemplate, record, rawNameToJimuName)

  return { title, values }
}

// Popup title templates reference fields as "{fieldName}" using the layer's own (raw) service field
// name, not the jimuFieldName DataRecord otherwise reads by — substituted here directly against the
// selected record's raw-to-jimu field mapping, since this element never instantiates an actual ArcGIS
// Popup widget to do it for us (see PopupElement's scope note in config.ts). A placeholder with no
// matching field (e.g. one referencing an Arcade expression) is left as-is rather than blanked out.
function substituteFieldPlaceholders (template: string, record: DataRecord, rawNameToJimuName: { [rawName: string]: string }): string {
  return template.replace(/\{([^}]+)\}/g, (match: string, rawName: string) => {
    const jimuName = rawNameToJimuName[rawName]
    if (!jimuName) return match
    return formatFieldValue(record.getFieldValue(jimuName))
  })
}

// Attribute field values are always a primitive or a Date, never a plain object — narrowing here
// (rather than a bare String(value)) is what lets each branch stringify safely instead of risking a
// silent "[object Object]" if a field ever unexpectedly comes back as something else.
function formatFieldValue (value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toLocaleString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return JSON.stringify(value)
}

async function preloadImages (elements: LayoutElement[]): Promise<{ [elementId: string]: HTMLImageElement }> {
  const imageElements = elements.filter((element): element is ImageElement =>
    element.type === 'image' && ((element.source === 'upload' && !!element.url) || (element.source === 'portalItem' && !!element.portalItemId))
  )
  const loaded = await Promise.all(imageElements.map(async (imageElement) => {
    const src = await resolveImageElementSrc(imageElement)
    return [imageElement.id, await loadImage(src)] as const
  }))
  return Object.fromEntries(loaded)
}

// Portal-sourced images are resolved via an authenticated request into a blob (then an object URL)
// rather than a raw cross-origin <img src>, so export never depends on the item being publicly
// accessible or subject to a CORS failure — same reasoning as Canvas.tsx's copy of this helper (kept
// separate rather than shared, since the two preload functions' surrounding code doesn't otherwise
// overlap enough to be worth a shared module for one four-line function).
async function resolveImageElementSrc (element: ImageElement): Promise<string> {
  if (element.source === 'portalItem' && element.portalItemId) {
    return await resolvePortalImageUrl(element.portalItemId)
  }
  return element.url
}

function loadImage (src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => { resolve(image) }
    image.onerror = () => { reject(new Error('Failed to load image')) }
    image.src = src
  })
}
