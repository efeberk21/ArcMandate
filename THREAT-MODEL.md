# Threat model

ArcMandate is an immutable, single-session USDC vault prototype. This document describes implemented boundaries; it is not an audit.

## Authority

- Starting or replacing a session and withdrawing require both the owner wallet and the vault's PQ key. Either key can freeze an active session.
- Agent payments require the current session, the configured agent, an allowed recipient, an unexpired policy, a positive amount within both limits, an unused payment ID, and sufficient USDC balance.
- Funding increases balance without renewing the session budget. Expiry and exhausted authority leave `active=true` until freeze; withdrawal requires an inactive session.
- Signed authorization binds the chain, vault, owner, action, session, nonce, deadline and action fields. Old signatures and old session payments must remain unusable after management changes.

## Keys and frontend

- The product PQ secret stays in a dedicated Worker. Its backup uses the fixed scrypt/AES-GCM profile with authenticated metadata. Restore checks the public key and proves a fresh signature before deployment or funding is enabled.
- The password is not persisted. Lost owner access or a lost PQ backup/password can prevent withdrawals. There is no recovery, key rotation or upgrade path.
- Real account/network changes invalidate authorization and terminate the Worker at the wallet event, before asynchronous context checks finish. Vault changes also lock it; the sole setup transition exception is this owner's verified deployment using the current Worker key. Same-context events and view-mode changes do not lock the key. External locks clear password inputs. Form/preset/custom-duration changes require another review. The client rechecks live context and simulates before wallet submission.
- A compromised device or malicious frontend can obtain both keys when used on that device. A Worker is not a hardware security boundary and this product is not an offline signer.
- PQ protects application authorization. The outer wallet transaction and network consensus are separate trust boundaries.
- The guided key importer checks file size/profile/public metadata before asking for a password, but metadata never authorizes an action. Decryption and fresh proof remain necessary. Thirty minutes of inactivity locks only the local signer; an active onchain session continues. Passwords temporarily exist in UI/Worker messages, although they are not persisted.
- `agent:create` writes a separate unencrypted testnet EVM key locally, refusing existing agent directories. Windows ACLs are restricted before writing; POSIX directories/files use 0700/0600. This is not a PQ backup, a hosted bot, or a protection against a compromised user/device. No owner private key is required by the agent CLI.

## Transactions and network

- Simulation is a snapshot, not a guarantee of later execution. A payment ordered before freeze may execute first.
- Wallet rejection, simulation rejection, mined revert and an unknown RPC outcome are distinct. A returned transaction hash is retained for receipt checks; an unknown submission is not automatically sent again.
- Receipt-driven reads are pinned to one block and do not regress below the last verified block. A new network/address never displays the preceding vault's snapshot. A same-vault RPC error can retain labelled stale data while management is disabled. Public RPC availability and correctness remain dependencies.
- Before wallet approval, the browser journals and requests an explicit pending nonce. Manual hashes must match sender/chain/destination/calldata/value and that nonce when known; replacement cancellation requires the original sender/nonce relationship. A failed mined-transaction lookup leaves the operation unresolved, including a reverted replacement. Legacy hashless records without a nonce cannot distinguish identical historical intents. External wallet submissions can consume the recorded nonce; this is a reconciliation case, not permission to resend.
- Same-origin submission/history Web Locks serialize cooperating tabs. Terminal receipt status and block/deployment metadata are persisted together; late unresolved updates cannot revive a terminal record. Storage/lock failure prevents new submissions. These controls do not coordinate independent origins/devices. A hashless user's "no transaction was sent" statement is an attestation and does not prove onchain cancellation; inaccurate statements can defeat local duplicate protection.
- Six-decimal ERC20 USDC and the wallet's eighteen-decimal native USDC view represent the same funds and must not be added together. Sub-micro-USDC native dust has no dedicated sweep path.
- Recipient allowlisting does not guarantee how recipients later use funds. An agent can be an allowed recipient; the review warns about this. A budget above today's balance may become spendable after future deposits.
- Browser agent payments bind a durable request to its original chain/account/vault/session/payment ID/recipient/amount before wallet submission. Confirmation requires the mined transaction intent and the exact `AgentPaid` event. `usedPaymentIds` is scoped to a session, not global business-level deduplication. Choosing a different request/session is an explicit new payment; erased storage or independent executors can defeat local duplicate protection.
- Browser draft writes and CLI-command copies use same-origin locks with stale-request checks. Browser coordination does not share the CLI's filesystem journals/OS locks. Use one executor for an agent account/request unless a separate durable coordinator is implemented. Gas funding is an ERC-20 transfer to the agent, proven by its matching Transfer event; the agent's own funds are outside vault controls. Fee/balance estimates are checked again before submission.
- Public vault bookmarks are hints, never authorization or authoritative session/balance state. Opening, deployment-hash lookup and imported cards require current chain/runtime checks for transactions. Labels and imported deployment context do not establish ownership. Unknown builds remain read only; this revision has no second supported runtime build.
- Corrupt operation or payment history restricts sending. Recovery exports raw data and quarantines it before validating replacement. Readable pending operations and original readable payment identities must remain. Accounting for unreadable submissions depends on an explicit user's wallet-activity check; a false statement can permit duplicate payment. Registry repair cannot reconcile or delete an operation journal.
- Diagnostics retain only event names/times in local tab session storage; no telemetry service, addresses, passwords, keyfile bytes, signatures or calldata are added. Native beforeunload cannot guarantee crash/mobile recovery. Historical spontaneous reloads are not claimed to have a proven cause.

## Development and remaining review

- Disposable testnet keys and journals are ignored under `private/`. The optional localhost smoke wallet uses those keys in Node, binds `127.0.0.1`, checks Host/Origin and a request token, and refuses mainnet. It is excluded from the production entry point.
- Mainnet management is disabled pending P6/P7 release gates. Current testnet evidence does not establish mainnet readiness.
- The 5 October revision saves signed management transactions before broadcast and atomically snapshots demo manifests. Agent journals also share chain/account OS locks and durable nonce reservations; every final success requires current receipt/event proof. These protections assume one shared checkout/storage coordinator and a trusted local journal directory. Preserve old journals and paymentIds during recovery; multiple independent machines can still race wallet nonces.
- P6 added local full-field signature mutation tests and a stateful invariant campaign using mock PQ/USDC dependencies. A separate Arc testnet Chrome run verified MetaMask owner management and user-operated Windows native file-picker restore. The user waived a clean Git clone/build for this checkpoint; only a clean source installation passed. Mainnet source verification remains a post-deployment P7 gate.
