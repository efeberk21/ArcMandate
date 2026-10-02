# P6 test and release evidence — 2026-10-02

This is a traceability record, not an audit. The commands below ran against the local P6 working tree after commit `4c27c51` (P5). P6 changes were uncommitted at the time of these runs. Mocked Foundry PQ/USDC behavior is not presented as Arc network behavior.

## Local commands and results

| Command | Result |
|---|---|
| `npm run check` | Passed: 17 Vitest tests in 5 files, web production build, Solidity compilation, 20 Foundry unit tests and 1 stateful invariant test. |
| `forge test --root contracts --match-contract ArcMandateInvariantTest -vv` | Passed: 64 runs × 128 calls = 8,192 handler calls, 0 unexpected reverts. Start, pay, direct funding, owner/PQ freeze, withdrawal, time advance, failed transfer and stale payment paths all had hundreds of calls. |
| `npm run release:snapshot` | Passed: P5 deployment input matched the pinned artifact plus onchain constructor args; mainnet RPC chain ID and one gas price snapshot were read without sending a transaction. |
| Clean source export: `npm ci --offline`, then `npm run check` | Passed from a 70-file export of the P6 working tree with no existing `node_modules`: 83 packages installed, 17 Vitest tests, production web build, 20 Foundry unit tests and 1 invariant campaign. This was not a clean clone of a P6 commit. |

Foundry's `afterInvariant()` rejects a campaign that misses a successful start/payment, freeze, failed-transfer rollback or stale-session rejection. Handler ghost accounting compares successful `AgentPaid` amounts with `spent` and the recipient's token balance. `fail_on_revert = true` prevents silently passing a campaign made of reverted handler calls.

## T01–T16 mapping

| ID | Exact local tests | Network/browser evidence | Remaining limit |
|---|---|---|---|
| T01 | `testT01ConstructorAndInitialState`, `testT01PolicyValidation` | P5 deployment receipt | Unit uses mock Arc dependencies. |
| T02 | `testT02OwnerAndPQBothRequired` | P5 two hybrid STARTs and withdrawal | Testnet only. |
| T03 | `testT03LimitsAndFragmentedPayments`; `invariant_SessionBudgetAndTransferAccounting` | P5 0.20 cap rejection and two 0.05 payments | Invariant uses mock token/verifier. |
| T04 | `testT04FundingAndDayChangeDoNotRenewBudget`; invariant `fund` and `advanceTime` | P5 direct vault funding receipt | Day-change check is local. |
| T05 | `testT05ExpiryAndDeadlineBoundaries` | — | Boundary checks local. |
| T06 | `testT06CallerAllowlistAndActiveChecks` | P5 old-session rejection simulations | Simulations are block-pinned, not mined reverts. |
| T07 | `testT07PaymentIdRetryAndOldSessionAfterReplacement`; `scripts/agent-journal.test.ts` | P5 CLI receipt and event recovery with no resend | Real crash was fault-injected only in TypeScript. |
| T08 | `testT08OwnerAndPQFreeze`; invariant `freezeOwner` and `freezePQ` | P5 mined PQ and owner freezes | Testnet only. |
| T09 | `testT09StaleManagementAndAgentCallsStayInvalid`; invariant `stalePay` | P5 `SessionInactive` then `SessionMismatch` simulations | Simulations are block-pinned. |
| T10 | `testT10DomainAndPolicyTamperCannotUseSignature`, `testT10FreezeFieldMatrix`, `testT10WithdrawFieldMatrix` | P1/P5 real PQ-positive calls | Full START/FREEZE/WITHDRAW field matrix is local mock-signature rejection, including cross-vault START. |
| T11 | `testT11VerifierFailuresFailClosed`; `PQVerifier.t.sol` | P1 Arc PQ probe and P5 real PQ transactions | Mock failure modes do not prove real precompile failure behavior. |
| T12 | `testT12FailedTransferRollsBackStateAndReentryIsBlocked`; invariant `failTransfer` | — | Local mock token. |
| T13 | `testT13WithdrawWithoutSessionThenAfterFreeze`; `testT10WithdrawFieldMatrix` | P5 mined hybrid withdrawal | Testnet only. |
| T14 | `keyfile.test.ts`; P3/P4 Worker recovery evidence in `IMPLEMENTATION-STATUS.md` | P4 encrypted export and fresh Worker restore; P6 Chrome download, page reload, user-selected file through Windows native picker, matching public key and fresh challenge signature twice | User operated the native picker; automation verified the application result. |
| T15 | `digest.test.ts`, `ArcMandateDigest.t.sol`, `PQVerifier.t.sol` | P1 Arc verifier probe and P5 PQ receipts | — |
| T16 | `transactions.test.ts`, `policy.test.ts`; P4 browser smoke | P4 local EIP-1193 adapter; P6 Chrome MetaMask on Arc testnet: deploy, fund, hybrid START, agent payment, owner freeze, hybrid withdraw; all receipts succeeded and the vault ended inactive/empty | Testnet only; this Chrome run used owner freeze, while P5 covered the PQ freeze path onchain. |

