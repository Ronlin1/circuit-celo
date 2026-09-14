import { ASSETS, isEvmAddress } from './config.js';

const PRECEDENCE = Object.freeze({ ALLOW: 0, RESIZE: 1, REVIEW: 2, BLOCK: 3, PAUSE: 4 });
const USD_PAR_ASSETS = new Set(['USAT', 'USDC', 'USDT', 'USDm']);
const makeCheck = (code, passed, severity, message) => Object.freeze({ code, passed, severity, message });

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function tokenAmount(intent) {
  if (intent?.amountBaseUnits == null || !ASSETS[intent?.asset]) return null;
  try {
    const raw = BigInt(intent.amountBaseUnits);
    if (raw <= 0n) return null;
    const decimals = ASSETS[intent.asset].decimals;
    const value = Number(raw) / (10 ** decimals);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function treasuryChecks({ mandate, intent, context = {} }) {
  const checks = [];
  const amountTokens = tokenAmount(intent);
  const validRecipient = isEvmAddress(intent?.recipient);

  checks.push(makeCheck('MANDATE_NOT_ACTIVE', mandate?.status === 'ACTIVE', 'HARD', mandate?.status === 'ACTIVE' ? 'Treasury mandate is active.' : 'An active treasury mandate is required.'));
  checks.push(makeCheck('CHAIN_NOT_ALLOWED', Number(intent?.chainId) === Number(mandate?.chainId), 'HARD', Number(intent?.chainId) === Number(mandate?.chainId) ? 'Intent targets the authorized chain.' : 'Intent targets a chain outside the mandate.'));
  checks.push(makeCheck('ASSET_NOT_ALLOWED', Boolean(mandate?.allowedAssets?.includes(intent?.asset)), 'HARD', mandate?.allowedAssets?.includes(intent?.asset) ? `${intent.asset} is allowed.` : `${intent?.asset ?? 'Unknown asset'} is outside the mandate.`));
  checks.push(makeCheck('INVALID_RECIPIENT', validRecipient, 'HARD', validRecipient ? 'Recipient is a valid EVM address.' : 'Recipient must be a valid 20-byte EVM address.'));
  checks.push(makeCheck('INVALID_PAYMENT_AMOUNT', finitePositive(intent?.requestedUsd), 'HARD', finitePositive(intent?.requestedUsd) ? 'Payment amount is positive and finite.' : 'Payment amount must be positive and finite.'));

  const underPaymentCap = finitePositive(intent?.requestedUsd) && Number.isFinite(mandate?.maxPaymentUsd) && intent.requestedUsd <= mandate.maxPaymentUsd;
  checks.push(makeCheck('PAYMENT_CAP_EXCEEDED', underPaymentCap, 'HARD', underPaymentCap ? 'Payment is within the per-action cap.' : 'Payment exceeds the per-action cap.'));

  const assetUnitCap = mandate?.assetUnitCaps?.[intent?.asset];
  const withinTokenCap = amountTokens == null || !Number.isFinite(assetUnitCap) || amountTokens <= assetUnitCap;
  checks.push(makeCheck('TOKEN_AMOUNT_CAP_EXCEEDED', withinTokenCap, 'HARD', withinTokenCap ? 'Token amount is within the asset cap.' : 'Token amount exceeds the asset-specific cap.'));

  let valueMatches = true;
  if (amountTokens != null && USD_PAR_ASSETS.has(intent?.asset) && finitePositive(intent?.requestedUsd)) {
    const tolerance = Math.max(0.01, intent.requestedUsd * 0.01);
    valueMatches = Math.abs(amountTokens - intent.requestedUsd) <= tolerance;
  }
  checks.push(makeCheck('POLICY_VALUE_MISMATCH', valueMatches, 'HARD', valueMatches ? 'Declared policy value matches the transfer amount.' : 'Transfer amount does not match the declared policy value.'));

  const dailySpend = Number(context?.dailySpendUsd ?? 0);
  const withinDaily = Number.isFinite(dailySpend) && Number.isFinite(mandate?.maxDailySpendUsd) && finitePositive(intent?.requestedUsd) && dailySpend + intent.requestedUsd <= mandate.maxDailySpendUsd;
  checks.push(makeCheck('DAILY_BUDGET_EXCEEDED', withinDaily, 'HARD', withinDaily ? 'Daily budget remains within the mandate.' : 'Payment would exceed the daily treasury budget.'));

  const x402Allowed = intent?.kind !== 'X402' || (Number.isFinite(mandate?.maxX402Usd) && finitePositive(intent?.requestedUsd) && intent.requestedUsd <= mandate.maxX402Usd);
  checks.push(makeCheck('X402_PRICE_CAP_EXCEEDED', x402Allowed, 'HARD', x402Allowed ? 'x402 price is within policy.' : 'x402 price exceeds the mandate cap.'));

  const identityAllowed = !mandate?.requireAgentIdentity || Boolean(context?.agentIdentity?.registered);
  checks.push(makeCheck('AGENT_IDENTITY_REQUIRED', identityAllowed, 'HARD', identityAllowed ? 'Agent identity requirement is satisfied.' : 'A verified ERC-8004 identity is required.'));

  const injectionSafe = !intent?.policyOverrideRequested && !intent?.promptInjectionDetected;
  checks.push(makeCheck('POLICY_OVERRIDE_ATTEMPT', injectionSafe, 'HARD', injectionSafe ? 'No policy override attempt detected.' : 'Untrusted agent text attempted to override the mandate.'));

  const duplicateSafe = !context?.recentIntentIds?.includes(intent?.intentId);
  checks.push(makeCheck('DUPLICATE_INTENT', duplicateSafe, 'PAUSE', duplicateSafe ? 'No semantic duplicate is pending.' : 'This intent was already observed; automatic retry is paused.'));

  const known = mandate?.knownRecipients?.map((value) => value.toLowerCase()).includes((intent?.recipient ?? '').toLowerCase());
  const needsReview = Boolean(!known && finitePositive(intent?.requestedUsd) && Number.isFinite(mandate?.unknownRecipientReviewUsd) && intent.requestedUsd > mandate.unknownRecipientReviewUsd);
  checks.push(makeCheck('UNKNOWN_RECIPIENT_REVIEW', !needsReview, 'REVIEW', needsReview ? 'Unknown recipient exceeds the autonomous review threshold.' : 'Recipient policy is satisfied.'));
  return Object.freeze(checks);
}

export function evaluateTreasuryIntent(input) {
  const checks = treasuryChecks(input);
  const failed = checks.filter((entry) => !entry.passed);
  const reasonCodes = failed.map((entry) => entry.code);
  let action = 'ALLOW';
  if (failed.some((entry) => entry.severity === 'PAUSE')) action = 'PAUSE';
  else if (failed.some((entry) => entry.severity === 'HARD')) action = 'BLOCK';
  else if (failed.some((entry) => entry.severity === 'REVIEW')) action = 'REVIEW';
  const decision = { action, checks, reasonCodes };
  if (PRECEDENCE[action] <= PRECEDENCE.RESIZE) decision.approvedUsd = input.intent.requestedUsd;
  return Object.freeze(decision);
}
