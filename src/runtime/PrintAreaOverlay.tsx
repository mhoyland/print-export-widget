import { React } from 'jimu-core'
import type { JimuMapView } from 'jimu-arcgis'
import { computePrintAreaRect } from './printArea'

export interface PrintAreaOverlayProps {
  jimuMapView: JimuMapView | null
  // width/height of the thing being framed (the active layout's mapFrame element) — null when there's
  // no active layout/mapFrame to frame, in which case nothing is drawn.
  aspectRatio: number | null
  visible: boolean
}

// Renders nothing into the React tree — the box itself is a plain DOM element appended directly into
// the bound map widget's own view.container (this widget has no map view of its own; it only ever
// controls one hosted elsewhere in the Experience, via useMapWidgetId). A raw DOM node instead of a
// portal keeps this consistent with how ElementWrapper.tsx already manages interact.js's DOM nodes in
// this codebase, and sidesteps needing a react-dom import purely for one overlay element.
// This is a *preview* only — it never repositions in response to panning/zooming (the crop it
// represents is a fixed region of the screen, not a fixed geographic extent; see exportRenderer.ts,
// which computes the same rect fresh at capture time from the view's current container size).
const PrintAreaOverlay = (props: PrintAreaOverlayProps): null => {
  const { jimuMapView, aspectRatio, visible } = props
  const boxRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const container = jimuMapView?.view?.container
    if (!container) return

    const box = document.createElement('div')
    box.style.position = 'absolute'
    box.style.pointerEvents = 'none'
    box.style.border = '2px dashed var(--sys-color-primary, #007ac2)'
    box.style.boxSizing = 'border-box'
    box.style.display = 'none'
    container.appendChild(box)
    boxRef.current = box

    const reposition = (): void => {
      if (aspectRatio === null) {
        box.style.display = 'none'
        return
      }
      const rect = computePrintAreaRect(container.clientWidth, container.clientHeight, aspectRatio)
      if (!rect) {
        box.style.display = 'none'
        return
      }
      box.style.display = visible ? 'block' : 'none'
      box.style.left = `${rect.x}px`
      box.style.top = `${rect.y}px`
      box.style.width = `${rect.width}px`
      box.style.height = `${rect.height}px`
    }
    reposition()

    const resizeObserver = new ResizeObserver(reposition)
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      // The bound map view is shared (this widget only ever controls one hosted elsewhere in the
      // Experience, via useMapWidgetId) and can be torn down independently of this widget — guard
      // against the container already having removed this node itself by the time cleanup runs.
      if (box.parentNode === container) container.removeChild(box)
      boxRef.current = null
    }
  }, [jimuMapView, aspectRatio, visible])

  return null
}

export default PrintAreaOverlay
