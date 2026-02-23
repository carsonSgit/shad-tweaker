import path from 'node:path';
import fs from 'fs-extra';
import { validateResearchRunId } from '../utils/validation.js';

export type AuditEventType =
  | 'research.scan'
  | 'research.plan'
  | 'research.simulate'
  | 'research.apply';

export interface AuditEvent {
  eventType: AuditEventType;
  runId: string;
  timestamp: string;
  payload: Record<string, number | boolean | null>;
}

function getAuditFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.shadcn-tweaker', 'audit', 'events.ndjson');
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, number | boolean | null> {
  const sanitized: Record<string, number | boolean | null> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'boolean') {
      sanitized[key] = value;
      continue;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      sanitized[key] = value;
      continue;
    }

    if (value === null) {
      sanitized[key] = null;
    }
  }

  return sanitized;
}

export async function appendAuditEvent(
  projectRoot: string,
  eventType: AuditEventType,
  runId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const validation = validateResearchRunId(runId);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid run ID');
  }

  const filePath = getAuditFilePath(projectRoot);
  await fs.ensureDir(path.dirname(filePath));

  const event: AuditEvent = {
    eventType,
    runId,
    timestamp: new Date().toISOString(),
    payload: sanitizePayload(payload),
  };

  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
}
