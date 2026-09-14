# CIRCUIT Treasury Architecture

CIRCUIT Treasury is a pre-execution runtime authorization layer for autonomous finance on Celo.

## Control path

```text
Human Financial Mandate
          │
Worker Agent ──► typed ActionIntent
          │             │
          └──────► CIRCUIT Treasury
                  ├─ deterministic treasury policy
                  ├─ ERC-8004 identity evidence
                  ├─ x402 price/resource guard
                  ├─ duplicate/sequence breaker
                  └─ hash-linked Flight Recorder
                            │
          PAUSE/BLOCK/REVIEW│ALLOW
                    │       ▼
                    │  Celo Execution Gateway
                    │       │
                    │  ERC-20 calldata
                    │       ▼
                    └──X  user's wallet signs
                            │
                            ▼
                       Celo Mainnet
```

## Control core

Deterministic policy and Flight Recorder primitives are loaded through a pinned `circuit-core` revision (`fed101ed4675dab240c322eb2318e5ce8564fe65`). The Celo-specific policy, identity, x402, execution, API, and wallet layers remain isolated in this repository. Pinning the control core keeps authorization behavior reproducible across environments.

## Why no custody

The public deployment defaults to `PREPARE`. An `ALLOW` verdict creates executable calldata but never signs it. The connected browser wallet remains the authority for the final transaction, allowing CIRCUIT to enforce runtime policy without centralizing private keys.

## x402 position

CIRCUIT sits immediately before the payment-signature step. `/api/x402-authorize` evaluates resource price, agent identity, budget, asset, and recipient policy before settlement is permitted. The facilitator remains a settlement component rather than a policy authority and can be configured independently.

## ERC-8004

The identity route queries the Celo mainnet Identity Registry with `ownerOf(agentId)`. Onchain registration is treated as policy evidence, not as proof that an agent is universally trustworthy.

## Flight Recorder

Every authorization evaluation records the intent, verdict, and prepared-transaction metadata in a SHA-256 hash-linked Flight Recorder. No wallet private key or secret is written to the trace.
