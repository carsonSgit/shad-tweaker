import type { ResearchPlan, SafetyIssue, SafetyReport } from '../types/index.js';

export interface SafetyReportInput {
  runId: string;
  plan: ResearchPlan;
  maxFiles: number;
  pathViolations: string[];
  rejectedRules: string[];
}

export function buildSafetyReport(input: SafetyReportInput): SafetyReport {
  const issues: SafetyIssue[] = [];
  const exceeded = input.plan.totals.touchedFiles > input.maxFiles;

  if (input.pathViolations.length > 0) {
    issues.push({
      code: 'PATH_TRAVERSAL_BLOCKED',
      severity: 'error',
      message: `${input.pathViolations.length} path violations detected during discovery`,
      details: {
        paths: input.pathViolations,
      },
    });
  }

  if (input.rejectedRules.length > 0) {
    issues.push({
      code: 'RULES_REJECTED',
      severity: 'warning',
      message: `${input.rejectedRules.length} rules rejected by regex policy`,
      details: {
        ruleIds: input.rejectedRules,
      },
    });
  }

  if (input.plan.rules.length === 0) {
    issues.push({
      code: 'NO_VALID_RULES',
      severity: 'error',
      message: 'No valid rules remained after validation',
    });
  }

  if (exceeded) {
    issues.push({
      code: 'MAX_FILES_EXCEEDED',
      severity: 'error',
      message: `Plan touches ${input.plan.totals.touchedFiles} files, max allowed is ${input.maxFiles}`,
    });
  }

  if (input.plan.requiresConfirmation) {
    issues.push({
      code: 'HIGH_RISK_CONFIRMATION_REQUIRED',
      severity: 'warning',
      message: 'High-risk plan requires explicit confirmation before apply',
      details: {
        riskScore: input.plan.risk.score,
      },
    });
  }

  return {
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    pathSafety: {
      checkedPaths: input.plan.totals.touchedFiles,
      violations: input.pathViolations,
    },
    regexSafety: {
      checkedRules: input.plan.rules.length,
      rejectedRules: input.rejectedRules,
    },
    limits: {
      maxFiles: input.maxFiles,
      touchedFiles: input.plan.totals.touchedFiles,
      exceeded,
    },
    blocked:
      input.pathViolations.length > 0 ||
      exceeded ||
      input.plan.blocked ||
      input.plan.rules.length === 0,
    issues,
  };
}
