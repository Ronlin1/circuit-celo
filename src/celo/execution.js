import { prepareCeloTransfer } from './gateway.js';

export function authorizeAndPrepare({ decision, intent, config }) {
  if (decision?.action !== 'ALLOW') {
    throw new Error(`Celo execution requires an ALLOW verdict; received ${decision?.action ?? 'NONE'}`);
  }
  const prepared = prepareCeloTransfer(intent, config);
  return Object.freeze({
    ...prepared,
    authorization: Object.freeze({ action: decision.action, reasonCodes: decision.reasonCodes ?? [] })
  });
}
