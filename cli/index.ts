#!/usr/bin/env node
import { type ChildProcess, spawn } from 'node:child_process';
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
