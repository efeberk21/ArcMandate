# ArcMandate

ArcMandate is an Arc USDC vault prototype that gives one software agent a bounded spending session. Owner wallet plus SLH-DSA-SHA2-128s signature authorizes a session and withdrawals. The owner or the PQ key can freeze a session. P2 contract implementation and a complete Arc testnet transaction sequence have passed; the product keyfile and management UI are upcoming P3/P4 work.

## Development

- Node.js 22.12+ and npm 11
- Foundry (Forge/Cast)
- `npm ci`
- `npm run check` for local build and tests
- `npm run preflight` for read-only Arc RPC checks
- `npm run pq:probe` for ephemeral-key SLH-DSA verification against Arc RPCs
- `npm run dev` for the web development server
- In the development page, **Run browser PQ check** signs a structured START intent inside a Worker and checks the result with Arc testnet. It is a development harness, not a vault UI.

The P2 vault contract is in [contracts/src/ArcMandateVault.sol](contracts/src/ArcMandateVault.sol). Testnet evidence is in [deployments/arc-testnet.json](deployments/arc-testnet.json): deployment, 1 USDC funding, two sessions, two agent payments, a PQ freeze, an owner freeze, hybrid withdrawal, and block-pinned negative simulations. The deployed testnet vault is [`0x91e4467997d28ad3443f910261f4d65b4c867bbd`](https://testnet.arcscan.app/address/0x91e4467997d28ad3443f910261f4d65b4c867bbd). It was emptied after the demo.

P1 authorization digest fixtures are in [fixtures/digest-vectors.json](fixtures/digest-vectors.json). `npm run fixtures:generate` regenerates them from the TypeScript implementation; Solidity tests independently compare their fixed expected values.

Copy `.env.example` to `.env` only when overriding public RPC URLs. Never put private keys or PQ secrets in the frontend or Git repository.

`npm run accounts:testnet` creates disposable testnet keys in ignored `private/arc-testnet-keys.json`; it refuses to overwrite an existing file. `npm run demo:testnet -- --balances` reads their public balances. After obtaining testnet funds and building the contract, `npm run demo:testnet` runs the testnet sequence and writes `deployments/arc-testnet.json`. It never targets mainnet. The disposable file is unencrypted and is only for P2 integration; P3 will add encrypted product key handling.

The current implementation priorities and acceptance gates are in [the roadmap](ArcMandate-roadmap.md) and [technical plan](ArcMandate-implementation-plan.md). The supplied plans were renamed to ArcMandate before the first commit.
