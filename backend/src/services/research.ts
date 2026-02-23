import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import type {
  ComponentGraph,
  ResearchPlan,
  SafetyReport,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { escapeRegExpLiteral } from '../utils/validation.js';
import { appendAuditEvent } from './audit.js';
import { createBackup } from './backup.js';
import { createPreview } from './differ.js';
import { discoverComponentRoots } from './discovery.js';
import { buildComponentGraph } from './parser.js';
import { buildResearchPlan } from './planner.js';
import type { PlannerRuleInput } from './planner.js';
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

function getWorkingDirectory(): string {
  return process.env.SHADCN_TWEAKER_CWD || process.cwd();
}

function createRunId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `run_${timestamp}_${suffix}`;
}

function getRunDirectory(projectRoot: string, runId: string): string {
  return path.join(projectRoot, RESEARCH_ROOT, runId);
}

function getArtifactPath(projectRoot: string, runId: string, name: string): string {
  return path.join(getRunDirectory(projectRoot, runId), name);
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

function buildSummaryMarkdown(plan: ResearchPlan, safety: SafetyReport, apply?: ApplyArtifact): string {
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

function compileRulePattern(rule: { find: string; isRegex: boolean }): RegExp {
  if (rule.isRegex) {
    return new RegExp(rule.find, 'g');
  }
  return new RegExp(escapeRegExpLiteral(rule.find), 'g');
}

function generateTempFileName(originalPath: string): string {
  const uuid = crypto.randomUUID();
  const baseName = path.basename(originalPath);
  return path.join(os.tmpdir(), `shadcn-tweaker-research-${uuid}-${baseName}`);
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

export async function scanResearch(request: ScanResearchRequest = {}): Promise<ScanResearchResponse> {
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
  const planResult = await buildResearchPlan({
    runId,
    goals: request.goals,
    graph,
    customRules: request.customRules,
    maxFiles,
  });
  const safetyReport = buildSafetyReport({
    runId,
    plan: planResult.plan,
    maxFiles,
    pathViolations: discovery.pathViolations,
    rejectedRules: planResult.rejectedRules,
  });

  await writeArtifact(projectRoot, runId, 'customization_candidates.json', planResult.candidates);
  await writeArtifact(projectRoot, runId, 'plan.json', planResult.plan);
  await writeArtifact(projectRoot, runId, 'safety_report.json', safetyReport);
  await fs.writeFile(
    getArtifactPath(projectRoot, runId, SUMMARY_FILE),
    buildSummaryMarkdown(planResult.plan, safetyReport),
    'utf-8'
  );
  await appendAuditEvent(projectRoot, 'research.plan', runId, {
    goals: request.goals,
    touchedFiles: planResult.plan.totals.touchedFiles,
    blocked: safetyReport.blocked,
  });

  return {
    runId,
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
    const original = await fs.readFile(filePath, 'utf-8');
    let nextContent = original;
    let fileChanges = 0;

    for (const ruleId of ruleIds) {
      const rule = ruleMap.get(ruleId);
      if (!rule) {
        continue;
      }
      const pattern = compileRulePattern(rule);
      const matches = nextContent.match(pattern);
      const matchCount = matches ? matches.length : 0;
      if (matchCount === 0) {
        continue;
      }

      nextContent = nextContent.replace(pattern, rule.replace);
      fileChanges += matchCount;
    }

    if (fileChanges > 0) {
      const diffPreview = createPreview(filePath, original, nextContent);
      previews.push({
        path: filePath,
        changes: fileChanges,
        diff: diffPreview.diff,
      });
      totalChanges += fileChanges;
    }
  }

  const simulation: SimulationArtifact = {
    runId,
    generatedAt: new Date().toISOString(),
    totalFiles: previews.length,
    totalChanges,
    previews,
  };

  await writeArtifact(projectRoot, runId, 'simulate.json', simulation);
  await appendAuditEvent(projectRoot, 'research.simulate', runId, {
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
      runId,
      appliedAt: new Date().toISOString(),
      modifiedFiles: [],
      totalChanges: 0,
      riskLevel: 'blocked',
      blocked: true,
    };
    await writeArtifact(projectRoot, runId, 'apply.json', artifact);
    await fs.writeFile(
      getArtifactPath(projectRoot, runId, SUMMARY_FILE),
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
  const ruleMap = new Map(plan.rules.map((rule) => [rule.ruleId, rule]));
  const modifiedFiles: string[] = [];
  let totalChanges = 0;
  let backupId: string | undefined;

  if (files.length > 0) {
    const backup = await createBackup(files);
    backupId = backup.id;
  }

  for (const filePath of files) {
    const ruleIds = groupedTargets.get(filePath) || [];
    const original = await fs.readFile(filePath, 'utf-8');
    let nextContent = original;
    let fileChanges = 0;

    for (const ruleId of ruleIds) {
      const rule = ruleMap.get(ruleId);
      if (!rule) {
        continue;
      }
      const pattern = compileRulePattern(rule);
      const matches = nextContent.match(pattern);
      const matchCount = matches ? matches.length : 0;
      if (matchCount === 0) {
        continue;
      }
      nextContent = nextContent.replace(pattern, rule.replace);
      fileChanges += matchCount;
    }

    if (fileChanges > 0 && nextContent !== original) {
      const tempPath = generateTempFileName(filePath);
      await fs.writeFile(tempPath, nextContent, 'utf-8');
      await fs.move(tempPath, filePath, { overwrite: true });
      modifiedFiles.push(filePath);
      totalChanges += fileChanges;
    }
  }

  const artifact: ApplyArtifact = {
    runId,
    appliedAt: new Date().toISOString(),
    backupId,
    modifiedFiles,
    totalChanges,
    riskLevel: plan.risk.level,
    blocked: false,
  };

  await writeArtifact(projectRoot, runId, 'apply.json', artifact);
  await fs.writeFile(
    getArtifactPath(projectRoot, runId, SUMMARY_FILE),
    buildSummaryMarkdown(plan, safety, artifact),
    'utf-8'
  );
  await appendAuditEvent(projectRoot, 'research.apply', runId, {
    modifiedFiles: modifiedFiles.length,
    totalChanges,
    backupId: backupId || null,
  });

  return artifact;
}

export async function getResearchReport(runId: string, format: 'json' | 'md' = 'json'): Promise<unknown> {
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
    runId,
    plan,
    safetyReport,
    simulation,
    applyResult,
  };
}

export async function getResearchArtifact(runId: string, name: string): Promise<unknown> {
  const projectRoot = getWorkingDirectory();
  await ensureRunExists(projectRoot, runId);

  const allowed = new Set([
    'component_graph.json',
    'customization_candidates.json',
    'safety_report.json',
    'plan.json',
    'simulate.json',
    'apply.json',
    'discovery.json',
  ]);
  if (!allowed.has(name)) {
    throw new Error(`Artifact not allowed: ${name}`);
  }

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
