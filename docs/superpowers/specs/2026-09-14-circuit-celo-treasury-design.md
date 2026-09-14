# CIRCUIT Treasury on Celo — Design

## Goal
Build a Celo-native version of CIRCUIT that authorizes autonomous financial actions at runtime and, only after deterministic approval, can execute or prepare real Celo mainnet stablecoin payments and x402 purchases.

## Winning thesis
**Give your agent a budget — not unlimited trust.**

CIRCUIT Treasury sits between an AI/worker agent and money movement. The worker proposes an `ActionIntent`; CIRCUIT evaluates the activated Financial Mandate, sequence behavior, duplicate/uncertain-settlement state, recipient/asset constraints, and agent identity/trust evidence. Strong verdict precedence remains `PAUSE > BLOCK > REVIEW > RESIZE > ALLOW`. Only `ALLOW` can reach the execution gateway.

## Architecture
Reuse the existing `Ronlin1/circuit` control plane and product UI. Replace Binance-specific proof and execution surfaces with Celo-specific adapters while preserving the deterministic policy, runtime drift, MCP, trace recorder, simulation/judge mode, and explicit execution boundary.

Flow:

`Worker Agent -> Payment/x402 Intent -> CIRCUIT Core -> ALLOW/RESIZE/REVIEW/BLOCK/PAUSE -> Celo Execution Gateway -> Celo Mainnet -> receipt -> Flight Recorder`

## Celo primitives
- Celo Mainnet chain ID `42220`, best-effort RPC `https://forno.celo.org`.
- ERC-8004 Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`.
- ERC-8004 Reputation Registry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`.
- x402 support via a provider/facilitator-compatible HTTP 402 flow; the public demo may prepare and validate x402 payment intents without embedding a private key.
- Stablecoin policy includes USA₮ and cNGN as hackathon-facing assets plus USDC, USDT and USDm as fully documented Celo payment assets. Token addresses that are not safely verified in repository docs must be supplied through environment variables rather than guessed.
- No secrets or private keys in the repository or browser bundle.

## Execution modes
1. `SIMULATION` — deterministic judge scenarios; no wallet needed.
2. `PREPARE` — produces a validated Celo transaction payload / x402 authorization request after CIRCUIT approval; no private key held by hosted app.
3. `LIVE` — server-side only, explicitly enabled, requires wallet credentials from environment variables. A live transfer must never occur unless the same intent received `ALLOW` and its approval has not expired.

The deployed hackathon site defaults to `PREPARE`/safe demo mode unless live credentials are deliberately configured.

## Celo mandate additions
A Financial Mandate may constrain:
- `chainId` / allowed network;
- stablecoin symbols and token addresses;
- total and per-payment budget;
- x402 maximum price;
- recipient allowlist / unknown-recipient review threshold;
- ERC-8004 identity requirement;
- minimum reputation evidence when available;
- maximum transaction frequency;
- semantic duplicate window;
- execution approval TTL.

## Judge scenarios
At minimum:
1. Safe USA₮ payment -> `ALLOW`.
2. Oversize payment -> `BLOCK`.
3. Duplicate stablecoin payment -> `PAUSE` or `BLOCK` according to runtime state.
4. Unknown recipient above review threshold -> `REVIEW`.
5. Cheap x402 API purchase within policy -> `ALLOW`.
6. x402 price above cap -> `BLOCK`.
7. Unregistered/unverified agent where identity is required -> `BLOCK`.
8. Prompt injection attempting to override mandate -> `BLOCK`.

## Product surface
Keep the CIRCUIT logo. Rebrand copy from Binance Agent OS to Celo agentic payments. Homepage must communicate the thesis in seconds and link directly to Judge Mode, Celo proof, Treasury, and architecture. Add a Celo proof page showing network, contracts, supported stablecoins, execution mode, example receipts/transaction payloads, and verifiable mainnet links when real receipts exist.

## Verification and safety
- Preserve existing test suite.
- Add Celo adapter and policy tests before implementation.
- No fabricated onchain transaction claims. Prepared/simulated proof is labeled as such; only actual transaction hashes are called mainnet settlement.
- Secret scanner must remain green.
- Existing deterministic verdict invariants must remain green.

## Deployment
Prefer Netlify because the original repository already has Netlify configuration/functions. Vercel is acceptable if deployment tooling is materially easier. Deployment must come from `Ronlin1/circuit-celo`.
