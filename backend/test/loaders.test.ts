import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generateBrailleLoader,
  getBrailleLoaderPreset,
  LoaderValidationError,
  listBrailleLoaderPresets,
} from '../src/services/loaders.js';

const BRAILLE_BLOCK = /^[⠀-⣿]+$/;

describe('braille loader presets', () => {
  it('exposes a curated preset catalog with unique ids', () => {
    const presets = listBrailleLoaderPresets();
    assert.ok(presets.length >= 8);
    const ids = presets.map((preset) => preset.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('keeps every frame and reduced-motion fallback in the braille block', () => {
    for (const preset of listBrailleLoaderPresets()) {
      assert.ok(preset.frames.length >= 2, `${preset.id} needs at least 2 frames`);
      for (const frame of preset.frames) {
        assert.match(frame, BRAILLE_BLOCK, `${preset.id} frame ${frame}`);
      }
      assert.match(preset.reducedMotionFrame, BRAILLE_BLOCK, preset.id);
      assert.ok(preset.intervalMs >= 30 && preset.intervalMs <= 2000, preset.id);
      assert.ok(preset.defaultLabel.length > 0, preset.id);
      assert.ok(preset.usage.length > 0, preset.id);
    }
  });

  it('throws a validation error for unknown preset ids', () => {
    assert.throws(() => getBrailleLoaderPreset('nope'), LoaderValidationError);
  });
});

describe('braille loader generation', () => {
  it('generates an accessible React component with preset defaults', () => {
    const generated = generateBrailleLoader({ presetId: 'braille-dots' });
    assert.equal(generated.componentName, 'DotsLoader');
    assert.equal(generated.fileName, 'DotsLoader.tsx');
    assert.equal(generated.intervalMs, 80);
    assert.ok(generated.code.includes('role="status"'));
    assert.ok(generated.code.includes('aria-live="polite"'));
    assert.ok(generated.code.includes('prefers-reduced-motion'));
    assert.ok(generated.code.includes('⠋'));
  });

  it('applies customization for name, speed, label, size, and color', () => {
    const generated = generateBrailleLoader({
      presetId: 'braille-ring',
      componentName: 'SyncSpinner',
      intervalMs: 45,
      label: 'Syncing workspace',
      sizeRem: 2,
      color: 'var(--primary)',
    });
    assert.equal(generated.componentName, 'SyncSpinner');
    assert.equal(generated.intervalMs, 45);
    assert.ok(generated.code.includes('const INTERVAL_MS = 45;'));
    assert.ok(generated.code.includes('"Syncing workspace"'));
    assert.ok(generated.code.includes("fontSize: '2rem'"));
    assert.ok(generated.code.includes('"var(--primary)"'));
  });

  it('renders the static fallback frame by default under reduced motion', () => {
    const generated = generateBrailleLoader({ presetId: 'braille-ring' });
    assert.equal(generated.reducedMotionMode, 'static-frame');
    assert.ok(generated.code.includes('⣿'));
  });

  it('supports a label-only reduced motion mode', () => {
    const generated = generateBrailleLoader({
      presetId: 'braille-dots',
      reducedMotionMode: 'label-only',
    });
    assert.equal(generated.reducedMotionMode, 'label-only');
    assert.ok(generated.code.includes('<span>{label}</span>'));
    assert.ok(!generated.code.includes('⠿'));
  });

  it('rejects invalid customization values', () => {
    assert.throws(
      () => generateBrailleLoader({ presetId: 'braille-dots', intervalMs: 5 }),
      LoaderValidationError
    );
    assert.throws(
      () => generateBrailleLoader({ presetId: 'braille-dots', componentName: 'not pascal' }),
      LoaderValidationError
    );
    assert.throws(
      () => generateBrailleLoader({ presetId: 'braille-dots', sizeRem: 40 }),
      LoaderValidationError
    );
    assert.throws(
      () => generateBrailleLoader({ presetId: 'braille-dots', label: '' }),
      LoaderValidationError
    );
  });

  it('rejects colors that could escape the generated string literal', () => {
    assert.throws(
      () => generateBrailleLoader({ presetId: 'braille-dots', color: "red'; alert(1); '" }),
      LoaderValidationError
    );
    assert.throws(
      () => generateBrailleLoader({ presetId: 'braille-dots', color: 'red"}${' }),
      LoaderValidationError
    );
  });
});
