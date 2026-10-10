<img src="apps/web/public/brand/arcmandate-symbol.png" alt="ArcMandate emblem" width="88">

# ArcMandate

### Your money. Your agent. Your rules.

**ArcMandate schedules automatic USDC payments from a vault on Arc, within limits chosen by its owner.** The owner sets the allowed recipients, total budget, maximum amount per payment and expiry. The smart contract checks those rules whenever the agent makes a payment.

Funds stay in the vault until a permitted payment sends them directly to a recipient. The owner manages spending authority with an EVM wallet and a separate Vault Key, and can freeze the session when access needs to stop.

[Open the application](https://arcmandate.vercel.app) · [View the mainnet vault](https://arcmandate.vercel.app/?network=mainnet&vault=0x99cAae907095bBB95D8714ee2a23369dB2377d7A) · [Contract source](contracts/src/ArcMandateVault.sol) · [Developer guide](DEVELOPMENT.md) · [Threat model](THREAT-MODEL.md)

> **Status — 10 October 2026:** Arc Mainnet vault management and hosted automatic payments are live. Mainnet verification confirmed two scheduled 0.01 USDC payments while the browser was closed, with a service redeployment between payments. The frontend manages finite payment schedules without requiring a terminal or per-payment wallet approval. Testnet verification also covered freeze blocking a later payment and withdrawal.

## Why ArcMandate exists

Software agents can carry out tasks that involve payments: buying access to a service, paying for a completed job, or settling a small invoice. Those workflows need a way to define how much authority an agent receives and when that authority ends.

ArcMandate was developed to explore **controlled payment delegation**. An owner deposits USDC into a dedicated vault, grants one agent a spending session, and keeps management access. The agent uses its own account to request payments. The vault decides whether each request fits the session.

The same rules apply whether the request comes from a manually operated wallet, a script or an AI agent integration. The contract enforces payment permission; the software making the request determines what task to perform and when to pay.

## Who can use it?

| User | What ArcMandate can provide |
| --- | --- |
| Developers building AI or software agents | A contract that limits an agent's USDC payments without requiring the owner's signing keys for each payment. |
| Teams experimenting with automated payments | A separate budget for one worker account, with approved recipients and a time limit. |
| Builders of paid services or task workflows | A payment permission layer for integrations where recipients can receive USDC on Arc. |
| Developers exploring wallet security | A working prototype of wallet plus post-quantum management approval, with two ways to revoke spending. |

For example, an owner can schedule two 0.01 USDC payments to an approved recipient, one minute apart. After the owner activates the plan, the hosted worker submits both payments even if the browser is closed. The contract enforces spending authority; the service enforces timing.

The **Automatic payments** screen prepares a service-managed payment account and creates finite schedules with a fixed recipient, amount and interval. The hosted worker signs payments without asking for a wallet approval each time. A manual payment console and testnet CLI remain available as developer tools. This is deterministic scheduled execution, not an LLM deciding what to buy.

## A concrete example

Suppose you deposit **10 USDC** and open a session with these rules:

| Rule | Setting |
| --- | --- |
| Agent | A separate wallet account |
| Allowed recipients | Two service-provider addresses |
| Total session budget | 2 USDC |
| Maximum per payment | 0.25 USDC |
| Expiry | Two hours from now |

The agent can make payments of up to 0.25 USDC to those two addresses, while the cumulative spend stays within 2 USDC and the session remains active and unexpired. A payment to another address, an oversized payment or a request for an old session is rejected.

The 2 USDC budget grants authority over part of the vault balance; it does not transfer 2 USDC into the agent's wallet. Depositing more money does not reset the session's spent amount or extend its expiry. If 2 USDC has been spent, further payments require a new session.

To end the session, the owner freezes it. After confirmation, the owner wallet and Vault Key can authorize withdrawal of the remaining funds.

## How the permissions work

A **session** is one set of spending rules for one agent. Each vault has one owner, one Vault Key and at most one active session.

| Role | Authority |
| --- | --- |
| **Owner wallet** | Creates the vault. Together with the Vault Key, opens or replaces sessions and withdraws funds. Can freeze spending on its own. |
| **Vault Key** | A separate SLH-DSA-SHA2-128s post-quantum signing key used for management approval. Can authorize a freeze through a funded relay. |
| **Agent account** | Requests payments under the current session. Pays its own transaction fees and needs neither management key to pay. |
| **Freeze relay** | Submits a Vault Key-authorized freeze and pays its fee. Receives no spending or withdrawal authority from that role. |
| **Recipient** | Receives USDC directly from the vault when a permitted payment succeeds. |

The Vault Key is generated and unlocked in a dedicated browser Worker. Its backup is encrypted with a password. The app requires downloading and restoring the actual backup before vault creation so that recoverability is checked before funds are deposited.

On every agent payment, the contract checks the sender, session ID, expiry, recipient, payment amount, remaining budget, vault balance and payment ID. Reusing an already executed payment ID in the same session is rejected. Replacing or freezing a session invalidates the old session's payment authority.

~~~mermaid
flowchart LR
    Owner["Owner wallet + Vault Key"] -->|"Authorize spending rules"| Vault["USDC vault on Arc"]
    Agent["Separate agent account"] -->|"Request payment"| Vault
    Vault -->|"Check session and limits"| Rules{"Payment permitted?"}
    Rules -->|"Yes: transfer USDC"| Recipient["Approved recipient"]
    Rules -->|"No"| Reject["Reject payment"]
~~~

Either the owner wallet or the Vault Key can stop spending. Withdrawal requires both management keys and an inactive session. An expired or exhausted session still needs to be frozen before withdrawal.

## Why Arc?

Arc supplies the parts used by this prototype:

- **USDC settlement:** the vault holds and transfers USDC to recipients.
- **USDC transaction fees:** owners, agents and freeze relays use USDC for gas on Arc.
- **Native post-quantum verification:** the contract calls Arc's SLH-DSA-SHA2-128s verifier to check Vault Key management signatures.

The post-quantum signature adds an approval requirement to application management. The connected EVM wallet and the network's own security remain separate trust boundaries. More detail is in the [threat model](THREAT-MODEL.md).

## Using the application

Use the [public application](https://arcmandate.vercel.app) with an EVM wallet on **Arc Mainnet**, chain ID **5042**. Transactions need USDC on that network. An existing supported vault can be viewed without connecting a wallet.

### 1. Create or open a vault

Choose **Create a vault** and connect the account that will own it. In **Vault Key**, generate a key, choose a backup password, download the encrypted file, then select that file and restore it.

Review the owner account, network, Vault Key and estimated transaction fee before approving creation in your wallet. Deployment creates an **empty vault**. Deposit and session creation are later steps.

For an existing vault, choose **Open an existing vault** and enter its address, select a saved vault, or find it from its successful creation transaction. Use the matching encrypted Vault Key backup when management approval is needed.

### 2. Prepare automatic payments

Open **Agent & session → Automatic payments**. Sign in with a free owner-wallet message, then choose **Prepare automatic payment account**. The service creates a separate account for this vault; no terminal, private-key import or manual agent account switch is required.

The service stores the agent signing key encrypted. It never receives your owner private key or Vault Key. A compromised service can use the authority you already granted, within the contract's limits. Keep gas funding small; the agent account's own funds are outside the vault policy.

### 3. Fund the vault and transaction senders

In **Funds**, deposit the USDC the agent may spend. Separately use **Add agent network fees** to fund the agent's own wallet for gas. A Vault Key freeze also needs a funded relay account.

| Balance | Purpose |
| --- | --- |
| Vault USDC | Payments to approved recipients |
| Owner wallet USDC | Deployment, management and funding transaction fees |
| Agent wallet USDC | Agent payment transaction fees |
| Relay wallet USDC | Vault Key freeze transaction fees |

USDC transferred into the agent's own wallet is outside the vault's spending rules. Keep gas funding separate from the vault deposit. Arc's native and ERC-20 USDC balance views represent the same underlying funds and must not be added together.

### 4. Set limits and open the session

Return to the owner account and restore the Vault Key if switching accounts locked it. In **Agent & session → Set limits**, choose:

- The agent account.
- One to five allowed recipient addresses.
- The total session budget.
- The maximum amount per payment.
- The session duration.

Review the policy and expiry, authorize it with the Vault Key, and approve the transaction with the owner wallet. **Open the session last**, after accounts and funds are ready, because its expiry is time-based.

### 5. Activate a payment plan

Return to **Automatic payments**. Choose an allowed recipient, a fixed amount, first payment time, interval and number of payments (1–100). All payments must fit the vault balance, remaining budget, per-payment limit and session expiry. Times are shown in your browser's time zone and stored as absolute UTC times.

Review the total and schedule, check the authorization box and select **Activate automatic payments**. Opening a spending session alone does not activate a plan. The hosted worker executes the plan with no per-payment wallet prompt, including while the page is closed. Each submitted payment has a network-fee cap of 0.01 USDC; fees come from the separate agent account.

A time missed by at least one minute is skipped; missed payments are not caught up in a burst. Network confirmation may be delayed. Pause stops new service submissions, while a transaction already sent may still confirm. Freeze revokes the onchain authority. An old plan never adopts a replacement session automatically.

### 6. Freeze and withdraw

Use **Freeze session** to stop spending. You can choose the owner wallet path or authorize a freeze with the Vault Key and a funded relay. A distinct relay can submit a freeze when the owner's account has a pending transaction.

Wait for confirmation, then use **Funds → Withdraw**. Withdrawal needs the owner wallet and the matching Vault Key. A payment ordered before the freeze may execute first. After stopping the plan and resolving pending payments, **Return unused fees to owner** returns the agent’s available gas balance to the immutable vault owner, less a buffered network fee. A small reserve can remain.

### 7. Check activity and return later

**Overview** shows the vault balance and session state. **Activity** shows decoded onchain events, explorer links and local wallet operation records.

Save the vault or export its public vault card to reopen it in another browser. A vault card contains public metadata; the encrypted Vault Key backup and its password are needed separately. Wallet permissions and transaction journals belong to the browser origin where they were created.

If a transaction's outcome is unknown, check its saved hash and wallet activity before sending again. Keep the original payment request when retrying. Reloading or locking the local key leaves the onchain session in its existing state.

## Release evidence

| Area | Current evidence |
| --- | --- |
| Hosted scheduler acceptance | Two scheduled mainnet payments with the browser closed and a service redeployment between payments. [Testnet payments and freeze](deployments/automation-testnet-2026-10-10.json). |
| Public mainnet frontend | [Live app](https://arcmandate.vercel.app), [10 October receipt UI publication](deployments/p7-mainnet-receipt-ui-2026-10-10.json) and [earlier wallet/UI checks](deployments/p7-mainnet-ui-2026-10-09.json). |
| Mainnet preparation | [Build, network isolation and read-only verifier checks](deployments/p7-mainnet-preparation-2026-10-09.json). |
| Funded testnet workflow | [8 October closeout](deployments/arc-testnet-closeout-2026-10-08.json): 11 successful transactions, three block-pinned rejection simulations and three actual process-interruption recoveries. |
| Browser wallet acceptance | [Testnet MetaMask evidence](deployments/p6-metamask-browser.json). |
| Mainnet vault and source verification | [10 October evidence](deployments/arc-mainnet-2026-10-10.json): successful empty-vault deployment, exact constructor/runtime matching, explorer source verification, three block-pinned rejection simulations and browser checks. |
| Funded mainnet workflow | [10 October acceptance](deployments/arc-mainnet-acceptance-2026-10-10.json): 11 successful transactions, owner-directed agent payments, budget/replay rejection, restart/replacement, owner/PQ freezes, full withdrawal and agent gas return. Manual MetaMask execution; final vault empty and inactive. |

The funded mainnet acceptance used application source `b503437fadb6d1af30ae0fc1132060d924652401`. All 13 hosted files matched its isolated mainnet build during the deployment checks. Each historical evidence file identifies its own source and scope. The acceptance record distinguishes mined transactions, free block-pinned simulations and manual browser checks.

The reference mainnet vault is `0x99cAae907095bBB95D8714ee2a23369dB2377d7A`, created in block `25142201` by [this transaction](https://explorer.arc.io/tx/0xa696ab775a6eacdbc59f567b0159e96831d7ec2b129ccb7b0952e161064e24d6). Creation transferred **0 USDC** and cost **0.038374662 USDC** in network fees. Funded acceptance cost **0.0640359225 USDC**. Owner, agent and vault balances reconcile exactly to the original total minus those fees, counting native/ERC-20 USDC once. After withdrawing the remaining 0.08 USDC, the agent returned its available gas funds; MetaMask left 0.00044625 USDC in the user-controlled agent account. The public vault link opens without connecting a wallet.

Two accepted hashes briefly returned transaction-not-found before RPC indexing caught up. Rechecking the saved receipts resolved both without duplicate sends. The receipt flow now waits through a bounded sequence of transaction-visibility reads before reporting an unknown outcome; sender, network, nonce, calldata and event verification still apply. The [new publication record](deployments/p7-mainnet-receipt-ui-2026-10-10.json) binds the tested fix to its source commit and verifies all 13 hosted files against a clean mainnet build.

## Prototype boundaries

This is an experimental prototype with no independent security audit.

- Each vault has one owner, one fixed Vault Key and one active agent session. The contract has no upgrade, key rotation or lost-key recovery path. Losing owner access or the backup/password can prevent withdrawal.
- The browser Worker manages local key use, but a compromised device or frontend can compromise signing. Keep the encrypted backup and password recoverable and private.
- Session budgets cover vault payments. They do not restrict the agent's own wallet or verify the quality of a purchased service.
- Payment IDs prevent repeated execution within a session. Coordinating business requests across devices, sessions or executors requires an integration's own durable records.
- Actual MetaMask speed-up/cancel acceptance remains incomplete after a testnet wallet error. The missing-original-hash recovery limitation is recorded in the [testnet closeout](deployments/arc-testnet-closeout-2026-10-08.json).
- A reported MetaMask warning for the hosted site is still unresolved; its cause has not been established. The [latest publication record](deployments/p7-mainnet-ui-2026-10-09.json) retains this open release issue.

## Run locally

The default local build targets **Arc Testnet**. The hosted production build targets **Arc Mainnet**; the network is selected at build time.

Prerequisites: Node.js 22.12+ and npm 11, plus Foundry for contract compilation. Exact release versions are in [toolchain.json](toolchain.json).

~~~sh
npm ci
npm run artifacts
npm run dev
~~~

For validation and a built testnet preview:

~~~sh
npm run check
npm run preview
~~~

The preview serves `http://127.0.0.1:5173/`. To build the prepared mainnet frontend using the existing generated contract artifact:

~~~sh
npm run build -w @arcmandate/web -- --mode mainnet
~~~

See the [developer guide](DEVELOPMENT.md) for RPC configuration, the testnet CLI, transaction recovery and integration test tooling.

## Repository map

| Path | Contents |
| --- | --- |
| [contracts/src](contracts/src) | Vault, authorization digests and Arc verifier integration |
| [apps/web/src](apps/web/src) | React application, wallet workflow and Vault Key Worker |
| [packages/core/src](packages/core/src) | Shared policy, keyfile, digest and generated contract code |
| [scripts](scripts) | Testnet executors, evidence recording and release checks |
| [services/automation](services/automation) | Hosted scheduler, encrypted agent keys, owner authentication and durable transaction state |
| [deployments](deployments) | Public deployment and validation records |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Detailed developer and recovery guide |
| [THREAT-MODEL.md](THREAT-MODEL.md) | Security assumptions and implemented boundaries |
