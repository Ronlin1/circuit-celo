import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerOfCall, decodeOwnerOfResult, identityEvidenceFromRpc } from '../../src/celo/agent-trust.js';

test('encodes ERC-8004 IdentityRegistry ownerOf call', () => {
  const data = buildOwnerOfCall(42n);
  assert.equal(data, '0x6352211e' + '2a'.padStart(64, '0'));
});

test('decodes registered owner from ownerOf result', () => {
  const result = '0x' + '0000000000000000000000001111111111111111111111111111111111111111';
  assert.equal(decodeOwnerOfResult(result), '0x1111111111111111111111111111111111111111');
  assert.deepEqual(identityEvidenceFromRpc({ agentId: '42', result }), { registered: true, agentId: '42', owner: '0x1111111111111111111111111111111111111111', standard: 'ERC-8004' });
});
