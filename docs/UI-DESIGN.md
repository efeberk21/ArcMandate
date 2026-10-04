# ArcMandate UI design

The selected direction is the anchored authority field: a vault and agent connected inside a visible boundary. It expresses ArcMandate's fixed budgets, defined recipients and revocable sessions. The supplied AgentLeash document informed the initial structure; the user's subsequent preference for smooth shapes, a deep dark theme, warm orange glow and sparse stars supersedes its sharp industrial styling.

## Visual language

- Near-black #07090e canvas, #10141c surfaces, soft chalk text and warm orange #ff8a45 accents. Red indicates unavailable authority or errors; green indicates successful verification.
- Rounded cards, pill buttons, smooth inputs and restrained ambient stars. The orange connection and agent glow form the focal point; supporting forms remain calm.
- Local IBM Plex Mono for data and system Segoe UI for interface text. No external font requests.
- The vault remains the anchor. An ellipse marks bounded authority; the brighter connection segment represents remaining session budget. The complete connection retains a softer orange glow while usable.
- Payment observations trigger a single light trace. Locking lowers the connection into a slack curve, removes the orange glow and dims the agent. Expired, exhausted and unanchored states also lose the active glow.
- Reduced motion disables animation and transitions. Keyboard focus uses an orange outline. Labels remain associated with inputs; narrow screens stack registers and management fields without horizontal overflow.

## State accuracy

Active requires an active, unexpired session with remaining budget. Spendable authority is bounded by both the remaining budget and vault balance. Hold remaining is an estimate from the last fetched chain timestamp and elapsed time; the existing management flow still obtains fresh authorization data.

Expired and exhausted sessions can remain active onchain and must be frozen before withdrawal. Freezing clears policy data and increments the session epoch. The locked view therefore shows cleared limits, no active recipients and zero spending authority. It does not invent historical policy data. Recorded demo receipts remain explicitly historical.

The in-field lock shortcut opens the existing transaction review flow. Existing owner/PQ checks, wallet approval, simulation and submission logic remain in place.

## Preview and verification

http://127.0.0.1:5173/design.html is a development-only preview using the same SessionPlate component with clearly labelled sample data. It offers active, locked, expired, exhausted and unanchored states and a simulated payment. It makes no wallet calls or transactions and is not included in the production entry.

The full npm run check passed: type checking, 17 TypeScript tests, production web and contract builds, and 21 contract tests including the invariant suite. Final UI refinements were checked again with type checking and the web build.

Browser verification covered the live demo's cleared/locked state, management forms, disabled authorization controls, invalid address feedback, mainnet management restrictions, and mobile/desktop layouts. The sample preview covered state changes, payment feedback and budget updates. No wallet transaction was submitted during visual verification.
