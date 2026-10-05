# ArcMandate

ArcMandate is an Arc USDC vault prototype that gives one software agent a bounded spending session. Owner wallet plus SLH-DSA-SHA2-128s signature authorizes a session and withdrawals. The owner or the PQ key can freeze a session. The testnet management UI supports encrypted backup/restore, deployment, funding, sessions, both freeze paths and hybrid withdrawal. Mainnet management remains disabled pending release checks.

## Development

- Node.js 22.12+ and npm 11
- Foundry (Forge/Cast)
- Exact release versions are in `toolchain.json` and `.node-version`: Node 25.5.0, npm 11.8.0, Forge 1.5.1 at the recorded commit. The supported development Node range remains 22.12+. `npm run check:toolchain` enforces release Node/npm; the Forge wrapper verifies version/commit. `ARC_ALLOW_TOOLCHAIN_MISMATCH=1` is a visible development-only override, never release evidence. CI checks installation, script syntax, tests, build and generated artifact drift.
- `npm ci`
- `npm run check` for local build and tests
- `npm run preflight` for read-only Arc RPC checks
- `npm run pq:probe` for ephemeral-key SLH-DSA verification against Arc RPCs
- `npm run dev` for the web development server
- The page opens the recorded testnet demo without a wallet. Enter management mode with an EVM wallet on Arc testnet to open a vault or create one. A new key must be exported and restored before deployment or funding. Existing vaults require the matching PQ backup.
- `npm run artifacts` regenerates the shared ABI and deployment bytecode from the pinned Foundry build; `npm run build:web` includes this step.
- Transactions require review, fresh authorization checks, simulation and wallet approval. Receipt timeout retains the submitted hash for rechecking. Account/network/vault changes lock the Worker; edited forms invalidate the review.
- Funding and management require the full pinned runtime, with every owner/PQ immutable instantiated. Matching getters alone remain read only. Receipt confirmation checks the actual mined transaction intent and action event; cancellation does not confirm the original action, and repricing links to its actual hash.
- Non-secret operations are saved before wallet submission and reconciled after reload. Unresolved funding/deployment cannot be silently repeated. Keep browser storage while unresolved; if the hash was lost, attach it from wallet activity. An emergency PQ freeze can use a distinct funded relay wallet despite another sender's pending operation. The same sender must first reconcile/cancel its pending nonce in its wallet. A freeze always uses fresh session/nonce state.
- The password is not persisted. Losing either management key, the encrypted file or its password can prevent withdrawal. Read [the threat model](THREAT-MODEL.md) for the device, frontend and network boundaries.

