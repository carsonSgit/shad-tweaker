import assert from 'node:assert/strict';
import test from 'node:test';
import {
  escapeRegExpLiteral,
  validateResearchRunId,
  validateTemplateRulesDetailed,
} from '../src/utils/validation.js';

test('validateTemplateRulesDetailed rejects invalid regex rules', () => {
  const result = validateTemplateRulesDetailed([{ find: '(', replace: '', isRegex: true }]);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === 'INVALID_REGEX'));
});

test('validateTemplateRulesDetailed accepts valid regex and plain text rules', () => {
  const result = validateTemplateRulesDetailed([
    { find: 'rounded-md', replace: 'rounded-lg', isRegex: false },
    { find: '\\s*cursor-pointer', replace: '', isRegex: true },
  ]);

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateResearchRunId accepts expected format and rejects traversal payloads', () => {
  assert.equal(validateResearchRunId('run_2026-02-23_22-01-09-321_a1b2c3').valid, true);
  assert.equal(validateResearchRunId('run_2026-02-23_22-01-09-321_a1b2c3/../etc').valid, false);
  assert.equal(validateResearchRunId('run_bad').valid, false);
});

test('escapeRegExpLiteral escapes regex metacharacters', () => {
  const value = 'class(name)+$';
  const escaped = escapeRegExpLiteral(value);
  assert.equal(escaped, 'class\\(name\\)\\+\\$');
});
