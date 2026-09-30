# Mirror "wow" upgrade: design spec and execution plan

Date: 2026-09-30. Deadline: 30 minutes from approval. Format: live 3-minute demo, fully offline (no API keys).
Inputs (read them, do not re-derive): `inputs/viz-design.md` (contract, SQL, components), `inputs/persona-design.md` (persona model, tokens, copy bank, demo deck), `inputs/audit-*.json` (verified findings).

## 1. Intent and success criteria

Win the KBC / Tectonic hackathon. The judges must *see* the algorithm think, see the product change for each user, and never see a glitch.

1. **Demo path is flawless** from a clean reset for sofie, lucas, marc, an, jan, po.
2. **The algorithm is visible.** Reasoning Theater (frame replay: doubt bar, signals lighting up, gate strip), what-if, why-not, belief web. The numbers come from the real engine SQL, never re-implemented.
3. **The product changes per user.** Persona themes (calm for Marc, studio for Lucas, default for Sofie), distinct role shells (customer / advisor / product owner), offline per-persona copy in EN/NL/FR, a Listen fallback without ElevenLabs.
4. **Safe by construction.** Customer JSON never contains "vulnerable/care"; what-if is read-only and reduce-only for consent; no individual-level data in any PO response; aggregate counts rounded, not just thresholded.

Non-goals: Cloud Run, real streaming, LLM keys, advisor what-if/theater variants, moment preview, 4th demo customer.

## 2. Approach (chosen)

One server-computed "explain" payload feeds four views (Theater, what-if, why-not, belief web). Persona is derived server-side (`ui` payload) and applied client-side through CSS custom properties. Galaxy is a lighter canvas fed by aggregates only. No new npm dependencies: SVG, CSS, WAAPI, canvas 2D (all allowed under the production CSP; `setAttribute('style')`, runtime `<style>`, `blob:` workers and `data:` fonts are blocked).

## 3. Shared API contract (v1)

Types, SQL and semantics: `inputs/viz-design.md` sections 2-3; persona: `inputs/persona-design.md` sections 3.2 and 6. In scope for v1:

| Route | Role | Owner |
|---|---|---|
| `POST /api/me/whatif` | customer | BE-1 |
| `GET /api/me/theater` (events, frames, final, `channels` policy map) | customer | BE-1 |
| `GET /api/me/why-not/{moment_id}?target=ask|act` | customer | BE-1 |
| `GET /api/po/galaxy` (aggregates only, rounded) | po | BE-3 |
| `GET /api/me/twin` gains `ui`, `as_of`; `GET /api/me/guidance` gains `voice`, `voice_script`, `tone`; `PUT /api/me/preferences` accepts optional prefs | customer | BE-2 |

Rules for every new route: customer id from the auth record only, `extra="forbid"`, bounded lists, rate-limit bucket, no DB writes in what-if/theater/why-not/galaxy, consent predicate in every query, uniform 404 semantics unchanged.

## 4. Work packages and file ownership (disjoint; nobody edits another package's files)

| Pkg | Scope | Owns |
|---|---|---|
| **BE-1 Explain engine** | `compile_hits`/`twin_sql` relation params + `as_of` upper bound; `gate`/`rk`/`score` columns with a startup migration check; `Engine.simulate`, `theater`, `why_not`; routes; tests (parity with stored twin, read-only checksum, consent, no "care" in customer JSON) | `dsl.py`, `engine.py`, new `explain.py`, new `routes_explain.py`, `tests/test_explain.py` |
| **BE-2 Hardening + persona + copy** | Audit fixes: message_cache key/invalidation on consent change, template fallback not cached permanently, FR grammar, delete_custom cleans feedback, login rate limit key, bounded/validated custom-moment values, PO k-anon rounding in `stats()` (called from `api.py`, implemented in new `privacy.py`), run timings. `persona.py` + `customer_prefs` + `ui`; `copybank.py` offline copy; demo reset script | `api.py`, `channels.py`, `security.py`, `config.py`, `db.py`, new `persona.py`, `copybank.py`, `privacy.py`, `backend/reset_demo.py`, `tests/test_hardening.py`, `tests/test_persona.py` |
| **BE-3 Galaxy API** | `GET /po/galaxy`: stage counts, best-row cells, operating points, missed, per-moment P/R, rounding rule from `privacy.py` contract (round to multiple of 5 for advisor/deferred/blocked, never split); route via new router | new `galaxy.py`, new `routes_po.py`, `tests/test_galaxy.py` |
| **FE-1 Visualizations** | `ReasoningTheater` (DoubtBar, EventLane, SignalChips, GateStrip, narration templates by gate, what-if panel, playback controls, stage mode), `WhyNot` cards, `BeliefWeb` (SVG 4-column, sever animation), fixtures mode for offline rehearsal | `web/src/viz/**` (incl. its own `types.ts`, `i18n`, `viz.css`) |
| **FE-2 Shell + persona + customer/advisor** | Theme tokens + `data-*` presets, role shells, reskin, projector sizing, reduced motion, contrast; `Mirror.tsx` fixes (double-submit, stale consent closure, out-of-order load) and mounting of FE-1 components; Demo Deck login (passwords typed once, sessions in memory, one-click switching; decide reload behaviour per persona spec); i18n for Login/Advisor/top bar/`html lang`; Advisor copy fixes; error boundary; `voice.ts` (SpeechSynthesis fallback + read-along); strict-TS cleanup (no `any`) | `App.tsx`, `main.tsx`, `api.ts`, `types.ts`, `i18n.ts`, `styles.css`, `views/Login.tsx`, `views/Mirror.tsx`, `views/Advisor.tsx`, `index.html`, new `theme/**`, `deck/**`, `voice.ts` |
| **FE-3 PO control room** | Galaxy canvas (two layers, FPS guard, reduced-motion static), HUD with per-moment P/R, honest elapsed timer, fix number formatting (`2.7 s`, `100,000`), fix "go live" success-on-failure + orphan handling, remove false "under a second" copy, synthetic-ground-truth badge | `views/ProductOwner.tsx`, new `web/src/galaxy/**` |

