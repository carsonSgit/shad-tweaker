import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { saveConfig, configExists, getDefaultConfig, type ShadcnTweakerConfig } from './config.js';

const COMMON_PATHS = [
  'src/components/ui',
  'components/ui',
  'app/components/ui',
  'src/ui',
  'frontend/src/components/ui',
  'frontend/components/ui',
];

async function detectExistingPaths(cwd: string): Promise<string[]> {
  const existing: string[] = [];
  
  for (const p of COMMON_PATHS) {
    const fullPath = path.join(cwd, p);
    if (await fs.pathExists(fullPath)) {
      existing.push(p);
    }
  }
  
  return existing;
}

async function countComponentFiles(dirPath: string): Promise<number> {
  try {
    const files = await fs.readdir(dirPath);
    return files.filter((f) => f.endsWith('.tsx') || f.endsWith('.jsx')).length;
  } catch {
    return 0;
  }
}

export async function runInit(cwd: string): Promise<void> {
  console.log(chalk.cyan('\n🔧 Shadcn Tweaker Setup\n'));

  // Check if config already exists
  if (await configExists(cwd)) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'Configuration file already exists. Overwrite?',
        default: false,
      },
    ]);

    if (!overwrite) {
      console.log(chalk.gray('Setup cancelled.'));
      return;
    }
  }

  // Detect existing component directories
  const existingPaths = await detectExistingPaths(cwd);
  const defaults = getDefaultConfig();

  // Build choices for components path
  const pathChoices: Array<{ name: string; value: string }> = [];
  
  for (const p of existingPaths) {
    const fullPath = path.join(cwd, p);
    const count = await countComponentFiles(fullPath);
    pathChoices.push({
      name: `${p} (${count} component${count !== 1 ? 's' : ''} found)`,
      value: p,
    });
  }
  
  pathChoices.push({
    name: 'Enter custom path...',
    value: '__custom__',
  });

  let componentsPath: string;

  if (pathChoices.length > 1) {
    const { selectedPath } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedPath',
        message: 'Where are your shadcn components located?',
        choices: pathChoices,
        default: existingPaths[0] || defaults.componentsPath,
      },
    ]);

    if (selectedPath === '__custom__') {
      const { customPath } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customPath',
          message: 'Enter the path to your components directory:',
          default: defaults.componentsPath,
          validate: async (input: string) => {
            const fullPath = path.isAbsolute(input) ? input : path.join(cwd, input);
            if (await fs.pathExists(fullPath)) {
              return true;
            }
            return `Directory not found: ${fullPath}`;
          },
        },
      ]);
      componentsPath = customPath;
    } else {
      componentsPath = selectedPath;
    }
  } else {
    const { customPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'customPath',
        message: 'Enter the path to your components directory:',
        default: defaults.componentsPath,
      },
    ]);
    componentsPath = customPath;
  }

  // Ask about backup settings
  const { configureAdvanced } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureAdvanced',
      message: 'Configure advanced settings (backup location, max backups)?',
      default: false,
    },
  ]);

  let backupsDir = defaults.backupsDir;
  let maxBackups = defaults.maxBackups;

  if (configureAdvanced) {
    const advanced = await inquirer.prompt([
      {
        type: 'input',
        name: 'backupsDir',
        message: 'Backup directory:',
        default: defaults.backupsDir,
      },
      {
        type: 'number',
        name: 'maxBackups',
        message: 'Maximum number of backups to keep:',
        default: defaults.maxBackups,
        validate: (input: number) => {
          if (input < 1) return 'Must be at least 1';
          if (input > 100) return 'Maximum is 100';
          return true;
        },
      },
    ]);

    backupsDir = advanced.backupsDir;
    maxBackups = advanced.maxBackups;
  }

  // Create config
  const config: ShadcnTweakerConfig = {
    componentsPath: `./${componentsPath.replace(/^\.\//, '')}`,
    backupsDir,
    templatesDir: defaults.templatesDir,
    maxBackups,
  };

  await saveConfig(config, cwd);

  // Create the shadcn-tweaker directory
  const tweakerDir = path.join(cwd, '.shadcn-tweaker');
  await fs.ensureDir(path.join(tweakerDir, 'backups'));
  await fs.ensureDir(path.join(tweakerDir, 'templates'));

  // Add to .gitignore if it exists
  const gitignorePath = path.join(cwd, '.gitignore');
  if (await fs.pathExists(gitignorePath)) {
    const gitignore = await fs.readFile(gitignorePath, 'utf-8');
    if (!gitignore.includes('.shadcn-tweaker')) {
      const { addToGitignore } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'addToGitignore',
          message: 'Add .shadcn-tweaker/ to .gitignore?',
          default: true,
        },
      ]);

      if (addToGitignore) {
        await fs.appendFile(gitignorePath, '\n# Shadcn Tweaker\n.shadcn-tweaker/\n');
        console.log(chalk.gray('Added .shadcn-tweaker/ to .gitignore'));
      }
    }
  }

  console.log(chalk.green('\n✓ Configuration saved to .shadcn-tweaker.json'));
  console.log(chalk.gray(`  Components path: ${config.componentsPath}`));
  console.log(chalk.gray(`  Backups: ${config.backupsDir}`));
  console.log(chalk.gray(`  Max backups: ${config.maxBackups}`));
  console.log(chalk.cyan('\nRun `shadcn-tweaker` to start customizing your components!\n'));
}
