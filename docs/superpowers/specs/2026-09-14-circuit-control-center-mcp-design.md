# CIRCUIT Control Center + MCP Design

**Date:** 2026-09-14  
**Status:** Approved architecture, implementation not yet started  
**Project:** CIRCUIT Treasury on Celo Mainnet

## 1. Objective

Evolve CIRCUIT Treasury from a strong policy demo into a production-shaped **control plane for autonomous money on Celo**.

The upgraded product must work for two audiences at once:

- **Humans** use a Control Center to connect wallets, inspect balances, configure/understand mandate limits, review decisions, and verify real transaction history.
- **Agents** use a remote MCP endpoint to inspect policy, request authorization, prepare transactions, verify identity/reputation, and inspect traces without receiving unrestricted signing authority.

The core product invariant remains unchanged:

> An agent may reason freely, but only CIRCUIT can open the execution boundary, and only a user-controlled wallet can sign the resulting transaction.

## 2. Success Criteria

The upgrade is successful when all of the following are true:

1. Wallet connection is explicit, inspectable, and reversible from the CIRCUIT UI.
2. A dashboard shows real, persistent treasury activity instead of only the current browser session.
3. Historical decisions and submitted Celo transactions can be filtered and inspected.
4. CIRCUIT exposes a remote MCP endpoint at `/mcp` using the current stateless MCP HTTP model.
5. MCP clients can call authorization tools but cannot bypass CIRCUIT policy or sign with a server-held user key.
6. CIRCUIT can advertise its MCP endpoint through its own ERC-8004 registration metadata.
7. Celo transactions can include the official ERC-8021 builder attribution suffix once the project tag is issued.
8. The entire system remains Celo-mainnet-first and non-custodial.
9. Regression, hostile-input, concurrency, and live smoke tests stay green.
10. The product tells a clear hackathon story: **dashboard for humans, MCP for agents, deterministic policy in the middle, Celo for settlement.**

## 3. Non-Goals for This Pass

The following are intentionally deferred until the Control Center is stable:

- custodial private-key storage;
- unrestricted autonomous server-side signing;
- cross-chain routing or bridges;
- swaps and DEX execution;
- complex smart-account delegation;
- recurring subscription execution;
- full multisig orchestration;
- production batch payroll.

A bounded batch-payout feature can be the next major phase after this design is proven.

## 4. Current-State Findings

The current implementation already has strong foundations:

- Celo Mainnet chain `42220`;
- deterministic treasury policy checks;
- ALLOW/BLOCK/REVIEW/PAUSE verdicts;
- per-action and daily budget controls;
- token amount integrity checks;
- x402 price-cap authorization;
- ERC-8004 identity lookup;
- duplicate/replay controls;
- hash-linked Flight Recorder;
- user-wallet execution;
- EIP-6963 MetaMask discovery;
- live Judge Mode;
- hostile-input and live stress tests.

The main structural gaps are:

- no first-class disconnect/reconnect UI;
- wallet details are compressed into a small header control;
- no persistent activity store;
- no dashboard metrics or transaction history;
- public mandate is effectively a single demo policy;
- x402 is authorization-focused rather than a complete paid-resource journey;
- CIRCUIT itself is not yet represented as its own ERC-8004 agent identity;
- reputation evidence is not surfaced to users;
- ERC-8021 builder attribution is not yet appended to prepared transactions;
- no remote CIRCUIT MCP server exists.

## 5. Proposed Architecture

### 5.1 Human Control Center

The existing homepage remains the public product surface, but the Treasury Lab becomes a fuller **Control Center**.

Primary dashboard sections:

1. **Treasury overview**
   - connected wallet;
   - network state;
   - CELO balance;
   - supported stablecoin balances;
   - current execution mode;
   - current ERC-8004 CIRCUIT agent identity.

2. **Mandate health**
   - per-action maximum;
   - remaining daily/session budget;
   - x402 cap;
   - unknown-recipient review threshold;
   - allowed assets;
   - identity mode;
   - replay protection state.

3. **Authorization metrics**
   - intents evaluated;
   - ALLOW count;
   - BLOCK count;
   - REVIEW count;
   - PAUSE count;
   - USD value authorized;
   - USD value prevented/held for review;
   - x402 spend authorized.

4. **Recent activity**
   - timestamp;
   - decision;
   - asset;
   - policy value;
   - masked recipient;
   - agent identity if supplied;
   - trace ID;
   - transaction hash and confirmation state when applicable.

5. **Decision detail drawer/modal**
   - full reason codes;
   - policy checks;
   - prepared payload metadata;
   - Flight Recorder hashes;
   - CeloScan link;
   - attribution evidence.

### 5.2 Visual Language

