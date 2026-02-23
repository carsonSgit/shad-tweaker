export interface ComponentMetadata {
  lines: number;
  size: number;
  lastModified: string;
  classCount?: number;
  exports?: string[];
  imports?: string[];
  confidence?: number;
  confidenceBand?: ConfidenceBand;
  kind?: ComponentKind;
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
    relativePath?: string;
    sha256?: string;
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

export type ConfidenceBand = 'high' | 'medium' | 'low';
export type ComponentKind = 'primitive' | 'wrapper' | 'composition' | 'unknown';
export type RiskLevel = 'low' | 'medium' | 'high' | 'blocked';
export type IssueSeverity = 'info' | 'warning' | 'error';

export interface ComponentRoot {
  path: string;
  confidence: number;
  reason: string;
}

export interface GraphNode {
  id: string;
  path: string;
  name: string;
  confidence: number;
  confidenceBand: ConfidenceBand;
  kind: ComponentKind;
  exports: string[];
  imports: string[];
  classUsageCount: number;
  lineCount: number;
  size: number;
  lastModified: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'import';
}

export interface ComponentGraph {
  runId: string;
  generatedAt: string;
  projectRoot: string;
  componentRoots: ComponentRoot[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: {
    filesIndexed: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  };
}

export interface CustomizationCandidate {
  ruleId: string;
  filePath: string;
  expectedMatches: number;
  confidenceBand: ConfidenceBand;
  risk: RiskLevel;
  rationale: string[];
}

export interface CustomizationCandidatesDocument {
  runId: string;
  generatedAt: string;
  goals: string[];
  candidates: CustomizationCandidate[];
  summary: {
    candidateCount: number;
    expectedTotalChanges: number;
  };
}

export interface SafetyIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  details?: Record<string, unknown>;
}

export interface SafetyReport {
  runId: string;
  generatedAt: string;
  pathSafety: {
    checkedPaths: number;
    violations: string[];
  };
  regexSafety: {
    checkedRules: number;
    rejectedRules: string[];
  };
  limits: {
    maxFiles: number;
    touchedFiles: number;
    exceeded: boolean;
  };
  blocked: boolean;
  issues: SafetyIssue[];
}

export interface PlanRule {
  ruleId: string;
  name: string;
  find: string;
  replace: string;
  isRegex: boolean;
}

export interface PlanTarget {
  filePath: string;
  ruleId: string;
  expectedMatches: number;
  confidenceBand: ConfidenceBand;
  risk: RiskLevel;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  reasons: string[];
}

export interface ResearchPlan {
  runId: string;
  createdAt: string;
  goals: string[];
  rules: PlanRule[];
  targets: PlanTarget[];
  totals: {
    touchedFiles: number;
    expectedChanges: number;
  };
  risk: RiskAssessment;
  requiresConfirmation: boolean;
  blocked: boolean;
  checksum: string;
}

export interface ValidationErrorDetail {
  index: number;
  field: string;
  code: string;
  message: string;
}

export interface ResearchRunSummary {
  runId: string;
  createdAt: string;
  artifacts: string[];
  plan: ResearchPlan;
  safetyReport: SafetyReport;
}
