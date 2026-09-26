# Print / Export Widget — Build Spec

ArcGIS Experience Builder (Developer Edition) custom widget: a client-side
print/export composer with a drag-and-drop layout editor, reusable across
Experiences as saved templates.

Reference screens (design mockups, for visual intent only — not code):
- Widget settings panel + selected state on the map:
  https://claude.ai/artifact/YCsrtjZewkQJDzfb2dcX4P (artboard: Main.dc.html)
- Full-screen layout editor (toolbar, layers, canvas, contextual properties):
  same link, artboard: LayoutEditor.dc.html

Note: the mockups are illustrative only and simplify a few things the model
below resolves differently — they show a single always-present "Map frame"
layer and a single fixed "Neatline" layer. In the actual model, a neatline
is just an ordinary `rect` element sent to back (any number can be added),
and `mapFrame` gains multi-map support in Phase 12. The type definitions and
build phases below are the source of truth.

---

## 1. Element data model

Every placeable thing on the print page — text, rectangle/neatline, north
point, logo, scale bar, legend, attribute table, feature popup, the map
frame itself — shares one shape so a single drag/resize wrapper and a
single renderer loop can handle all of them.

```ts
type ElementBase = {
  id: string
  name: string        // shown in the Layers panel; also used as the runtime-editable field label for text elements
  type: 'mapFrame' | 'text' | 'rect' | 'northArrow' | 'image' | 'scaleBar' | 'legend' | 'attributeTable' | 'popup'
  x: number          // px, relative to page top-left
  y: number
  w: number
  h: number
  zIndex: number      // array order in Layout.elements doubles as this; keep both in sync
  locked?: boolean     // runtime-viewer lock: whether a viewer (when WidgetConfig.allowViewerLayoutEdit is on) can drag/resize this element. Does NOT restrict the template designer inside the Layout Editor — the designer can always move any element.
  visible?: boolean
  // Shared border/fill styling, available to any element's renderer (not every renderer needs to use it)
  strokeColor?: string
  strokeWidth?: number      // pt
  cornerRadius?: number
  fill?: { enabled: boolean; color: string }
}

type TextElement = ElementBase & {
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  align: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'  // defaults to 'middle'; text taller than the box overflows evenly on both sides rather than only downward
  editableAtRuntime?: boolean   // if true, the runtime widget shows an input (labeled by `name`, pre-filled with `text`) letting the viewer override the content before export. Independent of `locked` — a text element can be position-locked but still content-editable.
}

type RectElement = ElementBase & {
  type: 'rect'
  // no additional fields — a rect is just the shared border/fill/cornerRadius
  // styling applied to a plain box. Used for neatlines (no fill, sent to
  // back), callout boxes, etc. Any number can be added via the Rectangle tool.
}

type NorthArrowElement = ElementBase & {
  type: 'northArrow'
  style: 'classic' | 'compass' | 'minimal' | 'compassRose'
  color: string
  rotation: number          // manual override, degrees
  syncToMapRotation: boolean
  mapFrameId?: string       // Phase 12: which mapFrame's rotation to sync to, when a layout has more than one map
}

type ImageElement = ElementBase & {
  type: 'image'
  source: 'upload' | 'portalItem'   // 'portalItem' added in Phase 8
  url?: string           // data: URI, set when source === 'upload'
  portalItemId?: string  // Portal image item id, set when source === 'portalItem' (Phase 8); resolved to a blob via an authenticated request at render/export time — never a raw cross-origin <img src>, so it isn't subject to CORS failures
  lockAspect: boolean
}
// Renamed from LogoElement/'logo' once any number of image elements (not just one logo) became
// addable via the toolbar — see the "Logo/Image" discussion earlier in this project's history.

type ScaleBarElement = ElementBase & {
  type: 'scaleBar'
  unit: 'metric' | 'imperial' | 'dual'
  style: 'line' | 'alternating'
  mapFrameId?: string       // Phase 12: which mapFrame's scale this reflects, when a layout has more than one map
}

type LegendElement = ElementBase & {
  type: 'legend'
  autoFitHeight: boolean
  fontSize?: number   // manual text/swatch size control, deliberately not auto-derived from box
                       // size — width implies column count and height implies rows-per-column, so
                       // using either to also imply text size kept fighting whichever of those two
                       // the designer was actually trying to adjust. Swatch size, row spacing, and
                       // padding all scale proportionally from this one explicit number.
}

type MapFrameElement = ElementBase & {
  type: 'mapFrame'
  mapWidgetId?: string      // Phase 12: which bound Map/Scene widget this frame snapshots. In Phase 1–11 (single-map), the widget's one bound map is used regardless of this field.
}

type AttributeTableElement = ElementBase & {
  type: 'attributeTable'
  layerId?: string        // esri Layer.id of the operational layer to query, within the widget's one bound map
  fields: string[]        // jimuFieldNames of the selected columns, in schema order; first 4 are auto-selected (with their aliases as header labels) the first time a layer is picked
  fieldLabels?: { [jimuFieldName: string]: string }   // optional header overrides; falls back to the field's alias
  fontSize?: number       // body row text size, same manual/independent-of-box-size approach as LegendElement.fontSize
  headerFill?: string
  headerTextColor?: string
  bodyTextColor?: string
  showTitle?: boolean     // defaults to true; prints `${title ?? name} | Total count: N` above the table
  title?: string          // optional override for the title line's text; falls back to `name` when unset
  showRowNumbers?: boolean  // defaults to true; prints a leading "#" column
}
// At print time, the table's rows come from that layer's DataSource.getSelectedRecords() (jimu-core's
// cross-widget selection — the same selection a Select tool or a List widget would set), not any raw
// ArcGIS Maps SDK highlight state — resolved via JimuMapView.getAllJimuLayerViews() /
// getOrCreateLayerDataSource(). No selection at print time prints as a headers-only table (a
// deliberate choice — it reads as intentional rather than looking broken); the live layout editor
// never queries a live selection at all and shows a few placeholder rows instead, purely to preview
// the table's shape/style while positioning it. More features selected than fit the box print as
// truncated with a final "+N more" summary row rather than clipping mid-row. Picking the layer/fields
// is available in the runtime viewer editor too (not design-only), by request — a viewer repointing
// the table is the kind of "adjust before I print" flexibility this element is for.

type PopupElement = ElementBase & {
  type: 'popup'
  layerId?: string
  fields: string[]        // jimuFieldNames shown as label/value rows, in order. When a layer is first picked, auto-populated
                           // from that layer's popupTemplate field list (its "fields" content, or its top-level fieldInfos as
                           // a fallback) if it has one; otherwise left empty for manual picking, same field-checklist UI as
                           // AttributeTableElement.
  fieldLabels?: { [jimuFieldName: string]: string }   // optional label overrides — falls back to the popup's own field label/alias
  title?: string           // optional override for the title line; falls back to the layer's popupTemplate.title (with
                            // {field} placeholders substituted from the shown feature) at render time, then to `name`
  fontSize?: number
  titleTextColor?: string
  labelTextColor?: string  // the field-label column's text color
  valueTextColor?: string
}
// Shows a single feature — the first of the layer's currently selected features, per "only work with
// a single selected feature; if multiple are selected then only use the first". Deliberately scoped
// to a layer's plain "fields" popup content (title + field list): the ArcGIS Maps SDK's popup content
// model also supports media/charts, attachments, Arcade-expression text, and related records, none of
// which have a reasonable static/synchronous equivalent on a print canvas (async Arcade evaluation,
// chart rendering, file attachments), so those are left unrendered rather than attempted. Same
// layer/field-picking-in-viewer-mode and empty-selection/placeholder conventions as AttributeTableElement.

type LayoutElement =
  | TextElement | RectElement | NorthArrowElement
  | ImageElement | ScaleBarElement | LegendElement | MapFrameElement | AttributeTableElement | PopupElement

interface Layout {
  id: string
  name: string
  pageSize: 'letter' | 'a4' | 'a3'
  orientation: 'portrait' | 'landscape'
  elements: LayoutElement[]   // order = z-order, back to front
}
```

