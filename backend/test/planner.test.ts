import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResearchPlan } from '../src/services/planner.js';
import type { ComponentGraph } from '../src/types/index.js';
import { createTempProject, writeProjectFile } from './helpers/temp-project.js';

test('buildResearchPlan is deterministic for identical graph and goals', async () => {
  const project = await createTempProject();
  try {
    const filePath = await writeProjectFile(
      project.root,
      'src/components/ui/button.tsx',
      'export function Button() { return <button className="rounded-md" />; }\n'
    );

    const graph: ComponentGraph = {
      runId: 'run_2026-02-23_22-01-09-321_a1b2c3',
      generatedAt: new Date().toISOString(),
      projectRoot: project.root,
      componentRoots: [
        {
          path: `${project.root}/src/components/ui`,
          confidence: 95,
          reason: 'test root',
        },
      ],
      nodes: [
        {
          id: 'src/components/ui/button.tsx',
          path: filePath,
          name: 'button',
          confidence: 90,
          confidenceBand: 'high',
          kind: 'primitive',
          exports: ['Button'],
          imports: [],
          classUsageCount: 1,
          lineCount: 1,
          size: 60,
          lastModified: new Date().toISOString(),
        },
      ],
      edges: [],
      summary: {
        filesIndexed: 1,
        highConfidence: 1,
        mediumConfidence: 0,
        lowConfidence: 0,
      },
    };

    const first = await buildResearchPlan({
      runId: graph.runId,
      goals: ['radius-normalization'],
      graph,
      maxFiles: 100,
    });
    const second = await buildResearchPlan({
      runId: graph.runId,
      goals: ['radius-normalization'],
      graph,
      maxFiles: 100,
    });

    assert.equal(first.plan.rules.length, 1);
    assert.equal(first.plan.targets.length, 1);
    assert.equal(first.plan.blocked, false);
    assert.equal(first.plan.checksum, second.plan.checksum);
  } finally {
    await project.cleanup();
  }
});

test('buildResearchPlan blocks when all rules are rejected', async () => {
  const project = await createTempProject();
  try {
    const filePath = await writeProjectFile(
      project.root,
      'src/components/ui/button.tsx',
      'export function Button() { return <button className="rounded-md" />; }\n'
    );

    const graph: ComponentGraph = {
      runId: 'run_2026-02-23_22-01-09-321_b1c2d3',
      generatedAt: new Date().toISOString(),
      projectRoot: project.root,
      componentRoots: [],
      nodes: [
        {
          id: 'src/components/ui/button.tsx',
          path: filePath,
          name: 'button',
          confidence: 90,
          confidenceBand: 'high',
          kind: 'primitive',
          exports: ['Button'],
          imports: [],
          classUsageCount: 1,
          lineCount: 1,
          size: 60,
          lastModified: new Date().toISOString(),
        },
      ],
      edges: [],
      summary: {
        filesIndexed: 1,
        highConfidence: 1,
        mediumConfidence: 0,
        lowConfidence: 0,
      },
    };

    const result = await buildResearchPlan({
      runId: graph.runId,
      goals: [],
      graph,
      customRules: [{ find: '(', replace: '', isRegex: true }],
      maxFiles: 100,
    });

    assert.equal(result.plan.rules.length, 0);
    assert.equal(result.plan.blocked, true);
    assert.equal(result.rejectedRules.length, 1);
  } finally {
    await project.cleanup();
  }
});
