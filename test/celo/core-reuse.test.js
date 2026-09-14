import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy } from 'circuit-core/src/policy/engine.js';

test('Celo runtime imports the pinned deterministic control core', () => {
  assert.equal(typeof evaluatePolicy, 'function');
});