## 2. Widget-level config

Settings that belong to the widget instance. `templates` is the designer's
curated set of reusable layouts (each already a complete, self-contained
`Layout` — see Section 1); everything else is a per-instance setting that
applies across all of them.

```ts
interface WidgetConfig {
  templates: Layout[]              // the designer's curated set of templates, e.g. "A4 Portrait", "A4 Landscape with Attributes" — see Phase 7
  allowViewerLayoutEdit?: boolean  // if true, once a runtime user picks a template, the runtime widget also shows "Edit Layout" for it, and viewers can drag/resize/restyle any element whose `locked` is not true — same toggle as before, now applying to whichever template is currently picked rather than to one fixed layout
  allowViewerAddElements?: boolean // Phase 9: only meaningful when allowViewerLayoutEdit is also on — additionally shows the Toolbar and Layers panel in the runtime editor, letting a viewer add new elements and delete/reorder ones they added this session (never the designer's original elements, which stay nudge/restyle-only)
  hideOnExport?: {                 // export-time-only visibility overrides — do not touch the Layout Editor canvas and are never written into Layout.elements
    legend?: boolean
    northArrow?: boolean
    scaleBar?: boolean
  }
}
```

`useMapWidgetIds` isn't part of this interface — it's Experience Builder's
own standard widget prop (`props.useMapWidgetIds`, set via
`MapWidgetSelector`/`onSettingChange`), not something this widget stores
itself. One bound map in Phase 1–11; Phase 12 allows more, paired to
`mapFrame` elements by `mapWidgetId`.

