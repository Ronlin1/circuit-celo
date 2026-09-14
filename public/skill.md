---
name: circuit-treasury
description: Runtime authorization for autonomous stablecoin and x402 payments on Celo. Use CIRCUIT before an agent signs or submits a financial action.
network: eip155:42220
repository: https://github.com/Ronlin1/circuit-celo
---

# CIRCUIT Treasury Agent Skill

CIRCUIT Treasury is a deterministic control layer for autonomous finance on Celo. **Agents propose; CIRCUIT owns the veto; a wallet or payment client executes only after `ALLOW`.**

## Discover

- `GET /api/status` — Celo network, token, ERC-8004 and x402 configuration.
- `GET /api/judge` — eight deterministic adversarial scenarios with expected vs actual verdicts.
- `GET /api/traces` — hash-linked Flight Recorder health and decisions recorded by the current function instance.

## Verify an ERC-8004 identity

`POST /api/identity`

```json
{"agentId":"42"}
```

CIRCUIT queries the ERC-8004 Identity Registry on Celo mainnet with `ownerOf(agentId)` and returns registration evidence.

## Authorize a transfer

`POST /api/evaluate`

```json
{
  "agentId":"42",
  "intent":{
    "chainId":42220,
    "kind":"TRANSFER",
    "asset":"USAT",
    "recipient":"0x1111111111111111111111111111111111111111",
    "requestedUsd":5,
    "amountBaseUnits":"5000000",
    "intentId":"unique-semantic-intent-id"
  },
  "context":{"dailySpendUsd":0,"recentIntentIds":[]}
}
```

Only an `ALLOW` response can include a prepared ERC-20 transaction payload. `BLOCK`, `PAUSE`, and `REVIEW` never produce an executable payload.

## Guard an x402 purchase

`POST /api/x402-authorize` with the same structure. CIRCUIT forces `kind: X402` and evaluates the resource price against the mandate's x402 ceiling before the client creates a payment signature.

The default public demo mandate caps x402 purchases at **$2**. CIRCUIT does not replace the x402 facilitator; it is the authorization layer immediately before signing/settlement. The Celo facilitator endpoint is discoverable through `/api/status` and configurable with `X402_FACILITATOR_URL`.

## Verdict precedence

`PAUSE > BLOCK > REVIEW > RESIZE > ALLOW`

An AI-generated explanation can never downgrade a stronger deterministic verdict.

## Celo primitives

- Chain: `eip155:42220`
- ERC-8004 Identity Registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- ERC-8004 Reputation Registry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- USA₮: `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771`
- cNGN: `0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f`

## Safety boundary

Never treat `ALLOW` as a private-key delegation. The public implementation prepares calldata and lets the user's wallet remain the signer. Never bypass CIRCUIT by signing first and asking for approval later.
