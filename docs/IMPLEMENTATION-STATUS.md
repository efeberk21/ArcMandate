# Implementation status — 2026-09-29, P2 complete

## Completed packages

- P0: ArcMandate public repository, pinned Node/Foundry dependencies, ignored secrets, network configuration and RPC preflight. Initial commit `25f7575`.
- P1: Shared TypeScript/Solidity START, FREEZE and WITHDRAW digest fixtures; strict SLH-DSA-SHA2-128s precompile wrapper; browser Worker signing and Arc testnet verifier probe. Commit `e91ffa6`.
- P2: One-session Arc USDC vault with owner/PQ hybrid START and withdrawal, agent payment controls, both freeze paths, state counters, replay protection, events and rollback tests. Contract source was deployed from commit `e23da59` with solc 0.8.28, Paris EVM and optimizer 200.

## Verification

- `npm run check` passed: TypeScript checks, 2 Vitest digest tests, web production build, Solidity compilation, and 18 Foundry tests (14 vault, 2 digest, 2 verifier).
- Browser Worker signed a structured digest and verified it against Arc testnet; changed digest was rejected. Local PQ probe also distinguished valid and mutated messages on both Arc RPCs. These read-only probes preceded P2's real transactions.
- Circle faucet sent 20 testnet USDC to a disposable owner account. This is testnet currency. `private/arc-testnet-keys.json` is git-ignored; the public manifest contains no secrets.
- Arc testnet chain 5042002: deployed vault [`0x91e4467997d28ad3443f910261f4d65b4c867bbd`](https://testnet.arcscan.app/address/0x91e4467997d28ad3443f910261f4d65b4c867bbd), funded it with 1 USDC, and completed the entire P2 sequence. Evidence with transaction hashes, blocks, receipts, gas values and block-pinned revert simulations: [`deployments/arc-testnet.json`](../deployments/arc-testnet.json).
- Real PQ transactions: first START `0x331db74b350c1c62a1b5b248ef48b736bcfc7203f6bcf2a53de243397544d462`, PQ freeze `0xbda0fd974f511510894673388dca6fb8d34faacb84c2574b1d5ebc4a63a9d85e`, second START `0x74dbf2859f46a764c9a99ce94404b69d9e99139a545859587b841433ce5a14db`, hybrid withdrawal `0x7e7e5802e69292b3bacde8d851597dde24f5db27dfc60d24abecfa3f3c2483b2`; all receipts succeeded.
- Two agent payments of 0.05 USDC succeeded. A 0.20 payment reverted with `PerPaymentLimitExceeded` in simulation at block 64646360. An old session call reverted with `SessionInactive` after PQ freeze at block 64646365 and `SessionMismatch` after a new session with the same agent at block 64646574. Simulations are block-specific and have no transaction receipt.
- Owner froze the second session and hybrid withdrawal returned 0.9 USDC; the vault's ERC20 balance was zero after the withdrawal. The relay had received at least 0.1 USDC from the two payments.

## Limits and decisions

- Disposable P2 testnet keys are held in a local unencrypted, ignored file for this script only. P3 will implement the encrypted user keyfile and restore lifecycle.
- P2's script can resume from its manifest after an interrupted run. The proof is for this deployed contract and disposable accounts; P5 will add a reusable demo run and agent journal.
- Arc RPC latest-head responses lagged a mined receipt briefly. Revert simulations are therefore pinned to the preceding receipt's block to prove the intended state. See `docs/DECISIONS.md`.
- This is a prototype testnet deployment, not a mainnet release or audit. Mainnet funding and publication are later P6/P7 work.
- The eventual mainnet demo needs an owner wallet funded for deployment, vault funding of 1 USDC, and small gas balances for the agent and PQ freeze relay. P6 will calculate the live cost from testnet gas evidence and current fees before asking for any mainnet funding.

## Next

P3: encrypted key export/import, browser Worker lock and restore, wrong-password/corrupt-file checks, and a fresh-browser signing test (T14–T15). P4 then builds the wallet-based management UI.
