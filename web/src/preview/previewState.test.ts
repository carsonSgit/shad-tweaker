import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { VariantAxis } from '@studio-shared';
import { previewFrameUrl, variantGridSelections } from './previewState';

const originalWindow = globalThis.window;

after(() => {
  globalThis.window = originalWindow;
});

describe('preview variant grid selections', () => {
  it('returns every selection when the cartesian product is within the limit', () => {
    const axes: VariantAxis[] = [
      {
        name: 'tone',
        values: [
          { name: 'default', classes: [] },
          { name: 'muted', classes: [] },
        ],
      },
      {
        name: 'size',
        values: [
          { name: 'sm', classes: [] },
          { name: 'lg', classes: [] },
        ],
      },
    ];

    const result = variantGridSelections(axes);

    assert.equal(result.total, 4);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.selections, [
      { tone: 'default', size: 'sm' },
      { tone: 'default', size: 'lg' },
      { tone: 'muted', size: 'sm' },
      { tone: 'muted', size: 'lg' },
    ]);
  });

  it('caps large cartesian products and reports truncation metadata', () => {
    const axes: VariantAxis[] = Array.from({ length: 5 }, (_, axisIndex) => ({
      name: `axis${axisIndex}`,
      values: Array.from({ length: 4 }, (_, valueIndex) => ({
        name: `value${valueIndex}`,
        classes: [],
      })),
    }));

    const result = variantGridSelections(axes);

    assert.equal(result.total, 1024);
    assert.equal(result.truncated, true);
    assert.equal(result.selections.length, 20);
  });
});

describe('preview frame URLs', () => {
  it('preserves the selected export name in iframe URLs', () => {
    globalThis.window = {
      location: { href: 'http://localhost:3000/studio', origin: 'http://localhost:3000' },
    } as Window & typeof globalThis;

    const url = previewFrameUrl(
      {
        componentPath: 'components/ui/button.tsx',
        exportName: 'ButtonIcon',
        viewport: 'desktop',
        theme: 'light',
        density: 'default',
        state: 'default',
        variants: {},
      },
      'http://127.0.0.1:3001/studio/preview/frame?componentPath=components%2Fui%2Fbutton.tsx'
    );

    assert.match(url, /exportName=ButtonIcon/);
  });
});