Pre-wired by the orchestrator before the build starts (so nobody touches shared files): stub components `viz/ReasoningTheater.tsx`, `viz/WhyNotList.tsx`, `viz/BeliefWeb.tsx`, `galaxy/Galaxy.tsx` (render `null`, typed props already defined), their imports in `Mirror.tsx`/`ProductOwner.tsx`, and `app.include_router(...)` for `routes_explain` and `routes_po` in `api.py`. A feature whose package does not finish simply stays a no-op stub: the app keeps working.

## 5. Engineering rules (from the owner's standards)

- Strict TypeScript, **no `any`, no unsafe casts**; Python fully typed. No comments unless the logic is non-obvious.
- No new runtime dependencies. No secrets anywhere; no plaintext sensitive storage except what the Demo Deck decision explicitly documents.
- Never touch `.env`, `backend/data/`, or the live API on port 8000. Each agent copies `scratchpad/db/base.duckdb` to its own path, sets `MIRROR_DB_PATH`, and uses its own port. Test with the production build (dev has no CSP).
- Agents do not run git. The orchestrator commits on branch `feature/wow-mirror`.
- All persona/role/copy output must pass: no care label to customers; care customer never gets pressure copy; overrides change presentation, never decisions.

## 6. Timeline (wall-clock, 30 minutes)

| T+ | Step |
|---|---|
| 0-4 | git init, branch, baseline commit; stubs and router wiring; dispatch 6 agents in parallel |
| 4-20 | Build (packages in parallel). Hard cut at T+20: anything unfinished stays a stub |
| 20-26 | Integrate: pytest, `tsc`, production build, browser smoke of the full demo script; three parallel reviewers (correctness, security/privacy, UX/accessibility) on the diff; fix confirmed findings |
| 26-30 | Stop API on :8000, regenerate clean DB (~25 s), restart on the production build, verify sofie 0.82/0.545, lucas 0.839 act, marc 0.874 advisor, jan 404 on sofie, EV moment flow; rehearsal notes |

## 7. Honesty constraints for the demo

- Do not say "under a second": measured 1.7-4.6 s (UI shows the real time). Warm-run before presenting.
- The data and ground truth are synthetic (badge stays). The "stream" is a deterministic replay of server frames, not live ingestion. Guardrail/fatigue scenes beyond Marc are what-if, labelled as such.
- Noisy-OR treats overlapping signals as independent (baby_store + baby_store_repeat): present as a calibrated approximation.

## 8. Acceptance checklist

- pytest green (existing 22 + new parity/read-only/consent/privacy tests); `tsc --noEmit` clean; production build clean; zero CSP violations in the browser.
- Theater for sofie replays growing_family (ask at the baby-shop event) and buying_home (0.82 < 0.85, asks); "looked at home insurance" what-if flips it to act (0.874); Marc's gate strip shows the human-first route without the word "care".
- Persona switch sofie -> lucas -> marc changes theme, density, copy language and tone without a reload or re-login.
- Listen works with no keys (speech synthesis or read-along with a neutral notice); no English developer error under an NL UI.
- PO: galaxy renders 100k points, EV moment adds a cluster, numbers formatted sanely, failed run is reported as failure.
