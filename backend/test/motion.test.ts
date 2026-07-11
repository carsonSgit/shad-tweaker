import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMotionOutput,
  DEFAULT_MOTION_SETTINGS,
  MotionValidationError,
  validateMotionSettings,
} from '../src/services/motion.js';
import type { MotionSettings } from '../src/types/index.js';

const SETTINGS: MotionSettings = {
  durationMs: 300,
  delayMs: 50,
  easing: 'ease-out',
  transformOrigin: 'top',
  enter: { opacity: 0, scale: 0.95, translateX: 0, translateY: -8 },
  exit: { opacity: 0, scale: 0.9, translateX: 16, translateY: 0 },
  reducedMotion: 'fade-only',
};

describe('motion settings validation', () => {
  it('accepts and normalizes valid settings', () => {
    const settings = validateMotionSettings(SETTINGS);
    assert.deepEqual(settings, SETTINGS);
  });

  it('accepts the default settings', () => {
    assert.deepEqual(validateMotionSettings(DEFAULT_MOTION_SETTINGS), DEFAULT_MOTION_SETTINGS);
  });

  it('rejects out-of-range and malformed values', () => {
    assert.throws(
      () => validateMotionSettings({ ...SETTINGS, durationMs: -1 }),
      MotionValidationError
    );
    assert.throws(
      () => validateMotionSettings({ ...SETTINGS, easing: 'bouncy' }),
      MotionValidationError
    );
    assert.throws(
      () => validateMotionSettings({ ...SETTINGS, transformOrigin: 'middle' }),
      MotionValidationError
    );
    assert.throws(
      () => validateMotionSettings({ ...SETTINGS, enter: { ...SETTINGS.enter, opacity: 2 } }),
      MotionValidationError
    );
    assert.throws(
      () => validateMotionSettings({ ...SETTINGS, reducedMotion: 'off' }),
      MotionValidationError
    );
    assert.throws(() => validateMotionSettings(null), MotionValidationError);
  });
});

describe('motion output generation', () => {
  it('generates tailwindcss-animate utility classes', () => {
    const output = buildMotionOutput(SETTINGS);
    assert.ok(output.tailwindClasses.includes('duration-[300ms]'));
    assert.ok(output.tailwindClasses.includes('delay-[50ms]'));
    assert.ok(output.tailwindClasses.includes('ease-ease-out') === false);
    assert.ok(output.tailwindClasses.includes('ease-out'));
    assert.ok(output.tailwindClasses.includes('origin-top'));
    assert.ok(output.tailwindClasses.includes('animate-in'));
    assert.ok(output.tailwindClasses.includes('fade-in-0'));
    assert.ok(output.tailwindClasses.includes('zoom-in-95'));
    assert.ok(output.tailwindClasses.includes('slide-in-from-top-[8px]'));
    assert.ok(output.tailwindClasses.includes('animate-out'));
    assert.ok(output.tailwindClasses.includes('slide-out-to-right-[16px]'));
  });

  it('represents reduced-motion behavior in both outputs', () => {
    const fadeOnly = buildMotionOutput(SETTINGS);
    assert.ok(fadeOnly.tailwindClasses.includes('motion-reduce:transform-none'));
    assert.ok(fadeOnly.css.includes('prefers-reduced-motion'));

    const disabled = buildMotionOutput({ ...SETTINGS, reducedMotion: 'disable' });
    assert.ok(disabled.tailwindClasses.includes('motion-reduce:animate-none'));
    assert.ok(disabled.css.includes('animation: none'));

    const full = buildMotionOutput({ ...SETTINGS, reducedMotion: 'full' });
    assert.ok(!full.tailwindClasses.includes('motion-reduce'));
    assert.ok(!full.css.includes('prefers-reduced-motion'));
  });

  it('generates CSS variables and enter/exit keyframes', () => {
    const output = buildMotionOutput(SETTINGS);
    assert.ok(output.css.includes('--motion-duration: 300ms'));
    assert.ok(output.css.includes('--motion-delay: 50ms'));
    assert.ok(output.css.includes('@keyframes motion-enter'));
    assert.ok(output.css.includes('@keyframes motion-exit'));
    assert.ok(output.css.includes('transform-origin: top'));
  });

  it('omits enter/exit animation classes for identity phases', () => {
    const output = buildMotionOutput({
      ...SETTINGS,
      enter: { opacity: 1, scale: 1, translateX: 0, translateY: 0 },
      exit: { opacity: 1, scale: 1, translateX: 0, translateY: 0 },
    });
    assert.ok(!output.tailwindClasses.includes('animate-in'));
    assert.ok(!output.tailwindClasses.includes('animate-out'));
  });
});
