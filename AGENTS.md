# AGENTS.md

Layered local coding agent (TypeScript, CommonJS). Docs and comments are largely
in Chinese; keep that style when editing them. `docs/` is design-first: changes
to layering, the protocol, or the security model must update `docs/00-product-decisions.md`
before touching code.

## Commands

Requires **Node.js >= 22** (scripts use `--env-file-if-exists`, `node --test`).

```bash
npm run check       # typecheck: main tsconfig + clients/web/tsconfig (two separate runs)
npm test            # runs `npm run build`, then node --test 'dist/test/**/*.test.js'
npm run build       # tsc -> dist/ + esbuild bundles the React web app -> dist/clients/web
```

- **There is no lint/formatter/ESLint/Prettier config.** `npm run check` is the only static gate.
- Run a **single test**: build first (tests import `../../src/...`, which resolves to `dist/src` at runtime), then `npm run build && node --test dist/test/server/agent-server.test.js`.
- `npm run server` / `cli` / `replay` auto-build via `preserver`/`precli`/`prereplay` hooks; `npm run dev` and `npm run demo:core` compile inline. `npm run dev` only prints protocol counts — it is a skeleton smoke check, **not** a dev server. Use `npm run server` for the real one.
- Full suite currently has **1 pre-existing failure** (42/43): `test/server/agent-server.test.ts` asserts `reasoning.completed` is not persisted, but `src/server/agent-server.ts` currently persists it (`TRANSIENT_EVENT_TYPES` has it commented out). Don't treat this as caused by your change.

## Architecture

Strict **downward-only** dependencies. Cross-layer data must be defined in `protocols` first, then producers/consumers.

```
clients ──► protocols ◄── server ──► core ──► llm
                              │           └► tools
                              ├──► store
                              └──► plugins
```

- `protocols`: zod schemas for events/commands (compile-time + runtime validation). Transient events (`message.delta`, `reasoning.delta`, `reasoning.completed`, `queue_update`) are broadcast but must not be persisted.
- `core`: agent loop only — messages, tool calls, event emission. Never touches fs/network/UI.
- `server`: the **only** translation layer (sessions, routing, store coordination). `createAgentServer` is transport-agnostic; WS/HTTP are separate files.
- `clients`: render events, send commands, no business state. CLI must not import `core`.
- `llm`/`tools`/`store`/`plugins`: single-purpose; tools carry no approval policy (approval is a reserved protocol, not yet enforced).

Composition roots (only these read `src/config`): `src/server/main.ts`, `scripts/cli.ts`, `scripts/replay.ts`. Web typecheck is separate because the main tsconfig **excludes** `clients/web`; the web tsconfig also omits `exactOptionalPropertyTypes` (main enables it, plus `noUncheckedIndexedAccess`).

## Runtime gotchas

- Config precedence: defaults < `agent.config.json` (or `AGENT_CONFIG`) < env < code. No `OPENAI_API_KEY` → deterministic mock LLM (loop runs offline).
- `.env` is only loaded by the `server`/`cli`/`replay` scripts via `--env-file-if-exists=.env`; `npm test` and `npm run check` do not read it.
- Undocumented CLI env vars: `AGENT_WS_URL` (skips auto-starting a local server), `AGENT_SESSION`, `NO_COLOR`.
- Sessions persist to `<sessionDir>/events.jsonl`; `npm run replay -- <sessionId>` replays offline.
- `src/tools/builtin/time.ts` is demo/test-only — excluded from `builtinTools` (the MVP set is read/write/edit/shell).
- `plugins/example-wordcount/plugin.json` sets `"enabled": false`, so it is not loaded by default. Host policy (enabled/allow/deny) is checked before plugin code is loaded.
- Web build output goes to `dist/clients/web`; `dist/`, `.env`, `agent.config.json`, `sessions/` are gitignored.
