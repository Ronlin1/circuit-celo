import { JUDGE_MANDATE } from './judge-scenarios.js';

export const PUBLIC_MANDATE = Object.freeze({
  ...JUDGE_MANDATE,
  requireAgentIdentity: false
});
