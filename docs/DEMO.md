# Judge Demo Runbook

## 1. Thesis — 10 seconds

“AI agents can move real money. CIRCUIT makes sure they cannot move more money, to more places, or for more reasons than the human authorized. Give your agent a budget, not unlimited trust.”

## 2. Judge Mode — 20 seconds

Click **Run all scenarios**. Show `8 / 8`:

1. Safe USA₮ → ALLOW
2. $50 under $20 cap → BLOCK
3. Duplicate semantic intent → PAUSE
4. Unknown recipient >$10 → REVIEW
5. $0.10 x402 → ALLOW
6. $3 x402 under $2 ceiling → BLOCK
7. Missing ERC-8004 identity → BLOCK
8. Prompt attempts to override mandate → BLOCK

Emphasize that model text cannot downgrade a stronger deterministic decision.

## 3. Treasury → 20 seconds

Use USA₮, known recipient, $5. Submit. Show `ALLOW`, token contract, calldata and Flight Recorder trace. Change policy value to $50 and show that no executable payload is returned.

If using a real independent wallet, connect it only after a safe ALLOW and execute a small transfer that the wallet owner genuinely intends. The resulting CeloScan hash is real mainnet proof. Never fund fake users to manufacture adoption.

## 4. Celo-native differentiators — 10 seconds

Show Celo 42220, USA₮/cNGN, ERC-8004 registry evidence, x402 guard and non-custodial wallet execution.
