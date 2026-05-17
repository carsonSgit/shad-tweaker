import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import backendPackage from '../package.json' with { type: 'json' };

describe('package compatibility', () => {
  it('keeps the React Vite plugin on the Vite 7 compatible major', () => {
    assert.match(backendPackage.dependencies.vite, /^\^7\./);
    assert.match(backendPackage.dependencies['@vitejs/plugin-react'], /^\^5\./);
  });
});
