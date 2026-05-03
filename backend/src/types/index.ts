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

export interface WorkspaceComponent {
  id: string;
  name: string;
  path: string;
  source?: ComponentSource;
  lastScannedAt?: string;
  metadata?: ComponentMetadata;
}

export interface ComponentPackage {
  id: string;
  name: string;
  type: 'component' | 'hook' | 'utility' | 'page' | 'registry-item';
  source?: ComponentSource;
  files: string[];
  dependencies: RegistryDependency[];
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

export interface DesignTokenSet {
  id: string;
  name: string;
  description?: string;
  tokens: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BackupMetadata {
  id: string;
  timestamp: string;
  components: string[];
  size: number;
}

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
  sources: ComponentSource[];
  packages: ComponentPackage[];
  tokenSets: DesignTokenSet[];
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
