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
  | 'dashboard'
  | 'components'
  | 'component-view'
  | 'editor'
  | 'preview'
  | 'templates'
  | 'backups'
  | 'help';
