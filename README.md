# ArcMandate

ArcMandate is a planned Arc USDC vault that gives one software agent a bounded spending session. The current repository contains the development scaffold and project plans; vault functionality is not implemented yet.

## Development

- Node.js 22.12+ and npm 11
- Foundry (Forge/Cast)
- `npm ci`
- `npm run check` for local build and tests
- `npm run preflight` for read-only Arc RPC checks
- `npm run pq:probe` for ephemeral-key SLH-DSA verification against Arc RPCs
- `npm run dev` for the web development server

Copy `.env.example` to `.env` only when overriding public RPC URLs. Never put private keys or PQ secrets in the frontend or Git repository.

The current implementation priorities and acceptance gates are in [the roadmap](ArcMandate-roadmap.md) and [technical plan](ArcMandate-implementation-plan.md). The supplied plans were renamed to ArcMandate before the first commit.
