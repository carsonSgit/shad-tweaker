import path from 'node:path';
import fs from 'fs-extra';
import type {
  RegistryGenerateResult,
  RegistryIndexJson,
  RegistryItemJson,
  RegistryValidationResult,
} from '../types/index.js';
import { parseComponentSource } from './parser.js';
import { scanComponents } from './scanner.js';
import { getWorkingDirectory } from './workspace.js';

export class RegistryPublishValidationError extends Error {
  readonly code = 'REGISTRY_PUBLISH_VALIDATION_ERROR';
}

const REGISTRY_SCHEMA = 'https://ui.shadcn.com/schema/registry.json';
const REGISTRY_ITEM_SCHEMA = 'https://ui.shadcn.com/schema/registry-item.json';
const REGISTRY_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/** Package specifiers that ship with every React project and are never item dependencies. */
const IMPLICIT_DEPENDENCIES = new Set(['react', 'react-dom', 'react/jsx-runtime']);

export function getRegistryOutputDir(cwd: string = getWorkingDirectory()): string {
  return path.join(cwd, '.shadcn-tweaker', 'registry');
}

function titleCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function packageName(moduleSpecifier: string): string {
  const parts = moduleSpecifier.split('/');
  return moduleSpecifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Builds a shadcn-compatible registry item for one component file, deriving
 * npm dependencies and local registry dependencies from its imports.
 */
export function buildRegistryItem(input: {
  name: string;
  content: string;
  knownComponentNames: Set<string>;
}): RegistryItemJson {
  const parsed = parseComponentSource(`${input.name}.tsx`, input.content);
  const dependencies = new Set<string>();
  const registryDependencies = new Set<string>();

  for (const parsedImport of parsed.imports) {
    const specifier = parsedImport.moduleSpecifier;
    if (specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('~/')) {
      const base = path.basename(specifier).replace(/\.(tsx|jsx|ts|js)$/, '');
      if (base === 'utils' || specifier.includes('lib/utils')) {
        registryDependencies.add('utils');
      } else if (input.knownComponentNames.has(base) && base !== input.name) {
        registryDependencies.add(base);
      }
      continue;
    }
    const pkg = packageName(specifier);
    if (!IMPLICIT_DEPENDENCIES.has(pkg) && !IMPLICIT_DEPENDENCIES.has(specifier)) {
      dependencies.add(pkg);
    }
  }

  return {
    $schema: REGISTRY_ITEM_SCHEMA,
    name: input.name,
    type: 'registry:ui',
    title: titleCase(input.name),
    description: `${titleCase(input.name)} component exported from the local shadcn-tweaker library.`,
    dependencies: [...dependencies].sort(),
    registryDependencies: [...registryDependencies].sort(),
    files: [
      {
        path: `registry/default/ui/${input.name}.tsx`,
        type: 'registry:ui',
        content: input.content,
      },
    ],
  };
}

const PUBLISH_INSTRUCTIONS = `# Publishing your registry

The generated files follow the shadcn registry layout:

- \`registry.json\` — the registry index (serve at the root of your registry URL)
- \`r/<name>.json\` — one installable item per component, with file contents inlined

## Serve locally

The local studio backend already serves these files:

- \`http://localhost:<port>/r/registry.json\`
- \`http://localhost:<port>/r/<name>.json\`

Test an install into any app:

\`\`\`sh
npx shadcn@latest add http://localhost:<port>/r/<name>.json
\`\`\`

## Publish for real

1. Host the \`registry.json\` and \`r/\` directory on any static host
   (Vercel, Netlify, GitHub Pages, an S3 bucket, ...).
2. Keep the \`r/<name>.json\` paths stable — they are the install URLs.
3. Consumers install with:

\`\`\`sh
npx shadcn@latest add https://your-domain.com/r/<name>.json
\`\`\`

Registry dependencies on other items in this registry resolve automatically
when they are served from the same base URL; plain names like \`utils\` resolve
against the official shadcn registry.
`;

export function getPublishInstructions(): string {
  return PUBLISH_INSTRUCTIONS;
}

/**
 * Generates registry.json plus r/[name].json item files for every component in
 * the local library, into `.shadcn-tweaker/registry/`.
 */
export async function generateRegistry(
  input: { name?: string; homepage?: string } = {}
): Promise<RegistryGenerateResult> {
  const name = input.name?.trim() || 'local-registry';
  if (!REGISTRY_NAME_PATTERN.test(name)) {
    throw new RegistryPublishValidationError(
      'registry name must be a lowercase kebab-case identifier (max 64 chars).'
    );
  }
  const homepage = input.homepage?.trim() || '';
  if (homepage && !/^https?:\/\/[^\s]+$/.test(homepage)) {
    throw new RegistryPublishValidationError('homepage must be an http(s) URL.');
  }

  const cwd = getWorkingDirectory();
  const scan = await scanComponents(cwd);
  if (!scan.success || scan.components.length === 0) {
    throw new RegistryPublishValidationError(
      'No components found to publish. Scan or import components first.'
    );
  }

  const knownComponentNames = new Set(scan.components.map((component) => component.name));
  const warnings: string[] = [];
  const items: RegistryItemJson[] = [];

  for (const component of scan.components) {
    if (!REGISTRY_NAME_PATTERN.test(component.name)) {
      warnings.push(`Skipped "${component.name}": not a valid registry item name.`);
      continue;
    }
    const content = await fs.readFile(component.path, 'utf-8');
    items.push(buildRegistryItem({ name: component.name, content, knownComponentNames }));
  }

  if (items.length === 0) {
    throw new RegistryPublishValidationError('No components were eligible for the registry.');
  }

  const registry: RegistryIndexJson = {
    $schema: REGISTRY_SCHEMA,
    name,
    homepage,
    items: items.map(({ $schema: _schema, ...item }) => ({
      ...item,
      // The index lists file metadata without inlined contents.
      files: item.files.map(({ content: _content, ...file }) => file),
    })),
  };

  const outputDir = getRegistryOutputDir(cwd);
  await fs.remove(outputDir);
  await fs.ensureDir(path.join(outputDir, 'r'));
  await fs.writeJson(path.join(outputDir, 'registry.json'), registry, { spaces: 2 });
  for (const item of items) {
    await fs.writeJson(path.join(outputDir, 'r', `${item.name}.json`), item, { spaces: 2 });
  }
  await fs.writeFile(path.join(outputDir, 'PUBLISHING.md'), PUBLISH_INSTRUCTIONS, 'utf-8');

  return { outputDir, registry, itemCount: items.length, warnings };
}

function validateItemShape(item: unknown, source: string, errors: string[]): void {
  if (!item || typeof item !== 'object') {
    errors.push(`${source}: item is not an object.`);
    return;
  }
  const record = item as Partial<RegistryItemJson>;
  if (typeof record.name !== 'string' || !record.name) errors.push(`${source}: missing name.`);
  if (typeof record.type !== 'string' || !record.type.startsWith('registry:')) {
    errors.push(`${source}: type must be a registry:* value.`);
  }
  if (!Array.isArray(record.files) || record.files.length === 0) {
    errors.push(`${source}: files must be a non-empty array.`);
    return;
  }
  for (const file of record.files) {
    if (typeof file.path !== 'string' || !file.path) {
      errors.push(`${source}: every file needs a path.`);
    }
    if (typeof file.type !== 'string') {
      errors.push(`${source}: every file needs a type.`);
    }
  }
}

/** Validates the generated registry directory against the shadcn structure. */
export async function validateRegistry(): Promise<RegistryValidationResult> {
  const outputDir = getRegistryOutputDir();
  const errors: string[] = [];
  const warnings: string[] = [];

  const registryPath = path.join(outputDir, 'registry.json');
  if (!(await fs.pathExists(registryPath))) {
    return {
      valid: false,
      itemCount: 0,
      errors: ['registry.json has not been generated yet.'],
      warnings,
    };
  }

  let registry: RegistryIndexJson;
  try {
    registry = await fs.readJson(registryPath);
  } catch {
    return {
      valid: false,
      itemCount: 0,
      errors: ['registry.json is not valid JSON.'],
      warnings,
    };
  }

  if (registry.$schema !== REGISTRY_SCHEMA) {
    warnings.push('registry.json $schema does not match the shadcn registry schema URL.');
  }
  if (typeof registry.name !== 'string' || !registry.name) {
    errors.push('registry.json: missing registry name.');
  }
  if (!Array.isArray(registry.items) || registry.items.length === 0) {
    errors.push('registry.json: items must be a non-empty array.');
    return { valid: false, itemCount: 0, errors, warnings };
  }

  const itemNames = new Set(registry.items.map((item) => item.name));
  for (const item of registry.items) {
    validateItemShape(item, `registry.json item "${item.name}"`, errors);

    const itemPath = path.join(outputDir, 'r', `${item.name}.json`);
    if (!(await fs.pathExists(itemPath))) {
      errors.push(`Missing item file r/${item.name}.json.`);
      continue;
    }
    let itemJson: RegistryItemJson;
    try {
      itemJson = await fs.readJson(itemPath);
    } catch {
      errors.push(`r/${item.name}.json is not valid JSON.`);
      continue;
    }
    validateItemShape(itemJson, `r/${item.name}.json`, errors);
    if (itemJson.files?.some((file) => typeof file.content !== 'string' || !file.content)) {
      errors.push(`r/${item.name}.json: item files must inline non-empty content.`);
    }
    for (const dependency of itemJson.registryDependencies ?? []) {
      if (!itemNames.has(dependency) && dependency !== 'utils') {
        warnings.push(
          `r/${item.name}.json: registry dependency "${dependency}" is not part of this registry; it must resolve from the shadcn registry.`
        );
      }
    }
  }

  return { valid: errors.length === 0, itemCount: registry.items.length, errors, warnings };
}
