import { React, Immutable, hooks, type AllWidgetProps } from 'jimu-core'
import { JimuMapViewComponent, type JimuMapView } from 'jimu-arcgis'
import { Button, Checkbox, Label, TextArea } from 'jimu-ui'
import { ArrowLeftOutlined } from 'jimu-icons/outlined/directional/arrow-left'
import { EditOutlined } from 'jimu-icons/outlined/editor/edit'
import { ExportOutlined } from 'jimu-icons/outlined/editor/export'
import type { IMConfig, Layout, TextElement } from '../config'
import { openPrintPreview } from './printPreview'
import { exportTemplateToFile } from './templateStore.local'
import { loadImportedTemplates, saveImportedTemplates } from './templateStore.localStorage'
import TemplatePicker from './TemplatePicker'
import PrintAreaOverlay from './PrintAreaOverlay'
import defaultMessages from '../translations/default'

// Lazy-loaded: the Layout Editor (interact.js, every icon, the color picker, all the properties
// panels) is a lot of code that most widget instances — anyone with allowViewerLayoutEdit off, likely
// the common case — should never have to download. Splitting it into its own chunk means only
// instances that actually enable the toggle pay for it, rather than bloating every visitor's page
// load with editor code they can't reach.
const LayoutEditor = React.lazy(async () => await import('./layoutEditor/LayoutEditor'))

