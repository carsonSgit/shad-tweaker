// Shared types from PROJECT_PLAN.md

export interface ComponentMetadata {
  lines: number;
  size: number;
  lastModified: string;
  classCount?: number;
}

export interface Component {
  name: string;
  path: string;
  content: string;
  metadata: ComponentMetadata;
}

export interface ComponentDetail extends Component {
  classes: string[];
}

export type ComponentDependencyStatus = 'none' | 'ok';

export interface ComponentLibraryInventoryItem {
  name: string;
  path: string;
  sourceRegistry?: string;
  primitiveBase?: string;
  variantCount: number;
  variants: VariantComponentSummary;
  lastModified: string;
  dependencyStatus: ComponentDependencyStatus;
  tokenUsage: string[];
}

export interface ComponentLibraryDetail extends ComponentLibraryInventoryItem {
  content: string;
  exports: string[];
  dependencies: Array<{ name: string; type: string; version?: string; source?: string }>;
  localComponentName?: string;
  originalComponentName?: string;
}

export interface ComponentLibraryDuplicate {
  type: 'name' | 'export' | 'dependency';
  value: string;
  componentPaths: string[];
  suggestedNames: string[];
}

export interface ComponentLibraryCompareResult {
  name: string;
  path: string;
  sourcePath?: string;
  changed: boolean;
  diff: string;
  localContent?: string;
  sourceContent?: string;
}

export interface Preview {
  path: string;
  before: string;
  after: string;
  diff: string;
  changes: number;
  lineNumbers: number[];
}

export type PreviewViewport = 'desktop' | 'tablet' | 'mobile';
export type PreviewTheme = 'light' | 'dark' | 'system';
export type PreviewDensity = 'comfortable' | 'default' | 'compact';
export type PreviewState =
  | 'default'
  | 'hover'
  | 'focus'
  | 'disabled'
  | 'loading'
  | 'open'
  | 'selected';

export interface PreviewDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface ComponentPreviewRequest {
  componentPath: string;
  exportName?: string;
  viewport?: PreviewViewport;
  theme?: PreviewTheme;
  density?: PreviewDensity;
  state?: PreviewState;
  parentOrigin?: string;
  variants?: Record<string, string>;
  inspectorClassName?: string;
}

export interface ComponentPreviewManifest {
  component: {
    name: string;
    path: string;
    exports: string[];
    defaultExport: string;
  };
  variants: VariantDefinitionDetail[];
  states: PreviewState[];
  viewports: Record<PreviewViewport, { width: number; height: number }>;
  themes: PreviewTheme[];
  densities: PreviewDensity[];
  frameUrl: string;
  diagnostics: PreviewDiagnostic[];
}

// Keep token system types in sync with backend/src/types/index.ts.
export type TokenCategory =
  | 'colors'
  | 'radius'
  | 'spacing'
  | 'typography'
  | 'border'
  | 'shadow'
  | 'opacity'
  | 'zIndex'
  | 'motion'
  | 'easing'
  | 'duration'
  | 'breakpoints'
  | 'density';

export interface DesignToken {
  name: string;
  category: TokenCategory;
  value: string;
  description?: string;
  aliases?: string[];
  createdAt: string;
  updatedAt: string;
}

export type DesignTokenMap = Record<TokenCategory, Record<string, DesignToken>>;

export interface DesignTokenSet {
  id: string;
  name: string;
  description?: string;
  tokens: DesignTokenMap;
  createdAt: string;
  updatedAt: string;
}

export interface ComponentTokenOverride {
  componentPath: string;
  tokenSetId: string;
  overrides: Partial<Record<TokenCategory, Record<string, string>>>;
}

export interface ComponentSource {
  originRegistry?: string;
  originalPackageName?: string;
  originalComponentName?: string;
  importedAt?: string;
  lastModifiedAt?: string;
  localComponentName?: string;
  dependencies?: RegistryDependency[];
}

export interface RegistryDependency {
  name: string;
  type: 'package' | 'registry' | 'local';
  version?: string;
  source?: string;
}

export interface RegistryItemFile {
  path: string;
  content?: string;
  type?: string;
}

export interface ComponentPackage {
  id: string;
  name: string;
  type: 'component' | 'hook' | 'utility' | 'page' | 'registry-item';
  source?: ComponentSource;
  files: string[];
  registryFiles?: RegistryItemFile[];
  dependencies: RegistryDependency[];
  devDependencies?: RegistryDependency[];
  registryDependencies: RegistryDependency[];
  createdAt: string;
  updatedAt: string;
}

export interface TokenPatch {
  category: string;
  token: string;
  value: string;
}

export interface ClassTransform {
  find: string;
  replace: string;
  isRegex: boolean;
}

export interface AstTransform {
  kind: string;
  target: string;
  value: unknown;
}

export interface MotionPatch {
  target: string;
  property: string;
  value: string;
}

export interface VariantRecipe {
  component?: string;
  axis: string;
  values: Record<string, string>;
}