**Also new in Phase 9:** `allowViewerAddElements?: boolean` — a second,
narrower runtime-editing toggle alongside `allowViewerLayoutEdit`, see
Phase 9 below.

**Breaking change from Phase 1–6:** `activeLayout: Layout` (a single layout)
is replaced by `templates: Layout[]` (Phase 7). This is a clean break, not a
migration — the widget is still under active development, so an existing
saved config without `templates` is simply treated as "no templates yet"
(the Setting panel prompts the designer to add one) rather than having any
auto-upgrade path written for it.

## 3. Folder structure

```
print-export-widget/
├── config.json
├── icon.svg
├── src/
│   ├── runtime/
│   │   ├── widget.tsx              // collapsed widget: TemplatePicker first (if no template picked yet), then the picked template's runtime-editable text inputs + Export + Print Preview (Phase 11) + optional "Edit Layout" (only when allowViewerLayoutEdit) + "Change template"
│   │   ├── TemplatePicker.tsx      // Phase 7: named list of props.config.templates (+ any locally-imported ones for this session) with a "Use this template" action per row
│   │   ├── templateStore.local.ts  // Phase 7: local-file save/load — a single Layout to/from a downloaded/uploaded .json, usable from both runtime and design time (no auth involved)
│   │   ├── templateStore.portal.ts // Phase 8: Portal item save/load, design-time only (via jimu-core's esri.restPortal — see Phase 8)
│   │   ├── portalImage.ts          // Phase 8: search the org's Image items + resolve a portalItemId to a blob, used by both ImageProps.tsx (design/runtime preview) and exportRenderer.ts (export time)
│   │   ├── layoutEditor/
│   │   │   ├── LayoutEditor.tsx    // full-screen modal composer; Phase 9 adds `allowAddElements`, gating the Toolbar/Layers panel in viewerMode
│   │   │   ├── Canvas.tsx          // the page + interact.js wrapped elements; Phase 10 adds the alignment-guide-line overlay
│   │   │   ├── ElementWrapper.tsx  // generic interact.js drag/resize wrapper, shared by all types; Phase 10 adds snap-while-dragging
│   │   │   ├── snapping.ts         // Phase 10: snap-target/threshold math, shared by every ElementWrapper instance
│   │   │   ├── PortalImagePicker.tsx // Phase 8: modal searching Portal "Image" items, used by ImageProps.tsx
│   │   │   ├── LayersPanel.tsx
│   │   │   ├── Toolbar.tsx         // add-element tool rail
│   │   │   └── properties/
│   │   │       ├── TextProps.tsx        // includes the "Editable at runtime" toggle
│   │   │       ├── RectProps.tsx        // includes Arrange: front/forward/backward/back
│   │   │       ├── NorthArrowProps.tsx
│   │   │       ├── ImageProps.tsx       // upload (Phase 1); + "Select from Portal" (Phase 8); renamed from LogoProps.tsx once any number of image elements (not just one logo) became addable
│   │   │       ├── ScaleBarProps.tsx
│   │   │       ├── LegendProps.tsx
│   │   │       └── MapFrameProps.tsx    // Phase 12: pick which bound map widget this frame snapshots
│   │   ├── elementRenderers/       // how each element type actually PAINTS (both live preview and export canvas use these)
│   │   │   ├── renderText.ts
│   │   │   ├── renderRect.ts
│   │   │   ├── renderNorthArrow.ts
│   │   │   ├── renderImage.ts     // renamed from renderLogo.ts alongside the Logo→Image rename
│   │   │   ├── renderScaleBar.ts
│   │   │   └── renderLegend.ts
│   │   ├── exportRenderer.ts       // screenshots the bound view(s), composites all elements onto a canvas; Phase 11 splits the compositing itself out into renderLayoutToCanvas(), shared with printPreview.ts, and exportLayout() stays the thin PNG-download wrapper around it
│   │   └── printPreview.ts         // Phase 11: renderLayoutToCanvas() → PNG data URL → opens a new tab styled to the exact page size with Print/Close/Download-PNG, modeled on the built-in Near Me widget's own "Export to PDF" (see Phase 11)
│   ├── setting/
│   │   ├── setting.tsx             // useMapWidgetIds, hideOnExport checkboxes, allowViewerLayoutEdit; renders TemplateManager
│   │   ├── TemplateManager.tsx     // Phase 7/8: the template list — Add/Duplicate/Delete/Edit/Export-to-file/Import-from-file per template, plus Load-from-Portal/Save-to-Portal (Phase 8) actions
│   │   ├── PortalTemplatePicker.tsx // Phase 8: modal searching the signed-in user's own "printLayoutTemplate"-tagged Portal items, used by TemplateManager.tsx
│   │   └── setting.messages.ts
│   ├── config.ts                   // Layout / LayoutElement / WidgetConfig types (sections 1–2)
│   └── translations/
│       └── default.ts
```

