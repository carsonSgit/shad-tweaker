import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import fs from 'fs-extra';
import {
  applyResearch,
  getResearchArtifact,
  getResearchReport,
  planResearch,
  scanResearch,
  simulateResearch,
} from '../src/services/research.js';
import { createTempProject, withTweakerCwd, writeProjectFile } from './helpers/temp-project.js';

test('research flow creates artifacts and applies planned changes', async () => {
  const project = await createTempProject();
  try {
    await writeProjectFile(
      project.root,
      'package.json',
      JSON.stringify({ name: 'fixture-project', private: true }, null, 2)
    );

    const componentFile = await writeProjectFile(
      project.root,
      'src/components/ui/button.tsx',
      'export function Button() { return <button className="rounded-md focus:outline-none" />; }\n'
    );

    await withTweakerCwd(project.root, async () => {
      const scanResult = await scanResearch();
      assert.ok(scanResult.runId.startsWith('run_'));
      assert.ok(scanResult.componentGraph.summary.filesIndexed >= 1);

      const planResult = await planResearch({
        runId: scanResult.runId,
        goals: ['radius-normalization'],
      });
      assert.equal(planResult.plan.blocked, false);
      assert.ok(planResult.plan.targets.length >= 1);
      assert.ok(planResult.safetyReport.blocked === false);

      const simulation = await simulateResearch(scanResult.runId);
      assert.ok(simulation.totalFiles >= 1);
      assert.ok(simulation.totalChanges >= 1);

      const apply = await applyResearch({
        runId: scanResult.runId,
        expectedChecksum: planResult.plan.checksum,
      });
      assert.equal(apply.blocked, false);
      assert.ok(apply.modifiedFiles.length >= 1);

      const updatedContent = await fs.readFile(componentFile, 'utf-8');
      assert.match(updatedContent, /rounded-lg/);

      const report = (await getResearchReport(scanResult.runId, 'json')) as {
        runId: string;
        plan: { checksum: string };
      };
      assert.equal(report.runId, scanResult.runId);
      assert.equal(report.plan.checksum, planResult.plan.checksum);

      const planArtifact = (await getResearchArtifact(scanResult.runId, 'plan.json')) as {
        checksum: string;
      };
      assert.equal(planArtifact.checksum, planResult.plan.checksum);

      const runDir = path.join(
        project.root,
        '.shadcn-tweaker',
        'research',
        'runs',
        scanResult.runId
      );
      assert.equal(await fs.pathExists(path.join(runDir, 'component_graph.json')), true);
      assert.equal(await fs.pathExists(path.join(runDir, 'customization_candidates.json')), true);
      assert.equal(await fs.pathExists(path.join(runDir, 'safety_report.json')), true);
      assert.equal(await fs.pathExists(path.join(runDir, 'summary.md')), true);
    });
  } finally {
    await project.cleanup();
  }
});
