# Implementation status — 2026-09-29

## Current scope

P0 development environment setup. No vault contract, PQ authorization, or demo transactions exist yet.

## Completed

- Inspected the five supplied Markdown plans and confirmed the workspace had no Git repository or code.
- Created the ArcMandate npm-workspaces scaffold, public network constants, secret ignores, read-only preflight, and ephemeral-key PQ probe.
- Installed pinned npm dependencies and lockfile: React 19.3.0, Vite 8.3.1, viem 2.57.0, noble post-quantum 0.7.1, OpenZeppelin Contracts 5.6.1, TypeScript 7.0.2, Vitest 4.1.11.
- Installed Foundry 1.5.1-stable (SHA256 of official Windows archive: `78556C2013C91F9143E4E42608D9305A02EA62A29B942B57C6FF3BADF7CDFBAB`) and compiled with solc 0.8.28, Paris EVM target.
- Initialized local Git repository on `main`.
- Created public GitHub repository `efeberk21/ArcMandate` through authenticated GitHub CLI and linked `origin`.
- Renamed all five supplied plan documents and their project-name references from the former name to ArcMandate.

## Verification

- `npm run check`: passed. No product tests exist yet; Vitest and Forge explicitly reported no tests.
- `npm run preflight` constituent commands: testnet chain 5042002, mainnet chain 5042, both USDC decimals 6. Both RPCs returned live blocks on 2026-09-29.
- `npm run pq:probe`: local SLH-DSA-SHA2-128s signing/verification passed (32-byte public key, 7856-byte signature, 1204 ms signing); both Arc testnet and mainnet returned `true` for valid and `false` for mutated message via `eth_call`.
- No onchain transaction or funded vault has been tested.

## Open issues

- GitHub web form rejected repository creation with “You can’t perform that action at this time”; authenticated GitHub CLI creation succeeded.
- Native Windows npm postinstall for `@foundry-rs/forge`/`cast` 1.5.1 failed; official release archive works and is installed under ignored `.tools/foundry`.

## Next

Commit and push this scaffold. Implement exact digest fixture and Solidity verifier wrapper, then browser Worker signature test in P1.
