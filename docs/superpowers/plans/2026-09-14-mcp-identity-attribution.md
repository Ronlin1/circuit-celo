# CIRCUIT MCP, Identity, and Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose CIRCUIT Treasury as a secure remote MCP service, register/surface CIRCUIT as an ERC-8004 agent, and attach verified ERC-8021 builder attribution to prepared Celo transactions.

**Architecture:** Add a stateless MCP 2026-07-28 endpoint backed by the same server-owned policy path as REST, so MCP cannot bypass mandate enforcement. Extend identity/reputation readers and add an attribution encoder at the transaction-preparation boundary; all signing remains in the user wallet.

**Tech Stack:** Node.js >=22.16, ESM, `@modelcontextprotocol/server` v2, `@modelcontextprotocol/node` v2, native `node:test`, Vercel functions, Celo Mainnet ERC-8004 registries, ERC-8021 calldata suffixes.

**Spec:** `docs/superpowers/specs/2026-09-14-circuit-control-center-mcp-design.md`

## Global Constraints

- `/mcp` is stateless HTTP and must serve MCP `2026-07-28`; legacy stateless compatibility may remain enabled through the official SDK default.
- MCP may inspect, authorize, prepare, verify, and report; it must not expose unrestricted signing or custody.
- MCP callers cannot provide a custom mandate, trusted replay context, or caller-selected verdict.
- Celo Mainnet identity registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`.
- Celo Mainnet reputation registry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`.
- ERC-8021 attribution is disabled until a real project tag is configured; no placeholder code ships as real attribution.
- Non-ALLOW results never produce executable transaction payloads.

---

### Task 1: Add MCP v2 dependencies and a minimal stateless endpoint

**Files:**
- Modify: `package.json`
- Create: `src/mcp/server.js`
- Create: `api/mcp.js`
- Modify: `vercel.json`
- Test: `test/mcp/server.test.js`

**Interfaces:**
- Produces `createCircuitMcpServer({env,activityStore,fetchImpl})`.
- `/mcp` delegates to official `createMcpHandler(factory)` and a Node adapter supported by the MCP v2 SDK.

- [ ] **Step 1: Write failing protocol smoke test**

Create a test client using the official MCP v2 client package or direct standards-compliant HTTP requests. Assert `server/discover`/tool discovery works at protocol `2026-07-28` and that a malformed header/body method mismatch is rejected.

Run: `node --test test/mcp/server.test.js`

Expected: FAIL because MCP modules do not exist.

- [ ] **Step 2: Add official MCP v2 packages**

Install the current stable v2 packages required by the official docs: `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, and any exact schema package required by the chosen registration API. Do not use deprecated v1 `@modelcontextprotocol/sdk` unless compatibility testing explicitly requires it.

- [ ] **Step 3: Implement minimal server factory**

Create an `McpServer({name:'circuit-treasury',version:<package version>},{capabilities:{tools:{}}})` per request. Keep tool registration pure and deterministic.

- [ ] **Step 4: Wire Vercel route**

Expose `/mcp` as POST through a dedicated function/route, not through the existing `?route=` REST dispatcher. Return `405` for unsupported methods if required by the SDK.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`

Commit: `feat: expose stateless CIRCUIT MCP endpoint`

---

### Task 2: Implement MCP treasury inspection tools

**Files:**
- Modify: `src/mcp/server.js`
- Test: `test/mcp/tools.test.js`

**Interfaces:**
- Tools: `get_treasury_status`, `get_mandate`, `list_activity`, `verify_trace`.

- [ ] **Step 1: Write failing schema tests**

Assert tool names, descriptions, bounded inputs, structured outputs, and that `list_activity` cannot request unbounded/global private history.

- [ ] **Step 2: Implement `get_treasury_status`**

Return Celo network, execution mode, supported assets, public mandate summary, and optional read-only wallet balance data only for an explicitly supplied valid address.

- [ ] **Step 3: Implement `get_mandate`**

Return only the server-owned active public mandate and verdict precedence; do not accept a caller mandate parameter.

- [ ] **Step 4: Implement `list_activity`**

Require a valid session scope or return only public aggregate/on-chain-safe history according to the privacy model. Cap results at 100.

- [ ] **Step 5: Implement `verify_trace`**

