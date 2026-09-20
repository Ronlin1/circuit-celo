import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function netlifySource() {
  return readFile(new URL('../../netlify/functions/circuit.mts', import.meta.url), 'utf8');
}

test('Netlify adapter exposes the same public API surface used by the Control Center', async () => {
  const source = await netlifySource();
  for (const route of [
    '/api/status',
    '/api/judge',
    '/api/traces',
    '/api/activity',
    '/api/metrics',
    '/api/identity',
    '/api/evaluate',
    '/api/x402-authorize',
    '/api/transaction-submitted',
    '/api/transaction-status'
  ]) {
    assert.match(source, new RegExp(route.replaceAll('/', '\\/')));
  }
});

test('Netlify adapter wires durable Supabase authorization state and modern server secret', async () => {
  const source = await netlifySource();
  assert.match(source, /createActivityStore/);
  assert.match(source, /createMemoryActivityStore/);
  assert.match(source, /SUPABASE_URL/);
  assert.match(source, /SUPABASE_SECRET_KEY/);
  assert.match(source, /CIRCUIT_ACTIVITY_STORE/);
  assert.match(source, /AUTHORIZATION_STATE_UNAVAILABLE/);
  assert.match(source, /await\s+evaluatePublicTreasuryRequest/);
});

test('Netlify adapter persists transaction lifecycle and maps upstream failures explicitly', async () => {
  const source = await netlifySource();
  assert.match(source, /recordSubmittedTransaction/);
  assert.match(source, /reconcileTransactionStatus/);
  assert.match(source, /CELO_RPC_UNAVAILABLE/);
  assert.match(source, /TRACE_NOT_FOUND/);
  assert.match(source, /Cache-Control|cache-control/);
});