## 4. Build phases (what to hand Claude Code, in order)

**Phase 1 — Static export, no editor (already spec'd in earlier discussion)**
`widget.tsx` with the runtime-editable text inputs (from the active Layout's
`editableAtRuntime` text elements, if any — otherwise none) + Export button;
`exportRenderer.ts` does `view.takeScreenshot()` + canvas compositing of a
*fixed* layout (title, logo, legend, north arrow, scale bar all hardcoded
position). Logo is upload-only in this phase, stored as a `data:` URI on
`LogoElement.url`. No "Edit Layout" entry point on the runtime widget yet —
the Layout Editor (once it exists in Phase 2+) is reached from the Setting
panel at design time only, until `allowViewerLayoutEdit` exists. Prove the
export pipeline works before any editor UI.

**Phase 2 — Element model + read-only layout editor shell**
Add `config.ts` types, `LayoutEditor.tsx` modal with toolbar/canvas/layers/
properties panels laid out per the mockup, rendering a `Layout` — but
elements are NOT draggable yet, just positioned from the data. Confirms the
UI shell and that `elementRenderers/*` can paint every type correctly both
in the editor canvas and via `exportRenderer`.

**Phase 3 — Drag & resize**
Wire `interact.js` into `ElementWrapper.tsx`. One wrapper, driven entirely by
`element.type` to decide what renders inside it. Drag/resize `end` listeners
update the element's `x/y/w/h` in state. (`react-rnd` was the original plan,
but its `react-draggable`/`re-resizable` internals aren't compatible with
React 19 yet — see the open "Update react monorepo to v19" PR on react-rnd's
repo. `interact.js` was already a dependency of this codebase and is
DOM-event-based rather than tied to React internals, so it isn't exposed to
that class of bug at all.)

**Phase 4 — Contextual properties panel + Arrange**
`properties/*.tsx` swap based on `selectedElement.type` (`LegendProps.tsx`
included — an earlier gap in this doc's folder listing, filled in during
this phase). Position/size and border/fill are shared across every panel via
`PositionSizeFields.tsx`/`ContainerStyleFields.tsx` rather than duplicated.
Rectangle gets the Arrange buttons (front/forward/backward/back) that
reorder the `elements` array and keep `zIndex` in sync. The Layers panel's
eye/lock icons became clickable this phase too (toggling `visible`/`locked`
directly). Note: `LegendElement.autoFitHeight` still isn't wired to any
actual behavior — `renderLegend.ts` always paints against the element's
stored `h` regardless of this flag, so it's deliberately left off
`LegendProps.tsx` for now rather than shipping a no-op toggle.

**Phase 5 — Page size/orientation + neatline-friendly rect (done, descoped)**
Both halves turned out to already be covered by how earlier phases landed.
The Rect tool has been a general-purpose shape since Phase 3/4 — no separate
"neatline" type or fixed layer, just an ordinary rect sent to back. The
size+orientation split exists in the Layout Editor's own header (Phase 2);
duplicating it in the widget's Setting panel too was considered and
explicitly declined — the single entry point in the editor is preferred, so
that duplication is off the list rather than deferred.

