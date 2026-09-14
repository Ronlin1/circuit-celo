# Celo Agents at Work — Submission Notes

## Project
**CIRCUIT Treasury — runtime authorization for autonomous finance on Celo**

## One line
**Give your agent a budget — not unlimited trust.**

## Problem
Wallet permission is too coarse for autonomous finance. A user may want an agent to make payments while still enforcing a narrower live mandate across approved assets, recipients, per-action and daily budgets, identity requirements, x402 price ceilings, and sequence controls.

## Solution
CIRCUIT evaluates each proposed financial action at runtime. Verdict precedence is `PAUSE > BLOCK > REVIEW > RESIZE > ALLOW`, and only `ALLOW` can cross the execution boundary.

The Celo implementation provides mainnet ERC-20 transaction preparation, user-wallet execution, ERC-8004 identity evidence, x402 authorization, stablecoin policy, adversarial Judge Mode, and hash-linked decision traces.

## Celo usage
- Celo mainnet `42220`
- USA₮ and cNGN as headline assets, with USDC, USD₮ and USDm also supported
- ERC-8004 Identity and Reputation registry configuration
- live `ownerOf(agentId)` identity evidence
- policy-gated x402 authorization
- non-custodial wallet execution for the final transaction signature

## Technical foundation
CIRCUIT Treasury imports deterministic policy and Flight Recorder primitives through a pinned `circuit-core` revision. Celo-specific authorization, token configuration, identity evidence, x402 controls, execution boundaries, API surfaces, Judge Mode, and wallet interaction are implemented in this repository.

## Suggested primary track
**Judges' Favorite** — CIRCUIT Treasury differentiates at the infrastructure layer by controlling autonomous financial execution rather than acting as another single-purpose payment agent.

## Evidence checklist
- CI green
- 8/8 Judge Mode green
- live deployment
- public repository
- `/skill.md` reachable
- real mainnet transaction proof only when a transaction has genuinely been signed and submitted
