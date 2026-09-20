import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../docs/sql/activity-store.sql', import.meta.url), 'utf8');

test('durable activity schema keeps browser roles out and grants the append RPC to service_role', () => {
  assert.match(sql, /alter table public\.circuit_activity enable row level security;/i);
  assert.match(sql, /revoke all on function public\.append_circuit_activity\(jsonb\) from public;/i);
  assert.match(sql, /grant execute on function public\.append_circuit_activity\(jsonb\) to service_role;/i);
});

test('durable activity schema enforces one intent per hashed session and a transaction lifecycle constraint', () => {
  assert.match(sql, /unique\s*\(session_key,\s*intent_id\)/i);
  assert.match(sql, /tx_status text not null default 'EVALUATED' check \(tx_status in \('EVALUATED','PREPARED','SUBMITTED','CONFIRMED','FAILED','BLOCKED','REVIEW','PAUSED'\)\)/i);
});