**Phase 6 — Runtime viewer editing**
`WidgetConfig.allowViewerLayoutEdit` gets a Setting-panel toggle. When on,
the runtime widget shows its own "Edit Layout" entry point, opening
`LayoutEditor.tsx` in a new `viewerMode`. Reuses the same editor rather than
building a second one: Toolbar and the Layers panel are hidden entirely,
the header drops to just Close/Undo/Redo/Apply (no name/page-size/
orientation/template controls — those are template-identity decisions, not
"nudge it before I print" ones), and the Properties panel shows Position &
size only, no per-type fields or Delete. `ElementWrapper` gains an
`interactive` flag (`!viewerMode || !element.locked`) — a locked element is
neither draggable/resizable nor selectable in viewer mode, closing the loop
on `locked`, which existed since Phase 1 but nothing ever actually read it
until now. Critically, "Apply" is session-local: it updates the runtime
widget's own React state, never `props.config` — a widget's runtime props
are read-only from its own code in Experience Builder's widget API (there's
no runtime equivalent of `onSettingChange`), so this isn't just a design
choice, it's the only way it could work. A viewer's adjustment affects only
their own export, never the shared template other viewers or the designer
see.

**Phase 7 — Multi-template management + local file import/export**
`WidgetConfig.activeLayout: Layout` (one layout) is replaced by
`WidgetConfig.templates: Layout[]` (Phase 7's breaking change — see Section 2
for why this is a clean break rather than a migration). The designer now
manages a named set of templates instead of one fixed layout, e.g. "A4
Portrait", "A4 Landscape with Attributes", "A4 Landscape with Popup".

- **Settings panel (design time):** `TemplateManager.tsx` replaces the old
  single "Edit Layout" button with a list of `templates` (name + page
  size/orientation badge), each with Edit (opens `LayoutEditor.tsx` for that
  one `Layout`, writing back into `templates[i]` on save), Duplicate, Delete,
  and Export-to-file actions, plus "Add template" (blank `Layout`, opens
  straight into the editor) and "Import from file". The Layout Editor's own
  header keeps its existing name/page-size/orientation controls (per-template,
  as before) but drops its now-redundant disabled "Load template…"/"Save as
  template" buttons — `TemplateManager.tsx` is the one entry point for
  template-level actions, consistent with the single-entry-point preference
  already established in Phase 5.
- **Local file import/export (`templateStore.local.ts`, both design time and
  runtime):** Export serializes one `Layout` to a downloaded `.json` (reusing
  `saveAs` from `jimu-core`, already used for the PNG export). Import reads
  a `.json` file back via `FileReader`, does a light shape check (`id`,
  `elements` array, etc. present), and assigns it a fresh `id` via
  `crypto.randomUUID()` so it can never collide with an existing template's
  id purely by chance.
- **Runtime widget:** `widget.tsx` shows `TemplatePicker.tsx` first — a
  simple named list of `props.config.templates` (plus any templates the
  viewer has imported from a local file *this session*, which are
  session-local like every other runtime-editor concept from Phase 6 and
  never written back to `props.config`) — until the viewer picks one. After
  picking, the widget behaves as it does today for that `Layout`: the
  `editableAtRuntime` text inputs, Export, and (if `allowViewerLayoutEdit` is
  on) "Edit Layout" — plus a new "Change template" control to go back to the
  picker, and "Export template to file" to save the *currently active*
  (possibly runtime-edited) `Layout` locally. No Portal access at runtime —
  local file only, per the design-time/runtime split.

