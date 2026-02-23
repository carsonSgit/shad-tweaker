import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import type { ComponentGraph, ResearchPlan, SafetyReport } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { isPathSafe, validateResearchRunId } from '../utils/validation.js';
import { appendAuditEvent } from './audit.js';
import { createBackup } from './backup.js';
import { createPreview } from './differ.js';
import { discoverComponentRoots } from './discovery.js';
import { buildComponentGraph } from './parser.js';
import type { PlannerRuleInput } from './planner.js';
import { buildResearchPlan } from './planner.js';
import { buildSafetyReport } from './risk.js';

interface DiscoveryArtifact {
  projectRoot: string;
  packageRoots: string[];
  componentRoots: Array<{ path: string; confidence: number; reason: string }>;
  ignoredDirectories: string[];
  pathViolations: string[];
}

interface SimulationPreview {
  path: string;
  changes: number;
  diff: string;
}

interface SimulationArtifact {
  runId: string;
  generatedAt: string;
  totalFiles: number;
  totalChanges: number;
  previews: SimulationPreview[];
}

interface ApplyArtifact {
  runId: string;
  appliedAt: string;
  backupId?: string;
  modifiedFiles: string[];
  totalChanges: number;
  riskLevel: string;
  blocked: boolean;
}

const RESEARCH_ROOT = path.join('.shadcn-tweaker', 'research', 'runs');
const SUMMARY_FILE = 'summary.md';
const ALLOWED_ARTIFACT_NAMES = new Set([
  'component_graph.json',
  'customization_candidates.json',
  'safety_report.json',
  'plan.json',
  'simulate.json',
  'apply.json',
  'discovery.json',
  SUMMARY_FILE,
]);
const SUPPORTED_RULE_REGEX_PATTERNS: Record<string, RegExp> = {
  '\\s*cursor-pointer': /\s*cursor-pointer/g,
};

function getWorkingDirectory(): string {
  return process.env.SHADCN_TWEAKER_CWD || process.cwd();
}

function createRunId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `run_${timestamp}_${suffix}`;
}

function countLiteralOccurrences(content: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let start = 0;
  while (start <= content.length - needle.length) {
    const index = content.indexOf(needle, start);
    if (index === -1) {
      break;
    }
    count += 1;
    start = index + needle.length;
  }
  return count;
}

function getResearchRoot(projectRoot: string): string {
  return path.resolve(projectRoot, RESEARCH_ROOT);
}

function assertValidRunId(runId: string): void {
  const validation = validateResearchRunId(runId);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid research run ID');
  }
}

function assertPathInsideBase(targetPath: string, basePath: string, label: string): string {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  if (!isPathSafe(resolvedTarget, resolvedBase)) {
    throw new Error(`${label} is outside the allowed directory`);
  }
  return resolvedTarget;
}

function assertProjectFilePath(projectRoot: string, targetPath: string): string {
  return assertPathInsideBase(targetPath, projectRoot, `File path ${targetPath}`);
}

function getRunDirectory(projectRoot: string, runId: string): string {
  assertValidRunId(runId);
  const researchRoot = getResearchRoot(projectRoot);
  const runPath = path.resolve(researchRoot, runId);
  return assertPathInsideBase(runPath, researchRoot, `Run path ${runId}`);
}

function getArtifactPath(projectRoot: string, runId: string, name: string): string {
  if (!ALLOWED_ARTIFACT_NAMES.has(name)) {
    throw new Error(`Artifact not allowed: ${name}`);
  }

  const runDir = getRunDirectory(projectRoot, runId);
  const artifactPath = path.resolve(runDir, name);
  return assertPathInsideBase(artifactPath, runDir, `Artifact path ${name}`);
}

async function writeArtifact(
  projectRoot: string,
  runId: string,
  name: string,
  payload: unknown
): Promise<void> {
  const artifactPath = getArtifactPath(projectRoot, runId, name);
  await fs.ensureDir(path.dirname(artifactPath));
  await fs.writeJson(artifactPath, payload, { spaces: 2 });
}

async function readArtifact<T>(projectRoot: string, runId: string, name: string): Promise<T> {
  const artifactPath = getArtifactPath(projectRoot, runId, name);
  return fs.readJson(artifactPath) as Promise<T>;
}