export interface Preset {
  id: string;
  name: string;
  description?: string;
  created?: string;
  migratedFromTemplateId?: string;
  tokenOverrides: TokenPatch[];
  classTransforms: ClassTransform[];
  astTransforms: AstTransform[];
  motionOverrides: MotionPatch[];
  variantRecipes: VariantRecipe[];
}

export interface TokenCandidate {
  category: TokenCategory;
  value: string;
  className: string;
  componentPath: string;
  source: 'className' | 'cn' | 'variant';
  line?: number;
}

export interface TokenFrequencyEntry {
  category: TokenCategory;
  value: string;
  occurrences: number;
  componentPaths: string[];
  classes: string[];
}

export interface TokenFrequencyReport {
  entries: TokenFrequencyEntry[];
  totalOccurrences: number;
}

export interface TokenInconsistencyEntry {
  category: TokenCategory;
  family: string;
  values: Array<{ value: string; occurrences: number; componentPaths: string[] }>;
  recommendedValue: string;
}

export interface TokenInconsistencyReport {
  entries: TokenInconsistencyEntry[];
}

export interface TokenPatchChange {
  category: TokenCategory;
  from: string;
  to: string;
  tokenName?: string;
}

export type PixelInspectorControlGroup =
  | 'radius'
  | 'padding'
  | 'gap'
  | 'height'
  | 'width'
  | 'borderWidth'
  | 'borderStyle'
  | 'borderColor'
  | 'background'
  | 'foreground'
  | 'shadow'
  | 'ring'
  | 'fontSize'
  | 'fontWeight'
  | 'letterSpacing'
  | 'duration'
  | 'easing'
  | 'transform';

export type PixelInspectorSaveMode = 'component-patch' | 'token-patch' | 'variant-value' | 'preset';

export interface PixelInspectorClassCandidate {
  className: string;
  group: PixelInspectorControlGroup;
  source: TokenCandidate['source'];
  line?: number;
}

export interface PixelInspectorAnalysis {
  componentPath: string;
  candidates: PixelInspectorClassCandidate[];
  rawClasses: string[];
  unsupported: Array<{ raw: string; line?: number; reason: string }>;
}

export interface PixelInspectorDraft {
  componentPath: string;
  targetClasses: string[];
  replacementClasses: string[];
  /**
   * Frontend-only editing buffer (the raw class string the UI is editing).
   * Optional because the backend service intentionally ignores it; patches are
   * derived from targetClasses/replacementClasses.
   */
  rawClassName?: string;
  saveMode: PixelInspectorSaveMode;
  tokenSetId?: string;
  tokenName?: string;
  presetName?: string;
  variantDefinition?: string;
  variantAxis?: string;
  variantValue?: string;
}

export interface PixelInspectorPreviewRequest {
  draft: PixelInspectorDraft;
}

export interface PixelInspectorApplyRequest extends PixelInspectorPreviewRequest {
  createBackup?: boolean;
  recordOverrides?: boolean;
}

export interface PixelInspectorApplyResult {
  success: boolean;
  modified: string[];
  changes: number;
  backupId?: string;
  presetId?: string;
  errors?: Array<{ path: string; error: string }>;
}

// Keep variant builder types in sync with backend/src/types/index.ts.
export interface ParserDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  line?: number;
}

// `unsupported` is reserved for variant-like definitions that future transform workflows can surface.
export type VariantSystemKind = 'cva' | 'tv' | 'manual' | 'unsupported';

export interface VariantValue {
  name: string;
  classes: string[];
}

export interface VariantAxis {
  name: string;
  values: VariantValue[];
  defaultValue?: string;
}

export interface VariantDefinitionDetail {
  name: string;
  system: VariantSystemKind;
  line?: number;
  baseClasses: string[];
  axes: VariantAxis[];
  compoundVariants: Array<{
    conditions: Record<string, string>;
    classes: string[];
  }>;
  raw?: string;
  rawStart?: number;
  rawEnd?: number;
  diagnostics: ParserDiagnostic[];
}

export interface VariantComponentSummary {
  name: string;
  path: string;
  variantCount: number;
  systems: VariantSystemKind[];
  axes: string[];
}

export interface VariantComponentDetail extends VariantComponentSummary {
  definitions: VariantDefinitionDetail[];
  diagnostics: ParserDiagnostic[];
}

export type VariantPreviewOperation =
  | {
      type: 'add-axis';
      axis: VariantAxis;
      defaultValue?: string;
    }
  | {
      type: 'add-value';
      axisName: string;
      value: VariantValue;
    }
  | {
      type: 'set-default';
      axisName: string;
      valueName: string;
    };

export interface VariantGenerationPreview {
  componentPath: string;
  targetDefinition: string;
  operation: VariantPreviewOperation;
  // Full raw source before the preview operation, intended for preview/debug display.
  before: string;
  // Full raw source after the preview operation, intended for preview/debug display.
  after: string;
  diff: string;
  // Estimated positional changed-line count; insertions/deletions can shift later lines.
  changes: number;
}

export interface TemplateRule {
  find: string;
  replace: string;
  isRegex: boolean;
}

export interface Template {
  id: string;
  name: string;
  rules: TemplateRule[];
  created: string;
}