**Phase 8 — Portal template save/load + image "Select from Portal"**
`templateStore.portal.ts` and `portalImage.ts` (design-time only, and their
own modules): `createItem`/`updateItem`/`searchItems`/`getItemData` from
`@esri/arcgis-rest-portal`, accessed via jimu-core's own re-export
(`esri.restPortal`, part of jimu-core's public `esri` object alongside
`restFeatureService`/`restRequest`) rather than importing the npm package
directly — jimu-core is already loaded once by the Experience Builder app
shell regardless of what this widget does, so this adds no bundle weight of
its own, which turned the originally-planned "keep it out of the
always-loaded runtime `widget.js`" lazy-loading concern moot: a plain
import is enough, since `exportRenderer.ts` (which needs `portalImage.ts`
for export-time image resolution, and is itself part of the always-loaded
bundle) now carries no extra cost either. Authenticated via
`SessionManager.getInstance().getMainSession()` (jimu-core's wrapper around
the signed-in user's `ArcGISIdentityManager` session — the same session ExB
itself is already using, so no separate sign-in flow was needed). Each
template is saved as its own small Portal item (per-template granularity,
matching local file export) tagged `printLayoutTemplate`, holding the
`Layout` JSON as the item's `text` data. The item `type` used is
`"Application Configuration"` (a generic AGO type for app-defined JSON
config, not tied to any map/service) — if a portal's validation rejects it,
that's a one-line fix in `templateStore.portal.ts`, since the
`printLayoutTemplate` tag (not the type) is what `searchItems` actually
filters on. `Layout` gained `portalItemId?: string`, set once a template is
first saved to Portal so a later save updates that same item instead of
creating a duplicate. `TemplateManager.tsx` got "Save to Portal" (create or
update, per-template) and "Load from Portal" (`PortalTemplatePicker.tsx`, a
modal searching the signed-in user's own tagged items) actions alongside
the existing local-file ones — design-time only, same as the rest of this
phase.

Also added "Select from Portal" as a second `ImageElement` source
(`PortalImagePicker.tsx`), with a "My Content"/"My Organization" scope
toggle — an unscoped `type:"Image"` search would otherwise match every
public Image item across all of ArcGIS Online, not just this portal/org,
which is exactly the problem a first pass at this hit. "My Organization"
needs the signed-in user's org id, which isn't on the session itself and
takes its own `getUser` call to look up (`portalImage.ts`). The picker's
results list scrolls independently of the modal (a fixed max-height area)
rather than growing the whole dialog unboundedly. It also has its own
"Upload new image to Portal…" action — for the (common, it turned out)
case where an org has no existing image items yet to browse — which
uploads a local file straight into the signed-in user's Portal content as
a new Image item via `createItem`'s `file` option, then immediately
selects it. The chosen `portalItemId` is resolved to a blob via an
authenticated `getItemData` request (never a raw cross-origin `<img src>`,
so it carries no CORS dependency) at both live-preview time (`Canvas.tsx`)
and export time (`exportRenderer.ts`).

**Phase 9 — Runtime element adding**
A second, narrower runtime-editing toggle, `allowViewerAddElements`, layered
on top of `allowViewerLayoutEdit` (only meaningful when that one is also
on — the Setting panel's toggle for it is disabled/hidden until
`allowViewerLayoutEdit` is checked, since adding an element a viewer then
couldn't move or resize wouldn't make sense). When both are on, the runtime
`LayoutEditor` (`viewerMode`) additionally shows the Toolbar and Layers
panel — today it hides both unconditionally.

- **What a viewer can do:** add any addable element type (the same
  `AddableElementType`s the designer gets — text, rect, north arrow, image,
  scale bar, legend, attribute table, popup; not `mapFrame`, same exclusion
  as today), then move/resize/restyle it, same as any unlocked element
  already works today. They can also delete or reorder (via the Layers
  panel or Arrange) an element *they added this session* — but not the
  designer's original elements, which stay nudge/restyle-only exactly as
  Phase 6 already established, never deletable or reorderable by a viewer.
- **Telling "designer's" and "viewer-added" elements apart:** no new flag on
  `LayoutElement` is needed. `widget.tsx` already computes `activeTemplate`
  (the picked template as originally loaded, before any session edits) —
  memoized on the template pick itself, not on every session edit, so it
  stays stable across repeated open/Apply/reopen cycles of the runtime
  editor within one visit. Its element `id`s are the "designer's original
  elements" set, passed down as a new `LayoutEditor` prop (e.g.
  `originalElementIds`); anything with an `id` outside that set was added
  during this session (new elements always get a fresh
  `crypto.randomUUID()`, so a collision is not a concern) and is
  deletable/reorderable. `PropertiesPanel.tsx`'s Delete button and
  `LayersPanel.tsx`'s per-row trash icon both need this same
  designer-vs-viewer-added check threaded in, wherever `viewerMode` is on —
  today they're simply hidden whenever `viewerMode` is true; Phase 9 makes
  that conditional per-element instead of blanket.
- **Design time is unaffected:** the designer's own `LayoutEditor` session
  (`viewerMode` false) already shows the Toolbar/Layers panel and already
  allows deleting/reordering anything (except `mapFrame`) — nothing changes
  there.

**Phase 10 — Snap/align guides while dragging**
Applies uniformly to both the design-time and runtime editors — it's a pure
precision aid, not a capability that needs gating behind a toggle the way
Phase 9's element-adding does.

- **Snap targets:** for the element currently being dragged, its own left/
  horizontal-center/right and top/vertical-center/bottom edges are checked
  against the same three points on every *other* element in the layout, plus
  the page's own edges and center (`0`/`w/2`/`w` and `0`/`h/2`/`h` in the
  logical page-pixel space `element.x/y/w/h` already live in — see
  `pageSize.ts`). Within a small threshold (a handful of logical px,
  converted from a fixed screen-px threshold via the existing `zoom` value
  `ElementWrapper` already divides drag deltas by), the dragged edge snaps
  to the matching target instead of wherever the raw pointer position would
  otherwise place it.
