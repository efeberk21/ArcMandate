# ArcMandate

ArcMandate is an Arc USDC vault prototype that gives one software agent a bounded spending session. Owner wallet plus SLH-DSA-SHA2-128s signature authorizes a session and withdrawals. The owner or the PQ key can freeze a session. The testnet management UI supports encrypted backup/restore, deployment, funding, sessions, both freeze paths and hybrid withdrawal. Mainnet management remains disabled pending release checks.

## Development

- Node.js 22.12+ and npm 11
- Foundry (Forge/Cast)
- `npm ci`
- `npm run check` for local build and tests
- `npm run preflight` for read-only Arc RPC checks
- `npm run pq:probe` for ephemeral-key SLH-DSA verification against Arc RPCs
- `npm run dev` for the web development server
- The page opens the recorded testnet demo without a wallet. Enter management mode with an EVM wallet on Arc testnet to open a vault or create one. A new key must be exported and restored before deployment or funding. Existing vaults require the matching PQ backup.
- `npm run artifacts` regenerates the shared ABI and deployment bytecode from the pinned Foundry build; `npm run build:web` includes this step.
- Transactions require review, fresh authorization checks, simulation and wallet approval. Receipt timeout retains the submitted hash for rechecking. Account/network/vault changes lock the Worker; edited forms invalidate the review.
- The password is not persisted. Losing either management key, the encrypted file or its password can prevent withdrawal. Read [the threat model](THREAT-MODEL.md) for the device, frontend and network boundaries.

The P2 vault contract is in [contracts/src/ArcMandateVault.sol](contracts/src/ArcMandateVault.sol). Testnet evidence is in [deployments/arc-testnet.json](deployments/arc-testnet.json): deployment, 1 USDC funding, two sessions, two agent payments, a PQ freeze, an owner freeze, hybrid withdrawal, and block-pinned negative simulations. The deployed testnet vault is [`0x91e4467997d28ad3443f910261f4d65b4c867bbd`](https://testnet.arcscan.app/address/0x91e4467997d28ad3443f910261f4d65b4c867bbd). It was emptied after the demo.

P1 authorization digest fixtures are in [fixtures/digest-vectors.json](fixtures/digest-vectors.json). `npm run fixtures:generate` regenerates them from the TypeScript implementation; Solidity tests independently compare their fixed expected values.

Copy `.env.example` to `.env` only when overriding public RPC URLs. Never put private keys or PQ secrets in the frontend or Git repository.

`npm run accounts:testnet` creates disposable testnet keys in ignored `private/arc-testnet-keys.json`; it refuses to overwrite an existing file. `npm run demo:testnet -- --balances` reads their public balances. After obtaining testnet funds and building the contract, `npm run demo:testnet` runs the testnet sequence and writes `deployments/arc-testnet.json`. It never targets mainnet. The disposable file is unencrypted and used only for integration scripts; the product uses encrypted Worker keyfiles.

## P5 agent payments and testnet evidence

The standalone agent CLI reads an ignored JSON file containing only `{ "privateKey": "0x..." }`. It never needs the owner wallet or PQ key. Use a unique, stable request ID for each intended payment and supply the session ID explicitly:

```text
npm run agent:pay -- --request invoice-42 --vault 0x... --to 0x... --amount 0.05 --session 1 --deployment-block 65133845 --key-file private/agent-testnet-key.json
```

The CLI targets Arc testnet only. Its ignored `private/agent-journal` records the exact request, a random `paymentId`, the signed transaction and its hash before broadcast. Repeat the same command after a timeout; a changed amount, recipient, vault or session is rejected. `confirmed` means the receipt or matching `AgentPaid` event was found; `pending` and `used` need further checking. An existing signed transaction is rebroadcast with its original nonce and bytes. Automatic higher-fee replacement is not implemented; inspect a persistently pending request's nonce and chain state before manual intervention. Keep this journal backed up while a payment is unresolved and do not run the same request concurrently. If a process crashes while holding a lock, the next run removes the lock only when its PID no longer exists.

For a new full demo, set `ARC_DEMO_MANIFEST_PATH` to a new file under `deployments/` before `npm run demo:testnet`; the default path is the completed P2 manifest and is intentionally not overwritten. The P5 rerun is recorded in [the P5 testnet manifest](deployments/arc-testnet-p5.json). It contains mined receipts and block-pinned rejection simulations; payment journals and keys remain private. The demo's owner/relay/deployment steps do not yet have the agent payment's crash recovery guarantee.

## Browser integration smoke test

`npm run smoke:web` serves `http://127.0.0.1:5173/smoke.html` with a development-only EIP-1193 adapter for the disposable owner/relay accounts above. Every **Send wallet transaction** button submits a real testnet transaction. Keep this page local. The bridge refuses mainnet, checks Host/Origin and a request token, and never sends account private keys to the browser. It is excluded from the production entry point.

The harness captures the product's encrypted browser export unchanged in `private/web-smoke-keyfile.json`. Reload, enter management, select the captured file, and restore it with the test password. The product must prove a fresh signature and match the vault key. This exercises the same export/restore path across fresh Workers; OS Downloads/file-picker behavior and real wallet extensions are separate checks.

The P4 smoke sequence is deploy → fund 1 USDC → start → PQ freeze from relay → start → owner freeze → withdraw 1 USDC. `node scripts/record-web-smoke.mjs` validates its real receipts and final inactive/empty state and writes [the public smoke evidence](deployments/p4-browser-smoke.json). Rejected wallet requests and cancelled reviews have no receipt and are not counted as mined transactions.

The current implementation priorities and acceptance gates are in [the roadmap](ArcMandate-roadmap.md) and [technical plan](ArcMandate-implementation-plan.md). The supplied plans were renamed to ArcMandate before the first commit.
