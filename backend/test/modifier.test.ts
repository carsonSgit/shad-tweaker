import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChanges, getBatchAction } from '../src/services/modifier.js';

test('getBatchAction remove-class escapes regex-sensitive class values', () => {
  const result = getBatchAction('remove-class', { className: 'btn(primary)+' });

  assert.ok(result.action);
  assert.equal(result.error, undefined);
  assert.match(result.action?.find || '', /btn\\\(primary\\\)\\\+/);
  assert.equal(result.action?.isRegex, true);
});

test('getBatchAction remove-class requires className option', () => {
  const result = getBatchAction('remove-class', {});

  assert.equal(result.action, null);
  assert.equal(result.code, 'BATCH_ACTION_INVALID_OPTIONS');
});

test('applyChanges returns INVALID_REGEX for malformed regex patterns', async () => {
  const result = await applyChanges([], '(', '', true, false);

  assert.equal(result.success, false);
  assert.equal(result.errors?.[0]?.code, 'INVALID_REGEX');
});