- **Where this lives:** the snap-target math (`snapping.ts`) is shared by
  every `ElementWrapper` instance, but computing it needs every *other*
  element's current bounds, which an individual `ElementWrapper` doesn't
  otherwise have visibility into (it only knows its own `element` prop) —
  `Canvas.tsx` already renders the full `layout.elements` list, so it passes
  each wrapper the other elements' bounds as a prop. Implemented as custom
  logic inside `ElementWrapper`'s existing interact.js `move` listener
  (which already does all the delta/coordinate math by hand) rather than
  interact.js's own built-in `snap` modifier — that modifier is built around
  snapping to a fixed grid or a fixed point list, not points recomputed from
  sibling positions on every frame, so it wouldn't save meaningful code here
  and would make the visual-guide-line feedback (below) harder to hook into.
- **Visual guide lines:** while snapped, a thin colored line is drawn the
  full extent needed to make the alignment legible (e.g. spanning from the
  dragged element to whichever sibling it aligned with, or the full page
  width/height for a page-edge/center snap) — a lightweight overlay in
  `Canvas.tsx`, driven by an `onGuidesChange` callback the actively-dragging
  `ElementWrapper` calls each move event and clears on drag end. Only one
  element is ever being dragged at a time, so this is simple transient state
  on `Canvas.tsx`, not written into `Layout` at all.
- **Scoped to move (dragging) only for this phase** — resize-edge snapping
  (each of the four resize handles independently snapping) is a natural
  follow-up but adds real complexity (four separate edges instead of one
  element's whole bounds) for a case the original request didn't ask for;
  left as an explicit future extension rather than attempted here.

**Phase 11 — Print Preview + browser print/PDF**
Modeled directly on how the built-in "Near Me" widget's own "Export to PDF"
actually works — traced from its real shipped source
(`dist/widgets/arcgis/near-me/src/runtime/components/report.tsx` and its
`assets/js/print.js`, both plain-text `.tsx`/`.js` in this dev environment,
not just compiled output). There is no PDF-generation library anywhere in
Experience Builder itself, built-in or otherwise — Near Me's "Export to
PDF" is: composite everything onto an image, open it in a new, isolated
browser tab styled to the exact physical page size, and let the browser's
own Print dialog (Save as PDF, an actual printer, whatever the user has)
do the rest. `print.js` really is just three lines wiring a Print button to
`window.print()` and a Close button to `window.close()`. This widget
follows the same pattern rather than adding a PDF-generation dependency —
a true generated `.pdf` file (via e.g. `jsPDF`) remains a legitimate,
separate future addition if ever wanted, not attempted here.

- **`exportRenderer.ts` is split**, not duplicated: `renderLayoutToCanvas
  (options: RenderOptions): Promise<HTMLCanvasElement>` now does all the
  actual work this file already did (screenshot the bound view, preload
  images/attribute rows/popup data, paint every element in zIndex order)
  and returns the composited canvas; `exportLayout(options: ExportOptions)`
  (`ExportOptions extends RenderOptions` with `fileName`) becomes a thin
  wrapper — `renderLayoutToCanvas()` → PNG blob → `saveAs()` — so "Export
  map" and the new Print Preview share one compositing pipeline rather than
  two.
- **New `printPreview.ts`**: `openPrintPreview(options: RenderOptions)`
  calls `renderLayoutToCanvas()`, converts the result to a PNG data URL
  (`canvas.toDataURL()`), and builds a small standalone HTML document — the
  image, sized via CSS `@page { size: <letter|A4|A3> <portrait|landscape> }`
  to match the `Layout`'s own page size/orientation exactly (the same
  mapping `getPageSizePx` already encodes), plus "Print" and "Close"
  buttons wired exactly like Near Me's `print.js` — wrapped in a `Blob` and
  opened via `window.open()`, exactly like Near Me's own `report.tsx`.
  Opening a dedicated, isolated tab rather than printing from within the
  ExB app itself is deliberate, not incidental: it's what keeps the
  browser's print output to just the composed page, with none of
  Experience Builder's own surrounding UI chrome bleeding into it — trying
  to scope that with print CSS from inside the running app would be far
  more fragile.
