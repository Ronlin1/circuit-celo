import { ERC8004 } from './config.js';

const OWNER_OF_SELECTOR = '6352211e';
const ADDRESS_RESULT = /^0x[0-9a-fA-F]{64}$/;

export function buildOwnerOfCall(agentId) {
  const id = typeof agentId === 'bigint' ? agentId : BigInt(agentId);
  if (id < 0n) throw new RangeError('agentId must be non-negative');
  const word = id.toString(16).padStart(64, '0');
  if (word.length > 64) throw new RangeError('agentId exceeds uint256');
  return `0x${OWNER_OF_SELECTOR}${word}`;
}

export function decodeOwnerOfResult(result) {
  if (!ADDRESS_RESULT.test(result ?? '')) throw new TypeError('ownerOf result must be a 32-byte hex word');
  const owner = `0x${result.slice(-40)}`;
  if (/^0x0{40}$/i.test(owner)) return null;
  return owner;
}

export function identityEvidenceFromRpc({ agentId, result }) {
  const owner = decodeOwnerOfResult(result);
  return Object.freeze({ registered: Boolean(owner), agentId: String(agentId), owner, standard: 'ERC-8004' });
}

export function buildIdentityRpcRequest(agentId) {
  return Object.freeze({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: ERC8004.identityRegistry, data: buildOwnerOfCall(agentId) }, 'latest']
  });
}
