export {
  analyzePixelInspector,
  applyPixelInspector,
  applyVariantGeneration,
  createPixelInspectorPreset,
  getComponentPreviewManifest,
  getPixelInspectorPresets,
  getStudioSummary,
  previewPixelInspector,
  updateWorkspaceConfig,
} from './api/client.js';
export type {
  ComponentPreviewManifest,
  ComponentPreviewRequest,
  PixelInspectorAnalysis,
  PixelInspectorApplyRequest,
  PixelInspectorApplyResult,
  PixelInspectorClassCandidate,
  PixelInspectorControlGroup,
  PixelInspectorDraft,
  PixelInspectorPreviewRequest,
  PixelInspectorSaveMode,
  PreviewDensity,
  PreviewState,
  PreviewTheme,
  PreviewViewport,
  StudioSummary,
  WorkspaceConfig,
} from './types/index.js';
export type { WorkbenchArea } from './workbench.js';
export {
  getWorkbenchAreaMeta,
  WORKBENCH_AREAS,
} from './workbench.js';