Return hash-chain verification evidence without leaking unrelated session records.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`

Commit: `feat: add MCP treasury inspection tools`

---

### Task 3: Implement MCP authorization and preparation tools through the same policy core

**Files:**
- Modify: `src/mcp/server.js`
- Modify: `src/celo/api.js`
- Test: `test/mcp/tools.test.js`
- Test: `test/celo/production-hardening.test.js`

**Interfaces:**
- Tools: `evaluate_payment`, `prepare_payment`, `authorize_x402`.
- All tools call the same `evaluatePublicTreasuryRequest`/durable activity path as REST.

- [ ] **Step 1: Write failing equivalence tests**

For an identical typed intent/session state, assert REST and MCP produce the same action, reason codes, approved amount, and prepared payload metadata.

- [ ] **Step 2: Add strict MCP intent schema**

Require chain ID, kind, asset, recipient, requested USD, amount base units, and intent ID. Bound string lengths. Reject NaN/Infinity/negative values, wrong chain, unsupported assets, invalid addresses, uint256 overflow, and custom mandate/context fields.

- [ ] **Step 3: Implement `evaluate_payment`**

Return decision/checks/trace only. Durable budget/replay state remains server-derived.

- [ ] **Step 4: Implement `prepare_payment`**

Use the same evaluation path and return executable Celo metadata only when action is `ALLOW`. Never trust a decision supplied by the client.

- [ ] **Step 5: Implement `authorize_x402`**

Force `kind:'X402'` server-side and return policy authorization evidence plus prepared payment metadata only when ALLOW.

- [ ] **Step 6: Add hostile-tool tests**

Attempt custom mandates, policy-override fields, duplicate intent IDs, mismatched token/USD values, and malformed MCP requests. Assert safe BLOCK/PAUSE/error and no executable payload.

- [ ] **Step 7: Verify and commit**

Run: `npm run verify`

Commit: `feat: expose policy-gated payment tools over MCP`

---

### Task 4: Expand ERC-8004 identity and reputation readers

**Files:**
- Create: `src/celo/reputation.js`
- Modify: `src/celo/agent-trust.js`
- Modify: `src/celo/api.js`
- Modify: `api/index.js`
- Modify: `src/mcp/server.js`
- Test: `test/celo/reputation.test.js`
- Test: `test/mcp/tools.test.js`

**Interfaces:**
- Produces `lookupAgentIdentity(agentId,env,fetchImpl)` and `lookupAgentReputation(agentId,env,fetchImpl)`.
- MCP tools: `verify_agent`, `get_agent_reputation`.
- REST addition: `POST /api/reputation`.

- [ ] **Step 1: Write failing ABI/RPC decoding tests**

Use fixture RPC responses for registered/unregistered agent and reputation summary/error cases. Assert no owner/operator self-feedback path is exposed by CIRCUIT.

- [ ] **Step 2: Refactor identity lookup out of Vercel adapter**

Move current identity RPC/fetch logic from `api/index.js` into reusable Celo module code so REST and MCP share it.

- [ ] **Step 3: Implement reputation reader**

Encode/read the registry summary using the official ERC-8004 interface and return normalized fields suitable for UI/MCP. Treat RPC errors as unavailable evidence, not fake zero reputation.

- [ ] **Step 4: Add REST and MCP surfaces**

Expose `POST /api/reputation`, `verify_agent`, and `get_agent_reputation` with strict agent ID validation.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`

Commit: `feat: surface ERC-8004 identity and reputation`

---

### Task 5: Publish CIRCUIT ERC-8004 registration metadata

**Files:**
- Create: `public/.well-known/circuit-agent.json`
- Modify: `public/skill.md`
- Modify: `README.md`
- Modify: `src/celo/config.js`
- Test: `test/celo/config.test.js`

**Interfaces:**
- Registration metadata advertises web, MCP, and wallet endpoint information.
- Config supports `CIRCUIT_ERC8004_AGENT_ID` and `CIRCUIT_AGENT_WALLET` once registration is actually completed.

- [ ] **Step 1: Write metadata validation test**

Assert type/name/description, `https://circuit-celo.vercel.app/mcp`, Celo wallet endpoint chain ID 42220 when configured, and supported trust includes reputation.

- [ ] **Step 2: Add public registration document**

Use a stable production URL so the on-chain `agentURI` can point to it. Do not insert an invented agent ID/wallet before registration.

- [ ] **Step 3: Expose configured CIRCUIT identity in status**

When env is present, `/api/status` returns agent ID and metadata URL. When absent, return a clear `registrationStatus:'pending'` rather than fake identity.

- [ ] **Step 4: Manual on-chain registration checkpoint**