## Clean installation and Chrome MetaMask run

A fresh source export of the uncommitted P6 working tree contained 70 project files and no pre-existing dependencies. Standard `npm ci --offline` installed 83 packages without lifecycle-script suppression; `npm run check` then passed all 17 TypeScript tests, production web build, 20 Foundry unit tests and the 8,192-call invariant campaign. This verifies a clean dependency installation from the current source. A clean Git clone/build from a committed P6 revision remains open.

In Chrome with the MetaMask extension, the owner account `0x48ABFba33961BCf0A0c6904ba34167432A3a0E38` used Arc testnet chain 5042002. The product downloaded an encrypted backup; after page reload, the user selected that file through the Windows native file picker. A fresh Worker imported it, matched public key `0x8307b2bd3e50ce2a94f58fd27bfa9db84b99c9079655603311fb3532975dccdf`, and verified a challenge signature. The same restore passed after deployment. Browser automation could not supply the file through its upload API, so the user performed both native-picker selections.

The owner approved MetaMask deploy, 0.5 USDC vault funding, hybrid START (0.15 total budget and 0.05 per-payment cap), owner freeze and 0.45 USDC hybrid withdrawal. The agent CLI paid 0.05 USDC during the session; a retry of the same request recovered the original payment ID and receipt. The [public Chrome run manifest](../deployments/p6-metamask-browser.json) records eight successful testnet receipts, including two initial wallet top-ups. Vault [`0x99caae907095bbb95d8714ee2a23369db2377d7a`](https://explorer.testnet.arc.io/address/0x99caae907095bbb95d8714ee2a23369db2377d7a) finished at block 65143675 with `active=false`, sessionId 2, controlNonce 3 and zero ERC20 USDC. The test key password was not retained; do not fund this disposable vault again.

## Money and authorization review

- `agentPay` requires the current active session, agent caller, unexpired policy, allowlisted recipient, per-payment cap, remaining session budget, unused nonzero payment ID and vault balance. It writes spent/ID before `SafeERC20.safeTransfer`; a transfer revert rolls both writes back. T03/T06/T07/T12 and the stateful invariant exercise these paths.
- `withdraw` requires inactive state, owner caller, current nonce/session/deadline and matching PQ signature for recipient and amount. It advances the nonce before `safeTransfer`; a revert rolls the nonce back. T02/T10/T13 cover these checks.
- `freezeByOwner` and `freezeByPQ` clear current policy and advance session/nonce. Replaced or frozen sessions never become current again. T08/T09/T10 and the invariant cover both paths.
- Keyfile import enforces its fixed KDF and AES-GCM profile and checks the recovered public key. The Worker holds the secret and verifies signatures locally; it does not provide a hardware isolation or guaranteed memory-erasure boundary. P3/P4 recovery tests cover tested paths.

## Release snapshot and open gates

[`deployments/p6-release-snapshot.json`](../deployments/p6-release-snapshot.json) records solc 0.8.28, Paris EVM, optimizer 200, creation/runtime-template hashes, testnet constructor args and onchain deployment-input match. At mainnet block 23900517 the RPC returned 20 gwei. Applying that one price to the P5 sequence's 4,250,124 gas gives 0.08500248 native USDC in estimated fees, or 0.102002976 with a 20% buffer. P5's actual 11 receipt fees totalled 0.1062531 native USDC at their historical prices. These are fee snapshots, separate from 1 USDC vault funding, and not a spending authorization. Arc distinguishes 18-decimal native fee units from 6-decimal ERC20 USDC: [Circle's Arc explanation](https://www.arc.io/blog/building-with-usdc-on-arc-one-token-two-interfaces).

P6's agreed test and preparation scope is complete. The user waived a clean Git clone/build for this checkpoint; the clean source installation above passed, but it does not verify that every P6 file is tracked in Git. The release snapshot gives a point-in-time cost estimate and identifies the future owner, agent and PQ relay funding needs. Actual mainnet account selection, funding and spending authorization are P7 prerequisites. Explorer source verification follows a P7 deployment and cannot be claimed before then. P7/mainnet and UI polish are deferred at the user's direction.
