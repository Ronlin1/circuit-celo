<p align="center"><img src="public/assets/circuit-mark.svg" width="112" alt="CIRCUIT Treasury logo"></p>
<h1 align="center">⚡ CIRCUIT Treasury</h1>
<p align="center"><strong>Runtime authorization for autonomous finance on Celo.</strong></p>
<p align="center">Give your agent a budget — not unlimited trust.</p>

> **Agents can reason. Celo lets them pay. CIRCUIT decides what they are authorized to do before money moves.**

CIRCUIT Treasury is a non-custodial runtime control layer for autonomous financial agents on **Celo**. It evaluates every proposed payment against a deterministic financial mandate before stablecoin calldata is exposed for signing or an x402 payment is authorized.

Built for **Celo Agents at Work 2026**, the system combines Celo mainnet execution, ERC-8004 identity evidence, x402 spend controls, sequence-aware safeguards, durable authorization state, and an auditable SHA-256 Flight Recorder.

## Why CIRCUIT Treasury

Wallet approval is too broad for autonomous finance. An agent may be allowed to pay while still needing strict limits around:

- approved assets and recipients;
- per-action and session-day budgets;
- ERC-8004 identity requirements;
- x402 price ceilings;
- duplicate and retry behavior; and
- human review thresholds.

CIRCUIT evaluates those constraints at runtime and returns one deterministic verdict:

`PAUSE > BLOCK > REVIEW > RESIZE > ALLOW`

Only `ALLOW` can cross the execution boundary.

## Control path

```text
Human Financial Mandate
          │
          ▼
      Worker Agent
          │
          ▼
   Payment / x402 Intent
          │
          ▼
   ⚡ CIRCUIT Treasury
    ├─ spend policy
    ├─ recipient policy
    ├─ ERC-8004 identity evidence
    ├─ x402 price guard
    ├─ duplicate / sequence breaker
    └─ SHA-256 Flight Recorder
          │
          ├── PAUSE / BLOCK / REVIEW ──► gateway closed
          │
          └── ALLOW ──► Celo calldata ──► user wallet ──► Celo mainnet
```

The application is deliberately **non-custodial**. CIRCUIT prepares an authorized transaction payload, but the connected user wallet remains the final signer. No wallet private key is stored by the application.

## Control Center

The web application exposes a session-scoped Control Center backed by the same authorization state used by the evaluator. It shows only real data:

- authorization verdict counts and protected/authorized value;
- session-day mandate utilization;
- recent persisted authorization and transaction lifecycle records;
- connected-wallet CELO and supported ERC-20 balances read through the wallet provider; and
- CeloScan links for submitted transactions.

No sample transactions, fabricated confirmations, or invented balances are shown.

## Celo integration

| Primitive | CIRCUIT Treasury use |
|---|---|
| **Celo Mainnet** `42220` | Stablecoin execution and onchain evidence |
| **USA₮** | Headline USD payment asset |
| **cNGN** | Naira-denominated payment asset |
| **USDC / USD₮ / USDm** | Additional supported Celo stablecoin rails |
| **ERC-8004** | Live agent identity registration evidence |
| **x402** | Policy-gated machine-to-machine spend authorization |
| **Celo wallet RPC** | User-controlled final transaction signature |

## Transaction lifecycle

A wallet-returned transaction hash is never treated as settlement proof by itself.

```text
ALLOW + prepared payload
        │
        ▼
wallet eth_sendTransaction
        │
        ▼
SUBMITTED + tx hash persisted
        │
        ▼
Celo receipt reconciliation
        │
        ├── no receipt yet ──► SUBMITTED
        ├── status success ──► CONFIRMED
        └── status failure ──► FAILED
```

A prepared authorization is one-shot after a successful broadcast. If the wallet broadcasts but CIRCUIT cannot persist the submission, the UI preserves the returned hash, links to CeloScan, disables resubmission, and tells the user to verify the existing transaction rather than send again.

The public demo recipient `0x1111111111111111111111111111111111111111` is **evaluation-only** and is blocked at the browser execution boundary. The live form does not prefill a recipient; a real recipient must be entered explicitly before evaluation.

## Judge Mode

Judge Mode runs eight deterministic adversarial scenarios designed to show the control boundary clearly:

| Scenario | Expected verdict |
|---|---|
| Safe USA₮ payment | `ALLOW` |
| Oversize payment | `BLOCK` |
| Duplicate retry | `PAUSE` |
| Unknown recipient above threshold | `REVIEW` |
| x402 purchase within cap | `ALLOW` |
| x402 price above cap | `BLOCK` |
| Missing ERC-8004 identity | `BLOCK` |
| Prompt-based policy override | `BLOCK` |

## 60-second demo path