Preserve the existing CIRCUIT visual identity: dark control-room UI, yellow Celo/CIRCUIT accent, green ALLOW, orange REVIEW, red BLOCK/PAUSE.

Add high-information visuals without turning the product into a generic analytics dashboard:

- compact KPI cards;
- mandate utilization progress bars;
- donut/bar decision distribution;
- activity timeline;
- value-over-time mini chart;
- status chips for `PREPARED`, `SUBMITTED`, `CONFIRMED`, `FAILED`;
- compact balance cards with token symbol and contract-link affordances.

Charts must be derived from real persisted activity, never invented demo data in production mode.

## 6. Wallet Connection and Disconnection UX

### 6.1 Wallet Modal

Clicking the wallet control opens a modal/panel that shows:

- provider name and icon/label;
- connected address;
- network name and chain ID;
- CELO balance;
- supported token balances;
- copy address;
- open address in CeloScan;
- reconnect/switch-account action;
- disconnect action.

Connection also uses an explicit modal rather than silently firing provider requests.

### 6.2 Disconnect Semantics

`Disconnect` must always clear CIRCUIT local application state:

- `account = null`;
- `walletProvider = null`;
- prepared execution state cleared;
- wallet UI returns to disconnected state;
- any wallet-specific dashboard data is removed from the active view.

Where the provider supports programmatic permission revocation, CIRCUIT may request it. Where it does not, the UI must state clearly that the dapp session is disconnected locally and provide instructions/open-wallet guidance for removing the site's permission inside the wallet.

Disconnecting is **not** the same as revoking ERC-20 token allowances. CIRCUIT must never claim otherwise.

### 6.3 Wallet Events

The application must correctly handle:

- `accountsChanged`;
- `chainChanged`;
- account removal;
- user rejection;
- provider collision;
- page refresh after disconnect;
- Celo network loss;
- reconnect with a different account.

## 7. Persistent Activity and Transaction History

### 7.1 Storage Interface

Introduce an `ActivityStore` abstraction so policy logic is not tied to one vendor.

Implementations:

- `MemoryActivityStore` for unit tests/local fallback;
- `SupabaseActivityStore` for production durable persistence.

The production implementation uses server-side environment variables only. No service-role credential is exposed to the browser.

### 7.2 Activity Record

A persisted activity record contains only data required for control, observability, and public-chain reconciliation:

- `id` / trace ID;
- timestamp;
- session identifier or hashed session key;
- connected wallet address when relevant;
- agent ID when supplied;
- action kind (`TRANSFER`, `X402`);
- asset;
- requested USD value;
- token amount/base units;
- decision;
- reason codes;
- recipient display value or hashed/masked representation for non-chain decisions;
- prepared contract address;
- transaction hash if submitted;
- transaction status;
- previous trace hash;
- current trace hash;
- ERC-8021 attribution tag/version when used.

No private key, seed phrase, wallet secret, auth token, or exchange credential is stored.

### 7.3 Transaction Lifecycle

Activity can move through these states:

`EVALUATED -> PREPARED -> SUBMITTED -> CONFIRMED`

or:

`EVALUATED -> BLOCKED / REVIEW / PAUSED`

or:

`SUBMITTED -> FAILED`

The browser reports a transaction hash after `eth_sendTransaction`; the backend records the submission and can reconcile receipt status using the Celo RPC.

### 7.4 Dashboard Queries

Add API surfaces for:

- recent activity;
- activity detail;
- aggregate metrics;
- transaction status reconciliation.

All public analytics endpoints must be rate-limited/safely bounded and must not expose server secrets.

## 8. MCP Server

### 8.1 Endpoint

Remote endpoint:

`POST https://circuit-celo.vercel.app/mcp`

Primary protocol target: MCP `2026-07-28` stateless HTTP. The implementation should use the current TypeScript MCP server package and preserve stateless compatibility for older clients where the official SDK supports it.

This design fits Vercel because protocol-level sessions are not required by MCP `2026-07-28`.

### 8.2 Initial MCP Tools

#### `get_treasury_status`
Returns:

- Celo network info;
- execution mode;
- supported assets;
- public mandate summary;
- optional wallet/address balance information when an address is explicitly provided.

#### `get_mandate`
Returns the current enforceable mandate and verdict precedence.

#### `evaluate_payment`
Input:

- chain ID;
- kind;
- asset;
- recipient;
- policy value;
- token/base-unit amount;
- intent ID;
- optional agent ID.

Output:

- decision;
- reason codes;
- checks;
- trace reference.

#### `prepare_payment`
Produces executable transaction metadata only when policy returns `ALLOW`.

It must not accept a caller-supplied decision or relaxed mandate.

