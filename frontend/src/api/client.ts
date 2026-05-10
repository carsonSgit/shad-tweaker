import type {
  ApiResponse,
  ApplyImportPlanResult,
  Backup,
  Component,
  ComponentDetail,
  ComponentTokenOverride,
  DesignTokenMap,
  DesignTokenSet,
  ComponentLibraryCompareResult,
  ComponentLibraryDetail,
  ComponentLibraryDuplicate,
  ComponentLibraryInventoryItem,
  ImportConflictResolution,
  ImportPlan,
  Preview,
  Template,
  TokenCandidate,
  TokenFrequencyReport,
  TokenInconsistencyReport,
  TokenPatchChange,
} from '../types/index.js';

// Get backend URL from environment variable (set by CLI wrapper)
// Falls back to localhost:3001 for development
const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Export for debugging/status display
export function getBackendUrl(): string {
  return BASE_URL;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = (await response.json()) as T & { error?: { message?: string; code?: string } };

    if (!response.ok) {
      const errorData = data as { error?: { message?: string; code?: string } };
      return {
        success: false,
        error: {
          message: errorData.error?.message || 'Request failed',
          code: errorData.error?.code || 'UNKNOWN_ERROR',
        },
      };
    }

    return { success: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    return {
      success: false,
      error: {
        message: `Backend unavailable: ${message}`,
        code: 'NETWORK_ERROR',
      },
    };
  }
}

// Component Management
export async function scanComponents(): Promise<
  ApiResponse<{ count: number; components: Component[] }>
> {
  return request('/api/components/scan');
}

export async function getComponents(): Promise<ApiResponse<{ components: Component[] }>> {
  return request('/api/components');
}

export async function getComponent(name: string): Promise<ApiResponse<ComponentDetail>> {
  return request(`/api/components/${encodeURIComponent(name)}`);
}

export async function getComponentLibraryInventory(): Promise<
  ApiResponse<{ components: ComponentLibraryInventoryItem[] }>
> {
  return request('/api/components/library/inventory');
}

export async function getComponentLibraryDetail(
  identifier: string
): Promise<ApiResponse<{ component: ComponentLibraryDetail }>> {
  return request(`/api/components/library/detail/${encodeURIComponent(identifier)}`);
}

export async function getComponentLibraryDuplicates(): Promise<
  ApiResponse<{ duplicates: ComponentLibraryDuplicate[] }>
> {
  return request('/api/components/library/duplicates');
}

