import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function clampLimit(limit) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(numeric)));
}

function hashSessionId(sessionId) {
  const value = String(sessionId ?? '');
  if (!value) throw new TypeError('sessionId is required');
  return createHash('sha256').update(value).digest('hex');
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

function toDbRecord(record) {
  return {
    trace_id: record.traceId,
    created_at: record.timestamp,
    session_key: hashSessionId(record.sessionId),
    intent_id: record.intentId,
    wallet_address: record.walletAddress ?? null,
    agent_id: record.agentId == null ? null : String(record.agentId),
    action_kind: record.kind,
    asset: record.asset,
    requested_usd: Number(record.requestedUsd),
    amount_base_units: record.amountBaseUnits == null ? null : String(record.amountBaseUnits),
    decision: record.decision,
    reason_codes: Array.isArray(record.reasonCodes) ? record.reasonCodes : [],
    recipient: record.recipient ?? null,
    token_contract: record.tokenContract ?? null,
    tx_hash: record.txHash ?? null,
    tx_status: record.txStatus ?? 'EVALUATED',
    block_number: record.blockNumber ?? null,
    previous_trace_hash: record.previousHash ?? null,
    current_trace_hash: record.currentHash,
    attribution_tag: record.attributionTag ?? null,
    attribution_version: record.attributionVersion ?? null
  };
}

function fromDbRow(row) {
  if (!row) return null;
  return {
    traceId: row.trace_id,
    timestamp: row.created_at,
    sessionId: null,
    intentId: row.intent_id,
    walletAddress: row.wallet_address ?? null,
    agentId: row.agent_id ?? null,
    kind: row.action_kind,
    asset: row.asset,
    requestedUsd: Number(row.requested_usd) || 0,
    amountBaseUnits: row.amount_base_units ?? null,
    decision: row.decision,
    reasonCodes: Array.isArray(row.reason_codes) ? row.reason_codes : [],
    recipient: row.recipient ?? null,
    tokenContract: row.token_contract ?? null,
    txHash: row.tx_hash ?? null,
    txStatus: row.tx_status,
    blockNumber: row.block_number == null ? null : Number(row.block_number),
    previousHash: row.previous_trace_hash ?? null,
    currentHash: row.current_trace_hash,
    attributionTag: row.attribution_tag ?? null,
    attributionVersion: row.attribution_version ?? null
  };
}

function unwrapData(data) {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function throwDbError(error) {
  if (!error) return;
  const text = `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''}`;
  if (/DUPLICATE_INTENT|23505/i.test(text)) throw new Error('DUPLICATE_INTENT');
  if (/TRACE_PREDECESSOR_CHANGED|40001/i.test(text)) throw new Error('TRACE_PREDECESSOR_CHANGED');
  const wrapped = new Error(error.message || 'ACTIVITY_STORE_ERROR');
  wrapped.code = error.code || 'ACTIVITY_STORE_ERROR';
  throw wrapped;
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

    async recordSubmitted({ traceId, txHash, walletAddress, sessionId = null }) {
      const item = records.find((entry) => entry.traceId === traceId && (!sessionId || entry.sessionId === sessionId));
      if (!item) throw new Error('TRACE_NOT_FOUND');
      item.txHash = txHash;
      item.walletAddress = walletAddress;
      item.txStatus = 'SUBMITTED';
      return clone(item);
    },

    async recordStatus({ traceId, txStatus, blockNumber, sessionId = null }) {
      const item = records.find((entry) => entry.traceId === traceId && (!sessionId || entry.sessionId === sessionId));
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

    async getByTraceId(traceId, { sessionId = null } = {}) {
      return clone(records.find((item) => item.traceId === traceId && (!sessionId || item.sessionId === sessionId)) || null);
    }
  });
}

export function createSupabaseActivityStore(env = process.env, options = {}) {
  if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL is required for Supabase activity store');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for Supabase activity store');

  const client = options.client || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  async function queryRows(sessionId, limit = 200) {
    const { data, error } = await client
      .from('circuit_activity')
      .select('*')
      .eq('session_key', hashSessionId(sessionId))
      .order('created_at', { ascending: false })
      .limit(clampLimit(limit));
    throwDbError(error);
    return data || [];
  }

  return Object.freeze({
    async getContext({ sessionId, today }) {
      const rows = await queryRows(sessionId, 200);
      const dailySpendUsd = rows
        .filter((row) => row.decision === 'ALLOW' && String(row.created_at || '').startsWith(today))
        .reduce((sum, row) => sum + (Number(row.requested_usd) || 0), 0);
      const recentIntentIds = rows.slice().reverse().map((row) => row.intent_id).filter(Boolean);
      return { dailySpendUsd, recentIntentIds, previousHash: rows[0]?.current_trace_hash ?? null };
    },

    async appendEvaluation(record) {
      if (!record || !record.traceId) throw new TypeError('activity record with traceId is required');
      const { data, error } = await client.rpc('append_circuit_activity', { p_record: toDbRecord(record) });
      throwDbError(error);
      return fromDbRow(unwrapData(data));
    },

    async recordSubmitted({ traceId, txHash, walletAddress, sessionId = null }) {
      let query = client
        .from('circuit_activity')
        .update({ tx_hash: txHash, wallet_address: walletAddress, tx_status: 'SUBMITTED' })
        .eq('trace_id', traceId);
      if (sessionId) query = query.eq('session_key', hashSessionId(sessionId));
      const { data, error } = await query.select('*').single();
      throwDbError(error);
      if (!data) throw new Error('TRACE_NOT_FOUND');
      return fromDbRow(data);
    },

    async recordStatus({ traceId, txStatus, blockNumber, sessionId = null }) {
      let query = client
        .from('circuit_activity')
        .update({ tx_status: txStatus, block_number: blockNumber ?? null })
        .eq('trace_id', traceId);
      if (sessionId) query = query.eq('session_key', hashSessionId(sessionId));
      const { data, error } = await query.select('*').single();
      throwDbError(error);
      if (!data) throw new Error('TRACE_NOT_FOUND');
      return fromDbRow(data);
    },

    async list({ sessionId, limit = 50 }) {
      return (await queryRows(sessionId, limit)).map(fromDbRow);
    },

    async getMetrics({ sessionId }) {
      const { data, error } = await client
        .from('circuit_activity')
        .select('*')
        .eq('session_key', hashSessionId(sessionId))
        .order('created_at', { ascending: false })
        .limit(1000);
      throwDbError(error);
      return metricsFor((data || []).map(fromDbRow));
    },

    async getByTraceId(traceId, { sessionId = null } = {}) {
      let query = client.from('circuit_activity').select('*').eq('trace_id', traceId);
      if (sessionId) query = query.eq('session_key', hashSessionId(sessionId));
      const { data, error } = await query.maybeSingle();
      throwDbError(error);
      return fromDbRow(data);
    }
  });
}

export function createActivityStore(env = process.env) {
  if (env.CIRCUIT_ACTIVITY_STORE === 'supabase') return createSupabaseActivityStore(env);
  return createMemoryActivityStore();
}
