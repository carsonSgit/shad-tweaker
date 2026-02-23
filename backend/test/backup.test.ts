import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import fs from 'fs-extra';
import { createBackup, getBackupDetails, restoreBackup } from '../src/services/backup.js';
import { createTempProject, withTweakerCwd, writeProjectFile } from './helpers/temp-project.js';

test('backup preserves unique relative paths for duplicate basenames and restores content', async () => {
  const project = await createTempProject();
  try {
    const buttonAPath = await writeProjectFile(
      project.root,
      'src/components/ui/button.tsx',
      'export const Button = () => "ui";\n'
    );
    const buttonBPath = await writeProjectFile(
      project.root,
      'src/components/forms/button.tsx',
      'export const Button = () => "forms";\n'
    );

    await withTweakerCwd(project.root, async () => {
      const backup = await createBackup([buttonAPath, buttonBPath]);
      const details = await getBackupDetails(backup.id);
      assert.ok(details);
      assert.equal(details?.files.length, 2);

      const relativePaths = new Set(details?.files.map((entry) => entry.relativePath).filter(Boolean));
      assert.equal(relativePaths.size, 2);

      for (const file of details?.files || []) {
        assert.ok(file.sha256);
      }

      await fs.writeFile(buttonAPath, 'changed-ui\n', 'utf-8');
      await fs.writeFile(buttonBPath, 'changed-forms\n', 'utf-8');

      const restore = await restoreBackup(backup.id);
      assert.equal(restore.success, true);
      assert.equal(restore.count, 2);

      const restoredA = await fs.readFile(buttonAPath, 'utf-8');
      const restoredB = await fs.readFile(buttonBPath, 'utf-8');
      assert.equal(restoredA, 'export const Button = () => "ui";\n');
      assert.equal(restoredB, 'export const Button = () => "forms";\n');

      for (const file of details?.files || []) {
        assert.ok(file.backupPath.startsWith(path.join(project.root, '.shadcn-tweaker', 'backups')));
      }
    });
  } finally {
    await project.cleanup();
  }
});

