import path from 'node:path';
import fs from 'fs-extra';
import type {
  ComponentExportRequest,
  ComponentExportResult,
  ComponentExportTarget,
  DesignTokenSet,
  RegistryItemJson,
} from '../types/index.js';
import { resolveWithinWorkspace, WorkspacePathError } from '../utils/paths.js';
import { buildRegistryItem } from './registryPublisher.js';
import { getWorkingDirectory, loadWorkspaceManifest } from './workspace.js';

export class ExportValidationError extends Error {
  readonly code = 'EXPORT_VALIDATION_ERROR';
}

export const EXPORT_TARGETS: ComponentExportTarget[] = ['folder', 'npm-package', 'registry'];
export const MAX_EXPORT_COMPONENTS = 100;

const PACKAGE_NAME_PATTERN = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

interface LoadedComponent {
  name: string;
  content: string;
}

function resolveOutputDir(cwd: string, target: ComponentExportTarget, outputDir?: string): string {
  const requested = outputDir?.trim() || `exports/${target}`;
  try {
    const resolved = resolveWithinWorkspace(cwd, requested);
    // Refuse to export into workspace metadata or source directories.
    const relative = path.relative(cwd, resolved);
    if (relative.split(path.sep)[0] === '.shadcn-tweaker') {
      throw new WorkspacePathError('outputDir must not target workspace metadata.');
    }
    return resolved;
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      throw new ExportValidationError('outputDir must be a safe project-relative directory.');
    }
    throw error;
  }
}

async function loadComponents(cwd: string, componentPaths: string[]): Promise<LoadedComponent[]> {
  if (!Array.isArray(componentPaths) || componentPaths.length === 0) {
    throw new ExportValidationError('componentPaths must be a non-empty array.');
  }
  if (componentPaths.length > MAX_EXPORT_COMPONENTS) {
    throw new ExportValidationError(
      `componentPaths must contain at most ${MAX_EXPORT_COMPONENTS} entries.`
    );
  }
  const components: LoadedComponent[] = [];
  for (const componentPath of componentPaths) {
    let absolute: string;
    try {
      absolute = resolveWithinWorkspace(cwd, componentPath, { extensions: ['.tsx', '.jsx'] });
    } catch (error) {
      if (error instanceof WorkspacePathError) {
        throw new ExportValidationError(
          `componentPaths entries must be safe project-relative TSX/JSX files (got "${componentPath}").`
        );
      }
      throw error;
    }
    if (!(await fs.pathExists(absolute))) {
      throw new ExportValidationError(`Component file not found: ${componentPath}`);
    }
    components.push({
      name: path.basename(absolute, path.extname(absolute)),
      content: await fs.readFile(absolute, 'utf-8'),
    });
  }
  return components;
}