export async function renameComponentLibraryItem(
  identifier: string,
  name: string
): Promise<ApiResponse<{ result: { newPath?: string } }>> {
  return request(`/api/components/library/${encodeURIComponent(identifier)}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function forkComponentLibraryItem(
  identifier: string,
  name: string
): Promise<ApiResponse<{ result: { newPath?: string } }>> {
  return request(`/api/components/library/${encodeURIComponent(identifier)}/fork`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function detachComponentLibraryItem(
  identifier: string
): Promise<ApiResponse<{ result: { previousPath?: string } }>> {
  return request(`/api/components/library/${encodeURIComponent(identifier)}/detach`, {
    method: 'POST',
  });
}

export async function resetComponentLibraryItem(
  identifier: string
): Promise<ApiResponse<{ result: { previousPath?: string } }>> {
  return request(`/api/components/library/${encodeURIComponent(identifier)}/reset`, {
    method: 'POST',
  });
}

export async function compareComponentLibraryItem(
  identifier: string
): Promise<ApiResponse<{ compare: ComponentLibraryCompareResult }>> {
  return request(`/api/components/library/${encodeURIComponent(identifier)}/compare`);
}

// Edit Operations
export async function previewEdit(
  componentPaths: string[],
  find: string,
  replace: string,
  isRegex = false
): Promise<ApiResponse<{ previews: Preview[] }>> {
  return request('/api/edit/preview', {
    method: 'POST',
    body: JSON.stringify({ componentPaths, find, replace, isRegex }),
  });
}

export async function applyEdit(
  componentPaths: string[],
  find: string,
  replace: string,
  isRegex = false
): Promise<ApiResponse<{ success: boolean; modified: string[]; backup: string }>> {
  return request('/api/edit/apply', {
    method: 'POST',
    body: JSON.stringify({ componentPaths, find, replace, isRegex }),
  });
}

export async function batchAction(
  action: string,
  componentPaths: string[]
): Promise<ApiResponse<{ success: boolean; modified: string[] }>> {
  return request('/api/edit/batch-action', {
    method: 'POST',
    body: JSON.stringify({ action, componentPaths }),
  });
}

// Template Management
export async function getTemplates(): Promise<ApiResponse<{ templates: Template[] }>> {
  return request('/api/templates');
}

export async function createTemplate(
  name: string,
  rules: Array<{ find: string; replace: string; isRegex?: boolean }>
): Promise<ApiResponse<{ success: boolean; template: Template }>> {
  return request('/api/templates', {
    method: 'POST',
    body: JSON.stringify({ name, rules }),
  });
}

export async function deleteTemplate(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return request(`/api/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function applyTemplate(
  id: string,
  componentPaths: string[]
): Promise<
  ApiResponse<{ success: boolean; modified: string[]; changes: number; backupId?: string }>
> {
  return request(`/api/templates/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
    body: JSON.stringify({ componentPaths }),
  });
}

// Backup Management
export async function createBackup(): Promise<
  ApiResponse<{ backupId: string; timestamp: string }>
> {
  return request('/api/backup/create', { method: 'POST' });
}

export async function restoreBackup(backupId: string): Promise<ApiResponse<{ success: boolean }>> {
  return request('/api/backup/restore', {
    method: 'POST',
    body: JSON.stringify({ backupId }),
  });
}

export async function listBackups(): Promise<ApiResponse<{ backups: Backup[] }>> {
  return request('/api/backup/list');
}

export interface BackupFilePreview {
  path: string;
  fileName: string;
  currentContent: string;
  backupContent: string;
}

export async function previewBackup(backupId: string): Promise<
  ApiResponse<{
    backupId: string;
    totalFiles: number;
    changedFiles: number;
    previews: BackupFilePreview[];
  }>
> {
  return request(`/api/backup/${encodeURIComponent(backupId)}/preview`);
}

// Import Planning
export async function generateImportPlan(
  itemName: string,
  sourceId?: string
): Promise<ApiResponse<{ plan: ImportPlan }>> {
  return request('/api/imports/plan', {
    method: 'POST',
    body: JSON.stringify({ itemName, sourceId }),
  });
}

export async function applyImportPlan(
  plan: ImportPlan,
  resolutions: ImportConflictResolution[] = []
): Promise<ApiResponse<{ result: ApplyImportPlanResult }>> {
  return request('/api/imports/apply', {
    method: 'POST',
    body: JSON.stringify({ plan, resolutions }),
  });
}

// Token System
export async function getTokenSets(): Promise<ApiResponse<{ tokenSets: DesignTokenSet[] }>> {
  return request('/api/tokens/sets');
}

export async function createTokenSet(input: {
  id?: string;
  name: string;
  description?: string;
  tokens?: DesignTokenMap;
}): Promise<ApiResponse<{ tokenSet: DesignTokenSet }>> {
  return request('/api/tokens/sets', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getTokenSet(id: string): Promise<ApiResponse<{ tokenSet: DesignTokenSet }>> {
  return request(`/api/tokens/sets/${encodeURIComponent(id)}`);
}

export async function updateTokenSet(
  id: string,
  input: { name: string; description?: string; tokens: DesignTokenMap }
): Promise<ApiResponse<{ tokenSet: DesignTokenSet }>> {
  return request(`/api/tokens/sets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteTokenSet(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return request(`/api/tokens/sets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function extractTokens(
  componentPaths?: string[]
): Promise<ApiResponse<{ candidates: TokenCandidate[] }>> {
  return request('/api/tokens/extract', {
    method: 'POST',
    body: JSON.stringify({ componentPaths }),
  });
}

export async function getTokenFrequencyReport(
  componentPath?: string
): Promise<ApiResponse<{ report: TokenFrequencyReport }>> {
  const query = componentPath ? `?componentPath=${encodeURIComponent(componentPath)}` : '';
  return request(`/api/tokens/reports/frequency${query}`);
}

export async function getTokenInconsistencyReport(
  componentPath?: string
): Promise<ApiResponse<{ report: TokenInconsistencyReport }>> {
  const query = componentPath ? `?componentPath=${encodeURIComponent(componentPath)}` : '';
  return request(`/api/tokens/reports/inconsistencies${query}`);
}

export async function previewTokenPatch(input: {
  tokenSetId: string;
  componentPaths: string[];
  changes: TokenPatchChange[];
}): Promise<ApiResponse<{ previews: Preview[]; totalChanges: number }>> {
  return request('/api/tokens/patch/preview', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function applyTokenPatch(input: {
  tokenSetId: string;
  componentPaths: string[];
  changes: TokenPatchChange[];
  createBackup?: boolean;
  recordOverrides?: boolean;
}): Promise<
  ApiResponse<{ success: boolean; modified: string[]; changes: number; backupId?: string }>
> {
  return request('/api/tokens/patch/apply', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getComponentTokenOverrides(
  componentPath: string
): Promise<ApiResponse<{ overrides: ComponentTokenOverride[] }>> {
  return request(`/api/tokens/components/${encodeURIComponent(componentPath)}/overrides`);
}

export async function putComponentTokenOverrides(
  componentPath: string,
  overrides: ComponentTokenOverride[]
): Promise<ApiResponse<{ overrides: ComponentTokenOverride[] }>> {
  return request(`/api/tokens/components/${encodeURIComponent(componentPath)}/overrides`, {
    method: 'PUT',
    body: JSON.stringify({ overrides }),
  });
}

// Health check
export async function healthCheck(): Promise<ApiResponse<{ status: string }>> {
  return request('/api/health');
}
