import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy } from 'circuit-core/src/policy/engine.js';

test('Celo fork pins and can import the original CIRCUIT deterministic core', () => {
  assert.equal(typeof evaluatePolicy, 'function');
});