function tokenCssVariables(tokenSets: DesignTokenSet[]): string {
  const lines: string[] = [':root {'];
  for (const tokenSet of tokenSets) {
    for (const [category, tokens] of Object.entries(tokenSet.tokens)) {
      for (const token of Object.values(tokens)) {
        lines.push(`  --${category}-${token.name}: ${token.value};`);
      }
    }
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function buildReadme(input: {
  title: string;
  components: LoadedComponent[];
  dependencies: string[];
  target: ComponentExportTarget;
}): string {
  const installBlock =
    input.dependencies.length > 0
      ? `\n## Dependencies\n\nInstall the packages these components import:\n\n\`\`\`sh\nnpm install ${input.dependencies.join(' ')}\n\`\`\`\n`
      : '';
  const usage = input.components
    .map(
      (component) => `- \`${component.name}\` — import from \`./components/ui/${component.name}\``
    )
    .join('\n');
  return `# ${input.title}

Exported from shadcn-tweaker (${input.target} target).

## Components

${usage}
${installBlock}
## Tokens

CSS variables for the exported design tokens live in \`tokens/css-variables.css\`;
the raw token data is in \`tokens/tokens.json\`. Import the CSS file once at your
app root, or merge the variables into your global stylesheet.

## Tailwind

See \`TAILWIND.md\` for configuration notes required by these components.
`;
}

const TAILWIND_NOTES = `# Tailwind configuration notes

These components use standard shadcn/ui conventions:

- **Content globs** — make sure your \`tailwind.config\` content globs include
  the directory you copy these components into.
- **tailwindcss-animate** — components using \`animate-in\`/\`animate-out\`
  utilities need the \`tailwindcss-animate\` plugin.
- **CSS variables** — color tokens reference CSS variables (e.g.
  \`bg-primary\`); wire the variables from \`tokens/css-variables.css\` into your
  theme via \`hsl(var(--...))\` or use them directly.
- **cn helper** — components importing \`@/lib/utils\` expect the shadcn \`cn\`
  helper (clsx + tailwind-merge).
`;

async function writeFiles(
  outputDir: string,
  files: Array<{ path: string; content: string }>
): Promise<string[]> {
  await fs.remove(outputDir);
  for (const file of files) {
    await fs.outputFile(path.join(outputDir, file.path), file.content, 'utf-8');
  }
  return files.map((file) => file.path);
}

/** Validates that every expected file landed on disk and JSON files parse. */
async function validateExport(
  outputDir: string,
  files: string[]
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  for (const file of files) {
    const absolute = path.join(outputDir, file);
    if (!(await fs.pathExists(absolute))) {
      errors.push(`Missing expected file: ${file}`);
      continue;
    }
    if (file.endsWith('.json')) {
      try {
        await fs.readJson(absolute);
      } catch {
        errors.push(`Invalid JSON in ${file}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Exports the selected components plus tokens, dependency manifest, README,
 * and Tailwind notes into a reusable folder, npm package scaffold, or
 * shadcn-compatible registry structure. Output is validated before returning.
 */
export async function exportComponents(
  input: ComponentExportRequest
): Promise<ComponentExportResult> {
  if (!EXPORT_TARGETS.includes(input.target)) {
    throw new ExportValidationError(`target must be one of: ${EXPORT_TARGETS.join(', ')}.`);
  }
  const cwd = getWorkingDirectory();
  const outputDir = resolveOutputDir(cwd, input.target, input.outputDir);
  const components = await loadComponents(cwd, input.componentPaths);
  const knownComponentNames = new Set(components.map((component) => component.name));

  const items: RegistryItemJson[] = components.map((component) =>
    buildRegistryItem({ name: component.name, content: component.content, knownComponentNames })
  );
  const dependencies = [...new Set(items.flatMap((item) => item.dependencies))].sort();

  const manifest = await loadWorkspaceManifest();
  const tokensCss = tokenCssVariables(manifest.tokenSets);
  const tokensJson = JSON.stringify(
    manifest.tokenSets.map((tokenSet) => ({
      id: tokenSet.id,
      name: tokenSet.name,
      tokens: tokenSet.tokens,
    })),
    null,
    2
  );
  const dependenciesJson = JSON.stringify(
    {
      dependencies,
      registryDependencies: [...new Set(items.flatMap((item) => item.registryDependencies))].sort(),
      components: components.map((component) => component.name),
    },
    null,
    2
  );

  const shared: Array<{ path: string; content: string }> = [
    { path: 'tokens/css-variables.css', content: tokensCss },
    { path: 'tokens/tokens.json', content: `${tokensJson}\n` },
    { path: 'dependencies.json', content: `${dependenciesJson}\n` },
    { path: 'TAILWIND.md', content: TAILWIND_NOTES },
  ];

  let files: Array<{ path: string; content: string }>;

  if (input.target === 'folder') {
    files = [
      ...components.map((component) => ({
        path: `components/ui/${component.name}.tsx`,
        content: component.content,
      })),
      {
        path: 'README.md',
        content: buildReadme({
          title: 'Component export',
          components,
          dependencies,
          target: input.target,
        }),
      },
      ...shared,
    ];
  } else if (input.target === 'npm-package') {
    const packageName = input.packageName?.trim() || 'my-component-library';
    if (!PACKAGE_NAME_PATTERN.test(packageName)) {
      throw new ExportValidationError('packageName must be a valid npm package name.');
    }
    const packageJson = JSON.stringify(
      {
        name: packageName,
        version: '0.1.0',
        description: 'Component library exported from shadcn-tweaker',
        type: 'module',
        main: './src/index.ts',
        types: './src/index.ts',
        files: ['src', 'tokens', 'README.md'],
        sideEffects: false,
        peerDependencies: {
          react: '>=18',
          'react-dom': '>=18',
        },
        dependencies: Object.fromEntries(dependencies.map((dependency) => [dependency, '*'])),
      },
      null,
      2
    );
    const indexTs = `${components
      .map((component) => `export * from './${component.name}.js';`)
      .join('\n')}\n`;
    files = [
      { path: 'package.json', content: `${packageJson}\n` },
      { path: 'src/index.ts', content: indexTs },
      ...components.map((component) => ({
        path: `src/${component.name}.tsx`,
        content: component.content,
      })),
      {
        path: 'README.md',
        content: buildReadme({
          title: packageName,
          components,
          dependencies,
          target: input.target,
        }),
      },
      ...shared,
    ];
  } else {
    const registry = {
      $schema: 'https://ui.shadcn.com/schema/registry.json',
      name: 'exported-registry',
      homepage: '',
      items: items.map(({ $schema: _schema, ...item }) => ({
        ...item,
        files: item.files.map(({ content: _content, ...file }) => file),
      })),
    };
    files = [
      { path: 'registry.json', content: `${JSON.stringify(registry, null, 2)}\n` },
      ...items.map((item) => ({
        path: `r/${item.name}.json`,
        content: `${JSON.stringify(item, null, 2)}\n`,
      })),
      {
        path: 'README.md',
        content: buildReadme({
          title: 'Registry export',
          components,
          dependencies,
          target: input.target,
        }),
      },
      ...shared,
    ];
  }

  const written = await writeFiles(outputDir, files);
  const validation = await validateExport(outputDir, written);

  return {
    outputDir,
    target: input.target,
    files: written,
    dependencies,
    validation,
  };
}
