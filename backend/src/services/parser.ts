import path from 'node:path';
import fs from 'fs-extra';
import type { ComponentGraph, ComponentRoot, GraphEdge, GraphNode } from '../types/index.js';
import { scoreComponent } from './classifier.js';
import { DISCOVERY_IGNORED_DIRECTORIES } from './discovery.js';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

interface AliasMapping {
  prefix: string;
  targets: string[];
}

async function collectSourceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (DISCOVERY_IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        await walk(path.join(currentDir, entry.name));
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.includes(ext)) {
        continue;
      }

      files.push(path.join(currentDir, entry.name));
    }
  }

  await walk(rootPath);
  return files.sort();
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /import\s+(?:type\s+)?(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null = importRegex.exec(content);
  while (match !== null) {
    imports.push(match[1]);
    match = importRegex.exec(content);
  }
  return imports;
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const exportRegex = /export\s+(?:const|function|class|type|interface)\s+([A-Za-z0-9_]+)/g;
  let match: RegExpExecArray | null = exportRegex.exec(content);
  while (match !== null) {
    exports.push(match[1]);
    match = exportRegex.exec(content);
  }

  if (/export\s+default/.test(content)) {
    exports.push('default');
  }

  return exports;
}

function countClassUsage(content: string): number {
  const patterns = [/className\s*=/g, /className\s*:/g, /\bcn\(/g, /\bclsx\(/g, /\bcva\(/g];
  let count = 0;
  for (const pattern of patterns) {
    count += (content.match(pattern) || []).length;
  }
  return count;
}

async function loadPathAliases(projectRoot: string): Promise<AliasMapping[]> {
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  if (!(await fs.pathExists(tsconfigPath))) {
    return [];
  }

  try {
    const rawConfig = await fs.readFile(tsconfigPath, 'utf-8');
    const parsed = JSON.parse(rawConfig) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    const baseUrl = parsed.compilerOptions?.baseUrl || '.';
    const mappings: AliasMapping[] = [];
    const aliasPaths = parsed.compilerOptions?.paths || {};

    for (const [alias, targets] of Object.entries(aliasPaths)) {
      const prefix = alias.endsWith('/*') ? alias.slice(0, -1) : alias;
      mappings.push({
        prefix,
        targets: targets.map((target) => {
          const normalizedTarget = target.endsWith('/*') ? target.slice(0, -1) : target;
          return path.resolve(projectRoot, baseUrl, normalizedTarget);
        }),
      });
    }

    return mappings;
  } catch {
    return [];
  }
}

async function tryResolveCandidate(basePath: string): Promise<string | null> {
  const candidates = [
    basePath,
    ...SOURCE_EXTENSIONS.map((ext) => `${basePath}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(basePath, `index${ext}`)),
  ];

  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) {
        return path.resolve(candidate);
      }
    }
  }

  return null;
}

async function resolveImportPath(
  projectRoot: string,
  importerPath: string,
  rawImport: string,
  aliasMappings: AliasMapping[]
): Promise<string | null> {
  if (rawImport.startsWith('.')) {
    return tryResolveCandidate(path.resolve(path.dirname(importerPath), rawImport));
  }

  for (const mapping of aliasMappings) {
    if (!rawImport.startsWith(mapping.prefix)) {
      continue;
    }
    const suffix = rawImport.slice(mapping.prefix.length);
    for (const target of mapping.targets) {
      const resolved = await tryResolveCandidate(path.resolve(target, suffix));
      if (resolved?.startsWith(path.resolve(projectRoot))) {
        return resolved;
      }
    }
  }

  return null;
}

export async function buildComponentGraph(
  runId: string,
  projectRoot: string,
  componentRoots: ComponentRoot[]
): Promise<ComponentGraph> {
  const aliasMappings = await loadPathAliases(projectRoot);
  const sourceFilesSet = new Set<string>();

  for (const root of componentRoots) {
    const files = await collectSourceFiles(root.path);
    for (const file of files) {
      sourceFilesSet.add(path.resolve(file));
    }
  }

  const sourceFiles = Array.from(sourceFilesSet).sort();
  const nodes: GraphNode[] = [];
  const nodeByAbsolutePath = new Map<string, GraphNode>();

  for (const filePath of sourceFiles) {
    const content = await fs.readFile(filePath, 'utf-8');
    const stats = await fs.stat(filePath);
    const exportsFound = extractExports(content);
    const importsFound = extractImports(content);
    const classUsageCount = countClassUsage(content);
    const classification = scoreComponent(filePath, content, exportsFound, importsFound);
    const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

    const node: GraphNode = {
      id: relativePath,
      path: filePath,
      name: path.basename(filePath, path.extname(filePath)),
      confidence: classification.score,
      confidenceBand: classification.band,
      kind: classification.kind,
      exports: exportsFound,
      imports: importsFound,
      classUsageCount,
      lineCount: content.split('\n').length,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
    };

    nodes.push(node);
    nodeByAbsolutePath.set(path.resolve(filePath), node);
  }

  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    for (const importPath of node.imports) {
      const resolved = await resolveImportPath(projectRoot, node.path, importPath, aliasMappings);
      if (!resolved) {
        continue;
      }
      const target = nodeByAbsolutePath.get(path.resolve(resolved));
      if (!target) {
        continue;
      }
      edges.push({
        from: node.id,
        to: target.id,
        type: 'import',
      });
    }
  }

  const highConfidence = nodes.filter((node) => node.confidenceBand === 'high').length;
  const mediumConfidence = nodes.filter((node) => node.confidenceBand === 'medium').length;
  const lowConfidence = nodes.filter((node) => node.confidenceBand === 'low').length;

  return {
    runId,
    generatedAt: new Date().toISOString(),
    projectRoot,
    componentRoots,
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => {
      const fromCompare = a.from.localeCompare(b.from);
      if (fromCompare !== 0) {
        return fromCompare;
      }
      return a.to.localeCompare(b.to);
    }),
    summary: {
      filesIndexed: nodes.length,
      highConfidence,
      mediumConfidence,
      lowConfidence,
    },
  };
}