#### `authorize_x402`
Runs CIRCUIT policy over an x402 payment request and returns authorization evidence.

#### `verify_agent`
Reads ERC-8004 identity evidence for a supplied agent ID.

#### `get_agent_reputation`
Reads ERC-8004 reputation summary/evidence for a supplied agent ID.

#### `list_activity`
Returns a bounded recent activity window. Sensitive/internal-only fields are excluded.

#### `verify_trace`
Verifies the hash-linked Flight Recorder chain or a specified trace relationship.

### 8.3 MCP Security Boundary

The MCP server must never expose a generic unrestricted `send_money` tool.

It may:

- inspect;
- authorize;
- prepare;
- verify;
- report.

It may not:

- hold the user's private key;
- silently sign as the user;
- allow a caller to replace the server mandate;
- trust caller-supplied daily-spend/replay context;
- return executable payloads for non-ALLOW decisions.

### 8.4 MCP Input Hardening

Every MCP tool receives strict schema validation and bounded input sizes.

Reject or safely handle:

- invalid EVM addresses;
- unsupported assets;
- wrong chain IDs;
- NaN/Infinity/negative values;
- uint256 overflow;
- duplicate intent IDs;
- oversized strings;
- prompt/policy override fields;
- malicious metadata;
- unsupported protocol requests;
- mismatched MCP headers/body method names.

## 9. ERC-8004 Self Identity and Reputation

CIRCUIT should be registered as its own ERC-8004 agent on Celo Mainnet.

Its registration metadata should advertise:

- name: `CIRCUIT Treasury`;
- description;
- web endpoint: production app;
- MCP endpoint: `/mcp`;
- wallet endpoint/address on chain `42220`;
- supported trust: identity and reputation initially;
- optional skill metadata URL.

The Control Center should show:

- CIRCUIT Agent ID;
- owner/wallet;
- registry status;
- reputation summary;
- 8004scan / explorer link when available.

CIRCUIT must not self-submit reputation feedback where the registry rules forbid owner/operator self-rating.

## 10. ERC-8021 Builder Attribution

Once registration provides the official `celo_...` builder identifier, transaction preparation must append the ERC-8021 attribution suffix according to the Celo builder specification.

Requirements:

- attribution is deterministic;
- original ERC-20 calldata remains semantically correct;
- tests verify the suffix exactly;
- UI exposes an `Attributed to CIRCUIT` indicator;
- prepared payload metadata records attribution version/tag;
- no placeholder/fake attribution is used before the real tag exists.

## 11. x402 Upgrade

Keep the current authorization endpoint, but improve the product journey so users and judges can see the complete sequence:

`resource request -> payment requirement -> CIRCUIT authorization -> payment prepared/signed -> resource response`

A demo x402 resource can be added as a controlled proving surface, but the policy engine remains independent of that demo.

Dashboard metrics distinguish normal transfers from x402 authorizations/payments.

## 12. Mandate Model Evolution

Do not immediately turn the public demo into a fully editable arbitrary-policy editor.

For this phase:

- retain a safe server-owned default mandate;
- expose the current mandate clearly in the dashboard;
- add named policy presets only if required (`Conservative`, `Standard`, `Demo`) and only when server-defined;
- never accept an arbitrary caller-supplied mandate from browser or MCP clients.

A later authenticated version can support user-owned persistent mandates.

## 13. API Changes

Existing routes remain backward compatible where possible.

Planned additions:

- `GET /api/activity`
- `GET /api/activity/:id` or equivalent query route
- `GET /api/metrics`
- `POST /api/transaction-submitted`
- `POST /api/transaction-status`
- `POST /api/reputation`
- `/mcp`

Existing:

- `/api/status`
- `/api/judge`
- `/api/traces`
- `/api/identity`
- `/api/evaluate`
- `/api/x402-authorize`

must continue to work unless an explicit migration is documented.

## 14. Code Organization

Targeted new modules:

- `src/celo/activity-store.js`
- `src/celo/metrics.js`
- `src/celo/receipts.js`
- `src/celo/reputation.js`
- `src/celo/attribution.js`
- `src/mcp/server.js`
- `api/mcp.js` or equivalent Vercel route

Browser code should be split enough that wallet logic, dashboard rendering, and intent execution do not continue growing inside one monolithic `public/app.js`.

Suggested browser modules:

- `public/js/wallet.js`
- `public/js/dashboard.js`
- `public/js/treasury.js`
- `public/js/ui.js`

Avoid unrelated refactors.

## 15. Testing Strategy

### 15.1 Unit Tests

Add tests for:

- wallet disconnect local reset;
- reconnect after disconnect;
- account switch;
- chain switch;
- EIP-6963 selection;
- activity persistence mapping;
- aggregate metrics;
- receipt reconciliation;
- ERC-8021 suffix encoding;
- reputation parsing;
- every MCP tool schema;
- MCP policy enforcement;
- non-ALLOW preparation refusal;
- malformed MCP requests;
- trace verification.

### 15.2 Integration Tests

Add tests that exercise:

- evaluate -> persist -> dashboard query;
- ALLOW -> prepare -> submitted hash -> confirmed receipt;
- BLOCK/REVIEW/PAUSE -> no executable payload;
- MCP evaluate -> same policy result as REST;
- MCP prepare -> same payload as REST for identical intent;
- identity lookup and reputation lookup;
- persistent store unavailable -> safe failure/fallback behavior.

### 15.3 Hostile/Fuzz Tests

Expand randomized testing to include:

- malformed addresses;
- extreme numeric values;
- large payloads;
- repeated intent IDs;
- session collision attempts;
- fake attribution tags;
- attempts to pass custom mandates;
- prompt injection strings;
- MCP header/body mismatch;
- x402 price manipulation;
- amount/value mismatches.

### 15.4 Live Stress

Before declaring production ready:

- concurrent REST authorization requests;
- concurrent MCP tool calls;
- mixed dashboard reads + writes;
- replay bursts;
- simulated Celo RPC failures/timeouts;
- persistence latency/failure;
- wallet cancel/reject paths;
- live Judge Mode;
- live ERC-8004 identity/reputation probes;
- live x402 proving flow.

## 16. Error Handling

The UI and MCP responses should distinguish:

- user rejection;
- wallet disconnected;
- wrong network;
- policy denial;
- invalid input;
- persistence unavailable;
- Celo RPC unavailable;
- transaction submitted but receipt pending;
- onchain revert/failure;
- ERC-8004 lookup failure;
- unsupported MCP protocol/client behavior.

Do not collapse all failures into generic `Unknown error` messages.

## 17. Privacy and Security

- Never request or store a seed phrase/private key.
- Never log wallet secrets or exchange credentials.
- Store only the minimum public/policy metadata required for history and auditability.
- Mask addresses in dashboard summaries; reveal full public addresses only in explicit detail views.
- Treat browser/MCP-supplied context as untrusted.
- Keep server-owned policy and replay/budget evidence authoritative.
- Rate-limit public write endpoints.
- Bound history queries and MCP list results.
- Use server-side secrets only through environment configuration.

## 18. Deployment and Compatibility

The production target remains Vercel.

Requirements:

- existing production URL remains stable;
- `/mcp` must run in the supported Vercel runtime;
- stateless MCP design must not depend on sticky sessions;
- production persistence must survive function restarts/redeployments;
- `MemoryActivityStore` is test/local only;
- current public API and `/skill.md` remain reachable.

## 19. Hackathon Positioning

This design strengthens all three strategically relevant dimensions:

### Value Moved
A transaction-aware treasury product creates a credible path toward legitimate payments between independent parties, and the future batch-payout phase can deepen this without manufacturing volume.

### Real World Adoption / Stablecoins
The dashboard makes the product understandable to normal users, while real stablecoin transaction history demonstrates repeatable utility instead of a one-shot demo.

### Judges' Favorite
The combined stack is differentiated:

`ERC-8004 identity/reputation -> MCP agent interface -> CIRCUIT authorization -> x402/stablecoin payment -> ERC-8021 attribution -> Celo settlement`

This makes CIRCUIT infrastructure that other agents can consume, not just another payment bot.

## 20. Delivery Order

Implementation should proceed in this order:

1. wallet modal + disconnect/reconnect;
2. activity-store abstraction + persistent history;
3. dashboard metrics/activity UI;
4. receipt submission/reconciliation;
5. MCP `/mcp` endpoint + security tests;
6. ERC-8004 CIRCUIT identity/reputation surfaces;
7. ERC-8021 attribution support once real tag is available;
8. improved x402 end-to-end proving flow;
9. expanded stress/live verification;
10. documentation/demo/submission refresh.

Batch payouts remain a follow-up phase after all of the above is green.

## 21. External References

- Celo ERC-8004 documentation: https://docs.celo.org/build-on-celo/build-with-ai/8004
- Celo MCP overview/server documentation: https://docs.celo.org/build-on-celo/build-with-ai/mcp/celo-mcp
- MCP 2026-07-28 release: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- MCP TypeScript SDK migration/server guidance: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
- Celo Agents at Work rules: https://www.risein.com/celo/celo-agents-at-work-hackathon

## 22. Final Product Thesis

> **CIRCUIT Treasury is the control plane for autonomous money on Celo: a dashboard for humans, MCP for agents, deterministic authorization in the middle, and Celo for settlement.**
