<img src="apps/web/public/brand/arcmandate-symbol.png" alt="ArcMandate emblem" width="88">

# ArcMandate

### Your money. Your agent. Your rules.

**ArcMandate gives a software agent permission to spend USDC from a vault on Arc, within limits chosen by its owner.** The owner sets the allowed recipients, total budget, maximum amount per payment and expiry. The smart contract checks those rules whenever the agent makes a payment.

Funds stay in the vault until a permitted payment sends them directly to a recipient. The owner manages spending authority with an EVM wallet and a separate Vault Key, and can freeze the session when access needs to stop.

[Open the application](https://arcmandate.vercel.app) · [Contract source](contracts/src/ArcMandateVault.sol) · [Developer guide](DEVELOPMENT.md) · [Threat model](THREAT-MODEL.md)

> **Status — 9 October 2026:** The public application runs in **Arc Mainnet mode** and supports creating and managing a user's own vault. The funded workflow has been demonstrated on testnet. Our mainnet vault deployment and complete workflow with real USDC are still awaiting funding and validation. Publishing the frontend and confirming transactions onchain are separate milestones. See [release evidence](#release-evidence) for the completed checks and remaining work.

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

For example, a developer could integrate a worker that pays two known service providers for completed tasks. ArcMandate would enforce the recipient list and spending limits. The developer would supply the worker, verify that a task was completed, and decide whether a payment should be requested.

The current application includes a manual agent payment console and public agent configuration export. The repository also contains a **testnet-only** payment CLI. An autonomous worker or hosted bot service is a separate integration.

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

### 2. Prepare a separate agent

In **Agent & session → Prepare agent**, enter another wallet account's public address. The owner and agent must be different accounts.

The mainnet workflow uses the browser payment console. Choose the agent account yourself in your wallet when making a payment. Preparing an account or opening a session grants permission; an automated executor must be supplied separately.

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

### 5. Make an agent payment

Connect the configured agent account and open **Agent & session → Make a payment**. Choose an allowed recipient, enter an amount and review the payment.

The application checks current authorization, simulates the action and estimates the fee before wallet approval. Once the transaction succeeds, the vault sends USDC to the recipient and updates the session's spent amount. The agent pays the network fee from its own wallet.

### 6. Freeze and withdraw

Use **Freeze session** to stop spending. You can choose the owner wallet path or authorize a freeze with the Vault Key and a funded relay. A distinct relay can submit a freeze when the owner's account has a pending transaction.

Wait for confirmation, then use **Funds → Withdraw**. Withdrawal needs the owner wallet and the matching Vault Key. A payment ordered before the freeze may execute first.

### 7. Check activity and return later

**Overview** shows the vault balance and session state. **Activity** shows decoded onchain events, explorer links and local wallet operation records.

Save the vault or export its public vault card to reopen it in another browser. A vault card contains public metadata; the encrypted Vault Key backup and its password are needed separately. Wallet permissions and transaction journals belong to the browser origin where they were created.

If a transaction's outcome is unknown, check its saved hash and wallet activity before sending again. Keep the original payment request when retrying. Reloading or locking the local key leaves the onchain session in its existing state.

## Release evidence

| Area | Current evidence |
| --- | --- |
| Public mainnet frontend | [Live app](https://arcmandate.vercel.app), [publication record](deployments/p7-mainnet-frontend-2026-10-09.json) and [latest wallet/UI checks](deployments/p7-mainnet-ui-2026-10-09.json). |
| Mainnet preparation | [Build, network isolation and read-only verifier checks](deployments/p7-mainnet-preparation-2026-10-09.json). |
| Funded testnet workflow | [8 October closeout](deployments/arc-testnet-closeout-2026-10-08.json): 11 successful transactions, three block-pinned rejection simulations and three actual process-interruption recoveries. |
| Browser wallet acceptance | [Testnet MetaMask evidence](deployments/p6-metamask-browser.json). |
| Funded mainnet workflow | Pending: our vault deployment, source verification, transaction receipts and final walkthrough. |

The application source recorded in the latest frontend publication is `b503437fadb6d1af30ae0fc1132060d924652401`. Each historical evidence file identifies its own source and scope. Testnet evidence establishes those testnet results; mainnet receipts will be published after the funded run.

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
| [deployments](deployments) | Public deployment and validation records |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Detailed developer and recovery guide |
| [THREAT-MODEL.md](THREAT-MODEL.md) | Security assumptions and implemented boundaries |
