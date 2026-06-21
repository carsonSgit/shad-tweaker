export interface ComponentMetadata {
  lines: number;
  size: number;
  lastModified: string;
  classCount?: number;
  exports?: string[];
}

export interface Component {
  name: string;
  path: string;
  content?: string;
  classes?: string[];
  metadata: ComponentMetadata;
}

export interface ScanResult {
  success: boolean;
  count: number;
  directory: string;
  components: Component[];
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

export interface EditRequest {
  componentPaths: string[];
  find: string;
  replace: string;
  isRegex: boolean;
}

export interface ApplyRequest extends EditRequest {
  createBackup?: boolean;
}

export interface BatchActionRequest {
  action: string;
  componentPaths: string[];
  options?: Record<string, string>;
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

export interface RegistrySourceIssue {
  code: string;
  message: string;
}

export interface RegistrySourceHealth {
  sourceId: string;
  sourceName: string;
  sourceType: RegistrySource['type'];
  status: RegistryHealthStatus;
  checkedAt: string;
  issues: RegistrySourceIssue[];
}

export interface RegistryReadWarning {
  sourceId: string;
  sourceName: string;
  message: string;
}

export interface RegistryItemSummary {
  id: string;
  name: string;
  type: ComponentPackage['type'];
  sourceId: string;
  sourceName: string;
}

export interface RegistrySourceListResult {
  items: RegistryItemSummary[];
  warnings: RegistryReadWarning[];
}

export interface WorkspaceComponent {
  id: string;
  name: string;
  path: string;
  source?: ComponentSource;
  lastScannedAt?: string;
  metadata?: ComponentMetadata;
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
  dependencies: RegistryDependency[];
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

export interface ComponentLibraryActionResult {
  success: true;
  component: ComponentLibraryDetail;
  previousPath?: string;
  newPath?: string;
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

export interface RegistryItemFile {
  path: string;
  content?: string;
  type?: string;
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

export interface ImportPlanRequest {
  itemName: string;
  sourceId?: string;
}

export interface ApplyImportPlanRequest {
  plan: ImportPlan;
  resolutions?: ImportConflictResolution[];
}

export interface ApplyImportPlanResult {
  success: boolean;
  added: string[];
  overwritten: string[];
  skipped: string[];
  backupId?: string;
  rolledBack?: boolean;
}

export type PrimitiveStarterProvider = 'blank' | 'radix' | 'base-ui';

export interface PrimitiveStarterTemplate {
  id: string;
  provider: PrimitiveStarterProvider;
  name: string;
  description: string;
  defaultComponentName: string;
  supportsParts: boolean;
  supportsCva: boolean;
}

export interface PrimitiveStarterGeneratedFile {
  path: string;
  content: string;
}

export interface PrimitiveStarterRequest {
  provider: PrimitiveStarterProvider;
  templateId?: string;
  componentName?: string;
  targetPath?: string;
  includeCva?: boolean;
  overwrite?: boolean;
}

export interface PrimitiveStarterResult {
  template: PrimitiveStarterTemplate;
  componentName: string;
  files: PrimitiveStarterGeneratedFile[];
  conflicts: string[];
}

export interface PrimitiveStarterApplyResult extends PrimitiveStarterResult {
  success: true;
  written: string[];
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

// Keep token system types in sync with frontend/src/types/index.ts.
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

export interface ComponentTokenOverride {
  componentPath: string;
  tokenSetId: string;
  overrides: Partial<Record<TokenCategory, Record<string, string>>>;
}

export interface DesignTokenSet {
  id: string;
  name: string;
  description?: string;
  tokens: DesignTokenMap;
  createdAt: string;
  updatedAt: string;
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
  /**
   * Deduplicated class names that matched a control group (i.e. the classified
   * candidates), not every class found in the source file.
   */
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
  /**
   * Per-path failures. Populated only by the `token-patch` save mode, which
   * delegates to applyTokenPatch; the plain component-patch path never sets it.
   */
  errors?: Array<{ path: string; error: string }>;
}

export interface TokenPatchPreviewResult {
  previews: Preview[];
  totalChanges: number;
}

export interface TokenPatchApplyResult {
  success: boolean;
  modified: string[];
  changes: number;
  partiallyApplied?: boolean;
  backupId?: string;
  errors?: Array<{ path: string; error: string }>;
}

export interface ParsedImport {
  moduleSpecifier: string;
  defaultImport?: string;
  namespaceImport?: string;
  namedImports: string[];
}

export interface ParsedExport {
  name: string;
  kind: 'function' | 'const' | 'class' | 'default' | 'named' | 're-export';
}

export interface ParsedComponent {
  name: string;
  declarationKind: 'function' | 'const' | 'class' | 'forwardRef' | 'memo';
  exported: boolean;
  line: number;
}

export interface ParsedJsxElement {
  tagName: string;
  line: number;
}

export interface ParsedClassNameAttribute {
  tagName: string;
  line: number;
  kind: 'string' | 'expression' | 'unsupported';
  raw: string;
  classes: string[];
}

export interface ParsedCnExpression {
  line: number;
  raw: string;
  stringLiterals: string[];
}

export interface ParsedVariantDefinition {
  name: string;
  callee: 'cva' | 'tv';
  line: number;
  baseClasses: string[];
  variants: Record<string, Record<string, string[]>>;
  defaultVariants: Record<string, string>;
  compoundVariants: Array<{
    conditions: Record<string, string>;
    classes: string[];
  }>;
  raw: string;
  rawStart: number;
  rawEnd: number;
}

export interface ParserDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  line?: number;
}

export interface ParsedComponentFile {
  path: string;
  language: 'tsx' | 'jsx';
  imports: ParsedImport[];
  exports: ParsedExport[];
  components: ParsedComponent[];
  jsxElements: ParsedJsxElement[];
  classNameAttributes: ParsedClassNameAttribute[];
  cnExpressions: ParsedCnExpression[];
  variantDefinitions: ParsedVariantDefinition[];
  diagnostics: ParserDiagnostic[];
}

export type BackupMetadata = Backup;

export interface WorkspaceConfig {
  componentDirectory: string;
  backupRetentionDays: number;
  maxBackups: number;
  autoBackup: boolean;
  validateAfterEdit: boolean;
  port: number;
}

export interface WorkspaceManifest {
  version: 1;
  createdAt: string;
  updatedAt: string;
  config: WorkspaceConfig;
  components: WorkspaceComponent[];
  sources: RegistrySource[];
  packages: ComponentPackage[];
  tokenSets: DesignTokenSet[];
  componentTokenOverrides: Record<string, ComponentTokenOverride[]>;
  presets: Preset[];
  backups: BackupMetadata[];
}

export interface Backup {
  id: string;
  timestamp: string;
  components: string[];
  size: number;
}

export interface BackupManifest {
  id: string;
  timestamp: string;
  files: Array<{
    originalPath: string;
    backupPath: string;
  }>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
  };
}

// Configuration for the application (stored in .shadcn-tweaker/config.json)
export interface Config {
  componentDirectory: string;
  backupRetentionDays: number;
  maxBackups: number;
  autoBackup: boolean;
  validateAfterEdit: boolean;
  port: number;
}
