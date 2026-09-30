# Implementation status — 2026-09-30, P3 implementation complete

## Completed packages

- P0: ArcMandate public repository, pinned Node/Foundry dependencies, ignored secrets, network configuration and RPC preflight. Initial commit `25f7575`.
- P1: Shared TypeScript/Solidity START, FREEZE and WITHDRAW digest fixtures; strict SLH-DSA-SHA2-128s precompile wrapper; browser Worker signing and Arc testnet verifier probe. Commit `e91ffa6`.
- P2: One-session Arc USDC vault with owner/PQ hybrid START and withdrawal, agent payment controls, both freeze paths, state counters, replay protection, events and rollback tests. Contract source was deployed from commit `e23da59` with solc 0.8.28, Paris EVM and optimizer 200.
- P3: Versioned encrypted PQ keyfile (`scrypt` N=131072/r=8/p=1, 32-byte salt, AES-256-GCM with 12-byte IV and authenticated metadata), strict 16 KiB/profile/field validation, Worker generate/export/import/structured sign/local verify/lock, and a browser recovery test harness. Secret bytes stay inside the Worker; import proves the restored key by signing a random challenge.

## Verification

- `npm run check` passed on 2026-09-30 after P3: TypeScript checks, 4 Vitest tests (2 digest, 2 keyfile), web production build, Solidity compilation, and 18 Foundry tests (14 vault, 2 digest, 2 verifier). Keyfile tests cover same-key export/import and signing, fresh salt/IV, wrong password, modified AAD/tag, oversize input, unsupported KDF/version, and key mismatch.
- Browser Worker signed a structured digest and verified it against Arc testnet; changed digest was rejected. Local PQ probe also distinguished valid and mutated messages on both Arc RPCs. These read-only probes preceded P2's real transactions.
- Circle faucet sent 20 testnet USDC to a disposable owner account. This is testnet currency. `private/arc-testnet-keys.json` is git-ignored; the public manifest contains no secrets.
- Arc testnet chain 5042002: deployed vault [`0x91e4467997d28ad3443f910261f4d65b4c867bbd`](https://testnet.arcscan.app/address/0x91e4467997d28ad3443f910261f4d65b4c867bbd), funded it with 1 USDC, and completed the entire P2 sequence. Evidence with transaction hashes, blocks, receipts, gas values and block-pinned revert simulations: [`deployments/arc-testnet.json`](../deployments/arc-testnet.json).
- Real PQ transactions: first START `0x331db74b350c1c62a1b5b248ef48b736bcfc7203f6bcf2a53de243397544d462`, PQ freeze `0xbda0fd974f511510894673388dca6fb8d34faacb84c2574b1d5ebc4a63a9d85e`, second START `0x74dbf2859f46a764c9a99ce94404b69d9e99139a545859587b841433ce5a14db`, hybrid withdrawal `0x7e7e5802e69292b3bacde8d851597dde24f5db27dfc60d24abecfa3f3c2483b2`; all receipts succeeded.
- Two agent payments of 0.05 USDC succeeded. A 0.20 payment reverted with `PerPaymentLimitExceeded` in simulation at block 64646360. An old session call reverted with `SessionInactive` after PQ freeze at block 64646365 and `SessionMismatch` after a new session with the same agent at block 64646574. Simulations are block-specific and have no transaction receipt.
- Owner froze the second session and hybrid withdrawal returned 0.9 USDC; the vault's ERC20 balance was zero after the withdrawal. The relay had received at least 0.1 USDC from the two payments.
- Browser P3 check: generated a key in the Worker, exported an encrypted backup, terminated the Worker, then imported an encrypted test keyfile in a fresh Worker. Import signed and verified a random challenge (9,270 ms); the restored key signed a structured START digest (2,218 ms), accepted by Arc testnet and rejected for a changed digest. Wrong-password import returned `Wrong password or damaged keyfile` and left signing disabled. The test keyfile was generated locally for this smoke test and removed afterward.

## Code quality cross-check

- P0–P2 claims were compared with the current roadmap, plan, source, test names, and public manifest. The base authorization model and onchain flow match the plan; `npm run check` confirms the existing local tests still pass. The public manifest distinguishes mined receipts from block-pinned revert simulations.
- T01–T13 have base unit coverage, but the full T10 field matrix and stateful fuzz/invariant work remain for P6. Do not describe the current suite as a completed security audit.
- `scripts/testnet-demo.ts` can resume from saved manifest steps, but a process interruption after transaction submission and before saving its hash can leave an unrecorded pending transaction. P5's journal/retry work should close this gap before claiming robust restart behavior.
- The browser tool could not expose the path of its `blob:` download, so one uninterrupted browser export → select that exact downloaded file → import run was not recorded. The TS test proves same-key file roundtrip; the browser smoke test proves Worker file import and Arc verification separately. Repeat the literal download/import flow during P4's clean-browser smoke test.

## Limits and decisions

- Disposable P2 testnet keys remain in a local unencrypted, ignored file for that script only; the P3 encrypted product keyfile is separate.
- P2's script skips steps already saved in its manifest after an interrupted run. A submission-to-save crash window remains, as noted above. The proof is for this deployed contract and disposable accounts; P5 will add a reusable demo run and agent journal.
- Arc RPC latest-head responses lagged a mined receipt briefly. Revert simulations are therefore pinned to the preceding receipt's block to prove the intended state. See `docs/DECISIONS.md`.
- This is a prototype testnet deployment, not a mainnet release or audit. Mainnet funding and publication are later P6/P7 work.
- The eventual mainnet demo needs an owner wallet funded for deployment, vault funding of 1 USDC, and small gas balances for the agent and PQ freeze relay. P6 will calculate the live cost from testnet gas evidence and current fees before asking for any mainnet funding.

## Next

P4: wallet-based management UI with deploy/fund/session/freeze/withdraw and read-only view. Run the literal downloaded-file restore smoke test, then T16 account/network/transaction-state checks. P5 follows with the agent journal and reusable demo.