const Widget = (props: AllWidgetProps<IMConfig>) => {
  const translate = hooks.useTranslation(defaultMessages)
  const [jimuMapView, setJimuMapView] = React.useState<JimuMapView>(null)
  const [textValues, setTextValues] = React.useState<{ [elementId: string]: string }>({})
  const [showPrintArea, setShowPrintArea] = React.useState(false)
  const [printPreviewError, setPrintPreviewError] = React.useState<string>(null)
  const [isRuntimeEditorOpen, setIsRuntimeEditorOpen] = React.useState(false)
  // Which template the viewer picked — session-local like every other runtime-editor concept from
  // Phase 6: there's no runtime equivalent of onSettingChange, so none of this can (or should) write
  // back to props.config. (Imported templates themselves are the one exception to "session-local" —
  // see importedTemplates below.)
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null)
  // Unlike every other piece of runtime state here, imported templates persist across a page refresh
  // via localStorage (see templateStore.localStorage.ts) — end users of this widget typically only have
  // Portal viewer access, so there's no durable Portal-based save/load available to them the way there
  // is for the designer at design time, and losing a locally-imported (possibly hand-edited) template to
  // an accidental refresh would otherwise mean redoing it or re-finding the original file.
  const [importedTemplates, setImportedTemplates] = React.useState<Layout[]>(() => loadImportedTemplates(props.id))
  // A viewer's layout adjustments to one of the *designer's* templates (Phase 6) stay session-local,
  // keyed by template id so switching to "Change template" and back to the same one doesn't lose them —
  // they live only in this state for the life of this widget instance and are never written back to
  // props.config. Edits to an *imported* template go straight into `importedTemplates` instead (see
  // isImportedTemplate/onSave below), so they ride along with the same localStorage persistence.
  const [sessionLayoutsByTemplateId, setSessionLayoutsByTemplateId] = React.useState<{ [templateId: string]: Layout }>({})

  React.useEffect(() => {
    saveImportedTemplates(props.id, importedTemplates)
  }, [props.id, importedTemplates])

  const useMapWidgetId = props.useMapWidgetIds?.[0]

  const configTemplates = React.useMemo<Layout[]>(() => {
    return (props.config.templates ?? Immutable([])).asMutable({ deep: true }) as Layout[]
  }, [props.config.templates])

  const availableTemplates = React.useMemo<Layout[]>(() => {
    return [...configTemplates, ...importedTemplates]
  }, [configTemplates, importedTemplates])

  const activeTemplate = availableTemplates.find((template) => template.id === selectedTemplateId) ?? null

  // The picked template's element ids, as originally picked — stable across repeated open/Apply/
  // reopen cycles of the runtime editor within one visit (memoized on `activeTemplate`, not on every
  // session edit), unlike `sessionLayout` which grows as the viewer adds elements. Phase 9's runtime
  // element adding uses this to tell "the designer's original elements" (nudge/restyle-only) apart
  // from "elements the viewer added this session" (freely deletable/reorderable) — anything with an
  // id outside this set was added afterward, since new elements always get a fresh crypto.randomUUID().
  const originalElementIds = React.useMemo<Set<string>>(() => {
    return new Set((activeTemplate?.elements ?? []).map((element) => element.id))
  }, [activeTemplate])

  const layout = (selectedTemplateId ? sessionLayoutsByTemplateId[selectedTemplateId] : undefined) ?? activeTemplate

  const editableTextElements = React.useMemo<TextElement[]>(() => {
    return (layout?.elements ?? []).filter(
      (element): element is TextElement => element.type === 'text' && Boolean(element.editableAtRuntime)
    )
  }, [layout])

  // Feeds PrintAreaOverlay's live preview box — the actual crop used at export time is recomputed
  // fresh from the view's current size in exportRenderer.ts, not from this value, but the aspect ratio
  // itself (the mapFrame element's own w/h) is the same in both places.
  const mapFrameAspectRatio = React.useMemo<number | null>(() => {
    const mapFrame = layout?.elements.find((element) => element.type === 'mapFrame')
    return mapFrame ? mapFrame.w / mapFrame.h : null
  }, [layout])

  const onTextChange = (elementId: string, value: string): void => {
    setTextValues((prev) => ({ ...prev, [elementId]: value }))
  }

  // Called directly (not awaited-into) from the button's onClick — openPrintPreview itself calls
  // window.open() as its very first, synchronous statement, before any await, so it stays inside the
  // click handler's user-gesture context and isn't at risk of being blocked as a pop-up. Wrapping this
  // in another async step before calling it would reintroduce that risk.
  const onPrintPreviewClick = (): void => {
    if (!jimuMapView?.view || !layout) return
    setPrintPreviewError(null)
    openPrintPreview({
      view: jimuMapView.view,
      jimuMapView,
      layout,
      textOverrides: textValues,
      labels: {
        preparingPreviewTitle: translate('preparingPreviewTitle'),
        preparingPreviewBody: translate('preparingPreviewBody'),
        printPreviewFailedTitle: translate('printPreviewFailedTitle'),
        printPreviewFailedBody: translate('printPreviewFailedBody'),
        print: translate('print'),
        downloadPng: translate('downloadPng'),
        actualSize: translate('actualSize'),
        close: translate('close')
      }
    }).catch(() => { setPrintPreviewError(translate('printPreviewFailed')) })
  }

  const isImportedTemplate = (templateId: string): boolean => {
    return importedTemplates.some((template) => template.id === templateId)
  }

  const onTemplateImported = (imported: Layout): void => {
    setImportedTemplates((prev) => [...prev, imported])
    setSelectedTemplateId(imported.id)
  }

  const onDeleteImportedTemplate = (templateId: string): void => {
    setImportedTemplates((prev) => prev.filter((template) => template.id !== templateId))
  }

  const onChangeTemplateClick = (): void => {
    setSelectedTemplateId(null)
    setTextValues({})
  }

  return (
    <div className="print-export-widget jimu-widget p-3 d-flex flex-column" style={{ height: '100%' }}>
      {useMapWidgetId
        ? <JimuMapViewComponent useMapWidgetId={useMapWidgetId} onActiveViewChange={setJimuMapView} />
        : <div className="text-disabled">{translate('noMapWidget')}</div>}
      <PrintAreaOverlay jimuMapView={jimuMapView} aspectRatio={mapFrameAspectRatio} visible={showPrintArea} />

      {!layout
        ? (
          <TemplatePicker
            templates={availableTemplates}
            isImported={isImportedTemplate}
            onPick={(template) => { setSelectedTemplateId(template.id) }}
            onImported={onTemplateImported}
            onDeleteImported={onDeleteImportedTemplate}
          />
          )
        : (
          <>
            {/* Grows to fill the panel so the print-area checkbox and Print button below always sit
                flush at the bottom, matching the built-in Print widget's own layout. */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {availableTemplates.length > 1 && (
                <Button
                  icon
                  type="tertiary"
                  className="mb-2 d-flex align-items-center"
                  onClick={onChangeTemplateClick}
                >
                  <ArrowLeftOutlined size={14} className="mr-1" />
                  {translate('changeTemplate')}
                </Button>
              )}

              <div className="mb-2" style={{ fontWeight: 600 }}>{layout.name}</div>

              {editableTextElements.map((element) => (
                <div className="mb-2" key={element.id}>
                  <Label for={`print-export-text-${element.id}`}>{element.name}</Label>
                  <TextArea
                    id={`print-export-text-${element.id}`}
                    height={34}
                    value={textValues[element.id] ?? element.text}
                    onChange={(evt) => { onTextChange(element.id, evt.target.value) }}
                  />
                </div>
              ))}

              <div className="d-flex flex-wrap align-items-center" style={{ gap: 8 }}>
                {props.config.allowViewerLayoutEdit && (
                  <Button
                    icon
                    type="tertiary"
                    title={translate('editLayout')}
                    aria-label={translate('editLayout')}
                    onClick={() => { setIsRuntimeEditorOpen(true) }}
                  >
                    <EditOutlined size={16} />
                  </Button>
                )}
                <Button
                  icon
                  type="tertiary"
                  title={translate('exportTemplate')}
                  aria-label={translate('exportTemplate')}
                  onClick={() => { exportTemplateToFile(layout) }}
                >
                  <ExportOutlined size={16} />
                </Button>
              </div>

              {printPreviewError && <div className="mt-2" style={{ color: 'var(--sys-color-error)' }}>{printPreviewError}</div>}
            </div>

            <div className="d-flex align-items-center mt-3" style={{ gap: 6, flexShrink: 0 }}>
              <Checkbox
                checked={showPrintArea}
                disabled={!jimuMapView || mapFrameAspectRatio === null}
                onChange={(_evt, checked) => { setShowPrintArea(checked) }}
              />
              <Label style={{ marginBottom: 0 }}>{translate('showPrintArea')}</Label>
            </div>
            <Button block type="primary" className="mt-2" style={{ flexShrink: 0 }} disabled={!jimuMapView} onClick={onPrintPreviewClick}>
              {translate('print')}
            </Button>

            {props.config.allowViewerLayoutEdit && (
              <React.Suspense fallback={null}>
                <LayoutEditor
                  isOpen={isRuntimeEditorOpen}
                  layout={layout}
                  useMapWidgetId={useMapWidgetId}
                  viewerMode
                  allowAddElements={props.config.allowViewerAddElements ?? false}
                  originalElementIds={originalElementIds}
                  onClose={() => { setIsRuntimeEditorOpen(false) }}
                  onSave={(updated) => {
                    if (isImportedTemplate(selectedTemplateId)) {
                      setImportedTemplates((prev) => prev.map((template) => template.id === selectedTemplateId ? updated : template))
                    } else {
                      setSessionLayoutsByTemplateId((prev) => ({ ...prev, [selectedTemplateId]: updated }))
                    }
                  }}
                />
              </React.Suspense>
            )}
          </>
          )}
    </div>
  )
}

export default Widget
