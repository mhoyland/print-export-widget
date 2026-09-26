import type { ScaleBarElement } from '../../config'

const METERS_PER_FOOT = 0.3048
const METERS_PER_MILE = 1609.344
const METERS_PER_KM = 1000

// The base bar/text dimensions below are tuned for this font size; `element.fontSize` (a plain manual
// field, like LegendElement's) scales them proportionally from there — same reasoning as
// renderLegend.ts's own DEFAULT_FONT_SIZE comment for why this isn't auto-derived from box size.
export const DEFAULT_FONT_SIZE = 10

const METERS_PER_UNIT: { [unit in ScaleBarElement['unit']]: number } = {
  km: METERS_PER_KM,
  m: 1,
  mi: METERS_PER_MILE,
  ft: METERS_PER_FOOT
}

// 2D MapView only for Phase 1 — SceneView perspective makes a linear scale bar meaningless at the ground.
export function renderScaleBar (ctx: CanvasRenderingContext2D, element: ScaleBarElement, view?: __esri.MapView | __esri.SceneView): void {
  const isVisible = element.visible ?? true
  if (!isVisible) return
  if (!view || !('resolution' in view)) return

  const metersPerPixel = (view as __esri.MapView).resolution
  if (!metersPerPixel) return

  const fontSize = element.fontSize ?? DEFAULT_FONT_SIZE
  const scale = fontSize / DEFAULT_FONT_SIZE
  const barHeight = 6 * scale
  const textGap = 2 * scale
  // Bar + gap + one line of text, top-to-bottom — centered vertically within element.h rather than
  // anchored to element.y, so resizing the box (or changing font size) doesn't leave it hugging the top.
  const blockHeight = barHeight + textGap + fontSize
  const originY = element.y + (element.h - blockHeight) / 2

  ctx.save()
  ctx.font = `${fontSize}px sans-serif`
  ctx.textBaseline = 'top'
  ctx.strokeStyle = '#000'
  ctx.fillStyle = '#000'
  ctx.lineWidth = 1.5 * scale

  const unitsPerPixel = metersPerPixel / METERS_PER_UNIT[element.unit]
  drawSegment(ctx, { x: element.x, y: originY }, element.w, unitsPerPixel, { unitLabel: element.unit, style: element.style, barHeight, textGap, align: element.align ?? 'left' })

  ctx.restore()
}

interface SegmentStyle {
  unitLabel: string
  style: ScaleBarElement['style']
  barHeight: number
  textGap: number
  align: NonNullable<ScaleBarElement['align']>
}

function drawSegment (
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  maxWidthPx: number,
  unitsPerPixel: number,
  { unitLabel, style, barHeight, textGap, align }: SegmentStyle
): void {
  const { y } = origin
  const maxDistance = maxWidthPx * unitsPerPixel
  const niceDistance = pickNiceNumber(maxDistance)
  if (niceDistance <= 0) return
  const barWidthPx = niceDistance / unitsPerPixel
  // The "nice" distance rounds down to fit maxWidthPx, so the drawn bar is usually narrower than the
  // element's own box — this decides where the leftover space goes.
  const leftover = maxWidthPx - barWidthPx
  const x = origin.x + (align === 'center' ? leftover / 2 : align === 'right' ? leftover : 0)

  if (style === 'alternating') {
    const segments = 4
    const segWidth = barWidthPx / segments
    for (let i = 0; i < segments; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#000' : '#fff'
      ctx.fillRect(x + i * segWidth, y, segWidth, barHeight)
      ctx.strokeRect(x + i * segWidth, y, segWidth, barHeight)
    }
  } else {
    ctx.beginPath()
    ctx.moveTo(x, y + barHeight / 2)
    ctx.lineTo(x + barWidthPx, y + barHeight / 2)
    ctx.moveTo(x, y)
    ctx.lineTo(x, y + barHeight)
    ctx.moveTo(x + barWidthPx, y)
    ctx.lineTo(x + barWidthPx, y + barHeight)
    ctx.stroke()
  }

  ctx.fillStyle = '#000'
  ctx.fillText('0', x, y + barHeight + textGap)
  ctx.textAlign = 'right'
  ctx.fillText(`${niceDistance} ${unitLabel}`, x + barWidthPx, y + barHeight + textGap)
  ctx.textAlign = 'left'
}

// Rounds down to the largest "nice" number (1/2/5 * 10^k) that still fits within maxValue.
function pickNiceNumber (maxValue: number): number {
  if (maxValue <= 0) return 0
  const exponent = Math.floor(Math.log10(maxValue))
  const bases = [1, 2, 5]
  let best = Math.pow(10, exponent)
  for (const base of bases) {
    const candidate = base * Math.pow(10, exponent)
    if (candidate <= maxValue) best = candidate
  }
  return best
}
