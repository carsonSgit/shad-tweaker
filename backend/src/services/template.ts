import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Template, TemplateRule } from '../types/index.js';
import { logger } from '../utils/logger.js';

const TEMPLATE_DIR = '.shadcn-tweaker/templates';
const TEMPLATE_FILE = 'templates.json';

function getWorkingDirectory(): string {
  return process.env.SHADCN_TWEAKER_CWD || process.cwd();
}

function getTemplatePath(): string {
  return path.join(getWorkingDirectory(), TEMPLATE_DIR, TEMPLATE_FILE);
}

async function ensureTemplateFile(): Promise<void> {
  const templatePath = getTemplatePath();
  const templateDir = path.dirname(templatePath);

  await fs.ensureDir(templateDir);

  if (!(await fs.pathExists(templatePath))) {
    await fs.writeJson(templatePath, { templates: [] }, { spaces: 2 });
  }
}

interface TemplateStore {
  templates: Template[];
}

async function readTemplates(): Promise<TemplateStore> {
  await ensureTemplateFile();
  return fs.readJson(getTemplatePath());
}

async function writeTemplates(store: TemplateStore): Promise<void> {
  await ensureTemplateFile();
  await fs.writeJson(getTemplatePath(), store, { spaces: 2 });
}

export async function listTemplates(): Promise<Template[]> {
  const store = await readTemplates();
  return store.templates;
}

export async function getTemplate(id: string): Promise<Template | null> {
  const store = await readTemplates();
  return store.templates.find((t) => t.id === id) || null;
}

export async function createTemplate(name: string, rules: TemplateRule[]): Promise<Template> {
  const store = await readTemplates();

  const template: Template = {
    id: `template_${uuidv4().slice(0, 8)}`,
    name,
    rules,
    created: new Date().toISOString(),
  };

  store.templates.push(template);
  await writeTemplates(store);

  logger.info(`Created template: ${template.id} - ${name}`);

  return template;
}

export async function updateTemplate(id: string, updates: Partial<Pick<Template, 'name' | 'rules'>>): Promise<Template | null> {
  const store = await readTemplates();
  const index = store.templates.findIndex((t) => t.id === id);

  if (index === -1) {
    return null;
  }

  const template = store.templates[index];

  if (updates.name !== undefined) {
    template.name = updates.name;
  }

  if (updates.rules !== undefined) {
    template.rules = updates.rules;
  }

  store.templates[index] = template;
  await writeTemplates(store);

  logger.info(`Updated template: ${id}`);

  return template;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const store = await readTemplates();
  const index = store.templates.findIndex((t) => t.id === id);

  if (index === -1) {
    return false;
  }

  store.templates.splice(index, 1);
  await writeTemplates(store);

  logger.info(`Deleted template: ${id}`);

  return true;
}

// Note: Template application is handled by the frontend which loads template rules
// into the editor and uses the edit/apply endpoint. The rules are returned from
// getTemplate() and the frontend orchestrates the apply workflow.

const DEFAULT_TEMPLATES: Array<{ name: string; rules: TemplateRule[] }> = [
  {
    name: 'Remove cursor-pointer',
    rules: [
      { find: '\\s*cursor-pointer', replace: '', isRegex: true },
    ],
  },
  {
    name: 'Add focus rings',
    rules: [
      {
        find: 'focus:outline-none',
        replace: 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isRegex: false,
      },
    ],
  },
  {
    name: 'Update to rounded-lg',
    rules: [
      { find: 'rounded-md', replace: 'rounded-lg', isRegex: false },
    ],
  },
];

export async function initializeDefaultTemplates(): Promise<void> {
  const store = await readTemplates();

  if (store.templates.length > 0) {
    return;
  }

  for (const defaultTemplate of DEFAULT_TEMPLATES) {
    await createTemplate(defaultTemplate.name, defaultTemplate.rules);
  }

  logger.info(`Initialized ${DEFAULT_TEMPLATES.length} default templates`);
}
