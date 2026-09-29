# Implementation status — 2026-09-29, P1

## Current scope

P0 environment is complete. P1 digest encoding, fixed vectors, PQ verifier wrapper, and browser Worker probe are complete. No vault or demo transaction exists yet.

## Completed

- Inspected the five supplied Markdown plans and confirmed the workspace had no Git repository or code.
- Created the ArcMandate npm-workspaces scaffold, public network constants, secret ignores, read-only preflight, and ephemeral-key PQ probe.
- Installed pinned npm dependencies and lockfile: React 19.3.0, Vite 8.3.1, viem 2.57.0, noble post-quantum 0.7.1, OpenZeppelin Contracts 5.6.1, TypeScript 7.0.2, Vitest 4.1.11.
- Installed Foundry 1.5.1-stable (SHA256 of official Windows archive: `78556C2013C91F9143E4E42608D9305A02EA62A29B942B57C6FF3BADF7CDFBAB`) and compiled with solc 0.8.28, Paris EVM target.
- Initialized local Git repository on `main`.
- Created public GitHub repository `efeberk21/ArcMandate` through authenticated GitHub CLI and linked `origin`.
- Renamed all five supplied plan documents and their project-name references from the former name to ArcMandate.
- Pushed initial commit `25f7575` to public `main`.
- Added shared START/FREEZE/WITHDRAW encoding in TypeScript and Solidity, fixed public JSON vectors, and tests comparing both implementations against the same expected hashes.
- Added strict Solidity PQ wrapper at Arc's fixed precompile address: signature length 7856; failed call, empty/malformed return, and noncanonical bool word all reject.
- Added a browser Worker P1 harness that creates a temporary key, signs the structured START digest, and verifies it through Arc testnet. The key stays inside the Worker and is discarded when it terminates.

## Verification

- `npm run check`: passed. No product tests exist yet; Vitest and Forge explicitly reported no tests.
- `npm run preflight` constituent commands: testnet chain 5042002, mainnet chain 5042, both USDC decimals 6. Both RPCs returned live blocks on 2026-09-29.
- `npm run pq:probe`: local SLH-DSA-SHA2-128s signing/verification passed (32-byte public key, 7856-byte signature, 1204 ms signing); both Arc testnet and mainnet returned `true` for valid and `false` for mutated message via `eth_call`.
- No onchain transaction or funded vault has been tested.
- `npm run test:ts`: 2 digest tests passed. `npm run test:contracts`: 4 Foundry tests passed.
- `npm run check`: passed after the P1 changes (typecheck, 2 TS tests, web Worker build, Solidity build, 4 Foundry tests).
- `npm run pq:probe`: both networks returned `true` for a valid signature, `false` for a mutated message, and reverted with `Invalid signature length` for a 7855-byte signature.
- Browser test at local Vite URL: Worker signed the fixed START digest `0x4477ad6fef783669b043225eb023c17df92d67f718b562f4600f0275c998b377` in 2190 ms. Arc testnet accepted it and rejected the changed digest.
- No onchain transaction or funded vault has been tested. Browser Worker timing is one local measurement, not a performance guarantee.

## Open issues

- Native Windows npm postinstall for `@foundry-rs/forge`/`cast` 1.5.1 failed; official release archive works and is installed under ignored `.tools/foundry`.

## Next

P2: implement full vault state transitions, real Arc USDC flow, replay limits, and a real transaction invoking the PQ wrapper. The P1 local mock tests and `eth_call` are not that transaction proof.
