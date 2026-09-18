function requireSessionId(sessionId) {
  const value = String(sessionId || '').trim();
  if (!value) throw new TypeError('sessionId is required');
  return value;
}

async function readJson(response, label) {
  let payload;
  if (typeof response?.json === 'function') payload = await response.json();
  else if (typeof response?.text === 'function') {
    const text = await response.text();
    payload = text ? JSON.parse(text) : {};
  } else payload = {};
  if (!response?.ok) throw new Error(payload?.error || `${label} request failed (${response?.status || 'unknown'})`);
  return payload;
}

function money(value) {
  const numeric = Number(value) || 0;
  return `$${numeric.toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function validTxHash(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(value || ''));
}

function activityRow(item) {
  const status = escapeHtml(item.txStatus || item.decision || 'EVALUATED');
  const decision = escapeHtml(item.decision || 'UNKNOWN');
  const asset = escapeHtml(item.asset || '—');
  const kind = escapeHtml(item.kind || '—');
  const value = money(item.requestedUsd);
  const time = item.timestamp ? escapeHtml(new Date(item.timestamp).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })) : '—';
  const tx = validTxHash(item.txHash)
    ? `<a class="activity-explorer" href="https://celoscan.io/tx/${escapeHtml(item.txHash)}" target="_blank" rel="noreferrer">CeloScan ↗</a>`
    : '';
  const reasons = Array.isArray(item.reasonCodes) && item.reasonCodes.length
    ? `<small>${item.reasonCodes.map(escapeHtml).join(' · ')}</small>`
    : '<small>Inside active mandate</small>';
  return `<article class="activity-row" data-trace-id="${escapeHtml(item.traceId || '')}"><div><b>${asset}</b><span>${kind} · ${value}</span>${reasons}</div><div class="activity-row-meta"><span class="decision-chip ${decision.toLowerCase()}">${decision}</span><span class="tx-chip">${status}</span><time>${time}</time>${tx}</div></article>`;
}

export async function loadDashboard({ sessionId, walletAddress = null, fetchImpl = globalThis.fetch } = {}) {
  const session = requireSessionId(sessionId);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const encoded = encodeURIComponent(session);
  const [metricsResponse, activityResponse] = await Promise.all([
    fetchImpl(`/api/metrics?sessionId=${encoded}`),
    fetchImpl(`/api/activity?sessionId=${encoded}&limit=50`)
  ]);
  const [metrics, activity] = await Promise.all([
    readJson(metricsResponse, 'metrics'),
    readJson(activityResponse, 'activity')
  ]);
  return Object.freeze({
    sessionId: session,
    walletAddress: walletAddress || null,
    metrics: metrics || {},
    activity: Array.isArray(activity) ? activity : []
  });
}

export function renderDashboardModel({ metrics = {}, activity = [], mandate = {} } = {}) {
  const counts = {
    ALLOW: Number(metrics.counts?.ALLOW) || 0,
    BLOCK: Number(metrics.counts?.BLOCK) || 0,
    REVIEW: Number(metrics.counts?.REVIEW) || 0,
    PAUSE: Number(metrics.counts?.PAUSE) || 0
  };
  const total = Number(metrics.intentsEvaluated) || Object.values(counts).reduce((sum, value) => sum + value, 0);
  const authorized = Number(metrics.totalAuthorizedUsd) || 0;
  const protectedValue = Number(metrics.protectedOrReviewedUsd) || 0;
  const dailyCap = Number(mandate.maxDailySpendUsd) || 0;
  const remaining = Math.max(0, dailyCap - authorized);
  const percent = dailyCap > 0 ? Math.min(100, Math.max(0, (authorized / dailyCap) * 100)) : 0;
  const rows = Array.isArray(activity) ? activity : [];

  return Object.freeze({
    empty: rows.length === 0,
    kpis: Object.freeze({
      intents: String(total),
      authorized: money(authorized),
      protected: money(protectedValue),
      confirmed: String(Number(metrics.confirmedTransactions) || 0),
      remaining: money(remaining),
      actionCap: money(mandate.maxPaymentUsd),
      x402Cap: money(mandate.maxX402Usd)
    }),
    decisionDistribution: Object.freeze({ ...counts, total }),
    mandateUtilization: Object.freeze({
      percent,
      label: `${money(authorized)} of ${money(dailyCap)} authorized`
    }),
    activityHtml: rows.length ? rows.map(activityRow).join('') : '<div class="dashboard-empty">No activity yet. Evaluate a real treasury intent to populate this session.</div>'
  });
}
