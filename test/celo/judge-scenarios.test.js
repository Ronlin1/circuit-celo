import test from 'node:test';
import assert from 'node:assert/strict';
import { runJudgeScenarios } from '../../src/celo/judge-scenarios.js';

test('judge mode proves all eight expected containment outcomes', () => {
  const results = runJudgeScenarios();
  assert.equal(results.length, 8);
  assert.equal(results.filter((entry) => entry.passed).length, 8);
  assert.deepEqual(results.map((entry) => entry.actual), ['ALLOW','BLOCK','PAUSE','REVIEW','ALLOW','BLOCK','BLOCK','BLOCK']);
});
