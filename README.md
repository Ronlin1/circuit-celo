<p align="center"><img src="public/assets/circuit-mark.svg" width="112" alt="CIRCUIT Treasury logo"></p>
<h1 align="center">⚡ CIRCUIT Treasury</h1>
<p align="center"><strong>Runtime authorization for autonomous finance on Celo.</strong></p>
<p align="center">Give your agent a budget — not unlimited trust.</p>

> **Agents can reason. Celo lets them pay. CIRCUIT decides what they are authorized to do before money moves.**

CIRCUIT Treasury is a non-custodial runtime control layer for autonomous financial agents on **Celo**. It evaluates every proposed payment against a deterministic financial mandate before stablecoin calldata is exposed for signing or an x402 payment is authorized.

Built for **Celo Agents at Work 2026**, the system combines Celo mainnet execution, ERC-8004 identity evidence, x402 spend controls, sequence-aware safeguards, and an auditable SHA-256 Flight Recorder.

## Why CIRCUIT Treasury

Wallet approval is too broad for autonomous finance. An agent may be allowed to pay while still needing strict limits around:

- approved assets and recipients;
- per-action and daily budgets;
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
3. In **Treasury Lab**, submit a `$5` USA₮ intent and inspect the `ALLOW` decision plus prepared Celo calldata.
4. Change the request to `$50` and confirm `BLOCK` produces no executable payload.
5. Set an x402 request to `$3` and confirm `X402_PRICE_CAP_EXCEEDED`.
6. Provide an ERC-8004 agent ID to incorporate live identity evidence.
7. Connect an EVM wallet. The signing action is exposed only after `ALLOW`.

## API and agent discovery

The deployment publishes [`/skill.md`](public/skill.md) for agent discovery and these API routes:

- `GET /api/status`
- `GET /api/judge`
- `GET /api/traces`
- `POST /api/identity`
- `POST /api/evaluate`
- `POST /api/x402-authorize`

## Security model

- **No custody:** CIRCUIT never stores wallet private keys.
- **Deterministic veto:** model-generated explanations cannot downgrade a stronger policy verdict.
- **No fabricated settlement:** a prepared payload is not represented as a completed transaction.
- **Auditable decisions:** authorization events are written to a hash-linked Flight Recorder.
- **Reproducible control layer:** deterministic policy and trace primitives are loaded from a pinned `circuit-core` revision.

## Local development

Requires Node.js `22.16.0` or newer.

```bash
npm install
npm run verify
```

Run individual checks with:

```bash
npm test
npm run scenario:verify
npm run check:syntax
npm run secret:scan
```

## Repository structure

```text
api/                 Vercel API adapter
netlify/functions/   Netlify serverless adapter
public/              Product UI and agent skill
src/celo/            Celo policy, identity, execution and trace modules
test/celo/           Deterministic control and integration tests
docs/                Architecture and submission documentation
```

## License

MIT © Ronald Atuhaire
