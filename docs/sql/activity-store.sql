-- CIRCUIT Treasury durable authorization and transaction activity.
-- Run this once in the Supabase SQL editor for the production project.
-- The table is intentionally server-only: the application uses a service-role
-- key in serverless functions and never exposes that key to the browser.

create extension if not exists pgcrypto;

create table if not exists public.circuit_activity (
  trace_id text primary key,
  created_at timestamptz not null default now(),
  session_key text not null,
  intent_id text not null,
  wallet_address text,
  agent_id text,
  action_kind text not null,
  asset text not null,
  requested_usd numeric not null,
  amount_base_units text,
  decision text not null check (decision in ('ALLOW','BLOCK','REVIEW','PAUSE','RESIZE')),
  reason_codes jsonb not null default '[]'::jsonb,
  recipient text,
  token_contract text,
  tx_hash text,
  tx_status text not null default 'EVALUATED' check (tx_status in ('EVALUATED','PREPARED','SUBMITTED','CONFIRMED','FAILED','BLOCKED','REVIEW','PAUSED')),
  block_number bigint,
  previous_trace_hash text,
  current_trace_hash text not null,
  attribution_tag text,
  attribution_version text,
  constraint circuit_activity_session_intent_unique unique (session_key, intent_id)
);

create index if not exists circuit_activity_session_created_idx
  on public.circuit_activity (session_key, created_at desc);
create index if not exists circuit_activity_tx_hash_idx
  on public.circuit_activity (tx_hash)
  where tx_hash is not null;
create index if not exists circuit_activity_decision_idx
  on public.circuit_activity (decision);

alter table public.circuit_activity enable row level security;

-- No anon/authenticated policies are created. Keep direct browser roles out even
-- if project-level default grants change later. The service role is used only
-- from CIRCUIT server routes and never exposed to browser code.
revoke all on table public.circuit_activity from anon, authenticated;
grant select, update on table public.circuit_activity to service_role;

comment on table public.circuit_activity is
  'CIRCUIT Treasury authorization decisions and Celo transaction lifecycle evidence.';
comment on column public.circuit_activity.session_key is
  'SHA-256 of the browser/MCP session identifier; the raw session identifier is not persisted.';

-- Atomic append helper. It serializes activity for a given session so two
-- simultaneous requests cannot both observe the same predecessor. The caller
-- supplies a current hash computed from the predecessor it read; if that
-- predecessor changed before append, the append fails closed and the caller
-- must re-evaluate rather than silently forking the audit chain.
create or replace function public.append_circuit_activity(p_record jsonb)
returns public.circuit_activity
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_key text := p_record->>'session_key';
  v_intent_id text := p_record->>'intent_id';
  v_expected_previous text := nullif(p_record->>'previous_trace_hash', '');
  v_actual_previous text;
  v_row public.circuit_activity;
begin
  if v_session_key is null or v_session_key = '' then
    raise exception 'SESSION_KEY_REQUIRED' using errcode = '22023';
  end if;
  if v_intent_id is null or v_intent_id = '' then
    raise exception 'INTENT_ID_REQUIRED' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_session_key, 0));

  if exists (
    select 1 from public.circuit_activity
    where session_key = v_session_key and intent_id = v_intent_id
  ) then
    raise exception 'DUPLICATE_INTENT' using errcode = '23505';
  end if;

  select current_trace_hash
    into v_actual_previous
    from public.circuit_activity
   where session_key = v_session_key
   order by created_at desc, trace_id desc
   limit 1;

  if coalesce(v_actual_previous, 'GENESIS') <> coalesce(v_expected_previous, 'GENESIS') then
    raise exception 'TRACE_PREDECESSOR_CHANGED' using errcode = '40001';
  end if;

  insert into public.circuit_activity (
    trace_id, created_at, session_key, intent_id, wallet_address, agent_id,
    action_kind, asset, requested_usd, amount_base_units, decision,
    reason_codes, recipient, token_contract, tx_hash, tx_status, block_number,
    previous_trace_hash, current_trace_hash, attribution_tag, attribution_version
  ) values (
    p_record->>'trace_id',
    coalesce((p_record->>'created_at')::timestamptz, now()),
    v_session_key,
    v_intent_id,
    nullif(p_record->>'wallet_address',''),
    nullif(p_record->>'agent_id',''),
    p_record->>'action_kind',
    p_record->>'asset',
    (p_record->>'requested_usd')::numeric,
    nullif(p_record->>'amount_base_units',''),
    p_record->>'decision',
    coalesce(p_record->'reason_codes', '[]'::jsonb),
    nullif(p_record->>'recipient',''),
    nullif(p_record->>'token_contract',''),
    nullif(p_record->>'tx_hash',''),
    coalesce(nullif(p_record->>'tx_status',''), 'EVALUATED'),
    nullif(p_record->>'block_number','')::bigint,
    v_expected_previous,
    p_record->>'current_trace_hash',
    nullif(p_record->>'attribution_tag',''),
    nullif(p_record->>'attribution_version','')
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.append_circuit_activity(jsonb) from public;
revoke all on function public.append_circuit_activity(jsonb) from anon, authenticated;
grant execute on function public.append_circuit_activity(jsonb) to service_role;
