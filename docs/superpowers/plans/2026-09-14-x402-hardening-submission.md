# CIRCUIT x402 Completion, Stress, and Submission Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn CIRCUIT's x402 policy support into a judge-visible end-to-end paid-resource flow, then run final adversarial/stress validation and prepare submission-grade evidence.

**Architecture:** Keep x402 authorization inside the existing CIRCUIT policy path, add a controlled demo resource that returns an explicit payment requirement, and complete the browser flow from challenge -> policy authorization -> wallet-prepared payment -> resource response. Harden all public surfaces under malformed input, replay, RPC/storage degradation, and concurrency before collecting real Celo mainnet evidence.

**Tech Stack:** Node.js >=22.16, native `node:test`, Vercel functions, CIRCUIT policy core, Celo Mainnet, existing x402 facilitator configuration, browser wallet execution, persistent activity store.

**Spec:** `docs/superpowers/specs/2026-09-14-circuit-control-center-mcp-design.md`

## Global Constraints

- x402 payment authorization must obey the same server-owned mandate and durable replay/budget state as ordinary transfers.
- Demo endpoints must never fake payment success or fabricate on-chain receipts.
- Real transaction evidence is recorded only after an actual wallet-signed Celo transaction is submitted/confirmed.
- No synthetic users, self-funded fake adoption, or fabricated transaction volume is presented as independent adoption.
- Existing Judge Mode must remain 8/8 after all changes.

---

### Task 1: Add a controlled x402 paid-resource proving surface

**Files:**
- Create: `src/celo/x402-resource.js`
- Modify: `api/index.js`
- Test: `test/celo/x402-resource.test.js`

**Interfaces:**
- `getX402ResourceChallenge()` returns a deterministic payment requirement with resource id, price USD, asset, recipient, network `eip155:42220`, and expiry.
- `verifyX402ResourceAccess(input)` validates proof/transaction evidence before returning the paid resource.

- [ ] **Step 1: Write failing challenge tests**

Assert unauthenticated resource access returns HTTP 402 semantics with a bounded challenge, valid Celo network, configured asset/recipient, price at or below the public x402 cap, and no secret values.

- [ ] **Step 2: Implement deterministic demo challenge**

Use one clearly labeled demo resource such as `circuit-risk-report`. Do not randomize price in a way that makes judging irreproducible.

- [ ] **Step 3: Require verifiable payment evidence before resource release**

For the hackathon proving path, accept a confirmed transaction hash only after checking Celo receipt success and matching expected token/recipient/amount when practical. If verification cannot prove payment, keep returning 402/verification-pending rather than a fake success.

- [ ] **Step 4: Add routes**

Add `GET /api/x402-resource` and a bounded proof/retry path such as `POST /api/x402-resource`.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`

Commit: `feat: add verifiable x402 demo resource`

---

### Task 2: Build end-to-end x402 browser flow

**Files:**
- Modify: `public/js/treasury.js`
- Modify: `public/js/dashboard.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `test/web/x402-ui.test.js`

**Interfaces:**
- UI flow: request resource -> receive 402 challenge -> `POST /api/x402-authorize` -> ALLOW -> wallet-prepared payment -> tx submission -> proof retry -> resource response.

- [ ] **Step 1: Write failing UI flow test**

Mock a 402 response, ALLOW authorization, wallet tx hash, confirmed verification, and successful resource response. Also test BLOCK when challenge price exceeds policy cap.

- [ ] **Step 2: Add x402 demo panel**

Show resource name, price, asset, network, policy verdict, tx state, and final access state. Keep the UI compact and clearly marked as a proving flow.

- [ ] **Step 3: Reuse the normal execution boundary**

Do not create separate signing logic. x402 must use the same prepared transaction path and wallet controller as ordinary transfers.

- [ ] **Step 4: Record x402 lifecycle in activity history**