function buildSummaryMarkdown(
  plan: ResearchPlan,
  safety: SafetyReport,
  apply?: ApplyArtifact
): string {
  const lines: string[] = [];
  lines.push(`# SDRA Run ${plan.runId}`);
  lines.push('');
  lines.push(`- Created: ${plan.createdAt}`);
  lines.push(`- Risk: ${plan.risk.level} (score: ${plan.risk.score})`);
  lines.push(`- Touched files: ${plan.totals.touchedFiles}`);
  lines.push(`- Expected changes: ${plan.totals.expectedChanges}`);
  lines.push(`- Blocked: ${safety.blocked ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Safety Issues');

  if (safety.issues.length === 0) {
    lines.push('- none');
  } else {
    for (const issue of safety.issues) {
      lines.push(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
  }

  if (apply) {
    lines.push('');
    lines.push('## Apply Result');
    lines.push(`- Applied at: ${apply.appliedAt}`);
    lines.push(`- Modified files: ${apply.modifiedFiles.length}`);
    lines.push(`- Total changes: ${apply.totalChanges}`);
    lines.push(`- Backup ID: ${apply.backupId || 'none'}`);
  }

  return lines.join('\n');
}

function groupTargetsByFile(plan: ResearchPlan): Map<string, string[]> {
  const ruleOrder = new Map(plan.rules.map((rule, index) => [rule.ruleId, index]));
  const grouped = new Map<string, string[]>();

  for (const target of plan.targets) {
    const list = grouped.get(target.filePath) || [];
    list.push(target.ruleId);
    grouped.set(target.filePath, list);
  }

  for (const [filePath, ruleIds] of grouped.entries()) {
    grouped.set(
      filePath,
      Array.from(new Set(ruleIds)).sort((a, b) => (ruleOrder.get(a) || 0) - (ruleOrder.get(b) || 0))
    );
  }

  return grouped;
}

type CompiledRulePattern =
  | { mode: 'regex'; pattern: RegExp }
  | { mode: 'literal'; needle: string };

function compileRulePattern(rule: { find: string; isRegex: boolean }): CompiledRulePattern {
  if (!rule.isRegex) {
    return { mode: 'literal', needle: rule.find };
  }

  const supportedPattern = SUPPORTED_RULE_REGEX_PATTERNS[rule.find];
  if (!supportedPattern) {
    throw new Error(`Unsupported regex pattern in plan: ${rule.find}`);
  }

  return { mode: 'regex', pattern: supportedPattern };
}

function applyRule(
  content: string,
  compiled: CompiledRulePattern,
  replace: string
): { nextContent: string; matchCount: number } {
  if (compiled.mode === 'regex') {
    const matches = content.match(compiled.pattern);
    const matchCount = matches ? matches.length : 0;
    if (matchCount === 0) {
      return { nextContent: content, matchCount: 0 };
    }

    return {
      nextContent: content.replace(compiled.pattern, replace),
      matchCount,
    };
  }

  const matchCount = countLiteralOccurrences(content, compiled.needle);
  if (matchCount === 0) {
    return { nextContent: content, matchCount: 0 };
  }

  return {
    nextContent: content.split(compiled.needle).join(replace),
    matchCount,
  };
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadcn-tweaker-research-'));
  const tempPath = path.join(tempDir, 'pending-write.tmp');
  try {
    await fs.writeFile(tempPath, content, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    await fs.move(tempPath, filePath, { overwrite: true });
  } finally {
    await fs.remove(tempDir);
  }
}

async function ensureRunExists(projectRoot: string, runId: string): Promise<void> {
  const runDir = getRunDirectory(projectRoot, runId);
  if (!(await fs.pathExists(runDir))) {
    throw new Error(`Research run not found: ${runId}`);
  }
}

export interface ScanResearchRequest {
  explicitPaths?: string[];
}

export interface ScanResearchResponse {
  runId: string;
  componentGraph: ComponentGraph;
}

export async function scanResearch(
  request: ScanResearchRequest = {}
): Promise<ScanResearchResponse> {
  const projectRoot = getWorkingDirectory();
  const runId = createRunId();
  const discovery = await discoverComponentRoots(projectRoot, request.explicitPaths || []);
  const graph = await buildComponentGraph(runId, projectRoot, discovery.componentRoots);
  const discoveryArtifact: DiscoveryArtifact = {
    projectRoot: discovery.projectRoot,
    packageRoots: discovery.packageRoots,
    componentRoots: discovery.componentRoots,
    ignoredDirectories: discovery.ignoredDirectories,
    pathViolations: discovery.pathViolations,
  };

  await writeArtifact(projectRoot, runId, 'discovery.json', discoveryArtifact);
  await writeArtifact(projectRoot, runId, 'component_graph.json', graph);
  await appendAuditEvent(projectRoot, 'research.scan', runId, {
    filesIndexed: graph.summary.filesIndexed,
    componentRoots: graph.componentRoots.length,
  });

  return {
    runId,
    componentGraph: graph,
  };
}

export interface PlanResearchRequest {
  runId?: string;
  goals: string[];
  customRules?: PlannerRuleInput[];
  maxFiles?: number;
  explicitPaths?: string[];
}

export async function planResearch(request: PlanResearchRequest): Promise<{
  runId: string;
  plan: ResearchPlan;
  safetyReport: SafetyReport;
}> {
  const projectRoot = getWorkingDirectory();
  const maxFiles = request.maxFiles || 200;
  let runId = request.runId;

  if (!runId) {
    const scanResult = await scanResearch({ explicitPaths: request.explicitPaths });
    runId = scanResult.runId;
  } else {
    await ensureRunExists(projectRoot, runId);
  }

  const graph = await readArtifact<ComponentGraph>(projectRoot, runId, 'component_graph.json');
  const discovery = await readArtifact<DiscoveryArtifact>(projectRoot, runId, 'discovery.json');
  if (graph.runId !== runId) {
    throw new Error('Research run metadata mismatch');
  }

  const canonicalRunId = graph.runId;
  const planResult = await buildResearchPlan({
    runId: canonicalRunId,
    goals: request.goals,
    graph,
    customRules: request.customRules,
    maxFiles,
  });
  const safetyReport = buildSafetyReport({
    runId: canonicalRunId,
    plan: planResult.plan,
    maxFiles,
    pathViolations: discovery.pathViolations,
    rejectedRules: planResult.rejectedRules,
  });

  await writeArtifact(projectRoot, canonicalRunId, 'customization_candidates.json', planResult.candidates);
  await writeArtifact(projectRoot, canonicalRunId, 'plan.json', planResult.plan);
  await writeArtifact(projectRoot, canonicalRunId, 'safety_report.json', safetyReport);
  await fs.writeFile(
    getArtifactPath(projectRoot, canonicalRunId, SUMMARY_FILE),
    buildSummaryMarkdown(planResult.plan, safetyReport),
    'utf-8'
  );
  await appendAuditEvent(projectRoot, 'research.plan', canonicalRunId, {
    touchedFiles: planResult.plan.totals.touchedFiles,
    blocked: safetyReport.blocked,
  });

  return {
    runId: canonicalRunId,
    plan: planResult.plan,
    safetyReport,
  };
}

export async function simulateResearch(runId: string): Promise<SimulationArtifact> {
  const projectRoot = getWorkingDirectory();
  await ensureRunExists(projectRoot, runId);
  const plan = await readArtifact<ResearchPlan>(projectRoot, runId, 'plan.json');
  const groupedTargets = groupTargetsByFile(plan);
  const ruleMap = new Map(plan.rules.map((rule) => [rule.ruleId, rule]));
  const previews: SimulationPreview[] = [];
  let totalChanges = 0;

  for (const [filePath, ruleIds] of groupedTargets.entries()) {
    const safeFilePath = assertProjectFilePath(projectRoot, filePath);
    const original = await fs.readFile(safeFilePath, 'utf-8');
    let nextContent = original;
    let fileChanges = 0;

    for (const ruleId of ruleIds) {
      const rule = ruleMap.get(ruleId);
      if (!rule) {
        continue;
      }
      const pattern = compileRulePattern(rule);
      const result = applyRule(nextContent, pattern, rule.replace);
      const matchCount = result.matchCount;
      if (matchCount === 0) {
        continue;
      }

      nextContent = result.nextContent;
      fileChanges += matchCount;
    }

    if (fileChanges > 0) {
      const diffPreview = createPreview(safeFilePath, original, nextContent);
      previews.push({
        path: safeFilePath,
        changes: fileChanges,
        diff: diffPreview.diff,
      });
      totalChanges += fileChanges;
    }
  }

  const simulation: SimulationArtifact = {
    runId: plan.runId,
    generatedAt: new Date().toISOString(),
    totalFiles: previews.length,
    totalChanges,
    previews,
  };

  await writeArtifact(projectRoot, plan.runId, 'simulate.json', simulation);
  await appendAuditEvent(projectRoot, 'research.simulate', plan.runId, {
    totalFiles: simulation.totalFiles,
    totalChanges: simulation.totalChanges,
  });

  return simulation;
}

export interface ApplyResearchRequest {
  runId: string;
  confirmHighRisk?: boolean;
  expectedChecksum?: string;
}

export async function applyResearch(request: ApplyResearchRequest): Promise<ApplyArtifact> {
  const projectRoot = getWorkingDirectory();
  const runId = request.runId;
  await ensureRunExists(projectRoot, runId);

  const plan = await readArtifact<ResearchPlan>(projectRoot, runId, 'plan.json');
  const safety = await readArtifact<SafetyReport>(projectRoot, runId, 'safety_report.json');
  if (request.expectedChecksum && request.expectedChecksum !== plan.checksum) {
    throw new Error('Plan checksum mismatch. Re-run planning before apply.');
  }

  if (safety.blocked || plan.blocked) {
    const artifact: ApplyArtifact = {
      runId: plan.runId,
      appliedAt: new Date().toISOString(),
      modifiedFiles: [],
      totalChanges: 0,
      riskLevel: 'blocked',
      blocked: true,
    };
    await writeArtifact(projectRoot, plan.runId, 'apply.json', artifact);
    await fs.writeFile(
      getArtifactPath(projectRoot, plan.runId, SUMMARY_FILE),
      buildSummaryMarkdown(plan, safety, artifact),
      'utf-8'
    );
    return artifact;
  }

  if (plan.requiresConfirmation && !request.confirmHighRisk) {
    throw new Error('High-risk plan requires explicit confirmation');
  }

  const groupedTargets = groupTargetsByFile(plan);
  const files = Array.from(groupedTargets.keys()).sort();
  const safeFiles = files.map((filePath) => assertProjectFilePath(projectRoot, filePath));
  const ruleMap = new Map(plan.rules.map((rule) => [rule.ruleId, rule]));
  const modifiedFiles: string[] = [];
  let totalChanges = 0;
  let backupId: string | undefined;

  if (safeFiles.length > 0) {
    const backup = await createBackup(safeFiles);
    backupId = backup.id;
  }

  for (const filePath of files) {
    const safeFilePath = assertProjectFilePath(projectRoot, filePath);
    const ruleIds = groupedTargets.get(filePath) || [];
    const original = await fs.readFile(safeFilePath, 'utf-8');
    let nextContent = original;
    let fileChanges = 0;

    for (const ruleId of ruleIds) {
      const rule = ruleMap.get(ruleId);
      if (!rule) {
        continue;
      }
      const pattern = compileRulePattern(rule);
      const result = applyRule(nextContent, pattern, rule.replace);
      const matchCount = result.matchCount;
      if (matchCount === 0) {
        continue;
      }
      nextContent = result.nextContent;
      fileChanges += matchCount;
    }

    if (fileChanges > 0 && nextContent !== original) {
      await writeFileAtomically(safeFilePath, nextContent);
      modifiedFiles.push(safeFilePath);
      totalChanges += fileChanges;
    }
  }

  const artifact: ApplyArtifact = {
    runId: plan.runId,
    appliedAt: new Date().toISOString(),
    backupId,
    modifiedFiles,
    totalChanges,
    riskLevel: plan.risk.level,
    blocked: false,
  };

  await writeArtifact(projectRoot, plan.runId, 'apply.json', artifact);
  await fs.writeFile(
    getArtifactPath(projectRoot, plan.runId, SUMMARY_FILE),
    buildSummaryMarkdown(plan, safety, artifact),
    'utf-8'
  );
  await appendAuditEvent(projectRoot, 'research.apply', plan.runId, {
    modifiedFiles: modifiedFiles.length,
    totalChanges,
  });

  return artifact;
}

export async function getResearchReport(
  runId: string,
  format: 'json' | 'md' = 'json'
): Promise<unknown> {
  const projectRoot = getWorkingDirectory();
  await ensureRunExists(projectRoot, runId);

  if (format === 'md') {
    const summaryPath = getArtifactPath(projectRoot, runId, SUMMARY_FILE);
    return fs.readFile(summaryPath, 'utf-8');
  }

  const plan = await readArtifact<ResearchPlan>(projectRoot, runId, 'plan.json');
  const safetyReport = await readArtifact<SafetyReport>(projectRoot, runId, 'safety_report.json');
  let simulation: SimulationArtifact | null = null;
  let applyResult: ApplyArtifact | null = null;

  try {
    simulation = await readArtifact<SimulationArtifact>(projectRoot, runId, 'simulate.json');
  } catch (_error) {
    simulation = null;
  }

  try {
    applyResult = await readArtifact<ApplyArtifact>(projectRoot, runId, 'apply.json');
  } catch (_error) {
    applyResult = null;
  }

  return {
    runId: plan.runId,
    plan,
    safetyReport,
    simulation,
    applyResult,
  };
}

export async function getResearchArtifact(runId: string, name: string): Promise<unknown> {
  const projectRoot = getWorkingDirectory();
  await ensureRunExists(projectRoot, runId);

  return readArtifact(projectRoot, runId, name);
}

export async function listResearchRuns(): Promise<string[]> {
  const projectRoot = getWorkingDirectory();
  const rootPath = path.join(projectRoot, RESEARCH_ROOT);
  if (!(await fs.pathExists(rootPath))) {
    return [];
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function logResearchError(scope: string, error: unknown): void {
  logger.error(`Research operation failed: ${scope}`, error);
}
