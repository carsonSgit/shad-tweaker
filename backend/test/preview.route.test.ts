import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import previewRouter from '../src/routes/preview.js';

const app = express();
app.use(express.json());
app.use('/api/studio/preview', previewRouter);
app.use('/studio/preview', previewRouter);

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(
  process.cwd(),
  '.shadcn-tweaker-test-workspaces',
  'preview-routes'
);

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(path.join(root, 'components/ui'));
  process.env.SHADCN_TWEAKER_CWD = root;
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  delete process.env.SHADCN_TWEAKER_CWD;
});

after(async () => {
  await fs.remove(testWorkspaceBase);
});

describe('studio preview routes', () => {
  it('returns a manifest with exports, variants, controls, and frame URL', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/button.tsx'),
      `import { cva } from 'class-variance-authority';

const buttonVariants = cva('inline-flex', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground',
      ghost: 'bg-transparent',
    },
    size: {
      sm: 'h-8 px-3',
      lg: 'h-10 px-4',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'sm',
  },
});

export function Button(props: { children?: string }) {
  return <button className={buttonVariants()}>{props.children ?? 'Button'}</button>;
}

export function ButtonIcon() {
  return <Button>Icon</Button>;
}`
    );

    const res = await request(app)
      .post('/api/studio/preview/manifest')
      .send({ componentPath: 'components/ui/button.tsx' });

    assert.equal(res.status, 200);
    assert.equal(res.body.manifest.component.name, 'button');
    assert.equal(res.body.manifest.component.path, 'components/ui/button.tsx');
    assert.deepEqual(res.body.manifest.component.exports, ['Button', 'ButtonIcon']);
    assert.equal(res.body.manifest.component.defaultExport, 'Button');
    assert.equal(res.body.manifest.variants.length, 1);
    assert.deepEqual(res.body.manifest.variants[0].axes.map((axis: { name: string }) => axis.name), [
      'variant',
      'size',
    ]);
    assert.deepEqual(res.body.manifest.states, [
      'default',
      'hover',
      'focus',
      'disabled',
      'loading',
      'open',
      'selected',
    ]);
    assert.equal(res.body.manifest.viewports.mobile.width, 390);
    assert.match(res.body.manifest.frameUrl, /^\/studio\/preview\/frame\?/);
    assert.ok(Array.isArray(res.body.manifest.diagnostics));
  });

  it('rejects unsafe preview component paths', async () => {
    await createTempRoot();

    const res = await request(app)
      .post('/api/studio/preview/manifest')
      .send({ componentPath: '../secret.tsx' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_PREVIEW_VALIDATION_ERROR');
  });

  it('returns 404 for missing preview components', async () => {
    await createTempRoot();

    const res = await request(app)
      .post('/api/studio/preview/manifest')
      .send({ componentPath: 'components/ui/missing.tsx' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'COMPONENT_PREVIEW_NOT_FOUND');
  });

  it('returns a preview frame shell that loads the runtime entry', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/badge.tsx'),
      `export function Badge() { return <span>Badge</span>; }`
    );

    const res = await request(app)
      .get('/studio/preview/frame')
      .query({ componentPath: 'components/ui/badge.tsx', exportName: 'Badge' });

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /html/);
    assert.match(res.text, /id="preview-root"/);
    assert.match(res.text, /\/studio\/preview\/runtime/);
    assert.match(res.text, /data-theme="light"/);
    assert.match(res.text, /data-density="default"/);
  });

  it('returns a runtime module that imports the selected local component', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/card.tsx'),
      `export function Card() { return <section>Card</section>; }`
    );

    const res = await request(app)
      .get('/studio/preview/runtime')
      .query({
        componentPath: 'components/ui/card.tsx',
        exportName: 'Card',
        state: 'selected',
        'variant.tone': 'muted',
      });

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);
    assert.match(res.text, /from '\/studio\/preview\/component\//);
    assert.match(res.text, /const exportName = "Card"/);
    assert.match(res.text, /data-preview-state/);
    assert.match(res.text, /"aria-selected": true/);
    assert.match(res.text, /"tone": "muted"/);
  });

  it('returns a component import module for a safe local component path', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/switch.tsx'),
      `export function Switch() { return <button>Switch</button>; }`
    );

    const res = await request(app).get(
      `/studio/preview/component/${encodeURIComponent('components/ui/switch.tsx')}`
    );

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);
    assert.match(res.text, /export \* from "\/components\/ui\/switch.tsx"/);
    assert.match(res.text, /export \{ default \} from "\/components\/ui\/switch.tsx"/);
  });

  it('surfaces parser diagnostics in the preview manifest', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/dynamic.tsx'),
      `function getClasses() { return 'bg-primary'; }

export function Dynamic() { return <button className={getClasses()}>Dynamic</button>; }`
    );

    const res = await request(app)
      .post('/api/studio/preview/manifest')
      .send({ componentPath: 'components/ui/dynamic.tsx' });

    assert.equal(res.status, 200);
    assert.ok(res.body.manifest.diagnostics.length > 0);
    assert.ok(
      res.body.manifest.diagnostics.some(
        (diagnostic: { code: string }) => diagnostic.code === 'UNSUPPORTED_CLASSNAME_EXPRESSION'
      )
    );
  });
});
