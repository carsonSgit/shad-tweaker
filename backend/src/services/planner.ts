import crypto from 'node:crypto';
import fs from 'fs-extra';
import type {
  ComponentGraph,
  CustomizationCandidatesDocument,
  PlanRule,
  PlanTarget,
  ResearchPlan,
  RiskAssessment,
  RiskLevel,
} from '../types/index.js';
import { validateRegex } from '../utils/validation.js';

export interface PlannerRuleInput {
  name?: string;
  find: string;
  replace: string;
  isRegex: boolean;
}

export interface BuildPlanInput {
  runId: string;
  goals: string[];
  graph: ComponentGraph;
  customRules?: PlannerRuleInput[];
  maxFiles: number;
}

export interface BuildPlanOutput {
  plan: ResearchPlan;
  candidates: CustomizationCandidatesDocument;
  rejectedRules: string[];
}

const GOAL_PRESETS: Record<string, PlannerRuleInput[]> = {
  'radius-normalization': [
    {
      name: 'normalize radius to rounded-lg',
      find: 'rounded-md',
      replace: 'rounded-lg',
      isRegex: false,
    },
  ],
  'focus-ring-normalization': [
    {
      name: 'add focus-visible ring defaults',
      find: 'focus:outline-none',
      replace:
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      isRegex: false,
    },
  ],
  'remove-cursor-pointer': [
    {
      name: 'remove cursor-pointer class',
      find: '\\s*cursor-pointer',
      replace: '',
      isRegex: true,
    },
  ],
};

function normalizeRules(goals: string[], customRules: PlannerRuleInput[] = []): PlannerRuleInput[] {
  const normalized: PlannerRuleInput[] = [];
  for (const goal of goals) {
    const presetRules = GOAL_PRESETS[goal];
    if (!presetRules) {
      continue;
    }
    normalized.push(...presetRules);
  }
  normalized.push(...customRules);
  return normalized;
}