The P2 vault contract is in [contracts/src/ArcMandateVault.sol](contracts/src/ArcMandateVault.sol). Testnet evidence is in [deployments/arc-testnet.json](deployments/arc-testnet.json): deployment, 1 USDC funding, two sessions, two agent payments, a PQ freeze, an owner freeze, hybrid withdrawal, and block-pinned negative simulations. The deployed testnet vault is [`0x91e4467997d28ad3443f910261f4d65b4c867bbd`](https://testnet.arcscan.app/address/0x91e4467997d28ad3443f910261f4d65b4c867bbd). It was emptied after the demo.

P1 authorization digest fixtures are in [fixtures/digest-vectors.json](fixtures/digest-vectors.json). `npm run fixtures:generate` regenerates them from the TypeScript implementation; Solidity tests independently compare their fixed expected values.

Copy `.env.example` to root `.env` when overriding public RPC URLs. Node scripts use `ARC_TESTNET_RPC_URL` / `ARC_MAINNET_RPC_URL`. The web app separately uses `VITE_ARC_TESTNET_RPC_URL` / `VITE_ARC_MAINNET_RPC_URL`; restart Vite or rebuild after changing them. HTTPS endpoints (or loopback HTTP) are validated, and the RPC chain ID must still match. Every `VITE_*` value is public in the browser bundle: do not include private RPC credentials, wallet keys or PQ secrets.

`npm run accounts:testnet` creates disposable testnet keys in ignored `private/arc-testnet-keys.json`; it refuses to overwrite an existing file. `npm run demo:testnet -- --balances` reads their public balances. After obtaining testnet funds and building the contract, `npm run demo:testnet` runs the testnet sequence and writes `deployments/arc-testnet.json`. It never targets mainnet. The disposable file is unencrypted and used only for integration scripts; the product uses encrypted Worker keyfiles.

## P5 agent payments and testnet evidence

The standalone agent CLI reads an ignored JSON file containing only `{ "privateKey": "0x..." }`. It never needs the owner wallet or PQ key. Use a unique, stable request ID for each intended payment and supply the session ID explicitly:

```text
npm run agent:pay -- --request invoice-42 --vault 0x... --to 0x... --amount 0.05 --session 1 --deployment-block 65133845 --key-file private/agent-testnet-key.json
```

The CLI targets Arc testnet only. Its ignored `private/agent-journal` records the exact request, agent account, random `paymentId`, signed transaction and hash before broadcast. Repeat the same command after timeout; a changed request is rejected. `confirmed` requires a current receipt plus matching `AgentPaid` proof, including for restored cached receipts. Signed calldata, signer, chain and hash are validated. `--reconcile` checks without signing or broadcasting. OS locks release on process death and do not rely on PID files; never delete journals to recover a lock.

Every request and vault using the same chain/agent shares `private/agent-wallet-locks`. Keep this directory and payment journals together. A reservation is written before signing, so a parallel or later request is rejected until the prior nonce is reconciled. `pending`/`used` need checking; `nonce-consumed` means another transaction consumed the signed nonce (exit code 4). After that proof, explicit `--retry-consumed` archives the old signed attempt and re-signs the **same paymentId/session/request** at a fresh nonce, subject to current authorization. Automatic fee replacement is not implemented. Old journals lacking `account` fail closed: preserve them and verify signer, receipt and payment event before a deliberate schema migration; do not create a new request or paymentId to bypass it. Locks cover processes sharing this checkout/storage; multiple machines require a single coordinator and shared durable storage.

For a new full demo, set `ARC_DEMO_MANIFEST_PATH` to a new file under `deployments/` before `npm run demo:testnet`; the default completed P2 manifest is not overwritten. The historical [P5 manifest](deployments/arc-testnet-p5.json) remains unchanged. New demo management steps save signed raw transactions before broadcast under ignored `private/demo-journal`; retries reuse the original hash. Manifest snapshots use flush-and-rename. Fresh authorizations use current block state, and a previously mined withdrawal is finalized without another transfer. Changed source trees, reverted/stuck authorizations and externally changed demo state stop for reconciliation; do not delete the journals to start over. These recovery paths have local fault tests; the revised full demo has not yet been rerun with a real wallet.

## Browser integration smoke test

`npm run smoke:web` serves `http://127.0.0.1:5173/smoke.html` with a development-only EIP-1193 adapter for the disposable owner/relay accounts above. Every **Send wallet transaction** button submits a real testnet transaction. Keep this page local. The bridge refuses mainnet, checks Host/Origin and a request token, and never sends account private keys to the browser. It is excluded from the production entry point.

The harness captures the product's encrypted browser export unchanged in `private/web-smoke-keyfile.json`. Reload, enter management, select the captured file, and restore it with the test password. The product must prove a fresh signature and match the vault key. A later [P6 Chrome MetaMask run](deployments/p6-metamask-browser.json) also tested a browser download and user-operated Windows native file-picker restore after reload, followed by real extension-wallet management on Arc testnet.

The P4 smoke sequence is deploy → fund 1 USDC → start → PQ freeze from relay → start → owner freeze → withdraw 1 USDC. `node scripts/record-web-smoke.mjs` validates its real receipts and final inactive/empty state and writes [the public smoke evidence](deployments/p4-browser-smoke.json). Rejected wallet requests and cancelled reviews have no receipt and are not counted as mined transactions.

`npm run release:snapshot` writes the ignored local file `deployments/revision-2026-10-05-release-snapshot.json` (override with `ARC_RELEASE_SNAPSHOT_PATH`) while preserving the public historical evidence. It binds successful deployment receipt/address, constructor and full runtime, and records commit/dirty source hash/lockfile/artifact/compiler settings. Gas price is a timed observation between two heads. Revised wallet adversarial acceptance, a fresh funded demo and release checks remain outstanding before mainnet management can be enabled.
