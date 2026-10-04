# ADR 0001 — Headless game-core via vm harness (bridge to server simulation)

Date: 2026-10-04 · Status: Accepted (M0)

## Context

The game is vanilla browser JavaScript: seven classic scripts (`audio.js`, `particles.js`, `food.js`,
`shop.js`, `entities.js`, `ai.js`, `game.js`) loaded in order by `apps/web/index.html`, sharing one
global scope. For real-time multiplayer we need the **same simulation** to run on a Node room server,
deterministically, at 30–60 Hz, without a browser.

A full TypeScript rewrite of the simulation would take weeks and risk behavior drift from the current
game. Direct `import` of the scripts is not possible: they use DOM APIs, `Math.random`, timers, and
`localStorage` at load time.

## Decision

Run the **unmodified game scripts** inside a Node `vm` context with:

- Minimal DOM/canvas/audio stubs (`packages/game-core/src/dom-stubs.js`).
- Virtual timers and a virtual clock so `setTimeout`-driven game logic is deterministic.
- A seeded `Math.random` (mulberry32) injected before the scripts load; the host's `Math` is untouched.
- UI-only methods (`updateHUD`, `renderMinimap`, `render`) stripped after construction — servers have no DOM.
- A bootstrap inside the context that exposes `new GameEngine()` and the catalog data to the host.

This gives a headless, deterministic, server-ready simulation **today**, with zero changes to game logic.

## Consequences

**Positive**
- Room server can start from the real game code immediately; no rewrite risk.
- Determinism enables replay-based anti-cheat and CI regression tests (same seed → same hash).
- Catalog export (`weaponSkins`, tiers, challenges) seeds the database from one source of truth.
- The browser game keeps working unchanged (it still loads the same files).

**Negative / risks**
- `vm` contexts are a bridging mechanism, not a long-term architecture; the TypeScript extraction
  into `packages/game-core/sim/` should happen incrementally (start with entities + AI).
- Global-scope coupling means any future script that assumes `window` will need stubs or refactoring.
- Headless performance still includes some DOM-ish overhead (leaderboard HTML strings); measured in
  the sim CLI and improved when the UI code is split out.

## Alternatives considered

1. **Full TS rewrite first** — cleaner, but weeks of work and high drift risk. Rejected for now.
2. **jsdom** — heavier, slower, and still needs canvas/audio stubs. Rejected in favor of tiny custom stubs.
3. **Copy simulation code into the server** — duplicate source of truth, guaranteed drift. Rejected.

## Follow-ups

- M1: add a `steer`/input injection API and expose per-tick entity state for the room server protocol.
- M2: move `entities.js` + `ai.js` into `packages/game-core/sim/` as ES modules; keep the browser
  consuming them via a small build step.
- Keep the determinism test (`test/sim.test.js`) as the guardrail for every refactor.