Persist challenge/evaluation/submission/confirmation metadata so dashboard metrics can distinguish x402 authorized spend from normal transfers.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`

Commit: `feat: complete x402 payment journey in Control Center`

---

### Task 3: Expand Judge Mode and adversarial coverage without changing original expected controls

**Files:**
- Modify: `src/celo/judge-scenarios.js`
- Modify: `scripts/verify-scenarios.js`
- Test: `test/celo/judge-scenarios.test.js`
- Test: `test/celo/production-hardening.test.js`

**Interfaces:**
- Keep the original eight canonical judge scenarios and add a separate extended suite rather than silently changing submission evidence.

- [ ] **Step 1: Add extended scenarios**

Add explicit cases for wrong chain, invalid recipient, token/USD mismatch, daily budget exhaustion, uint256/amount abuse, durable replay after process restart, storage outage fail-closed, and attribution tampering.

- [ ] **Step 2: Preserve canonical 8/8 endpoint**

`GET /api/judge` continues to report the original eight expected controls for stable demo evidence. Add an `extended` field or separate internal verifier for the larger suite.

- [ ] **Step 3: Verify and commit**

Run: `npm run scenario:verify && npm run verify`

Commit: `test: expand CIRCUIT adversarial judge coverage`

---

### Task 4: Run high-concurrency and degradation stress tests

**Files:**
- Create: `scripts/full-stress.js`
- Modify: `scripts/live-smoke.js`
- Modify: `.github/workflows/live-smoke.yml`
- Test: `test/celo/production-hardening.test.js`

**Interfaces:**
- Stress script supports `BASE_URL`, `CONCURRENCY`, and `REQUESTS`; defaults are safe and non-transactional.

- [ ] **Step 1: Test 1,000 mixed authorization requests locally/preview**

Mix ALLOW, BLOCK, REVIEW, duplicate, malformed, and x402 requests across multiple sessions. Assert no non-ALLOW response carries prepared calldata.

- [ ] **Step 2: Test same-session race conditions**

Fire simultaneous same-intent and budget-boundary requests. Assert one durable order is established and replay/daily caps cannot be bypassed via races.

- [ ] **Step 3: Simulate dependency degradation**

Exercise Celo RPC timeout/error, Supabase timeout/error, malformed RPC response, and MCP malformed headers. Authorization state failures must fail closed.

- [ ] **Step 4: Add CI live-smoke guardrails**

Keep live CI read-only/non-funding. Never trigger wallet signing or transfer funds in CI.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify && node scripts/full-stress.js`

Commit: `test: stress CIRCUIT across policy and dependency failures`

---

### Task 5: Collect genuine mainnet evidence

**Files:**
- Modify: `docs/SUBMISSION.md`
- Modify: `docs/DEMO.md`

**Interfaces:**
- Evidence records only real tx hashes/agent IDs/attribution code after on-chain confirmation.

- [ ] **Step 1: Fund a test wallet minimally**

Use a small real balance on Celo Mainnet. Verify network before every withdrawal/transfer. Do not expose seed/private key.

- [ ] **Step 2: Execute one tiny ordinary stablecoin transfer through CIRCUIT**

Use a real recipient, evaluate to ALLOW, sign in the wallet, confirm on Celo, and record the tx hash/receipt.

- [ ] **Step 3: Execute one real x402 proving payment if the demo resource is fully verified**

Record the actual tx hash and resulting paid-resource response. Skip rather than fake if any verification step is incomplete.

- [ ] **Step 4: Test with independent users**

Recruit real users who own their own wallets. Record only consented/public aggregate evidence; do not label self-transfers or builder-funded wallets as independent adoption.

- [ ] **Step 5: Update submission evidence**

Add real CeloScan links, CIRCUIT ERC-8004 agent ID/registration tx, real ERC-8021 code, live MCP endpoint, and verified Judge/extended results.

- [ ] **Step 6: Commit**

Commit: `docs: add verified Celo mainnet submission evidence`

---

### Task 6: Final product/demo polish and submission freeze

**Files:**
- Modify: `README.md`
- Modify: `docs/SUBMISSION.md`
- Modify: `docs/DEMO.md`
- Modify: `public/skill.md`
- Modify: `public/index.html`
- Modify: `public/styles.css`

**Interfaces:**
- Final product copy uses one thesis consistently: `Give your agent a budget — not unlimited trust.`

- [ ] **Step 1: Audit all public claims**

Remove any claim that lacks live/on-chain/test evidence. Clearly distinguish policy simulation, prepared transaction, submitted transaction, and confirmed transaction.

- [ ] **Step 2: Polish demo path**

Ensure a judge can: connect wallet -> see dashboard -> ALLOW -> BLOCK -> inspect 8/8 -> inspect ERC-8004/MCP -> see real activity/receipt -> inspect x402 flow in under three minutes.

- [ ] **Step 3: Update README quick start**

Put live app, MCP endpoint, architecture, supported Celo assets, security boundary, ERC-8004/8021/x402 links, and verified evidence above deep implementation detail.

- [ ] **Step 4: Run final verification from clean install**

Run:

```bash
rm -rf node_modules
npm ci
npm run verify
```

Then run all preview live-smoke/stress scripts.

- [ ] **Step 5: Freeze production candidate**

Deploy the verified commit, inspect `/`, `/app.js` or module assets, `/api/status`, `/api/judge`, `/mcp`, `/skill.md`, and x402 resource endpoints from production.

- [ ] **Step 6: Commit**

Commit: `release: freeze CIRCUIT hackathon submission candidate`
