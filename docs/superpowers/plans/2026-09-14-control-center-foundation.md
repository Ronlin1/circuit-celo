# CIRCUIT Control Center Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-shaped CIRCUIT Control Center with reversible wallet UX, durable policy state, transaction history, metrics, and real dashboard visuals.

**Architecture:** Introduce an `ActivityStore` boundary with memory and Supabase implementations, make durable activity the source of truth for replay/daily-spend evidence, and add transaction lifecycle + aggregate query APIs. Split browser responsibilities into wallet/dashboard/treasury/UI modules while preserving the existing REST behavior and non-custodial wallet-signing boundary.

**Tech Stack:** Node.js >=22.16, native `node:test`, ESM, Vercel functions, Supabase Postgres, browser EIP-1193/EIP-6963, Celo Mainnet chain 42220.

**Spec:** `docs/superpowers/specs/2026-09-14-circuit-control-center-mcp-design.md`

## Global Constraints

- Celo Mainnet only for production execution: chain ID `42220`.
- No private key, seed phrase, exchange credential, or wallet secret is stored server-side.
- Public/browser/MCP callers may not provide or relax the server-owned mandate.
- Non-`ALLOW` decisions must never produce executable transaction payloads.
- Production authorization must fail closed if authoritative durable replay/budget state cannot be read or atomically updated.
- Flight Recorder append must be atomic per session so concurrent requests cannot fork the hash chain.
- Session-scoped history is private by default; public/global views expose only aggregate or public-chain-safe data.
- Existing `/api/status`, `/api/judge`, `/api/traces`, `/api/identity`, `/api/evaluate`, and `/api/x402-authorize` behavior remains compatible unless explicitly documented.

---

### Task 1: Add durable ActivityStore boundary and Supabase schema

**Files:**
- Create: `src/celo/activity-store.js`
- Create: `docs/sql/activity-store.sql`
- Modify: `package.json`
- Modify: `.env.example`
- Test: `test/celo/activity-store.test.js`

**Interfaces:**
- Produces: `createMemoryActivityStore()`, `createSupabaseActivityStore(env)`, and `createActivityStore(env)`.
- Store methods: `getContext({sessionId, today})`, `appendEvaluation(record)`, `recordSubmitted({traceId, txHash, walletAddress})`, `recordStatus({traceId, txStatus, blockNumber})`, `list({sessionId, limit})`, `getMetrics({sessionId})`, `getByTraceId(traceId)`.
- `getContext()` returns `{ dailySpendUsd:number, recentIntentIds:string[], previousHash:string|null }`.

- [ ] **Step 1: Write failing store contract tests**

Add tests that create a memory store, append ALLOW/BLOCK records, and assert daily spend counts only ALLOW, recent IDs are session-scoped, status updates preserve the original trace, and metrics aggregate verdict/value correctly.

Run: `node --test test/celo/activity-store.test.js`

Expected: FAIL because `src/celo/activity-store.js` does not exist.

- [ ] **Step 2: Implement `MemoryActivityStore` minimally**

Implement an in-memory array-backed store with immutable returned snapshots, bounded `list()` limits (`1..200`), and exact session matching. Make `appendEvaluation()` serialize per-session appends through a Promise queue so tests model the atomic append contract.

Run: `node --test test/celo/activity-store.test.js`

Expected: PASS.

- [ ] **Step 3: Add Supabase dependency and schema**

Add `@supabase/supabase-js` to dependencies. Create `docs/sql/activity-store.sql` defining `circuit_activity` with UUID/text trace id primary key, timestamps, session hash, wallet address, agent id, action kind, asset, requested USD numeric, amount base units text, decision, reason codes JSONB, recipient representation, token contract, tx hash, tx status, block number, previous/current trace hashes, attribution tag/version, and unique `(session_key,intent_id)` replay protection.

Create indexes on `(session_key,created_at desc)`, `tx_hash`, and `decision`.

- [ ] **Step 4: Implement `SupabaseActivityStore`**

Use only server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Implement the same contract as memory store. Treat duplicate `(session_key,intent_id)` inserts as replay evidence rather than a successful second append.

- [ ] **Step 5: Add env documentation**

