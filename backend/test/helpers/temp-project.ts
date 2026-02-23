import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';

export interface TempProject {
  root: string;
  cleanup: () => Promise<void>;
}

export async function createTempProject(): Promise<TempProject> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shadcn-tweaker-test-'));
  return {
    root,
    cleanup: async () => {
      await fs.remove(root);
    },
  };
}

export async function writeProjectFile(
  projectRoot: string,
  relativePath: string,
  content: string
): Promise<string> {
  const fullPath = path.join(projectRoot, relativePath);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

export async function withTweakerCwd<T>(projectRoot: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.SHADCN_TWEAKER_CWD;
  process.env.SHADCN_TWEAKER_CWD = projectRoot;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.SHADCN_TWEAKER_CWD;
    } else {
      process.env.SHADCN_TWEAKER_CWD = previous;
    }
  }
}
