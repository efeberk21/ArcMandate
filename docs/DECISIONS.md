# Decisions

- 2026-09-29: The project and repository name is **ArcMandate**. The five supplied plan files and their project-name references were renamed before the first commit. This also changes the planned signature domain and keyfile identifier; fixture tests must use the ArcMandate strings.
- 2026-09-29: The implementation plan and roadmap govern current work when older planning/review documents differ.
- 2026-09-29: Solidity 0.8.28 with Paris EVM target is an initial conservative toolchain setting. Arc compatibility remains to be proven with real RPC integration before deployment.
- 2026-09-29: Vite 8 Workers use ES module output because Noble's imported modules require code splitting; the default IIFE Worker build failed. The Worker build and local browser verification passed after setting `worker.format = 'es'`.
- 2026-09-29: Arc testnet P2 succeeded with a real PQ signature and ERC20 USDC transfers. The solc 0.8.28/Paris setting is compatible with this tested path; wider network and security claims still require P6 review.
- 2026-09-29: Arc RPC `latest` briefly returned a head older than a transaction receipt from the same run. Demo simulations and state reads use the preceding receipt's explicit block number. A simulation is recorded separately from a mined transaction.
