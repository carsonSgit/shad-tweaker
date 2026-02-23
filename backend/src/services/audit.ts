import path from 'node:path';
import fs from 'fs-extra';

export type AuditEventType =
  | 'research.scan'
  | 'research.plan'
  | 'research.simulate'
  | 'research.apply';

export interface AuditEvent {
  eventType: AuditEventType;
  runId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

function getAuditFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.shadcn-tweaker', 'audit', 'events.ndjson');
}

export async function appendAuditEvent(
  projectRoot: string,
  eventType: AuditEventType,
  runId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const filePath = getAuditFilePath(projectRoot);
  await fs.ensureDir(path.dirname(filePath));

  const event: AuditEvent = {
    eventType,
    runId,
    timestamp: new Date().toISOString(),
    payload,
  };

  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
}