Document:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CIRCUIT_ACTIVITY_STORE=supabase
```

Do not expose the service-role key through `/api/status`.

- [ ] **Step 6: Run full verification and commit**

Run: `npm run verify`

Expected: all existing and new tests PASS.

Commit: `feat: add durable CIRCUIT activity store`

---

### Task 2: Make durable replay/budget state authoritative and fail closed

**Files:**
- Modify: `src/celo/api.js`
- Modify: `src/celo/trace.js`
- Modify: `api/index.js`
- Test: `test/celo/api.test.js`
- Test: `test/celo/production-hardening.test.js`
- Test: `test/celo/trace.test.js`

**Interfaces:**
- `evaluatePublicTreasuryRequest` becomes async and accepts `{ intent, agentIdentity, env, activityStore }`.
- Produces persisted trace metadata with `{traceId, previousHash, currentHash}`.

- [ ] **Step 1: Write failing tests for persistence-backed replay and budget**

Test that two requests with the same session/intent ID cause the second to `PAUSE`, that ALLOW spend survives creation of a fresh API evaluator using the same store, and that a store read failure in production returns a safe error rather than ALLOW.

Run: `node --test test/celo/api.test.js test/celo/production-hardening.test.js`

Expected: FAIL against the current process-memory recorder.

- [ ] **Step 2: Refactor recorder context behind ActivityStore**

Replace direct `recorder.list()` context derivation with `await activityStore.getContext(...)`. Keep the existing policy engine synchronous; build its context before calling `evaluateTreasuryIntent()`.

- [ ] **Step 3: Make evaluation append atomic**

Compute decision + prepared payload, then atomically append the evaluation with the previous hash from the same authoritative session chain. If a duplicate intent wins a race, return `PAUSE/DUPLICATE_INTENT` and do not prepare executable calldata.

- [ ] **Step 4: Add fail-closed production behavior**

When `CIRCUIT_ACTIVITY_STORE=supabase`, any authoritative context/append failure must return HTTP `503` with a stable error code such as `AUTHORIZATION_STATE_UNAVAILABLE`; it must not silently fall back to process memory.

Memory fallback remains valid only for tests/local development when explicitly configured.

- [ ] **Step 5: Update route adapter for async evaluation**

Change `api/index.js` to `await evaluatePublicTreasuryRequest(...)` and construct one store per request from `runtimeEnv()`.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`

Commit: `fix: make durable policy state authoritative`

---

### Task 3: Add transaction lifecycle, history, and aggregate metrics APIs

**Files:**
- Create: `src/celo/metrics.js`
- Create: `src/celo/receipts.js`
- Modify: `src/celo/api.js`
- Modify: `api/index.js`
- Test: `test/celo/activity-api.test.js`
- Test: `test/celo/receipts.test.js`

**Interfaces:**
- Produces `getActivity({store,sessionId,limit})`, `getActivityMetrics({store,sessionId})`, `recordSubmittedTransaction(...)`, `reconcileTransactionStatus(...)`.
- API additions: `GET /api/activity`, `GET /api/metrics`, `POST /api/transaction-submitted`, `POST /api/transaction-status`.

- [ ] **Step 1: Write failing API tests**

Cover bounded limits, required session key, masked/non-sensitive outputs, submitted tx recording, confirmed receipt reconciliation, and rejection of malformed tx hashes/wallet addresses.

- [ ] **Step 2: Implement metric aggregation helpers**

Return counts for `ALLOW/BLOCK/REVIEW/PAUSE`, total authorized USD, protected/reviewed USD, x402 authorized USD, submitted and confirmed transaction counts.

- [ ] **Step 3: Implement Celo receipt lookup**

Use `eth_getTransactionReceipt` against configured Celo RPC. Validate hash as `0x` + 64 hex chars. Map no receipt to `SUBMITTED`, status `0x1` to `CONFIRMED`, and `0x0` to `FAILED`.

- [ ] **Step 4: Add REST routes**

Make all list/metrics routes session-scoped unless an explicitly public aggregate endpoint is later designed. Do not return service configuration or secret session material.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`

Commit: `feat: add treasury history and transaction lifecycle APIs`

---

### Task 4: Split wallet logic and add connect/disconnect modal

**Files:**
- Create: `public/js/wallet.js`
- Create: `public/js/ui.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `test/web/wallet-ui.test.js`

**Interfaces:**
- `createWalletController({window, onStateChange})` exposes `discover()`, `connect()`, `disconnect()`, `refresh()`, `getState()`.
- Wallet state: `{provider, providerInfo, account, chainId, connected, status, error}`.

- [ ] **Step 1: Write failing disconnect tests**

Add tests proving disconnect clears account/provider/prepared state, reconnect works, account changes update state, chain changes to non-Celo mark execution unavailable, and page initialization respects a local disconnect marker rather than immediately reconnecting passively.

- [ ] **Step 2: Extract existing EIP-6963 discovery unchanged**

Move provider announcement/request logic and legacy fallback from `public/app.js` into `public/js/wallet.js` without changing selection priority: EIP-6963 MetaMask first, MiniPay next, then other announced provider, then legacy injection.

- [ ] **Step 3: Implement local disconnect semantics**

