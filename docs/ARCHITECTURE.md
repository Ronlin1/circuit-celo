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

## Reused core

`circuit-core` is pinned to original CIRCUIT commit `fed101ed4675dab240c322eb2318e5ce8564fe65`. The Celo fork directly imports its deterministic policy and SHA-256 Flight Recorder modules. This makes the hackathon delta explicit rather than pretending the prior work was rebuilt during this event.

## Why no custody

The public deployment defaults to `PREPARE`. An ALLOW creates executable calldata but never signs it. The browser wallet remains the authority for the final transaction. This means CIRCUIT can demonstrate real independent-user payments without centralizing private keys.

## x402 position

CIRCUIT sits immediately before the payment-signature step. `/api/x402-authorize` evaluates the resource price, agent identity, budget, asset and recipient policy. The facilitator is a settlement component, not the policy authority, and can be configured separately.

## ERC-8004

The live identity route calls the Celo mainnet Identity Registry `ownerOf(agentId)`. Onchain registration becomes evidence used by the deterministic mandate; it is not treated as proof that an agent is universally trustworthy.

## Flight Recorder

Every API evaluation records intent + verdict + prepared-transaction metadata through the original hash-linked Flight Recorder. No secret or private key is written to the trace.
