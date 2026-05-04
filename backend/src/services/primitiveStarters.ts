import path from 'node:path';
import fs from 'fs-extra';
import type {
  PrimitiveStarterGeneratedFile,
  PrimitiveStarterProvider,
  PrimitiveStarterRequest,
  PrimitiveStarterResult,
  PrimitiveStarterTemplate,
} from '../types/index.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';
import { loadWorkspaceManifest } from './workspace.js';

export const PRIMITIVE_STARTER_TEMPLATES: PrimitiveStarterTemplate[] = [
  {
    id: 'blank-component',
    provider: 'blank',
    name: 'Blank component',
    description: 'A minimal wrapper component with cn-ready className merging.',
    defaultComponentName: 'PrimitiveWrapper',
    supportsParts: false,
    supportsCva: true,
  },
  {
    id: 'radix-dialog',
    provider: 'radix',
    name: 'Radix Dialog',
    description: 'A multi-part dialog wrapper around @radix-ui/react-dialog primitives.',
    defaultComponentName: 'Dialog',
    supportsParts: true,
    supportsCva: true,
  },
  {
    id: 'base-ui-dialog',
    provider: 'base-ui',
    name: 'Base UI Dialog',
    description: 'A multi-part dialog wrapper around @base-ui-components/react/dialog primitives.',
    defaultComponentName: 'Dialog',
    supportsParts: true,
    supportsCva: true,
  },
];

export function listPrimitiveStarterTemplates(): PrimitiveStarterTemplate[] {
  return PRIMITIVE_STARTER_TEMPLATES;
}

export function findPrimitiveStarterTemplate(
  provider: PrimitiveStarterProvider,
  templateId?: string
): PrimitiveStarterTemplate | null {
  const templates = PRIMITIVE_STARTER_TEMPLATES.filter(
    (template) => template.provider === provider
  );

  if (templateId) {
    return templates.find((template) => template.id === templateId) ?? null;
  }

  return templates[0] ?? null;
}

function toPascalCase(value: string): string {
  return value
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function toKebabCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-');
}

function normalizeComponentName(value: string | undefined, fallback: string): string | null {
  const name = toPascalCase(value ?? fallback);
  if (!name || !/^[A-Z][a-zA-Z0-9]*$/.test(name)) return null;
  return name;
}

function resolveTargetPath(
  cwd: string,
  componentDirectory: string,
  componentName: string,
  targetPath?: string
): string | null {
  const relativePath = targetPath ?? `${toKebabCase(componentName)}.tsx`;
  if (!relativePath || !isSafeProjectRelativePath(relativePath)) return null;

  return path.resolve(cwd, componentDirectory, relativePath);
}

function blankStarterContent(componentName: string): string {
  return `import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ${componentName}Props extends React.HTMLAttributes<HTMLDivElement> {}

export function ${componentName}({ className, ...props }: ${componentName}Props) {
  return (
    <div
      data-slot="${toKebabCase(componentName)}"
      className={cn('rounded-md border bg-background p-4 text-foreground shadow-sm', className)}
      {...props}
    />
  );
}
`;
}

function generateFiles(
  template: PrimitiveStarterTemplate,
  componentName: string,
  targetPath: string
): PrimitiveStarterGeneratedFile[] {
  if (template.provider !== 'blank') {
    throw new Error(`Unsupported primitive starter provider: ${template.provider}`);
  }

  return [
    {
      path: targetPath,
      content: blankStarterContent(componentName),
    },
  ];
}

export async function generatePrimitiveStarter(
  request: PrimitiveStarterRequest,
  cwd: string
): Promise<PrimitiveStarterResult> {
  const template = findPrimitiveStarterTemplate(request.provider, request.templateId);
  if (!template) {
    throw new Error('Primitive starter template not found.');
  }

  const manifest = await loadWorkspaceManifest(cwd);
  const componentName = normalizeComponentName(
    request.componentName,
    template.defaultComponentName
  );
  if (!componentName) {
    throw new Error('componentName must produce a valid PascalCase component name.');
  }

  const targetPath = resolveTargetPath(
    cwd,
    manifest.config.componentDirectory,
    componentName,
    request.targetPath
  );
  if (!targetPath) {
    throw new Error('targetPath must be a safe project-relative path.');
  }

  const files = generateFiles(template, componentName, targetPath);
  const conflicts: string[] = [];

  for (const file of files) {
    if (await fs.pathExists(file.path)) {
      conflicts.push(file.path);
    }
  }

  return {
    template,
    componentName,
    files,
    conflicts,
  };
}
