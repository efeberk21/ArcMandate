# ArcMandate mainnet release

Status on 8 October 2026: **P7 preparation started; no mainnet deployment or spending.** Funding can wait until 9 October. The user selected Vercel for an initial public testnet site, with mainnet release to follow. This runbook is a release plan, not evidence that its pending steps passed.

## Prepared inputs

- Tested application baseline: `13ff30cbd91f92637eead67b491e6f9f645c833b`. Source SHA-256: `91c27d476cf35ebbeead7f4f4dd125a770ff036d13bf5ca57961db73e0d34e2f`. Subsequent documentation changes are not part of this historical test run.
- Contract: `contracts/src/ArcMandateVault.sol:ArcMandateVault`; direct constructor arguments are owner address and the 32-byte PQ public key. It has no upgrade mechanism.
- Compiler: solc `0.8.28`, Paris EVM, optimizer enabled / 200 runs. Lockfile and artifact hashes are retained in the local acceptance release snapshot.
- Arc Mainnet chain ID: `5042`. Public RPC: `https://rpc.mainnet.arc.io`. Explorer: `https://explorer.arc.io`.
- USDC ERC-20: `0x3600000000000000000000000000000000000000`, 6 decimals. The native gas view uses 18 decimals and represents the same underlying funds; do not add the two balance views.
- The funded testnet demo and real pending-relay proof are in [the public closeout](deployments/arc-testnet-closeout-2026-10-08.json). MetaMask replacement acceptance was waived and its missing-original-hash recovery limitation remains disclosed.

## Funding and accounts

The selected owner and agent had zero mainnet balance in the 8 October read-only account snapshot. There is no funding transaction to record yet. The user's previous preference against depositing personal money does not authorize an agent to acquire funds or spend on their behalf. A decision to fund tomorrow is separate from the eventual transaction budget and wallet approvals.

Before transferring any funds, confirm the receiving public addresses, Arc Mainnet and the available funding route. Use the owner's wallet for deployment and management, a separate agent for payments, and a funded distinct relay for PQ freeze. Choose the relay address before calculating the split. Never reuse the ignored unencrypted disposable testnet script keys as production keys or request private keys/passwords in chat.

The previous 11-transaction testnet sequence gives a planning reference: at the 8 October 17:06 UTC gas observation, approximately 0.085 USDC fees, or 0.102 with a 20% buffer, plus the planned 1 USDC vault demonstration balance. This is historical, excludes changes to the final sequence and is neither a fixed quote nor permission to spend. Re-estimate for the actual accounts, deployment and fee conditions immediately before funding/spending. Agent and relay fees must be funded outside the vault.

## Pending release work

1. **Prepare the mainnet application path.** The current `App.tsx` fixes the network to testnet; vault-selection/deployment lookup and capability gates also contain testnet restrictions. Mainnet RPC configuration alone cannot enable it. Make network selection, wallet-chain guards, storage isolation, deployment lookup and visible network labels consistent, preserving full runtime and fresh authorization checks. The existing `agent:pay` and `demo:testnet` commands also explicitly refuse mainnet. Choose one mainnet execution path and retain its operation/payment journals; do not silently retarget disposable scripts or run both browser and CLI for the same account/request.
2. **Prepare the production build and HTTPS hosting.** Vercel is the selected provider. The first deployment remains on testnet and can use the assigned `vercel.app` address; a purchased domain is optional. Root `vercel.json` builds the Vite workspace using the tracked, previously generated contract artifact, without requiring Foundry in Vercel's build environment. `.vercelignore` excludes local secrets, test journals and generated build outputs from source upload. Build from the selected release source; include only public RPC settings and exclude the localhost smoke adapter. Record the actual HTTPS URL after deployment. A subsequent mainnet application release can use the same stable production origin.
3. **Fund and deploy after the budget is concrete.** Generate and verify a recoverable encrypted PQ backup on the intended origin. Review exact owner/public key/chain/constructor and current gas. Deployment creates an empty vault, not a deposit or an agent session. Persist the operation before wallet submission and retain its hash on timeout. Verify successful receipt, creation input and full instantiated runtime before any vault funding.
4. **Verify explorer source.** Use the exact deployed artifact, compiler/settings and actual constructor arguments. Record an explorer result showing verified matching source; starting a verification command is not success.
5. **Record the short mainnet sequence.** Fund the vault and agent/relay fees; open a session with 0.15 total budget, 0.05 cap, one allowed recipient and a short expiry. Make a 0.05 payment. Pin a simulation rejecting 0.20. Freeze through a distinct funded PQ relay; pin an old-session rejection. Open a new session for the same agent; pin the old-session rejection again and make a valid new-session payment. Freeze and withdraw the exact remaining balance with owner plus PQ approval. Negative simulations need no paid revert transaction. There is no repeat of the waived MetaMask replacement test in this release sequence.
6. **Publish truthful evidence and perform the release smoke check.** A public mainnet manifest records chain ID, vault, deployment block/hash, actual release source, compiler/settings, each successful receipt with fee, and each simulation with block/call/decoded error. Final state must be inactive and empty. The live HTTPS link must open the correct mainnet vault without a wallet; Worker/RPC and wallet network checks must work. Update README and the submission draft only with the actual URLs and observed results.

Routine build/type checks for new release code and the mainnet/HTTPS smoke above are release validation. The completed testnet acceptance suite is not reopened merely because P7 started.

## Submission

The [official Arc Microgrants page](https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq) asks for a working Arc mainnet deployment with an accessible link, a public repository, a short description explaining the Arc component, and a public builder profile. A deck is explicitly unnecessary. No mandatory video or special README format appears in the published program requirements. Video preparation was removed from this project's agreed scope.

The public repo is `https://github.com/efeberk21/ArcMandate`. The public GitHub builder profile can be `https://github.com/efeberk21`, subject to confirming the submitting account. A working mainnet link is still pending. Do not submit a testnet-only project as mainnet-ready. Deadline: 14 October 2026 at 23:59 ET, equivalent to 15 October at 06:59 in Türkiye; internal fallback target remains 11 October.

Hosting and contract deployment are separate operations. Vercel publishes frontend files; deploying the Solidity vault submits a chain transaction. The official program states that USDC is needed to deploy and transact: https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq . A sponsored service could pay that fee for a user, but no sponsor or gas-free contract deployment is configured in this project. No personal-money deposit or mainnet spending is assumed from the current publication request.
