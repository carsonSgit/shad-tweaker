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
  lastModified: string;
  dependencyStatus: ComponentDependencyStatus;
  tokenUsage: string[];
  filePath: string;
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