1. Open the deployed application.
2. Run **Judge Mode** and confirm `8 / 8` expected controls match.
3. In **Treasury Lab**, enter a valid recipient and submit a `$5` USA₮ intent; inspect the `ALLOW` decision plus prepared Celo calldata.
4. Change the request to `$50` and confirm `BLOCK` produces no executable payload.
5. Set an x402 request to `$3` and confirm `X402_PRICE_CAP_EXCEEDED`.
6. Provide an ERC-8004 agent ID to incorporate live identity evidence.
7. Connect an EVM wallet. The signing action is exposed only after a traceable `ALLOW` and only on Celo.

## API and agent discovery

The deployment publishes [`/skill.md`](public/skill.md) for agent discovery and these API routes:

- `GET /api/status`
- `GET /api/judge`
- `GET /api/traces`
- `GET /api/activity?sessionId=...`
- `GET /api/metrics?sessionId=...`
- `POST /api/identity`
- `POST /api/evaluate`
- `POST /api/x402-authorize`
- `POST /api/transaction-submitted`
- `POST /api/transaction-status`

## Security model

- **No custody:** CIRCUIT never stores wallet private keys.
- **Deterministic veto:** model-generated explanations cannot downgrade a stronger policy verdict.
- **No fabricated settlement:** a prepared payload or wallet hash is not represented as a confirmed transaction.
- **One-shot browser execution:** a broadcast authorization is consumed to reduce accidental duplicate sends.
- **Demo-address protection:** the public demo recipient cannot cross the wallet execution boundary.
- **Durable production authorization state:** Vercel/Node production forces the Supabase store and fails closed if it is unavailable or misconfigured.
- **Server-only database access:** browser roles are denied direct activity-table/RPC access; the Supabase server secret stays in server functions only.
- **Auditable decisions:** authorization events are written to a hash-linked Flight Recorder.
- **Reproducible control layer:** deterministic policy and trace primitives are loaded from a pinned `circuit-core` revision.

## Local development

Requires Node.js `22.16.0` or newer.

```bash
npm install
npm run verify
```

Local development defaults to the in-memory ActivityStore unless `CIRCUIT_ACTIVITY_STORE=supabase` is explicitly configured.

Run individual checks with:

```bash
npm test
npm run scenario:verify
npm run check:syntax
npm run secret:scan
```

## Production deployment

Production intentionally fails closed if durable authorization state is not configured. Before deploying to Vercel or another `NODE_ENV=production` runtime:

1. Create or select a Supabase project for CIRCUIT.
2. Run [`docs/sql/activity-store.sql`](docs/sql/activity-store.sql) once in that project's SQL editor. The migration creates the durable activity table, hash-chain append RPC, indexes, RLS configuration, and explicit server-only permissions.
3. Configure these **server-side production environment variables**:

```text
SUPABASE_URL=<your Supabase project URL>
SUPABASE_SECRET_KEY=<server-only sb_secret_... key>
CIRCUIT_EXECUTION_MODE=PREPARE
CELO_RPC_URL=https://forno.celo.org
```

`SUPABASE_SECRET_KEY` is preferred for new deployments. CIRCUIT also accepts the legacy `SUPABASE_SERVICE_ROLE_KEY` as a migration fallback. Neither key may be placed in browser/public variables such as `NEXT_PUBLIC_*`, `VITE_*`, or committed files.

In production, CIRCUIT forces the durable Supabase ActivityStore even if `CIRCUIT_ACTIVITY_STORE=memory` is supplied. If the Supabase credentials, schema, or state read are unavailable, authorization requests return `503 AUTHORIZATION_STATE_UNAVAILABLE`; CIRCUIT does not silently downgrade to memory.

Keep `CIRCUIT_EXECUTION_MODE=PREPARE` unless the execution model is intentionally changed and re-verified. Wallet signing remains user-controlled in PREPARE mode.

### Pre-deploy checklist

- `npm run verify` is fully green.
- `docs/sql/activity-store.sql` has been applied to the production Supabase project.
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or the legacy service-role fallback) are present only in server-side production settings.
- `/api/status` returns Celo Mainnet `42220`, `PREPARE`, and a durable state model.
- `/api/judge` returns `8 / 8` expected controls.
- A production evaluation persists and appears through `/api/activity` for the same session.
- The first real-wallet proof uses a small intentional amount and a verified recipient; never use the demo recipient for funds.

## Repository structure

```text
api/                 Vercel API adapter
netlify/functions/   Netlify serverless adapter
public/              Product UI and agent skill
src/celo/            Celo policy, identity, execution and trace modules
test/celo/           Deterministic control and integration tests
docs/sql/            Production durable-state migration
docs/                Architecture and submission documentation
```

## License

MIT © Ronald Atuhaire
