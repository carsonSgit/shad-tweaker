import type {
  ApiResponse,
  Component,
  ComponentDetail,
  Preview,
  Template,
  Backup,
} from '../types/index.js';

// Get backend URL from environment variable (set by CLI wrapper)
// Falls back to localhost:3001 for development
const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Export for debugging/status display
export function getBackendUrl(): string {
  return BASE_URL;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
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

export async function getComponents(): Promise<
  ApiResponse<{ components: Component[] }>
> {
  return request('/api/components');
}

export async function getComponent(
  name: string
): Promise<ApiResponse<ComponentDetail>> {
  return request(`/api/components/${encodeURIComponent(name)}`);
}

// Edit Operations
export async function previewEdit(
  componentPaths: string[],
  find: string,
  replace: string,
  isRegex: boolean = false
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
  isRegex: boolean = false
): Promise<
  ApiResponse<{ success: boolean; modified: string[]; backup: string }>
> {
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
export async function getTemplates(): Promise<
  ApiResponse<{ templates: Template[] }>
> {
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

export async function deleteTemplate(
  id: string
): Promise<ApiResponse<{ success: boolean }>> {
  return request(`/api/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function applyTemplate(
  id: string,
  componentPaths: string[]
): Promise<ApiResponse<{ success: boolean; modified: string[]; changes: number; backupId?: string }>> {
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

export async function restoreBackup(
  backupId: string
): Promise<ApiResponse<{ success: boolean }>> {
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

export async function previewBackup(
  backupId: string
): Promise<ApiResponse<{ backupId: string; totalFiles: number; changedFiles: number; previews: BackupFilePreview[] }>> {
  return request(`/api/backup/${encodeURIComponent(backupId)}/preview`);
}

// Health check
export async function healthCheck(): Promise<ApiResponse<{ status: string }>> {
  return request('/api/health');
}
