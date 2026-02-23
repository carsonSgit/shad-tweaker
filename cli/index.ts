#!/usr/bin/env node
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Command } from 'commander';
import { configExists, resolveComponentsPath } from './config.js';
import { runInit } from './init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find project root (where backend and frontend folders are)
function getProjectRoot(): string {
  // When running from dist/cli/index.js, go up to root
  // When running with tsx from cli/index.ts, we're already relative to root
  let root = path.resolve(__dirname, '..');

  // If we're in dist/cli, go up one more level
  if (path.basename(root) === 'dist') {
    root = path.resolve(root, '..');
  }

  return root;
}

async function findAvailablePort(startPort = 3001): Promise<number> {
  const { default: getPort } = await import('get-port');
  return getPort({ port: startPort });
}

async function waitForServer(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

interface CLIOptions {
  path?: string;
  port?: string;
}

interface ResearchCommandOptions {
  path?: string;
  port?: string;
  json?: boolean;
  run?: string;
  rules?: string;
  maxFiles?: string;
  confirm?: boolean;
  checksum?: string;
  format?: 'json' | 'md';
  goal?: string[];
}

async function startBackend(
  port: number,
  componentsPath: string | null,
  cwd: string
): Promise<ChildProcess> {
  const projectRoot = getProjectRoot();
  const backendPath = path.join(projectRoot, 'backend', 'dist', 'server.js');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    SHADCN_TWEAKER_CWD: cwd,
  };

  if (componentsPath) {
    env.SHADCN_COMPONENTS_PATH = componentsPath;
  }

  const backend = spawn('node', [backendPath], {
    env,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Suppress backend output in normal operation
  backend.stdout?.on('data', () => {});
  backend.stderr?.on('data', (data) => {
    const msg = data.toString();
    // Only show critical errors
    if (msg.includes('Error') || msg.includes('EADDRINUSE')) {
      console.error(chalk.red(msg));
    }
  });

  return backend;
}

async function startFrontend(backendUrl: string, cwd: string): Promise<ChildProcess> {
  const projectRoot = getProjectRoot();
  const frontendPath = path.join(projectRoot, 'frontend', 'dist', 'index.js');

  const frontend = spawn('node', [frontendPath], {
    env: {
      ...process.env,
      BACKEND_URL: backendUrl,
      SHADCN_TWEAKER_CWD: cwd,
    },
    cwd,
    stdio: 'inherit',
  });

  return frontend;
}

async function withBackend<T>(
  cwd: string,
  options: { port?: string; componentsPath?: string | null },
  runner: (backendUrl: string) => Promise<T>
): Promise<T> {
  const port = options.port ? Number.parseInt(options.port, 10) : await findAvailablePort();
  const backendUrl = `http://localhost:${port}`;
  const backend = await startBackend(port, options.componentsPath || null, cwd);

  const ready = await waitForServer(backendUrl);
  if (!ready) {
    backend.kill();
    throw new Error('Failed to start backend server');
  }

  try {
    return await runner(backendUrl);
  } finally {
    backend.kill();
  }
}

async function requestJson<T>(
  backendUrl: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${backendUrl}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = (await response.json()) as { error?: { message?: string } } & T;
  if (!response.ok) {
    throw new Error(data.error?.message || 'Request failed');
  }

  return data;
}

async function loadRulesFile(
  filePath: string
): Promise<Array<{ find: string; replace: string; isRegex: boolean }>> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as
    | Array<{ find: string; replace: string; isRegex: boolean }>
    | { rules?: Array<{ find: string; replace: string; isRegex: boolean }> };

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed.rules)) {
    return parsed.rules;
  }

  throw new Error('Rules file must be an array or an object with a "rules" array');
}

function printJsonIfNeeded(payload: unknown, asJson?: boolean): boolean {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return true;
  }
  return false;
}

