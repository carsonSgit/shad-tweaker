import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VariantAxis } from '@studio-shared';
import { variantGridSelections } from './previewState';

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