export interface Backup {
  id: string;
  timestamp: string;
  components: string[];
  size?: number;
}

export interface BackupListItem {
  id: string;
  timestamp: string;
  components: number;
  size?: number;
}

export interface WorkspaceConfig {
  componentDirectory: string;
  backupRetentionDays: number;
  maxBackups: number;
  autoBackup: boolean;
  validateAfterEdit: boolean;
  port: number;
}

export interface RegistrySource {
  id: string;
  name: string;
  type: 'shadcn-registry' | 'url-list' | 'local-folder' | 'npm-package';
  baseUrl?: string;
  registryJsonUrl?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RegistryHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface RegistrySourceHealth {
  sourceId: string;
  sourceName: string;
  sourceType: RegistrySource['type'];
  status: RegistryHealthStatus;
  checkedAt: string;
  issues: Array<{ code: string; message: string }>;
}

export interface RegistryItemSummary {
  id: string;
  name: string;
  type: string;
  sourceId: string;
  sourceName: string;
}

export interface WorkspaceManifest {
  version: number;
  createdAt: string;
  updatedAt: string;
  config: WorkspaceConfig;
  components: Array<{ id: string; name: string; path: string; lastScannedAt?: string }>;
  sources: RegistrySource[];
  packages: ComponentPackage[];
  tokenSets: DesignTokenSet[];
  componentTokenOverrides: Record<string, ComponentTokenOverride[]>;
  presets: Preset[];
  backups: Backup[];
}

export interface StudioSummary {
  _meta?: {
    errors: Array<{ label: string; message: string }>;
  };
  workspace: {
    cwd: string;
    backendUrl?: string;
    manifest: WorkspaceManifest;
  };
  components: {
    count: number;
    selectedCount?: number;
    inventory: ComponentLibraryInventoryItem[];
  };
  registries: {
    sources: RegistrySource[];
    health: RegistrySourceHealth[];
    items: RegistryItemSummary[];
    warnings: Array<{ sourceId: string; sourceName: string; message: string }>;
  };
  tokens: {
    tokenSets: DesignTokenSet[];
    frequency?: TokenFrequencyReport;
    inconsistencies?: TokenInconsistencyReport;
  };
  variants: {
    components: VariantComponentSummary[];
  };
  backups: {
    backups: BackupListItem[];
  };
  health: {
    status: string;
    timestamp?: string;
    version?: string;
  };
}

export interface PlannedFile {
  sourcePath: string;
  targetPath: string;
  content: string;
}

export interface ImportConflict {
  path: string;
  type: 'file-exists' | 'unsafe-path' | 'missing-content';
  message: string;
}

export type ImportConflictAction = 'overwrite' | 'skip' | 'rename' | 'fork';

export interface ImportConflictResolution {
  path: string;
  action: ImportConflictAction;
  targetPath?: string;
}

export interface ImportPlan {
  id: string;
  itemName: string;
  sourceId?: string;
  filesToAdd: PlannedFile[];
  filesToOverwrite: PlannedFile[];
  dependencies: string[];
  devDependencies: string[];
  registryDependencies: string[];
  aliasesNeeded: string[];
  conflicts: ImportConflict[];
}

export interface ApplyImportPlanResult {
  success: boolean;
  added: string[];
  overwritten: string[];
  skipped: string[];
  backupId?: string;
  rolledBack?: boolean;
}

export type BrailleLoaderUsage = 'terminal' | 'web';

export type BrailleLoaderReducedMotionMode = 'static-frame' | 'label-only';

export interface BrailleLoaderPreset {
  id: string;
  name: string;
  description: string;
  /** Animation frames; every glyph stays within the Unicode braille block. */
  frames: string[];
  /** Default frame interval in milliseconds. */
  intervalMs: number;
  /** Accessible label announced to screen readers while loading. */
  defaultLabel: string;
  /** Static glyph rendered when the user prefers reduced motion. */
  reducedMotionFrame: string;
  usage: BrailleLoaderUsage[];
  tags: string[];
}

export interface BrailleLoaderCustomization {
  presetId: string;
  /** PascalCase identifier for the generated component. */
  componentName?: string;
  intervalMs?: number;
  label?: string;
  /** Glyph font size in rem. */
  sizeRem?: number;
  /** CSS color value or design-token reference, e.g. `var(--primary)`. */
  color?: string;
  reducedMotionMode?: BrailleLoaderReducedMotionMode;
}

export interface BrailleLoaderGenerated {
  presetId: string;
  componentName: string;
  fileName: string;
  code: string;
  intervalMs: number;
  label: string;
  reducedMotionMode: BrailleLoaderReducedMotionMode;
}

export interface ApiError {
  message: string;
  code: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

// Screen navigation types
export type Screen =
  | 'components'
  | 'registries'
  | 'tokens'
  | 'variants'
  | 'motion'
  | 'pixel-inspector'
  | 'diff'
  | 'settings'
  | 'dashboard'
  | 'component-view'
  | 'editor'
  | 'preview'
  | 'templates'
  | 'backups'
  | 'help';
