export default {
  noMapWidget: 'No map widget is configured for this widget yet.',
  editLayout: 'Edit Template',
  noTemplates: 'No templates are available yet. Ask this app\'s designer to add one, or import a template file below.',
  importTemplate: 'Import template…',
  changeTemplate: 'Change template',
  exportTemplate: 'Export template',
  printPreviewFailed: 'Could not open the print preview. Please try again.',
  showPrintArea: 'Show print area',
  deleteImportedTemplate: 'Delete imported template',
  confirmDeleteTemplate: 'Confirm delete?',

  // Shared position/size and container-style fields (used by every per-type properties panel)
  positionAndSize: 'Position & size',
  fieldX: 'X',
  fieldY: 'Y',
  fieldW: 'W',
  fieldH: 'H',
  container: 'Container',
  borderColor: 'Border color',
  borderWidth: 'Border width',
  cornerRadius: 'Corner radius',
  backgroundFill: 'Background fill',

  // Toolbar
  toolText: 'Text',
  toolRectangle: 'Rectangle',
  toolImage: 'Image',
  toolPopup: 'Popup',
  toolTable: 'Table',
  toolNorthPoint: 'North pt',
  toolScaleBar: 'Scale bar',
  toolLegend: 'Legend',
  toolMap: 'Map',
  placeElement: 'Place {label}',

  // Layers panel
  layers: 'Layers',
  hide: 'Hide',
  show: 'Show',
  moveUp: 'Move up',
  moveDown: 'Move down',
  lock: 'Lock',
  unlock: 'Unlock',
  delete: 'Delete',
  selectToDelete: 'Select to delete',

  // Properties panel shell
  selectElementPrompt: 'Select an element to view its properties.',
  name: 'Name',
  deleteElement: 'Delete element',

  // Layout editor header
  close: 'Close',
  undoTooltip: 'Undo (Ctrl+Z)',
  undo: 'Undo',
  redoTooltip: 'Redo (Ctrl+Y)',
  redo: 'Redo',
  pageSizeLetter: 'Letter (8.5 × 11 in)',
  pageSizeTabloid: 'Tabloid (11 × 17 in)',
  pageSizeA4: 'A4 (210 × 297 mm)',
  pageSizeA3: 'A3 (297 × 420 mm)',
  portrait: 'Portrait',
  landscape: 'Landscape',
  apply: 'Apply',
  saveLayout: 'Save layout',

  // Canvas zoom controls
  zoomOut: 'Zoom out',
  zoomIn: 'Zoom in',
  fit: 'Fit',

  // Text properties
  content: 'Content',
  font: 'Font',
  size: 'Size',
  weight: 'Weight',
  normal: 'Normal',
  bold: 'Bold',
  color: 'Color',
  horizontalAlign: 'Horizontal align',
  verticalAlign: 'Vertical align',
  alignLeft: 'Left',
  alignCenter: 'Center',
  alignRight: 'Right',
  alignTop: 'Top',
  alignMiddle: 'Middle',
  alignBottom: 'Bottom',
  editableAtRuntime: 'Editable at runtime',

  // Rect properties
  arrange: 'Arrange',
  bringToFront: 'Bring to front',
  bringForward: 'Bring forward',
  sendBackward: 'Send backward',
  sendToBack: 'Send to back',

  // North arrow properties
  northArrowSectionTitle: 'North arrow',
  style: 'Style',
  styleClassic: 'Classic',
  styleCompass: 'Compass',
  styleMinimal: 'Minimal',
  styleCompassRose: 'Compass rose',
  syncToMapRotation: 'Sync to map rotation',
  rotationDegrees: 'Rotation (°)',

  // Image properties
  sourceUpload: 'Upload',
  sourcePortal: 'Portal',
  imageMustBeSmaller: 'Image must be smaller than 1MB.',
  replaceImage: 'Replace image…',
  uploadImage: 'Upload image…',
  pngOrSvgUpTo1Mb: 'PNG or SVG, up to 1MB',
  usingPortalImage: 'Using: {value}',
  changeEllipsis: 'Change…',
  browsePortalEllipsis: 'Browse Portal…',
  lockAspectRatio: 'Lock aspect ratio',

  // Scale bar properties
  units: 'Units',
  unitKilometers: 'Kilometers (km)',
  unitMeters: 'Meters (m)',
  unitMiles: 'Miles (mi)',
  unitFeet: 'Feet (ft)',
  styleLine: 'Line',
  styleAlternatingBar: 'Alternating bar',

  // Legend properties
  fontSize: 'Font size',
  legendFontSizeHint: 'Swatch size and spacing scale with this — shrink it to fit more columns without overlap.',
  columns: 'Columns',
  columnsAuto: 'Auto',
  columns1: '1',
  columns2: '2',
  columns3: '3',
  columns4: '4',

  // Attribute table / popup shared data fields
  dataSectionTitle: 'Data',
  layer: 'Layer',
  selectALayerEllipsis: 'Select a layer…',
  fields: 'Fields',
  loadingFields: 'Loading fields…',
  noFieldsFound: 'No fields found on this layer.',

  // Attribute table properties
  attributeTablePrintHint: 'At print time, the table shows that layer\'s currently selected features.',
  columnHeaders: 'Column headers',
  tableStyleSectionTitle: 'Table style',
  showTitle: 'Show title',
  showRowNumbers: 'Show row numbers',
  headerFill: 'Header fill',
  headerTextColor: 'Header text color',
  bodyTextColor: 'Body text color',

  // Popup properties
  popupPrintHint: 'At print time, the card shows that layer\'s first currently selected feature.',
  fieldLabels: 'Field labels',
  title: 'Title',
  popupTitleHintWithTemplate: 'Defaults to the layer\'s own popup title, with {placeholder} placeholders filled in from the feature.',
  popupTitleHintNoTemplate: 'Type {placeholder} to substitute a field\'s value from the feature.',
  cardStyleSectionTitle: 'Card style',
  titleColor: 'Title color',
  labelColor: 'Label color',
  valueColor: 'Value color',

  // Portal image picker
  selectImageFromPortal: 'Select image from Portal',
  myContent: 'My Content',
  myOrganization: 'My Organization',
  searchByTitleEllipsis: 'Search by title…',
  search: 'Search',
  searchingEllipsis: 'Searching…',
  noImagesFound: 'No images found.',
  select: 'Select',
  uploadingEllipsis: 'Uploading…',
  uploadNewImageToPortalEllipsis: 'Upload new image to Portal…',
  portalUploadHint: 'PNG or SVG, up to 1MB. Uploads to your Portal content, then selects it.',

  // Print preview tab (passed as parameters into printPreview.ts, which renders outside the React tree)
  preparingPreviewTitle: 'Preparing preview…',
  preparingPreviewBody: 'Preparing print preview…',
  printPreviewFailedTitle: 'Print preview failed',
  printPreviewFailedBody: 'Something went wrong generating the print preview. Close this tab and try again.',
  print: 'Print',
  downloadPng: 'Download PNG',
  actualSize: 'Actual size'
}