async function main() {
  const program = new Command();

  program
    .name('shadcn-tweaker')
    .description('Terminal-based tool for batch customizing shadcn/ui components')
    .version('1.0.0');

  program
    .command('init')
    .description('Initialize shadcn-tweaker configuration for your project')
    .action(async () => {
      await runInit(process.cwd());
    });

  const research = program.command('research').description('Deep research agent command suite');

  research
    .command('scan')
    .description('Discover component roots and build component graph')
    .option('-p, --path <path>', 'Explicit components path override')
    .option('--port <port>', 'Backend server port (default: auto-detect)')
    .option('--json', 'Print full JSON response')
    .action(async (options: ResearchCommandOptions) => {
      const cwd = process.cwd();
      const componentsPath = options.path
        ? await resolveComponentsPath(options.path, cwd)
        : await resolveComponentsPath(undefined, cwd);

      const result = await withBackend(
        cwd,
        { port: options.port, componentsPath },
        async (backendUrl) =>
          requestJson<{
            success: boolean;
            runId: string;
            componentGraph: {
              summary: {
                filesIndexed: number;
                highConfidence: number;
                mediumConfidence: number;
                lowConfidence: number;
              };
              componentRoots: Array<{ path: string; confidence: number; reason: string }>;
            };
          }>(backendUrl, '/api/research/scan', {
            method: 'POST',
            body: JSON.stringify({ paths: options.path ? [options.path] : [] }),
          })
      );

      if (printJsonIfNeeded(result, options.json)) {
        return;
      }

      console.log(chalk.cyan(`Run ID: ${result.runId}`));
      console.log(
        `Indexed ${result.componentGraph.summary.filesIndexed} files (${result.componentGraph.summary.highConfidence} high, ${result.componentGraph.summary.mediumConfidence} medium, ${result.componentGraph.summary.lowConfidence} low confidence)`
      );
      for (const root of result.componentGraph.componentRoots) {
        console.log(`- ${root.path} [${root.confidence}] ${root.reason}`);
      }
    });

  research
    .command('plan')
    .description('Build deterministic research plan from goals and/or rules')
    .option('-g, --goal <goal...>', 'Goal IDs (e.g. radius-normalization focus-ring-normalization)')
    .option('--rules <path>', 'Path to JSON file with custom rules')
    .option('--run <runId>', 'Existing run ID (optional)')
    .option('--max-files <n>', 'Max files touched before blocking')
    .option('-p, --path <path>', 'Explicit components path override')
    .option('--port <port>', 'Backend server port (default: auto-detect)')
    .option('--json', 'Print full JSON response')
    .action(async (options: ResearchCommandOptions) => {
      const goals = options.goal || [];
      const customRules = options.rules
        ? await loadRulesFile(path.resolve(process.cwd(), options.rules))
        : [];
      if (goals.length === 0 && customRules.length === 0) {
        throw new Error('Provide at least one --goal or --rules file');
      }
      const maxFiles = options.maxFiles ? Number.parseInt(options.maxFiles, 10) : undefined;
      if (maxFiles !== undefined && Number.isNaN(maxFiles)) {
        throw new Error('--max-files must be a valid integer');
      }

      const result = await withBackend(
        process.cwd(),
        {
          port: options.port,
          componentsPath: options.path
            ? await resolveComponentsPath(options.path, process.cwd())
            : null,
        },
        async (backendUrl) =>
          requestJson<{
            success: boolean;
            runId: string;
            plan: {
              checksum: string;
              totals: { touchedFiles: number; expectedChanges: number };
              risk: { level: string; score: number; reasons: string[] };
              requiresConfirmation: boolean;
              blocked: boolean;
            };
            safetyReport: {
              blocked: boolean;
              issues: Array<{ code: string; severity: string; message: string }>;
            };
          }>(backendUrl, '/api/research/plan', {
            method: 'POST',
            body: JSON.stringify({
              runId: options.run,
              goals,
              customRules,
              maxFiles,
              paths: options.path ? [options.path] : [],
            }),
          })
      );

      if (printJsonIfNeeded(result, options.json)) {
        return;
      }

      console.log(chalk.cyan(`Run ID: ${result.runId}`));
      console.log(`Plan checksum: ${result.plan.checksum}`);
      console.log(
        `Risk: ${result.plan.risk.level} (score ${result.plan.risk.score}) | touched files: ${result.plan.totals.touchedFiles} | expected changes: ${result.plan.totals.expectedChanges}`
      );
      if (result.plan.requiresConfirmation) {
        console.log(chalk.yellow('High-risk plan: apply requires --confirm'));
      }
      if (result.safetyReport.issues.length > 0) {
        for (const issue of result.safetyReport.issues) {
          console.log(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
        }
      }
    });

  research
    .command('simulate')
    .description('Generate simulation previews for a research plan')
    .requiredOption('--run <runId>', 'Run ID created by research scan/plan')
    .option('--port <port>', 'Backend server port (default: auto-detect)')
    .option('--json', 'Print full JSON response')
    .action(async (options: ResearchCommandOptions) => {
      const result = await withBackend(
        process.cwd(),
        { port: options.port, componentsPath: null },
        async (backendUrl) =>
          requestJson<{
            success: boolean;
            simulation: { totalFiles: number; totalChanges: number };
          }>(backendUrl, '/api/research/simulate', {
            method: 'POST',
            body: JSON.stringify({ runId: options.run }),
          })
      );

      if (printJsonIfNeeded(result, options.json)) {
        return;
      }

      console.log(
        `Simulation complete: ${result.simulation.totalFiles} files, ${result.simulation.totalChanges} total changes`
      );
    });

  research
    .command('apply')
    .description('Apply a planned research run with safety gates')
    .requiredOption('--run <runId>', 'Run ID created by research scan/plan')
    .option('--confirm', 'Required for high-risk plans')
    .option('--checksum <checksum>', 'Expected plan checksum to prevent stale apply')
    .option('--port <port>', 'Backend server port (default: auto-detect)')
    .option('--json', 'Print full JSON response')
    .action(async (options: ResearchCommandOptions) => {
      const result = await withBackend(
        process.cwd(),
        { port: options.port, componentsPath: null },
        async (backendUrl) =>
          requestJson<{
            success: boolean;
            apply: {
              blocked: boolean;
              riskLevel: string;
              modifiedFiles: string[];
              totalChanges: number;
              backupId?: string;
            };
          }>(backendUrl, '/api/research/apply', {
            method: 'POST',
            body: JSON.stringify({
              runId: options.run,
              confirmHighRisk: options.confirm === true,
              expectedChecksum: options.checksum,
            }),
          })
      );

      if (printJsonIfNeeded(result, options.json)) {
        return;
      }

      if (result.apply.blocked) {
        console.log(chalk.red('Apply blocked by safety policy'));
        return;
      }

      console.log(
        `Applied run (${result.apply.riskLevel} risk): ${result.apply.modifiedFiles.length} files, ${result.apply.totalChanges} changes`
      );
      if (result.apply.backupId) {
        console.log(`Backup ID: ${result.apply.backupId}`);
      }
    });

  research
    .command('report')
    .description('Show report for a research run')
    .requiredOption('--run <runId>', 'Run ID created by research scan/plan')
    .option('--format <format>', 'json or md', 'json')
    .option('--port <port>', 'Backend server port (default: auto-detect)')
    .option('--json', 'Print raw JSON response')
    .action(async (options: ResearchCommandOptions) => {
      if (options.format === 'md') {
        const output = await withBackend(
          process.cwd(),
          { port: options.port, componentsPath: null },
          async (backendUrl) => {
            const response = await fetch(
              `${backendUrl}/api/research/${encodeURIComponent(options.run || '')}/report?format=md`
            );
            if (!response.ok) {
              const payload = (await response.json()) as { error?: { message?: string } };
              throw new Error(payload.error?.message || 'Failed to fetch report');
            }
            return response.text();
          }
        );
        console.log(output);
        return;
      }

      const result = await withBackend(
        process.cwd(),
        { port: options.port, componentsPath: null },
        async (backendUrl) =>
          requestJson<{ success: boolean; report: unknown }>(
            backendUrl,
            `/api/research/${encodeURIComponent(options.run || '')}/report?format=json`
          )
      );

      if (printJsonIfNeeded(result, options.json)) {
        return;
      }

      const report = result.report as {
        plan?: { risk?: { level?: string }; totals?: { touchedFiles?: number } };
        applyResult?: { modifiedFiles?: string[] };
      };
      console.log(`Run report (${options.run})`);
      console.log(`Risk: ${report.plan?.risk?.level || 'unknown'}`);
      console.log(`Touched files: ${report.plan?.totals?.touchedFiles || 0}`);
      console.log(`Applied files: ${report.applyResult?.modifiedFiles?.length || 0}`);
    });

  program
    .option('-p, --path <path>', 'Path to shadcn components directory')
    .option('--port <port>', 'Backend server port (default: auto-detect)')
    .action(async (options: CLIOptions) => {
      const cwd = process.cwd();

      // Check if config exists, suggest init if not
      const hasConfig = await configExists(cwd);

      // Resolve components path
      const componentsPath = await resolveComponentsPath(options.path, cwd);

      if (!componentsPath && !hasConfig) {
        process.exit(1);
      }

      // Find available port
      const port = options.port ? Number.parseInt(options.port, 10) : await findAvailablePort();
      const backendUrl = `http://localhost:${port}`;

      if (componentsPath) {
      }

      // Start backend server
      const backend = await startBackend(port, componentsPath, cwd);

      // Wait for backend to be ready
      const serverReady = await waitForServer(backendUrl);

      if (!serverReady) {
        console.error(chalk.red('Failed to start backend server'));
        backend.kill();
        process.exit(1);
      }

      // Start frontend TUI
      const frontend = await startFrontend(backendUrl, cwd);

      // Handle cleanup
      const cleanup = () => {
        frontend.kill();
        backend.kill();
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      frontend.on('exit', (code) => {
        backend.kill();
        process.exit(code || 0);
      });

      backend.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.error(chalk.red(`Backend exited with code ${code}`));
          frontend.kill();
          process.exit(code);
        }
      });
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
});