Clear CIRCUIT state immediately. Attempt `wallet_revokePermissions` for `{eth_accounts:{}}` only when provider supports it; catch unsupported-method errors and return a state message explaining that wallet-side site permission may remain.

Never claim token approvals were revoked.

- [ ] **Step 4: Build wallet modal**

Add modal contents for provider, address, chain, copy address, CeloScan address link, reconnect/switch account, and disconnect. Connection begins from this modal so provider/account choice is explicit.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/web/wallet-ui.test.js && npm run verify`

Commit: `feat: add reversible wallet connection experience`

---

### Task 5: Build Control Center dashboard and real balance panels

**Files:**
- Create: `public/js/dashboard.js`
- Create: `public/js/treasury.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `test/web/dashboard-ui.test.js`

**Interfaces:**
- `loadDashboard({sessionId,walletAddress})` reads `/api/metrics` and `/api/activity`.
- `loadBalances(provider,address,status)` reads CELO via `eth_getBalance` and ERC-20 `balanceOf(address)` using token config returned from `/api/status`.

- [ ] **Step 1: Write failing DOM tests for dashboard rendering**

Cover empty state, real metric cards, decision distribution, recent activity rows, tx-status chips, CeloScan links, and no fabricated sample data.

- [ ] **Step 2: Build KPI and mandate-health sections**

Render intents evaluated, authorized USD, protected/reviewed USD, confirmed transactions, remaining budget, per-action cap, x402 cap, and identity/replay status from live APIs.

- [ ] **Step 3: Build balances**

For the connected wallet, read native CELO and each supported ERC-20 using `eth_call` `balanceOf`. Format using each configured token's decimals; failed token reads show `Unavailable` instead of zero.

- [ ] **Step 4: Build lightweight visuals without chart dependency**

Use CSS/SVG primitives for a verdict distribution ring/bar, mandate utilization bar, and value-over-time mini sparkline generated only from persisted activity. Avoid adding a large chart library for the hackathon pass.

- [ ] **Step 5: Build recent activity drawer**

Rows open a detail panel showing checks/reason codes, trace hashes, prepared contract, tx hash/status, and CeloScan link when applicable.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`

Commit: `feat: launch CIRCUIT Control Center dashboard`

---

### Task 6: Record browser-submitted transactions and reconcile status

**Files:**
- Modify: `public/js/treasury.js`
- Modify: `public/js/dashboard.js`
- Modify: `public/app.js`
- Test: `test/web/dashboard-ui.test.js`
- Test: `test/celo/activity-api.test.js`

**Interfaces:**
- On successful `eth_sendTransaction`, browser POSTs `{traceId,txHash,walletAddress}` to `/api/transaction-submitted` and refreshes dashboard.

- [ ] **Step 1: Write failing submission-flow test**

Simulate an ALLOW payload, wallet transaction hash, POST recording, and dashboard status transition `PREPARED -> SUBMITTED`.

- [ ] **Step 2: Implement recording**

Do not mark a transaction confirmed merely because MetaMask returned a hash. Record `SUBMITTED`, then reconcile separately.

- [ ] **Step 3: Poll/reconcile conservatively**

Request `/api/transaction-status` after submission and on dashboard refresh. Stop polling after a bounded number of attempts; leave as `SUBMITTED` rather than inventing success.

- [ ] **Step 4: Verify and commit**

Run: `npm run verify`

Commit: `feat: track Celo transaction lifecycle in dashboard`

---

### Task 7: Stress the durable Control Center and document operations

**Files:**
- Modify: `scripts/live-smoke.js`
- Create: `scripts/activity-stress.js`
- Modify: `README.md`
- Modify: `docs/DEMO.md`
- Modify: `docs/ARCHITECTURE.md`
- Test: `test/celo/production-hardening.test.js`

**Interfaces:**
- Stress script supports configurable base URL and concurrency without embedding secrets.

- [ ] **Step 1: Add hostile persistence tests**

Cover concurrent duplicate intent IDs, 200 simultaneous same-session ALLOW attempts, malformed session keys, store latency, store outage, and huge list limits.

- [ ] **Step 2: Add live activity smoke**

Exercise status, judge, evaluate, metrics, activity, and transaction validation routes without sending funds.

- [ ] **Step 3: Update docs**

Document dashboard, disconnect semantics, Supabase schema setup, privacy model, and fail-closed production behavior.

- [ ] **Step 4: Run final verification**

Run: `npm run verify`

Then run against deployed preview: `node scripts/live-smoke.js` and `node scripts/activity-stress.js`.

- [ ] **Step 5: Commit**

Commit: `test: harden Control Center under concurrent load`