- The same tab also offers a plain "Download PNG" link (the same data URL,
  trivially free once it already exists) — so this one entry point covers
  image download, browser print, and Save-as-PDF (via the browser's own
  print dialog) together, rather than three separate buttons on the widget
  itself. The preview *is* the tab the user sees before printing — there's
  no separate in-app preview modal to keep in sync with it.
- **New "Print Preview" icon button** in the runtime widget, alongside
  Export map/Edit Layout/Export template. Runtime only for this phase —
  the design-time editor already has everything needed (its own
  `JimuMapViewComponent`) to get the same button later as a small
  follow-up, not attempted now.
- **Deliberately out of scope for this phase:** a true generated `.pdf`
  file (would need an actual PDF-generation library — nothing in
  Experience Builder provides one for free, unlike the Portal/session
  access Phase 8 could lean on), and export resolution/quality options (a
  separate idea from the same discussion that produced this phase) — both
  remain natural, additive follow-ups rather than blockers here.

**Phase 12 — Multiple map frames (future/optional)**
`useMapWidgetIds` grows beyond one. `mapFrame` elements become addable via
the Toolbar (rather than a fixed singleton) and each is bound to a specific
Map/Scene widget via `mapWidgetId`, set from `MapFrameProps.tsx`.
`exportRenderer.ts` loops per `mapFrame`, resolving and screenshotting each
bound view independently and compositing it into its own frame — both 2D
`MapView` and 3D `SceneView` support `.takeScreenshot()`, so mixing e.g. an
aerial 2D map and a 3D point cloud in one layout works. `NorthArrowElement`/
`ScaleBarElement.mapFrameId` become meaningful, pairing each to a specific
map when more than one is present. The Layout Editor canvas changes from one
implicit full-bleed background map to each `mapFrame` element rendering its
own bound live view within its own bounds, like any other element.

## 5. Key libraries

- `interact.js` (already a dependency of this codebase) — drag + resize,
  wired directly to DOM nodes rather than through a React wrapper component.
  Its own published types are broken (they reference an internal
  `@interactjs/interactjs` sub-package that isn't installed), so it's
  imported via the exact JS subpath the bundler already resolves to
  (`interactjs/dist/interact.min.js`) with a small hand-written ambient
  declaration (`layoutEditor/interactjs.d.ts`) covering just the API used.
- `@esri/arcgis-rest-portal` — template save/load via Portal Items, and
  Portal image search/resolution for the image element's "Select from
  Portal" source (both Phase 8), authenticated via jimu-core's
  `SessionManager.getInstance().getMainSession()`. Accessed via jimu-core's
  own re-export (`esri.restPortal`) rather than importing the npm package
  directly, so it adds no bundle weight of its own — jimu-core is already
  loaded once by the app shell regardless.
- (optional, phase 8+) `jsPDF` — if PNG export isn't enough and true
  multi-page PDF is wanted later

## 6. Notes for whoever (Claude Code) implements this

- The editor canvas and the final export renderer must **share the same
  `elementRenderers/*` functions** — the editor is not allowed to fake the
  look with different code, or WYSIWYG breaks.
- `zIndex`/array order is the single source of truth for stacking — don't
  let CSS `z-index` values drift independently of the `elements` array.
- North arrow's `rotation` is a manual override; when `syncToMapRotation`
  is true, ignore the stored value and use the bound view's rotation live
  instead — keep both fields so a user can lock it for print even while
  panning. In Phase 12, "the bound view" means the map frame identified by
  `mapFrameId`.
- `locked` is strictly a runtime-viewer concept — it never restricts the
  template designer inside the Layout Editor, only a viewer using the
  runtime widget when `WidgetConfig.allowViewerLayoutEdit` is on.
- `WidgetConfig.hideOnExport` (the Setting panel's Legend/North arrow/Scale
  bar checkboxes) only affects what `exportRenderer` composites into the
  final output. It must never be written into `Layout.elements` or mutate a
  saved template — the same template can be reused by another Experience
  with different export preferences.
- An image sourced from an arbitrary external URL risks a canvas-tainting
  CORS failure at export time even though it displays fine in the live
  preview `<img>`. Phase 1 sidesteps this by supporting upload only
  (embedded as a `data:` URI); Phase 8's "Select from Portal" option
  sidesteps it by resolving the image through an authenticated Portal REST
  request rather than a raw cross-origin image load. Freeform external URL
  entry is intentionally not supported.
- Cap uploaded image file size client-side (e.g. ~500KB–1MB) — an uploaded
  logo's bytes get embedded directly in the `Layout` JSON and, by extension,
  in any template Portal Item saved from it, so template size scales with
  logo size.
