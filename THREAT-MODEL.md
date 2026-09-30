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
- Account, network, vault and mode changes terminate the Worker and invalidate reviewed authorization. Form changes require another review. The client rechecks live context and simulates before wallet submission.
- A compromised device or malicious frontend can obtain both keys when used on that device. A Worker is not a hardware security boundary and this product is not an offline signer.
- PQ protects application authorization. The outer wallet transaction and network consensus are separate trust boundaries.

## Transactions and network

- Simulation is a snapshot, not a guarantee of later execution. A payment ordered before freeze may execute first.
- Wallet rejection, simulation rejection, mined revert and an unknown RPC outcome are distinct. A returned transaction hash is retained for receipt checks; an unknown submission is not automatically sent again.
- Receipt-driven reads are pinned to one block. RPC errors clear the live vault display. Public RPC availability and correctness remain dependencies.
- Six-decimal ERC20 USDC and the wallet's eighteen-decimal native USDC view represent the same funds and must not be added together. Sub-micro-USDC native dust has no dedicated sweep path.
- Recipient allowlisting does not guarantee how recipients later use funds. An agent can be an allowed recipient; the review warns about this. A budget above today's balance may become spendable after future deposits.

## Development and remaining review

- Disposable testnet keys and journals are ignored under `private/`. The optional localhost smoke wallet uses those keys in Node, binds `127.0.0.1`, checks Host/Origin and a request token, and refuses mainnet. It is excluded from the production entry point.
- Mainnet management is disabled pending P6/P7 release gates. Current testnet evidence does not establish mainnet readiness.
- Full signature mutation coverage, stateful fuzz/invariants, clean-checkout release verification and restart-safe agent journaling remain planned work.
