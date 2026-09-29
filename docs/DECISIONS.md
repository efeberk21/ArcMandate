# Decisions

- 2026-09-29: The project and repository name is **ArcMandate**. The five supplied plan files and their project-name references were renamed before the first commit. This also changes the planned signature domain and keyfile identifier; fixture tests must use the ArcMandate strings.
- 2026-09-29: The implementation plan and roadmap govern current work when older planning/review documents differ.
- 2026-09-29: Solidity 0.8.28 with Paris EVM target is an initial conservative toolchain setting. Arc compatibility remains to be proven with real RPC integration before deployment.
- 2026-09-29: Vite 8 Workers use ES module output because Noble's imported modules require code splitting; the default IIFE Worker build failed. The Worker build and local browser verification passed after setting `worker.format = 'es'`.
