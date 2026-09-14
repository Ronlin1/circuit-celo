<p align="center"><img src="public/assets/circuit-mark.svg" width="112" alt="CIRCUIT logo"></p>
<h1 align="center">⚡ CIRCUIT Treasury</h1>
<p align="center"><strong>Give your agent a budget — not unlimited trust.</strong></p>
<p align="center">Runtime authorization infrastructure for autonomous finance on Celo.</p>

> **Agents can reason. Celo lets them pay. CIRCUIT decides what they are allowed to do before money moves.**

CIRCUIT Treasury is the Celo-native execution evolution of [CIRCUIT](https://github.com/Ronlin1/circuit), built for **Celo Agents at Work 2026**. The original project proved deterministic runtime control with zero financial writes. This fork connects that proven control plane to **real Celo mainnet ERC-20 transaction preparation, wallet execution, ERC-8004 identity evidence and x402 spend authorization**.

## 60-second judge path

1. Open the deployed site.
2. Run **Judge Mode** — target is `8 / 8` expected containment outcomes.
3. In **Treasury Lab**, submit a $5 USA₮ intent and see `ALLOW` + executable Celo calldata.
4. Change it to $50 and see `BLOCK` with no transaction payload.
5. Try x402 at $3 and see `X402_PRICE_CAP_EXCEEDED`.
6. Enter an ERC-8004 agent ID to use live Celo identity evidence.
7. Connect your wallet: only an `ALLOW` can expose the **Sign & execute on Celo** action.

## What is new for Celo

```text
Worker agent
    │
    ▼
Payment / x402 intent
    │
    ▼
⚡ CIRCUIT
 ├─ Financial Mandate
 ├─ spend + recipient policy
 ├─ duplicate / sequence breaker
 ├─ ERC-8004 identity evidence
 ├─ x402 price guard
 └─ SHA-256 Flight Recorder
    │
    ├── PAUSE / BLOCK / REVIEW ──► execution gateway CLOSED
    │
    └── ALLOW ──► prepared ERC-20 calldata ──► user's wallet ──► Celo mainnet
```

The public app is deliberately **non-custodial**. It never stores a wallet key. A connected user wallet remains the signer for a real payment.

## Celo primitives

| Primitive | CIRCUIT use |
|---|---|
| **Celo Mainnet** `42220` | Stablecoin settlement and identity evidence |
| **USA₮** | Headline USD payment asset |
| **cNGN** | Naira-denominated payment asset |
| **USDC / USD₮ / USDm** | Additional Celo stablecoin rails |
| **ERC-8004** | Live agent identity registration evidence |
| **x402** | Policy-gated machine-to-machine spend before signing |
| **Celo wallet RPC** | User-controlled final transaction signature |

## Deterministic decision precedence

`PAUSE > BLOCK > REVIEW > RESIZE > ALLOW`

The model may interpret and explain. **Deterministic code owns the veto.**

## Test evidence

The repository uses Node's native test runner and pins the original CIRCUIT control core at commit `fed101ed4675dab240c322eb2318e5ce8564fe65`.

```bash
npm install
npm test
npm run scenario:verify
npm run check:syntax
npm run secret:scan
```

Judge Mode covers safe payment, oversize payment, duplicate retry, unknown recipient review, safe x402, expensive x402, missing agent identity, and prompt-injection policy override.

## API / agent skill

The deployed site publishes [`/skill.md`](public/skill.md). Core routes:

- `GET /api/status`
- `GET /api/judge`
- `GET /api/traces`
- `POST /api/identity`
- `POST /api/evaluate`
- `POST /api/x402-authorize`

## Honest execution boundary

A prepared payload is **not** described as a settled transaction. Only a real wallet-submitted transaction hash is a Celo mainnet receipt. This repository contains no private key and no fabricated transaction proof.

## Origin

CIRCUIT = **Continuous Intent & Runtime Control for User-authorized Intelligent Transactions**.

Original project: https://github.com/Ronlin1/circuit  
Celo fork: https://github.com/Ronlin1/circuit-celo

MIT © Ronald Atuhaire
