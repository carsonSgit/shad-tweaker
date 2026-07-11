#!/usr/bin/env node
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
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

function getPackageVersion(): string {
  try {
    const packageJsonPath = path.join(getProjectRoot(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      version?: string;
    };
    return packageJson.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
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

interface StudioOptions extends CLIOptions {
  tui?: boolean;
  web?: boolean;
  open?: boolean;
}

type StudioSurface = 'tui' | 'web';

type BackendProcess = ChildProcess & { stderrTail: string[] };

async function startBackend(
  port: number,
  componentsPath: string | null,
  cwd: string
): Promise<BackendProcess> {
  const projectRoot = getProjectRoot();
  const backendPath = path.join(projectRoot, 'backend', 'dist', 'server.js');

  if (!fs.existsSync(backendPath)) {
    console.error(chalk.red(`Backend build not found at ${backendPath}`));
    console.error(chalk.yellow('Run "bun run build" first, or reinstall shadcn-tweaker.'));
    process.exit(1);
  }

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

  // Suppress backend output in normal operation, but keep recent stderr
  // so startup failures can be reported with their actual cause.
  const stderrTail: string[] = [];
  backend.stdout?.on('data', () => {});
  backend.stderr?.on('data', (data) => {
    const msg = data.toString();
    stderrTail.push(msg);
    if (stderrTail.length > 20) {
      stderrTail.shift();
    }
    // Only show critical errors
    if (msg.includes('Error') || msg.includes('EADDRINUSE')) {
      console.error(chalk.red(msg));
    }
  });

  return Object.assign(backend, { stderrTail });
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

async function prepareBackend(options: CLIOptions): Promise<{
  backend: BackendProcess;
  backendUrl: string;
  cwd: string;
}> {
  const cwd = process.cwd();
  const hasConfig = await configExists(cwd);
  const componentsPath = await resolveComponentsPath(options.path, cwd);

  if (!componentsPath && !hasConfig) {
    console.error(chalk.red('Could not find a shadcn components directory.'));
    console.error(
      chalk.yellow(
        'Run "shadcn-tweaker init" to configure your project, or pass --path <path> to your components directory.'
      )
    );
    process.exit(1);
  }

  let port: number;
  if (options.port) {
    port = Number.parseInt(options.port, 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      console.error(chalk.red(`Invalid port "${options.port}". Use a number between 1 and 65535.`));
      process.exit(1);
    }
  } else {
    port = await findAvailablePort();
  }
  const backendUrl = `http://localhost:${port}`;
  const backend = await startBackend(port, componentsPath, cwd);
  const serverReady = await waitForServer(backendUrl);

  if (!serverReady) {
    console.error(chalk.red('Failed to start backend server'));
    const stderrOutput = backend.stderrTail.join('').trim();
    if (stderrOutput) {
      console.error(chalk.dim(stderrOutput));
    }
    backend.kill();
    process.exit(1);
  }

  return { backend, backendUrl, cwd };
}

async function launchTui(options: CLIOptions): Promise<void> {
  const { backend, backendUrl, cwd } = await prepareBackend(options);
  const frontend = await startFrontend(backendUrl, cwd);

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
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const opener = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  opener.on('error', () => {
    console.log(chalk.yellow(`Could not open a browser automatically. Open ${url}`));
  });
  opener.unref();
}

async function launchWebStudio(options: StudioOptions): Promise<void> {
  const { backend, backendUrl } = await prepareBackend(options);
  const studioUrl = `${backendUrl}/studio`;

  console.log(chalk.cyan(`Studio available at ${studioUrl}`));
  if (options.open !== false) {
    openBrowser(studioUrl);
  }

  const cleanup = () => {
    backend.kill();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  backend.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(chalk.red(`Backend exited with code ${code}`));
      process.exit(code);
    }
  });
}

async function chooseStudioSurface(options: StudioOptions): Promise<StudioSurface> {
  if (options.tui && options.web) {
    console.error(chalk.red('Choose only one studio surface: --tui or --web.'));
    process.exit(1);
  }
  if (options.tui) return 'tui';
  if (options.web) return 'web';

  if (!process.stdin.isTTY) {
    console.error(
      chalk.red('No interactive terminal detected. Pass --tui or --web to pick a studio surface.')
    );
    process.exit(1);
  }

  const answer = await inquirer.prompt<{ surface: StudioSurface }>([
    {
      type: 'list',
      name: 'surface',
      message: 'Launch which studio surface?',
      choices: [
        { name: 'Terminal workbench', value: 'tui' },
        { name: 'Browser studio', value: 'web' },
      ],
    },
  ]);
  return answer.surface;
}

async function main() {
  const program = new Command();

  program
    .name('shadcn-tweaker')
    .description('Terminal-based tool for batch customizing shadcn/ui components')
    .version(getPackageVersion());

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
      await launchTui(options);
    });

  program
    .command('studio')
    .description('Launch the local studio shell')
    .option('-p, --path <path>', 'Path to shadcn components directory')
    .option('--port <port>', 'Backend server port (default: auto-detect)')
    .option('--tui', 'Launch the terminal workbench')
    .option('--web', 'Launch the browser studio')
    .option('--no-open', 'Print the browser studio URL without opening it')
    .action(async (_options: StudioOptions, command: Command) => {
      // Merge in root-level options so `studio --port`/`--path` work even when
      // commander attributes those flags to the root program.
      const options = command.optsWithGlobals<StudioOptions>();
      const surface = await chooseStudioSurface(options);
      if (surface === 'web') {
        await launchWebStudio(options);
        return;
      }
      await launchTui(options);
    });

  program
    .command('visual')
    .description('Launch the browser studio shell')
    .option('-p, --path <path>', 'Path to shadcn components directory')
    .option('--port <port>', 'Backend server port (default: auto-detect)')
    .option('--no-open', 'Print the browser studio URL without opening it')
    .action(async (_options: StudioOptions, command: Command) => {
      const options = command.optsWithGlobals<StudioOptions>();
      await launchWebStudio({ ...options, web: true });
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
});
