# CIRCUIT Celo Treasury Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the proven CIRCUIT runtime-control product and ship a judge-ready Celo Treasury that authorizes stablecoin/x402 intents before Celo mainnet execution.

**Architecture:** Preserve the deterministic CIRCUIT core and Flight Recorder. Add a focused Celo adapter layer that understands chain 42220, stablecoin payment intents, ERC-8004 identity evidence, x402 price caps, and safe transaction preparation; wire those capabilities into the existing server/MCP/UI without placing private keys in the browser.

**Tech Stack:** Node.js 22+, native `node:test`, existing CIRCUIT JavaScript/MCP server, Celo EVM JSON-RPC, ERC-20 calldata, ERC-8004 registries, x402 HTTP payment semantics, Netlify functions/static hosting.

**Spec:** `docs/superpowers/specs/2026-09-14-circuit-celo-treasury-design.md`

## Global Constraints

- Celo Mainnet chain ID is `42220`; default RPC is `https://forno.celo.org`.
- Deterministic verdict precedence remains `PAUSE > BLOCK > REVIEW > RESIZE > ALLOW`.
- No private keys, wallet secrets, or fabricated transaction hashes in source or public assets.
- Unverified USA₮/cNGN token addresses are configuration values, never guessed constants.
- Only an unexpired `ALLOW` result may reach a live execution path.
- Existing CIRCUIT tests and secret-scan behavior must remain green.
- Reuse the existing CIRCUIT logo and preserve the strongest runtime-control features.

---

### Task 1: Import the proven CIRCUIT baseline

**Files:**
- Import: source tree from `Ronlin1/circuit` into `Ronlin1/circuit-celo`
- Preserve: `src/**`, `test/**`, `public/**`, `netlify/**`, `scripts/**`, `agent/**`, core docs and CI
- Preserve current Celo spec/plan files

**Interfaces:**
- Consumes: original CIRCUIT repository at its current `main`
- Produces: a runnable baseline in `circuit-celo` with the same tests and UI

- [ ] Import all tracked baseline files while keeping the Celo design/plan.
- [ ] Change repository/package identity from Binance hackathon copy to `circuit-celo` without altering behavior.
- [ ] Verify the copied tree contains the runtime core, server, MCP, UI, scripts and test suite.

### Task 2: Celo primitives and transaction preparation — TDD

**Files:**
- Create: `test/celo/celo-config.test.js`
- Create: `test/celo/celo-gateway.test.js`
- Create: `src/celo/config.js`
- Create: `src/celo/gateway.js`

**Interfaces:**
- Produces: `CELO_MAINNET`, `ERC8004`, `getConfiguredAssets(env)`, `buildErc20Transfer({ tokenAddress, recipient, amountBaseUnits })`, `prepareCeloTransfer(intent, config)`.

- [ ] Write tests asserting chain `42220`, the two official ERC-8004 registry addresses, documented USDC/USDT/USDm addresses, env-based USA₮/cNGN configuration, and rejection of missing/invalid addresses.
- [ ] Run the new tests and confirm RED because `src/celo/*` does not exist.
- [ ] Implement minimal immutable Celo configuration and ERC-20 `transfer(address,uint256)` calldata encoding without adding a new heavyweight dependency.
- [ ] Implement safe transfer preparation returning `{ chainId, rpcUrl, to, data, value, asset, recipient, amountBaseUnits }` and never signing/sending.
- [ ] Run Celo tests and confirm GREEN.

### Task 3: ERC-8004 identity evidence and x402 guard — TDD

**Files:**
- Create: `test/celo/agent-trust.test.js`
- Create: `test/celo/x402-policy.test.js`
- Create: `src/celo/agent-trust.js`
- Create: `src/celo/x402.js`

**Interfaces:**
- Produces: `buildAgentIdentityCall(agentId)`, `evaluateAgentTrust(evidence, policy)`, `normalizeX402Intent(input)`, `evaluateX402Price(intent, mandate)`.

- [ ] Write tests that block missing identity when required, accept verified identity evidence, expose the official Identity/Reputation registry addresses, allow x402 prices at/below cap, and block prices above cap.
- [ ] Run tests and confirm RED.
- [ ] Implement deterministic identity-evidence and x402-price evaluation. Network lookup remains an adapter boundary so public judge mode is deterministic.
- [ ] Run tests and confirm GREEN.

### Task 4: Celo Treasury policy integration — TDD

