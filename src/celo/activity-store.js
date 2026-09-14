function clone(value) {
  return value == null ? value : structuredClone(value);
}

function clampLimit(limit) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(numeric)));
}

function metricsFor(records) {
  const counts = { ALLOW: 0, BLOCK: 0, REVIEW: 0, PAUSE: 0 };
  let totalAuthorizedUsd = 0;
  let protectedOrReviewedUsd = 0;
  let x402AuthorizedUsd = 0;
  let submittedTransactions = 0;
  let confirmedTransactions = 0;

  for (const item of records) {
    if (Object.hasOwn(counts, item.decision)) counts[item.decision] += 1;
    const value = Number(item.requestedUsd) || 0;
    if (item.decision === 'ALLOW') {
      totalAuthorizedUsd += value;
      if (item.kind === 'X402') x402AuthorizedUsd += value;
    } else if (item.decision === 'BLOCK' || item.decision === 'REVIEW' || item.decision === 'PAUSE') {
      protectedOrReviewedUsd += value;
    }
    if (item.txStatus === 'SUBMITTED' || item.txStatus === 'CONFIRMED' || item.txStatus === 'FAILED') submittedTransactions += 1;
    if (item.txStatus === 'CONFIRMED') confirmedTransactions += 1;
  }

  return {
    counts,
    totalAuthorizedUsd,
    protectedOrReviewedUsd,
    x402AuthorizedUsd,
    submittedTransactions,
    confirmedTransactions
  };
}

export function createMemoryActivityStore() {
  const records = [];
  const queues = new Map();

  async function serialized(sessionId, work) {
    const key = String(sessionId ?? '');
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.then(work, work);
    queues.set(key, next.catch(() => {}));
    return next;
  }

  return Object.freeze({
    async getContext({ sessionId, today }) {
      const scoped = records.filter((item) => item.sessionId === sessionId);
      const dailySpendUsd = scoped
        .filter((item) => item.decision === 'ALLOW' && String(item.timestamp || '').startsWith(today))
        .reduce((sum, item) => sum + (Number(item.requestedUsd) || 0), 0);
      const recentIntentIds = scoped.slice(-200).map((item) => item.intentId).filter(Boolean);
      return clone({ dailySpendUsd, recentIntentIds, previousHash: scoped.at(-1)?.currentHash ?? null });
    },

    async appendEvaluation(record) {
      if (!record || !record.traceId) throw new TypeError('activity record with traceId is required');
      return serialized(record.sessionId, async () => {
        if (records.some((item) => item.traceId === record.traceId)) throw new Error('DUPLICATE_TRACE_ID');
        if (records.some((item) => item.sessionId === record.sessionId && item.intentId === record.intentId)) throw new Error('DUPLICATE_INTENT');
        const saved = clone(record);
        records.push(saved);
        return clone(saved);
      });
    },

    async recordSubmitted({ traceId, txHash, walletAddress }) {
      const item = records.find((entry) => entry.traceId === traceId);
      if (!item) throw new Error('TRACE_NOT_FOUND');
      item.txHash = txHash;
      item.walletAddress = walletAddress;
      item.txStatus = 'SUBMITTED';
      return clone(item);
    },

    async recordStatus({ traceId, txStatus, blockNumber }) {
      const item = records.find((entry) => entry.traceId === traceId);
      if (!item) throw new Error('TRACE_NOT_FOUND');
      item.txStatus = txStatus;
      item.blockNumber = blockNumber ?? null;
      return clone(item);
    },

    async list({ sessionId, limit = 50 }) {
      return clone(records
        .filter((item) => item.sessionId === sessionId)
        .slice()
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
        .slice(0, clampLimit(limit)));
    },

    async getMetrics({ sessionId }) {
      return clone(metricsFor(records.filter((item) => item.sessionId === sessionId)));
    },

    async getByTraceId(traceId) {
      return clone(records.find((item) => item.traceId === traceId) || null);
    }
  });
}

export function createSupabaseActivityStore(env = process.env) {
  if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL is required for Supabase activity store');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for Supabase activity store');
  throw new Error('Supabase activity store implementation is not initialized');
}

export function createActivityStore(env = process.env) {
  if (env.CIRCUIT_ACTIVITY_STORE === 'supabase') return createSupabaseActivityStore(env);
  return createMemoryActivityStore();
}