Using the user's connected wallet, register CIRCUIT Treasury against the Celo Mainnet Identity Registry with the public metadata URI. Record the real agent ID and tx hash in submission docs only after confirmation.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`

Commit: `feat: publish CIRCUIT ERC-8004 agent metadata`

---

### Task 6: Implement ERC-8021 attribution encoder and transaction integration

**Files:**
- Create: `src/celo/attribution.js`
- Modify: `src/celo/gateway.js`
- Modify: `src/celo/config.js`
- Modify: `.env.example`
- Test: `test/celo/attribution.test.js`
- Test: `test/celo/gateway.test.js`

**Interfaces:**
- Produces `encodeErc8021Suffix(code)` and `appendErc8021Attribution(calldata,code)`.
- Config: `CIRCUIT_ERC8021_CODE` is optional; absent means no suffix.

- [ ] **Step 1: Write failing canonical-suffix tests**

Use the official schema-0 structure: ASCII code bytes, code-length byte, schema ID `00`, and 16-byte ERC marker `80218021802180218021802180218021`. Assert exact bytes for a known test code and reject empty/oversized/non-ASCII codes.

- [ ] **Step 2: Implement encoder**

Keep original calldata unchanged when no real code is configured. When configured, append exactly one suffix and return attribution metadata separately.

- [ ] **Step 3: Integrate into prepared ERC-20 calldata**

`prepareCeloTransfer()` appends attribution after the standard ERC-20 `transfer` calldata, preserving the first 68-byte ABI payload semantics. Include `{attribution:{standard:'ERC-8021',code}}` in prepared metadata.

- [ ] **Step 4: Add replay-safe tests**

Assert attribution is not appended twice if preparation is accidentally called on already-attributed data; use a suffix detector or keep attribution strictly at one preparation boundary.

- [ ] **Step 5: Configure only the real builder code**

After Celo hackathon registration returns the official `celo_...` identifier, set it in production env. Never commit a secret; the attribution code itself is public.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`

Commit: `feat: attribute CIRCUIT transactions with ERC-8021`

---

### Task 7: Add identity/reputation/attribution to the Control Center

**Files:**
- Modify: `public/js/dashboard.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `test/web/dashboard-ui.test.js`

**Interfaces:**
- Dashboard consumes `/api/status`, `/api/identity`, `/api/reputation`, and activity attribution metadata.

- [ ] **Step 1: Write failing UI tests**

Cover pending vs registered CIRCUIT identity, reputation unavailable vs populated, MCP endpoint copy action, and attributed/unattributed transaction badges.

- [ ] **Step 2: Build Agent Identity card**

Show CIRCUIT Agent ID, owner/wallet, registry state, MCP endpoint, and explorer/8004 link when configured.

- [ ] **Step 3: Build Reputation card**

Show total feedback and normalized categories when available. Never represent no feedback/RPC failure as a positive score.

- [ ] **Step 4: Add attribution indicator**

Prepared/submitted transaction detail shows `ERC-8021 · <code>` only when actual attribution metadata is present.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`

Commit: `feat: surface agent trust and attribution in dashboard`

---

### Task 8: MCP concurrency, compatibility, and documentation

**Files:**
- Create: `scripts/mcp-smoke.js`
- Create: `scripts/mcp-stress.js`
- Modify: `scripts/live-smoke.js`
- Modify: `README.md`
- Modify: `public/skill.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEMO.md`
- Test: `test/mcp/server.test.js`

**Interfaces:**
- Scripts accept `BASE_URL` and send no real transactions.

- [ ] **Step 1: Add modern + legacy stateless compatibility tests**

Verify 2026-07-28 modern discovery/calls and the SDK's supported legacy stateless fallback. Verify unsupported methods and header/body mismatches fail cleanly.

- [ ] **Step 2: Stress MCP authorization**

Run at least 200 concurrent mixed ALLOW/BLOCK/duplicate requests against a preview deployment. Assert zero policy bypasses and bounded error handling.

- [ ] **Step 3: Update skill and architecture docs**

Document MCP endpoint, exact tool names, security boundary, ERC-8004 relationship, ERC-8021 attribution, and example safe tool calls.

- [ ] **Step 4: Run full verification + live smoke**

Run: `npm run verify`

Then: `node scripts/mcp-smoke.js` and `node scripts/mcp-stress.js` against preview.

- [ ] **Step 5: Commit**

Commit: `test: harden CIRCUIT MCP and trust surfaces`
