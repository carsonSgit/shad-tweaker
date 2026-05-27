import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import {
  createPreviewApiLimiter,
  createPreviewApiRouter,
  createPreviewBrowserRouter,
} from '../src/routes/preview.js';
import {
  createPreviewFrameHtml,
  getPreviewOrigin,
  getPreviewPort,
  getStudioOrigin,
} from '../src/services/preview.js';

const app = express();
app.use(express.json());
app.use('/api/studio/preview', createPreviewApiRouter());
app.use('/studio/preview', createPreviewBrowserRouter());

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
  delete process.env.PORT;
  delete process.env.PREVIEW_PORT;
  delete process.env.PREVIEW_ORIGIN;
  delete process.env.STUDIO_ORIGIN;
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
    assert.deepEqual(
      res.body.manifest.variants[0].axes.map((axis: { name: string }) => axis.name),
      ['variant', 'size']
    );
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
    assert.match(
      res.body.manifest.frameUrl,
      /^http:\/\/127\.0\.0\.1:\d+\/studio\/preview\/frame\?/
    );
    assert.doesNotMatch(res.body.manifest.frameUrl, /exportName=Button/);
    assert.doesNotMatch(res.body.manifest.frameUrl, /exportName=/);
    assert.ok(Array.isArray(res.body.manifest.diagnostics));
  });

  it('returns a manifest and frame URL for a selected named export', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/button.tsx'),
      `export function Button() { return <button>Button</button>; }
export function ButtonIcon() { return <span>Icon</span>; }`
    );

    const res = await request(app).post('/api/studio/preview/manifest').send({
      componentPath: 'components/ui/button.tsx',
      exportName: 'ButtonIcon',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.manifest.component.defaultExport, 'ButtonIcon');
    assert.match(res.body.manifest.frameUrl, /exportName=ButtonIcon/);
  });

  it('rejects unsafe preview component paths', async () => {
    await createTempRoot();

    for (const componentPath of [
      '../secret.tsx',
      '/tmp/secret.tsx',
      'components/ui/card.ts',
      'components/ui/card<script>.tsx',
      'components/ui/card.tsx\0.js',
    ]) {
      const res = await request(app).post('/api/studio/preview/manifest').send({ componentPath });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'COMPONENT_PREVIEW_VALIDATION_ERROR');
    }
  });

  it('rejects unsafe preview export names for manifests', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/button.tsx'),
      `export function Button() { return <button>Button</button>; }`
    );

    const res = await request(app).post('/api/studio/preview/manifest').send({
      componentPath: 'components/ui/button.tsx',
      exportName: 'Button";alert(1)//',
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_PREVIEW_VALIDATION_ERROR');
  });

  it('rejects unsafe preview export names for runtime modules', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/button.tsx'),
      `export function Button() { return <button>Button</button>; }`
    );

    const res = await request(app).get('/studio/preview/runtime').query({
      componentPath: 'components/ui/button.tsx',
      exportName: 'Button";alert(1)//',
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_PREVIEW_VALIDATION_ERROR');
  });

  it('rejects safe export names that are not exported by the component', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/button.tsx'),
      `export function Button() { return <button>Button</button>; }`
    );

    const res = await request(app).post('/api/studio/preview/manifest').send({
      componentPath: 'components/ui/button.tsx',
      exportName: 'ButtonIcon',
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_PREVIEW_VALIDATION_ERROR');
    assert.equal(res.body.error.message, 'Component export not found: ButtonIcon');
  });

  it('sanitizes preview variants from request bodies and query strings', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/card.tsx'),
      `export function Card() { return <section>Card</section>; }`
    );

    const manifestRes = await request(app)
      .post('/api/studio/preview/manifest')
      .send({
        componentPath: 'components/ui/card.tsx',
        variants: Object.fromEntries([
          [' tone ', ' muted '],
          ['__proto__', 'polluted'],
          ['constructor', 'polluted'],
          ['prototype', 'polluted'],
          ['bad.key', 'value'],
          ['size', 'lg<script>'],
          ['empty', ''],
        ]),
      });

    assert.equal(manifestRes.status, 200);
    assert.match(manifestRes.body.manifest.frameUrl, /variant\.tone=muted/);
    assert.doesNotMatch(manifestRes.body.manifest.frameUrl, /__proto__/);
    assert.doesNotMatch(manifestRes.body.manifest.frameUrl, /constructor/);
    assert.doesNotMatch(manifestRes.body.manifest.frameUrl, /prototype/);
    assert.doesNotMatch(manifestRes.body.manifest.frameUrl, /bad\.key/);
    assert.doesNotMatch(manifestRes.body.manifest.frameUrl, /lg%3Cscript/);

    const runtimeRes = await request(app).get('/studio/preview/runtime').query({
      componentPath: 'components/ui/card.tsx',
      'variant.tone': ' muted ',
      'variant.bad.key': 'value',
      'variant.__proto__': 'polluted',
      'variant.size': 'lg<script>',
    });

    assert.equal(runtimeRes.status, 200);
    assert.match(runtimeRes.text, /"tone": "muted"/);
    assert.doesNotMatch(runtimeRes.text, /__proto__/);
    assert.doesNotMatch(runtimeRes.text, /bad\.key/);
    assert.doesNotMatch(runtimeRes.text, /lg<script>/);
  });

  it('rejects traversal-like preview component paths for runtime modules', async () => {
    await createTempRoot();

    const res = await request(app).get('/studio/preview/runtime').query({
      componentPath: '../secret.tsx',
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_PREVIEW_VALIDATION_ERROR');
  });

  it('rejects traversal-like preview component paths for component import modules', async () => {
    await createTempRoot();

    const res = await request(app).get(
      `/studio/preview/component/${encodeURIComponent('../secret.tsx')}`
    );

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_PREVIEW_VALIDATION_ERROR');
  });

  it('rejects unsupported preview enum options', async () => {
    await createTempRoot();

    for (const [field, value, message] of [
      ['viewport', 'watch', 'viewport must be one of: desktop, tablet, mobile.'],
      ['theme', 'sepia', 'theme must be one of: light, dark, system.'],
      ['density', 'spacious', 'density must be one of: comfortable, default, compact.'],
      [
        'state',
        'dragging',
        'state must be one of: default, hover, focus, disabled, loading, open, selected.',
      ],
    ]) {
      const res = await request(app)
        .get('/studio/preview/frame')
        .query({ componentPath: 'components/ui/card.tsx', [field]: value });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'COMPONENT_PREVIEW_VALIDATION_ERROR');
      assert.equal(res.body.error.message, message);
    }
  });

  it('returns a validation error when a component has no previewable exports', async () => {
    const root = await createTempRoot();
    await fs.writeFile(path.join(root, 'components/ui/empty.tsx'), `const label = 'Empty';`);

    const res = await request(app)
      .post('/api/studio/preview/manifest')
      .send({ componentPath: 'components/ui/empty.tsx' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_PREVIEW_VALIDATION_ERROR');
    assert.equal(res.body.error.message, 'Component has no previewable exports.');
  });

  it('keeps preview API and browser routes partitioned', async () => {
    await createTempRoot();

    const apiFrame = await request(app)
      .get('/api/studio/preview/frame')
      .query({ componentPath: 'components/ui/card.tsx' });
    const browserManifest = await request(app)
      .post('/studio/preview/manifest')
      .send({ componentPath: 'components/ui/card.tsx' });

    assert.equal(apiFrame.status, 404);
    assert.equal(browserManifest.status, 404);
  });

  it('can rate limit preview API routes', async () => {
    const limitedApp = express();
    limitedApp.use(express.json());
    limitedApp.use('/api/studio/preview', createPreviewApiLimiter(1), createPreviewApiRouter());
    await createTempRoot();

    await request(limitedApp)
      .post('/api/studio/preview/manifest')
      .send({ componentPath: 'components/ui/missing.tsx' });
    const res = await request(limitedApp)
      .post('/api/studio/preview/manifest')
      .send({ componentPath: 'components/ui/missing.tsx' });

    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'RATE_LIMIT_EXCEEDED');
  });

  it('rejects preview manifest component paths that resolve through symlinks outside the workspace', async () => {
    const root = await createTempRoot();
    const outsideRoot = path.join(testWorkspaceBase, randomUUID());
    tempRoots.push(outsideRoot);
    await fs.ensureDir(outsideRoot);
    await fs.writeFile(
      path.join(outsideRoot, 'escaped.tsx'),
      `export function Escaped() { return <button>Escaped</button>; }`
    );
    await fs.symlink(
      path.join(outsideRoot, 'escaped.tsx'),
      path.join(root, 'components/ui/escaped.tsx')
    );

    const res = await request(app)
      .post('/api/studio/preview/manifest')
      .send({ componentPath: 'components/ui/escaped.tsx' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_PREVIEW_VALIDATION_ERROR');
  });

  it('rejects preview runtime component paths that resolve through symlinks outside the workspace', async () => {
    const root = await createTempRoot();
    const outsideRoot = path.join(testWorkspaceBase, randomUUID());
    tempRoots.push(outsideRoot);
    await fs.ensureDir(outsideRoot);
    await fs.writeFile(
      path.join(outsideRoot, 'escaped.tsx'),
      `export function Escaped() { return <button>Escaped</button>; }`
    );
    await fs.symlink(
      path.join(outsideRoot, 'escaped.tsx'),
      path.join(root, 'components/ui/escaped.tsx')
    );

    const res = await request(app).get('/studio/preview/runtime').query({
      componentPath: 'components/ui/escaped.tsx',
    });

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
      .query({ componentPath: 'components/ui/badge.tsx' });

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /html/);
    assert.match(res.text, /id="preview-root"/);
    assert.match(res.text, /\/studio\/preview\/runtime/);
    assert.match(res.text, /data-theme="light"/);
    assert.match(res.text, /data-density="default"/);
  });

  it('sets a local-only frame-ancestors CSP on preview browser responses', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/badge.tsx'),
      `export function Badge() { return <span>Badge</span>; }`
    );

    const res = await request(app)
      .get('/studio/preview/frame')
      .query({ componentPath: 'components/ui/badge.tsx' });

    assert.equal(res.status, 200);
    assert.equal(
      res.headers['content-security-policy'],
      "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*"
    );
    assert.equal(res.headers['x-frame-options'], undefined);
  });

  it('escapes preview frame theme and density attributes', () => {
    const html = createPreviewFrameHtml({
      componentPath: 'components/ui/badge.tsx',
      theme: 'dark"&<>' as never,
      density: 'compact"&<>' as never,
    });

    assert.match(html, /data-theme="dark&quot;&amp;&lt;&gt;"/);
    assert.match(html, /data-density="compact&quot;&amp;&lt;&gt;"/);
    assert.doesNotMatch(html, /data-theme="dark"&<>"/);
    assert.doesNotMatch(html, /data-density="compact"&<>"/);
  });

  it('returns a runtime module that imports the selected local component', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/card.tsx'),
      `export function Card() { return <section>Card</section>; }`
    );

    const res = await request(app).get('/studio/preview/runtime').query({
      componentPath: 'components/ui/card.tsx',
      state: 'selected',
      'variant.tone': 'muted',
    });

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);
    assert.match(res.text, /from ["']\/studio\/preview\/component\//);
    assert.match(res.text, /const exportName = "Card"/);
    assert.match(res.text, /const parentOrigin = "http:\/\/127\.0\.0\.1:\d+"/);
    assert.equal(res.text.match(/postMessage\(/g)?.length, 2);
    assert.equal(res.text.match(/postMessage\([\s\S]*?parentOrigin\)/g)?.length, 2);
    assert.doesNotMatch(res.text, /postMessage\([^;]+,\s*'\*'\)/s);
    assert.match(res.text, /data-preview-state/);
    assert.match(res.text, /data-preview-label/);
    assert.match(res.text, /data-force-hover/);
    assert.doesNotMatch(res.text, /"children":/);
    assert.match(res.text, /React\.createElement\(PreviewErrorBoundary, null,/);
    assert.match(res.text, /React\.createElement\(Component, previewProps\)/);
    assert.match(res.text, /"aria-selected": true/);
    assert.match(res.text, /"tone": "muted"/);
  });

  it('serializes runtime request values as JavaScript data, not executable code', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/alert-card.tsx'),
      `export function AlertCard() { return <section>Alert</section>; }`
    );

    const res = await request(app).get('/studio/preview/runtime').query({
      componentPath: 'components/ui/alert-card.tsx',
      parentOrigin: 'http://localhost:4321',
      state: 'open',
      'variant.intent': 'alert',
    });

    assert.equal(res.status, 200);
    assert.match(res.text, /const parentOrigin = "http:\/\/localhost:4321"/);
    assert.match(res.text, /"data-preview-state": "open"/);
    assert.match(res.text, /"intent": "alert"/);
    assert.doesNotMatch(res.text, /postMessage\([^;]+,\s*['"]\*['"]\)/s);
    assert.doesNotMatch(res.text, /;\s*alert\s*\(/);
  });

  it('returns a runtime module for a selected named export', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/card.tsx'),
      `export function Card() { return <section>Card</section>; }
export function CardPreview() { return <section>Preview</section>; }`
    );

    const res = await request(app).get('/studio/preview/runtime').query({
      componentPath: 'components/ui/card.tsx',
      exportName: 'CardPreview',
    });

    assert.equal(res.status, 200);
    assert.match(res.text, /const exportName = "CardPreview"/);
  });

  it('returns preview frame and runtime markup that can simulate hover state', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/hover-card.tsx'),
      `export function HoverCard() { return <button>Hover</button>; }`
    );

    const frameRes = await request(app).get('/studio/preview/frame').query({
      componentPath: 'components/ui/hover-card.tsx',
      state: 'hover',
    });
    const runtimeRes = await request(app).get('/studio/preview/runtime').query({
      componentPath: 'components/ui/hover-card.tsx',
      state: 'hover',
    });

    assert.equal(frameRes.status, 200);
    assert.match(frameRes.text, /\[data-force-hover="true"\]/);
    assert.equal(runtimeRes.status, 200);
    assert.match(runtimeRes.text, /"data-force-hover": true/);
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
    assert.match(res.text, /export default PreviewModule.default/);
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

  it('falls back to safe local preview and studio origins for invalid environment values', () => {
    process.env.PORT = '4100';
    process.env.PREVIEW_PORT = 'not-a-number';
    process.env.PREVIEW_ORIGIN = 'https://example.com';
    process.env.STUDIO_ORIGIN = 'https://example.com';

    assert.equal(getPreviewPort(), 4101);
    assert.equal(getPreviewOrigin(), 'http://127.0.0.1:4101');
    assert.equal(getStudioOrigin(), 'http://127.0.0.1:4100');

    process.env.PORT = 'not-a-number';

    assert.equal(getPreviewPort(), 3001);
    assert.equal(getPreviewOrigin(), 'http://127.0.0.1:3001');
    assert.equal(getStudioOrigin(), 'http://127.0.0.1:3000');
  });
});
