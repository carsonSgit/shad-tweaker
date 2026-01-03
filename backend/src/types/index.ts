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