**Files:**
- Create/modify focused policy files under `src/policy/**` after inspecting existing interfaces
- Create: `test/celo/treasury-policy.test.js`
- Modify scenario fixtures under `src/scenarios/**`

**Interfaces:**
- Consumes existing `ActionIntent`/mandate evaluation pipeline.
- Produces Celo-specific reason codes such as `CHAIN_NOT_ALLOWED`, `ASSET_NOT_ALLOWED`, `X402_PRICE_CAP_EXCEEDED`, `AGENT_IDENTITY_REQUIRED`, while preserving stronger legacy verdict precedence.

- [ ] Write failing tests for safe stablecoin ALLOW, oversize BLOCK, unknown-recipient REVIEW, x402-cap BLOCK, and agent-identity BLOCK.
- [ ] Run tests and confirm RED for Celo behavior only.
- [ ] Add the smallest Celo-aware checks to the existing policy pipeline; do not rewrite legacy logic.
- [ ] Run targeted and full policy tests; confirm GREEN.

### Task 5: Execution-gateway boundary and receipt trace — TDD

**Files:**
- Modify existing execution gateway under `src/execution/**`
- Modify trace integration under `src/trace/**` only where required
- Create: `test/celo/execution-boundary.test.js`

**Interfaces:**
- Produces: Celo `PREPARE` result only after ALLOW; blocks direct preparation for REVIEW/BLOCK/PAUSE; records network/asset/recipient/prepared payload and optional real receipt hash.

- [ ] Write failing tests proving BLOCK/REVIEW/PAUSE can never prepare Celo execution and ALLOW can.
- [ ] Run tests and confirm RED.
- [ ] Add `SIMULATION | PREPARE | LIVE` execution mode with LIVE disabled unless explicitly configured server-side.
- [ ] Record prepared/real Celo receipt metadata in Flight Recorder without claiming settlement when no hash exists.
- [ ] Run targeted tests and confirm GREEN.

### Task 6: Judge Mode and public product experience

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/styles.css` (or exact equivalent after baseline import)
- Create/modify: `public/celo/**` and treasury/judge pages using existing site patterns
- Modify: `README.md`, `docs/ARCHITECTURE.md`, `docs/DEMO.md`, `docs/SUBMISSION.md`

**Interfaces:**
- Produces: homepage thesis, Celo proof page, Treasury demo, 8 deterministic judge scenarios, architecture explanation, explicit simulated/prepared/mainnet evidence labels.

- [ ] Replace Binance-specific hero/judge copy with `Give your agent a budget — not unlimited trust.` and Celo Treasury narrative while retaining CIRCUIT visual identity.
- [ ] Add visible badges/cards for Celo Mainnet, x402, ERC-8004, USA₮/cNGN policy support, and Flight Recorder.
- [ ] Add the eight Celo judge scenarios from the design spec and expected verdicts.
- [ ] Add a Celo proof page showing official chain/registry addresses and clear execution-mode labeling.
- [ ] Update docs with the new hackathon work, differentiation, safety boundary and exact demo path.

### Task 7: Netlify API and deployment readiness

**Files:**
- Modify: `netlify/functions/circuit.mts`
- Modify: `netlify.toml`
- Modify: `.env.example`
- Modify: `package.json`
- Add tests under `test/netlify/**`/`test/celo/**` as appropriate

**Interfaces:**
- Produces public endpoints for CIRCUIT evaluation/status plus safe Celo prepare/proof responses; never returns private keys.

- [ ] Add env names for `CELO_RPC_URL`, optional `USAT_TOKEN_ADDRESS`, optional `CNGN_TOKEN_ADDRESS`, and explicit `CIRCUIT_EXECUTION_MODE`.
- [ ] Wire Celo status/preparation through existing Netlify function patterns.
- [ ] Update package metadata/repository/homepage and keep verification scripts.
- [ ] Run full `npm test`, syntax verification, secret scan, scenario verification and local smoke equivalent.

### Task 8: Final verification and deployment

**Files:**
- No speculative feature work; only fixes required by verification.

**Interfaces:**
- Produces: a green repository and a live Netlify/Vercel URL tied to `Ronlin1/circuit-celo`.

- [ ] Run the complete existing verification suite plus all new Celo tests.
- [ ] Inspect public source for accidental secret/private-key exposure and inaccurate mainnet claims.
- [ ] Verify deployed homepage, Celo proof, Judge Mode and API routes.
- [ ] Record the deployed URL and final judge path in README/submission docs.