function createRuleId(rule: PlannerRuleInput): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${rule.find}::${rule.replace}::${rule.isRegex}`)
    .digest('hex')
    .slice(0, 10);
  return `rule_${hash}`;
}

type CompiledRule =
  | { mode: 'regex'; pattern: RegExp }
  | { mode: 'literal'; needle: string };

const SUPPORTED_REGEX_RULES: Record<string, RegExp> = {
  '\\s*cursor-pointer': /\s*cursor-pointer/g,
};

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

function compileRule(rule: PlannerRuleInput): { compiled: CompiledRule | null; error?: string } {
  if (rule.find.length === 0) {
    return { compiled: null, error: 'find value cannot be empty' };
  }

  if (rule.isRegex) {
    const validation = validateRegex(rule.find);
    if (!validation.valid) {
      return { compiled: null, error: validation.error || 'invalid regex' };
    }

    const supportedPattern = SUPPORTED_REGEX_RULES[rule.find];
    if (!supportedPattern) {
      return { compiled: null, error: 'unsupported regex pattern' };
    }

    return { compiled: { mode: 'regex', pattern: supportedPattern } };
  }

  return { compiled: { mode: 'literal', needle: rule.find } };
}

function targetRisk(matches: number, confidenceBand: 'high' | 'medium' | 'low'): RiskLevel {
  if (matches > 20 && confidenceBand === 'high') {
    return 'high';
  }
  if (matches > 5 || confidenceBand === 'high') {
    return 'medium';
  }
  return 'low';
}

function buildRiskAssessment(
  touchedFiles: number,
  targets: PlanTarget[],
  maxFiles: number,
  regexRuleCount: number
): RiskAssessment {
  const highConfidenceTargets = targets.filter((target) => target.confidenceBand === 'high').length;
  const highRiskTargets = targets.filter((target) => target.risk === 'high').length;
  const score = touchedFiles + highConfidenceTargets * 2 + highRiskTargets * 3 + regexRuleCount * 3;
  const reasons: string[] = [];

  if (touchedFiles > maxFiles) {
    reasons.push(`touched files ${touchedFiles} exceeds maxFiles ${maxFiles}`);
    return {
      level: 'blocked',
      score,
      reasons,
    };
  }

  if (highRiskTargets > 0 || touchedFiles > 50) {
    reasons.push('high blast radius across critical component files');
    return {
      level: 'high',
      score,
      reasons,
    };
  }

  if (score >= 30 || touchedFiles > 15) {
    reasons.push('moderate blast radius, preview recommended');
    return {
      level: 'medium',
      score,
      reasons,
    };
  }

  reasons.push('limited and low-risk scope');
  return {
    level: 'low',
    score,
    reasons,
  };
}

function createChecksum(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function buildResearchPlan(input: BuildPlanInput): Promise<BuildPlanOutput> {
  const normalizedRules = normalizeRules(input.goals, input.customRules || []);
  const rules: PlanRule[] = [];
  const targets: PlanTarget[] = [];
  const rejectedRules: string[] = [];
  const fileContentCache = new Map<string, string>();
  const seenRuleIds = new Set<string>();

  for (const candidateRule of normalizedRules) {
    const ruleId = createRuleId(candidateRule);
    if (seenRuleIds.has(ruleId)) {
      continue;
    }
    seenRuleIds.add(ruleId);

    const compiled = compileRule(candidateRule);
    if (!compiled.compiled) {
      rejectedRules.push(ruleId);
      continue;
    }

    rules.push({
      ruleId,
      name: candidateRule.name || ruleId,
      find: candidateRule.find,
      replace: candidateRule.replace,
      isRegex: candidateRule.isRegex,
    });

    for (const node of input.graph.nodes) {
      if (node.confidenceBand === 'low') {
        continue;
      }

      let fileContent = fileContentCache.get(node.path);
      if (!fileContent) {
        fileContent = await fs.readFile(node.path, 'utf-8');
        fileContentCache.set(node.path, fileContent);
      }

      let expectedMatches = 0;
      if (compiled.compiled.mode === 'regex') {
        const matches = fileContent.match(compiled.compiled.pattern);
        expectedMatches = matches ? matches.length : 0;
      } else {
        expectedMatches = countLiteralOccurrences(fileContent, compiled.compiled.needle);
      }
      if (expectedMatches === 0) {
        continue;
      }

      targets.push({
        filePath: node.path,
        ruleId,
        expectedMatches,
        confidenceBand: node.confidenceBand,
        risk: targetRisk(expectedMatches, node.confidenceBand),
      });
    }
  }

  const sortedTargets = targets.sort((a, b) => {
    const pathCompare = a.filePath.localeCompare(b.filePath);
    if (pathCompare !== 0) {
      return pathCompare;
    }
    return a.ruleId.localeCompare(b.ruleId);
  });

  const touchedFiles = new Set(sortedTargets.map((target) => target.filePath)).size;
  const expectedChanges = sortedTargets.reduce((sum, target) => sum + target.expectedMatches, 0);
  const regexRuleCount = rules.filter((rule) => rule.isRegex).length;
  const risk = buildRiskAssessment(touchedFiles, sortedTargets, input.maxFiles, regexRuleCount);
  const blocked = risk.level === 'blocked' || rules.length === 0;
  const requiresConfirmation = risk.level === 'high';
  const checksum = createChecksum({
    rules,
    targets: sortedTargets,
    maxFiles: input.maxFiles,
    goals: input.goals,
  });

  const plan: ResearchPlan = {
    runId: input.runId,
    createdAt: new Date().toISOString(),
    goals: input.goals,
    rules: rules.sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
    targets: sortedTargets,
    totals: {
      touchedFiles,
      expectedChanges,
    },
    risk,
    requiresConfirmation,
    blocked,
    checksum,
  };

  const candidates: CustomizationCandidatesDocument = {
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    goals: input.goals,
    candidates: sortedTargets.map((target) => ({
      ruleId: target.ruleId,
      filePath: target.filePath,
      expectedMatches: target.expectedMatches,
      confidenceBand: target.confidenceBand,
      risk: target.risk,
      rationale: [
        `matches for ${target.ruleId}: ${target.expectedMatches}`,
        `component confidence: ${target.confidenceBand}`,
      ],
    })),
    summary: {
      candidateCount: sortedTargets.length,
      expectedTotalChanges: expectedChanges,
    },
  };

  return {
    plan,
    candidates,
    rejectedRules,
  };
}
