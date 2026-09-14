# Celo Agents at Work — Submission Notes

## Project
**CIRCUIT Treasury — runtime authorization for autonomous finance on Celo**

## One line
**Give your agent a budget — not unlimited trust.**

## Problem
Wallet permission is too coarse for autonomous finance. A user may genuinely want an agent to pay, but only within a narrower live mandate: approved assets, recipients, per-action/daily budgets, identity requirements, x402 price ceilings and sequence limits.

## Solution
CIRCUIT evaluates each proposed financial action at runtime. `PAUSE > BLOCK > REVIEW > RESIZE > ALLOW`. Only ALLOW crosses the execution boundary. The Celo fork adds real mainnet token calldata, user-wallet execution, ERC-8004 identity evidence, x402 authorization and stablecoin support while reusing CIRCUIT's proven deterministic core and Flight Recorder.

## Celo usage
- Celo mainnet 42220
- USA₮ and cNGN headline assets; USDC, USD₮, USDm supported
- ERC-8004 Identity + Reputation registry addresses exposed and identity lookup implemented
- x402 purchase intents have a dedicated policy-gated API path
- real transaction execution stays in the independent user's wallet

## Existing project disclosure
The original CIRCUIT was created for the Binance Agent OS Mini Hackathon and was deliberately simulation-first with zero financial writes. This submission does **not** hide that history. The new Celo work is isolated in this repository and pins the original core commit. New work includes the Celo execution gateway, treasury policy, stablecoin configuration, ERC-8004 evidence, x402 authorization, Celo Judge Mode, API/skill surface, and wallet-driven mainnet execution.

## Suggested primary track
**Judges' Favorite** — the differentiation is infrastructure-level runtime authorization rather than another bill-pay/remittance agent.

## Evidence checklist
- CI green
- 8/8 Judge Mode green
- live deployment
- repository public
- `/skill.md` reachable
- optional real independent-wallet mainnet transaction hash added only after genuine execution
