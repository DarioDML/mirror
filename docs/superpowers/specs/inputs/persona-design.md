# Mirror: persona-adaptive, role-adaptive, offline-copy design spec (read-only investigation)

Scope: design input only. Nothing inside the project root was edited. Every claim is tagged with file:line or with the command I ran. Anything I could not verify is marked "NOT VERIFIED".

## 0. Decisions in one screen

1. Persona = 10 independent display axes computed server-side by a pure function `derive()` (new `backend/mirror/persona.py`), sent to the customer as one `ui` object that has the SAME keys for every customer. The care flag is an input only; it is never serialized, named, or logged. Four named presets (guided, studio, quick, calm) exist for narration, but customers are assigned per axis.
2. Switcher = client-side multi-session "Demo Deck" (5 real logins held in memory, swap the active one). Rejected: a server endpoint that mints tokens for other users.
3. Offline copy = deterministic slot-based bank (`backend/mirror/copybank.py`), tone/language/confidence-band aware, output validated by the same rules as the Gemini sandbox. Gemini stays optional and gets an enumerated tone only.
4. Listen = browser SpeechSynthesis fallback that speaks a server-built `voice_script`, with a visual read-along when no voice exists for the language (this machine has no French voice, see 1.6).
5. The "algorithm wow" needs NO new backend data: per-evidence `weight`, `thresholds`, `confidence`, `inferred` are already in `/api/me/twin` (engine.py:143-150, 158-162). The noisy-OR can be animated client-side and reproduces the server numbers exactly (see 10).
6. Build/demo from the production bundle served by uvicorn (CSP on), not from Vite dev (HMR full-reloads wipe in-memory tokens). Rehearse under CSP.

## 1. Ground truth (verified)

How I got data: the live `backend/data/mirror.duckdb` and `.wal` are exclusively locked by the running API (plain `cp` and a FileShare.ReadWrite open both failed). I copied `backend/mirror/*.py` and `backend/moments/*.yaml` into the scratchpad (no `.env` involved), regenerated with the identical recipe (seed 42, 100,000 customers, events = 6,116,388, matches README:5 "6.1M") and queried that copy. It reproduces a fresh generate, NOT any feedback/consent edits made in the live file since.

Scratchpad = `C:/Users/Dario/AppData/Local/Temp/claude/C--Users-Dario-OneDrive---Erasmushogeschool-Brussel-Hackathon-Tectronic-30-09-2026/3b438afa-ea49-4084-a20d-604844ed0009/scratchpad` (abbrev. SP).

### 1.1 Customer attributes that exist
- `customers` columns: customer_id, first_name, age, region, city, language, household_size, vulnerable, consent_transactions, consent_app, advisor_id (generate.py:327-331).
- `/api/me/*` exposes only first_name, language, consents, beliefs, plans (api.py:184-204). Age, region, city, household, vulnerable are NOT visible to the customer today. I grepped Marc's `/me/twin`, `/me/guidance`, `/me` JSON for "vulnerable|care|flag": no hit (SP/bk/probe3.py).
- Demo customers (queried): Sofie 31, hh2, flanders/Gent, en, not vulnerable; Lucas 27, hh1, flanders/Antwerpen, nl; Marc 44, hh3, wallonia/Liège, fr, vulnerable (generate.py:252-257 confirmed by query).
- All three demo customers have exactly 20 app events (18 logins) -> app-behaviour traits cannot differentiate the demo personas; profile + twin state must.
- Engine outputs per demo customer (run): Sofie buying_home ask 0.82 (notary 0.6, mortgage_simulation 0.5, life_stage 0.1) and growing_family ask 0.545 (baby 0.35, toy 0.3); Lucas going_freelance act 0.839 (0.55, 0.45, 0.35); Marc buying_home advisor 0.874 (0.6, 0.5, 0.3, 0.1).
- Population (100k): age 18-25 10,435 / 26-35 16,171 / 36-50 35,499 / 51-65 27,369 / 66+ 10,526; household 1=24,704, 2=34,597, 3+=40,699; vulnerable 2,003 (2.0%) and 234 of 11,692 people aged 65+ (2.0%): care is independent of age (generate.py:241 `rng.random(n) < 0.02`). Never proxy care with age. twin states: wait 18,866, ask 2,136, act 286, advisor 45, deferred 1; 2,442 customers (2.4%) have an active moment.
- Residual inference channel (verified): state `advisor` arises only via `vulnerable AND policy='advisor'` (dsl.py:227). In the population all 45 advisor-state rows belong to vulnerable customers (SQL probe). The customer already sees "With your advisor" (i18n.ts:58). Do not add any explanation of why.

### 1.2 Frontend facts
- One shared shell for all roles, role only changes a pill label (App.tsx:9, 37-57). `<Mirror />` rendered without `key` (App.tsx:53). Global mutable token (api.ts:4-9) and a global 401 handler that logs out whoever is active (api.ts:33, App.tsx:14-19). Session type has no username (types.ts:4); login response has no username either (api.py:165-166).
- Theme: one palette (styles.css:1-19). `font-family: Inter,...` (styles.css:20) but no @font-face exists; `document.fonts` length 0 in the browser, so it renders in system-ui. No `prefers-*` media query, no dark mode, `<html lang="en">` never updated (index.html:2; measured `document.documentElement.lang === "en"` after login).
- 37 `font-size: Npx` declarations in styles.css, 35 px-based sizing declarations: the `text_scale` token needs a mechanical px->rem pass first.
- Measured on the production-CSP build logged in as Sofie: `.btn.small` 32px high, lang buttons 33px, chips 35px, state chips 25px; text nodes: 22 at 13px, 7 at 12px, 5 at 11px, only 2 at 18px, 1 at 30px.
- Existing WCAG contrast failures (computed, SP/contrast.py): `.muted` 4.03:1 on --bg and 4.36:1 on white; "Plan ready" chip `.s-act` teal on teal-soft 3.02:1; "We're asking you" chip `.s-ask` 3.63:1; `.note.ok`, `.success`, `.src-app` 3.02:1; `.src-transactions` 4.48:1. Required 4.5:1.
- Build baseline (ran `npm run build` in a scratch copy): JS 247.34 kB (77.29 kB gzip), CSS 10.89 kB, TypeScript ^7.0.2 with strict + noUnusedLocals + noUnusedParameters (tsconfig.json:9-10): an unused import breaks the build. Budget: stay under about +60 kB gzip.

### 1.3 Production CSP constraints (tested in the browser against the scratch prod build, header api.py:82-85)
Applies whenever uvicorn serves `web/dist` (config.py:35). Results of a live experiment:
| Technique | Result |
|---|---|
| `el.style.width=...`, `style.setProperty('--x')` (what React `style={{}}` does; already used at Mirror.tsx:149-151) | WORKS |
| `document.adoptedStyleSheets` / `CSS.registerProperty` | WORKS (a `CSSTransition` on a registered `<color>` custom property was created, playState running) |
| `setAttribute('style', ...)`, injected `<style>` | BLOCKED (style-src-attr / style-src-elem) |
| `<link>` to Google Fonts | BLOCKED |
| inline `<script>` | BLOCKED (so no FOUC theme bootstrap in index.html) |
| `new SpeechSynthesisUtterance` | fine (not governed by CSP) |
Design consequence: all tokens live in bundled CSS keyed by `data-*` attributes on `<html>`; set with `documentElement.dataset.*` and `style.setProperty`; fonts only self-hosted or system stacks; no inline scripts.
Also available in the demo pane (Chrome 152): View Transitions API, `@property`, container queries, `color-mix`, `light-dark()`. Feature-detect `document.startViewTransition` (older Firefox lacks it). NOT VERIFIED: actual frame-by-frame animation (the pane is throttled), only that transitions are created.

### 1.4 Performance numbers (scratch server, prod mode, 16-thread Ryzen 9 7940HS, other dev servers running)
login 63-125 ms (first call 332 ms); `/me/twin` about 10 ms; `/me/guidance` 8-19 ms; feedback POST 107 ms; advisor brief 17 ms. Population run `run_ms` = 2072, 2384, 3277, 3183, 2904. README says 0.6-1 s (README:119) and the script says "under a second" (README:102). ProductOwner.tsx:87 prints the real `run_ms`, so narration and screen can contradict. Prototype persona SQL over all 100k customers: 91-107 ms.

### 1.5 Copy/AI facts
- Only 9 template strings exist (channels.py:24-40): 3 states x 3 languages, no tone.
- `_gemini` returns None immediately when no key (channels.py:70-71); with a key the HTTP timeout is 15 s per uncached item (channels.py:94), ElevenLabs 30 s (channels.py:110).
- Cache key = (customer, moment, state, lang, channel="app") (channels.py:120-125,128) with no evidence or tone in the key.
- Listen without ElevenLabs: endpoint 503 "Voice channel not configured (set ELEVENLABS_API_KEY)" (api.py:316-317) and the raw string is rendered to the user (Mirror.tsx:227,270). Reproduced in the browser.

### 1.6 Speech synthesis on this machine
- Windows SAPI voices installed (PowerShell): Microsoft Zira en-US, Microsoft Frank nl-NL, Microsoft Bart nl-BE. NO French voice.
- Chromium in the desktop pane exposes only Frank (nl-NL) and Bart (nl-BE).
- Experiment (volume 0): `lang='nl-BE'` picks Bart, `start` fires, 11 `boundary` events (word-level read-along is possible); first boundary came after 3,480 ms for a long first utterance vs 94-608 ms for later short ones (cold start, possibly length related: warm it up). `lang='fr-BE'` and `lang='en-GB'` with no matching voice still START and END with NO error event (default voice is used), so failure is silent and the French text would be spoken by a Dutch voice. You must check `getVoices()` yourself.
- README:104 demo path is "Switch to NL, Listen": works with Bart here. EN and FR Listen would be wrong or silent on this machine. The presenter's actual browser (Edge/Chrome) NOT VERIFIED; check with `speechSynthesis.getVoices().map(v=>v.lang+' '+v.name)`.

## 2. Bugs found that hit the demo (fix first, W0)

| # | Bug | Evidence | Fix |
|---|---|---|---|
| B1 | French ask copy is ungrammatical: "sur la base de un virement à un notaire" | Reproduced: Sofie set to FR, `/me/guidance` returned exactly that. Template channels.py:27 | Use "d'après {evidence}" (prototype SP/copybank_proto.py) |
| B2 | Same error on Marc's (FR, advisor) card: "Sur la base de {why}" | i18n.ts:46 + Mirror.tsx:249; Marc's `why` = "un virement à un notaire, ..." | FR `basedOn`: "D'après {why}." |
| B3 | Stale intro leaks switched-off data: after Sofie turns app data OFF the intro still says "...and a mortgage simulation in the app" while `why` correctly drops it | Reproduced (SP/bk/probe3.py). Cause: cache key has no evidence (channels.py:120-150); `refresh_customer` never invalidates `message_cache` (engine.py:106-116). Contradicts dataNote "we don't read it at all" (i18n.ts:32) | Do not cache template output; cache only LLM text under `channel=f"app:{tone}:{sig}"` with `sig = sha1(state + sorted signal ids)[:8]` (no schema change) |
| B4 | Listen shows "Voice channel not configured (set ELEVENLABS_API_KEY)" to the user | Reproduced in the UI | SpeechSynthesis fallback, section 8 |
| B5 | Login screen leaks dev detail and labels Marc "needs a human" | Login.tsx:52 placeholder "DEMO_PASSWORD from your .env"; Login.tsx:8 | Placeholder "Demo password"; Marc hint "Customer · Liège". In the dock never label Marc with care wording |
| B6 | `<html lang>` always "en" | index.html:2 | `applyUi` sets `document.documentElement.lang = twin.customer.language` |
| B7 | Existing contrast failures | section 1.2 | New tokens in section 5 all pass |
| B8 | Spoken ask script repeats itself ("Are we right? Are you buying a home?") | channels.py:154-155 | voice_script for ask = intro without its closing question + moment.question |

## 3. Persona model

### 3.1 Inputs (all server-side)
From `customers`: age, household_size, region, language, vulnerable (call it `care` internally), consent_app. From the customer's own twin rows (`engine.customer_rows`, engine.py:119-130): top active belief by `priority*confidence` among states act/ask/advisor -> `top_category`, `top_state`. App engagement: `count(app events, 180d)` ONLY if consent_app (consent-filtered like signals, dsl.py:137). Stored overrides (`customer_prefs`). Client device signals (merged in the browser): prefers-reduced-motion, prefers-contrast, viewport width.

### 3.2 Derived axes (`ui` payload, identical keys for everyone)
```ts
type Ui = {
  v: 1;
  layout: "guided" | "studio" | "quick";
  theme: "daylight" | "linen" | "studio" | "pop";
  density: "airy" | "normal" | "compact";
  text_scale: 1 | 1.125 | 1.25;
  motion: "none" | "subtle" | "lively";
  tone: "neutral" | "reassuring" | "direct" | "playful";
  register: "informal" | "formal";
  accent: "housing" | "household" | "family" | "work" | "mobility" | "energy" | "savings" | "other";
  emphasis: "overview" | "question" | "plan" | "human";
  math: "hidden" | "summary" | "full";
  auto: { text_scale: boolean; motion: boolean; detail: boolean; tone: boolean };
};
```
Rules (first match wins; working reference implementation and invariant test in `SP/persona_proto.py`, ran 36,288 input combinations, 0 violations):
1. `care` -> layout guided, theme linen, density airy, text_scale 1.25, motion none, tone reassuring, register formal, math hidden.
2. else `top_category=='work' AND consent_app AND app_events_180d >= 12` (12 = population median, p25 9 / p75 16) -> studio/studio/compact/1.0/subtle/direct/informal/math full.
3. else `age < 30 AND top_category in (household, housing)` -> quick/pop/normal/1.0/lively/playful/informal/math hidden.
4. else guided/daylight/normal/1.0/subtle, tone playful if age<30 else neutral, math summary.
Always: `accent = top_category or "other"`; `emphasis = {advisor:human, act:plan, ask:question, none:overview}[top_state]`.
Then apply customer overrides (enumerations only), then the browser applies device signals (OS reduced-motion forces motion none; prefers-contrast:more switches to a high-contrast token variant).

Golden payloads (prototype output):
- sofie: guided / daylight / normal / 1 / subtle / neutral / informal / accent housing / emphasis question / math summary
- lucas: studio / studio / compact / 1 / subtle / direct / informal / work / plan / full
- marc: guided / linen / airy / 1.25 / none / reassuring / formal / housing / human / hidden
- noor (synthetic 23-year-old moving in): quick / pop / normal / 1 / lively / playful / informal / household / plan / hidden

Population effect (SQL, 100k, SP/bk/persona_sql_probe2.py): preset guided 97.53%, calm 2.00% (= all 2,003 care customers), studio 0.34%, quick 0.12%; per-axis tone: neutral 82,255, playful 15,402, reassuring 2,003, direct 340. Honest note: the rules are hand-written heuristics, not validated with users. The young-mover persona does not exist among the 6 demo users (users list generate.py:350-357): show it via Persona Studio (section 11) or add a 4th customer (needs a regenerate, W13).

### 3.3 Rules that keep it safe (make each one a test)
- S1 `care` is never serialized, named, or logged. `ui` key set is constant across customers (prototype asserts it).
- S2 age/household/region change FORM only (density, tone, ordering, accent, layout); never echoed in copy.
- S3 Every customer-perceivable axis is listed in a "Display and tone" sheet with current value, override, "Reset to auto". The explanation sentence is the same for every customer: "Mirror adapts layout and wording to what we know about you and to your device. You can change every setting here."
- S4 Overrides never reach the engine: `derive()` takes no decision input; test that Marc with prefs {text_scale l, motion none, detail full, tone playful} still gets `type == "advisor"` and no steps (extends test_security.py:155-159, 186-192).
- S5 Behaviour-derived traits only with consent_app; with consent off they are 0/unknown.
- S6 Calm removes nothing the customer may do: "That's right / Not true", consents, language stay (only presentation changes). Do not use age to reduce capability.
- S7 Do not show the residual channel explanation (section 1.1).
- Customer overrides persist in `customer_prefs`; reading/writing only through `/api/me/*` (customer id from the auth record, no IDOR).

## 4. What each persona sees (presets)

| Aspect | guided (Sofie) | studio (Lucas) | calm (Marc) | quick (young mover) |
|---|---|---|---|---|
| Layout | 2 columns >=900px (today), cards, ask card leads | 3 panes: belief table / evidence+math / plan; key-number strip; shortcuts j k y n l ? | 1 column max 640px, ONE card at a time, rest in "Show more" | mobile-first swipe card stack (pointer events), bottom sheet for plan |
| Density/type | 16px base (raise small text to 14), tap 40 | 14px base, tabular-nums/mono numerals, tap 32 | 20px base (x1.25), line-height 1.6, tap 56, min text 16 | 17px base, tap 48 |
| Motion | 240 ms ease-out, meter fills, stagger chips 60 ms | 120 ms linear | none (opacity 120 ms only) | spring 380 ms via `linear()`, `navigator.vibrate(10)` on confirm if supported |
| Theme | daylight + accent by moment | dark studio | linen (warm paper), no red | pop violet/coral |
| Belief math | summary: bar + evidence chips + "+n pts" | full formula and factors, threshold gaps, date scrubber | hidden; words ("a few signs", "fairly sure"); "Show me how sure" link | hidden |
| Tone/register | neutral, informal | direct, number-first, informal | reassuring, formal, no pressure | playful, informal, short |
| Emphasis (from top_state) | question -> big two-button choice | plan -> plan open by default | human -> "Talk to your advisor" primary, Listen prominent | plan |
| Also | what-if consent preview | what-if + timeline | generous whitespace, no percentages by default | confetti-free micro-celebrations |
Language drives copy (EN/NL/FR), date/number locale (`Intl` with en-GB/nl-BE/fr-BE as formatDate already does, i18n.ts:78-81), `<html lang>`, and voice. Region: locale formatting only (optional stretch: city skyline in the hero); do not vary legal wording by region without checking (README:147).
Life moment: `accent` colours the hero/meter/primary button (table in 5.2). Engine confidence: per-card, not per-user (phrasing band low <0.65, mid <0.8, high; emphasis by state; low-confidence cards get hedged wording and the amber treatment). Care never appears as a label anywhere on customer screens, including any "X-ray": the X-ray that lists derived traits lives only in the Advisor and Product Owner roles.

## 5. Design tokens (all contrast pairs computed, SP/contrast.py, SP/contrast2.py; thresholds 4.5:1 text, 7:1 body in calm)

### 5.1 Themes (CSS custom properties on `[data-theme]`)
| Token | daylight (fixed) | linen (calm) | studio (dark) | pop | advisor desk | PO control room |
|---|---|---|---|---|---|---|
| --bg | #f4f6fa | #faf7f2 | #0e1420 | #f3f0ff | #eef1f5 | #0a0f1a |
| --card | #ffffff | #ffffff | #151c2b | #ffffff | #ffffff | #111a2b |
| --ink | #0e1a2b | #1b2430 (14.65) | #e6ecf5 (15.5) | #1d1340 (15.35) | #17212e (14.3) | #e8eef9 (16.45) |
| --ink-2 | #44546a | #3b4756 (8.85) | #b4c0d3 (9.26) | #3a2f66 | #3a4756 | #b8c6e0 |
| --muted | #586981 (5.17, fixes 4.03) | #566273 (5.80) | #8d9bb3 (6.06) | #564c7d (6.87) | #525f70 (5.74) | #8fa0bd (6.57) |
| --accent (default) | #0a52dd (btn 6.43) | #1f5f9e (btn 6.59) | #6aa3ff (6.73, dark text 7.28) | #5b3df5 (btn 6.12), --accent-2 #ff6b4a (dark text 6.11) | #2f4fd8 (btn 6.50) | #3ddc97 (9.85, dark text 9.38) |
| ok ink/soft | #0a7768 / #e3f6f3 (4.87, fixes 3.02) | #0b6b5e / #dff3ee (5.55) | #4ad2b5 on card (9.07) | - | - | #3ddc97 |
| ask ink/soft | #8f5200 / #fff3df (5.67, fixes 3.63) | #8a4b00 / #fdf0d8 (6.04) | #f2b35a on card (9.22) | - | - | #ffc857 (11.3) |
| human ink/soft | #6b46c1 / #f0ebfc (5.50) | #5b3a9e / #ece6f8 (6.78) | - | - | care badge #5b2b9e / #efe6fb (7.61) | - |
| --radius | 14px | 20px | 10px | 24px | 8px | 6px |
Advisor rail: #1c2733 with text #dbe3ee (11.7) and muted #9fb0c6 (6.85).

### 5.2 Accent per moment category (white text on accent / accent on 10% tint, all >=4.5)
housing #b4460f (5.49/4.75), household #b3265a (6.28/5.34), family #25703a (6.07/5.28, #2a7d3f failed 4.49), work #3b4fd1 (6.51/5.59), mobility #0b7285 (5.59/4.86), energy #9a5b00 (5.43/4.75), savings #1c7c54 (5.17/4.52), other #0a52dd (6.43/5.51). In linen/studio the accent only tints the hero/meter; buttons keep the theme accent.

### 5.3 Type, size, motion
| Preset | --fs (base) | small | h1 / h2 / h3 | --tap | --dur | --ease |
|---|---|---|---|---|---|---|
| guided | 16px | 14px | 30 / 20 / 17 | 40px | 240ms | cubic-bezier(.2,.8,.2,1) |
| studio | 14px | 12.5px | 22 / 16 / 14 | 32px | 120ms | linear |
| calm | 20px (16 x 1.25) | 16px | 36 / 26 / 22 | 56px | 0ms | none |
| quick | 17px | 14px | 34 / 22 / 18 | 48px | 380ms | linear(0,.58,.89,1.02,1) spring |
Mechanics: `html { font-size: calc(100% * var(--text-scale, 1)) }` set by `documentElement.style.setProperty('--text-scale', ...)` (verified allowed under CSP); convert the 37 px font-size declarations to rem first. Fonts: system stack (Segoe UI Variable, ui-monospace for numerals). Optional: self-host `@fontsource-variable/inter` (new npm dependency, re-run npm audit, README:137).
Role languages (each a shell with its own chrome, not just a pill):
- Customer: soft cards, generous whitespace, per-preset theme above.
- Advisor "Desk": light grey canvas, dark slate left rail (#1c2733), 13px compact rows (36px), tabular numbers, status pills, keyboard j/k, "/" search, r refresh, right-hand "What {name} sees" phone mirror (section 11).
- Product owner "Control room": dark #0a0f1a, panels #111a2b, green #3ddc97 + blue #5aa0ff + amber, big mono KPI numerals with count-up, pipeline strip (events -> hits -> beliefs -> moments -> messages).
Implementation hooks: `<html data-theme data-role data-density data-motion data-layout>`; optional `@property` registrations for colour morphing (verified a CSSTransition is created under CSP); View Transition for the persona swap.

## 6. API changes (exact)

All changes keep `extra="forbid"`, customer id from the auth record, enumerations only.
1. `GET /api/me/twin` (api.py:207): add `ui: Ui` and `as_of: config.SIM_NOW` (config.py:38; needed to draw timelines relative to the simulated "now"). Helper `_persona_inputs(cid)` selects age/household/vulnerable/consent_app + app count (only if consent) + `engine.customer_rows(cid)` (engine.py:119).
2. `GET /api/me/guidance` (api.py:296): top-level `voice: {provider: "elevenlabs"|"browser"}` (= `bool(config.ELEVENLABS_API_KEY)`), per item: `voice_script` (server-built, `Channels.voice_script`), `confidence`, `tone`, `parts: [{t, k: "fact"|"tone"|"rule"}] | null` (null when an LLM wrote it).
3. `PUT /api/me/preferences` (api.py:256-266): all fields optional, at least one required (model_validator): `language`, `text_scale: auto|s|m|l`, `motion: auto|none|subtle`, `detail: auto|simple|standard|full`, `tone: auto|neutral|reassuring|direct|playful`. Backward compatible with `{language}`. Returns `_twin_payload` (now including `ui`). Existing 422-on-extra behaviour verified (`{"language":"en","theme":"dark"}` -> 422).
4. DB: `customer_prefs(customer_id INTEGER PRIMARY KEY, text_scale VARCHAR, motion VARCHAR, detail VARCHAR, tone VARCHAR, updated_at TIMESTAMP DEFAULT current_timestamp)` appended to `APP_TABLES_SQL` (db.py:62-93). It is created at startup by `ensure_app_tables` (engine.py:36): NO regeneration needed, only an API restart.
5. `moments_rt`: add `category VARCHAR` (engine.py:53-60) so custom moments carry a category for the SQL persona view.
6. Advisor: `GET /api/advisor/customers/{id}/customer-view` -> `{ui, items}` reusing `_guidance_items` (api.py:269) for the assigned customer only (404 otherwise, like api.py:364-370), rate-limited with the `ai` bucket; plus a `conversation` hint in the brief (language, pace "unhurried" when ui.motion none, "no product push" when care) appended to `NOTES` (api.py:351-359). The advisor already sees `care_flag` (api.py:394-396).
7. PO: `GET /api/po/adaptation` -> counts per preset and per axis using the same SQL as single customers (`persona_sql()`, tested 91-107 ms for 100k), cells under K_ANON=10 returned as "<10" via `_k` (engine.py:25-29), no ids/names (respect test_security.py:81). `POST /api/po/simulate-persona` body `{age 18-90, household_size 1-6, language, top_category, top_state, consent_app, app_events, care}` -> `{ui, sample: {text, parts}}`, PO-only, synthetic inputs, rate-limited. Single source of truth: the browser never re-implements derive().
8. No new public endpoint, no token minting, no impersonation (section 9).

## 7. Offline copy generator (`backend/mirror/copybank.py`, prototype in SP/copybank_proto.py)

Design:
- Input `Facts(customer_id, name, lang, state, tone, moment_id, confidence, evidence labels (already localized), steps, signature)`. Enumerated tone and register only; no free text enters a template.
- Bank = slots: GREET[tone][lang] (1-2 variants), BASED_ON[lang] + CLAIM[lang][band] (low/mid/high hedging) + SOFT[tone][lang] (reassurance inside sentence 1), CLOSE[state][tone][lang]; "direct" uses number-first frames ("{name}: 82% zeker op basis van ..., Bevestigen of corrigeren?"). FR uses "d'après" to avoid the elision bug.
- Determinism: variant chosen with `zlib.crc32(customer|moment|state|lang|signature|salt) % len(options)`. Do NOT use Python `hash()` (salted per process, text would change on every restart).
- Sandbox parity with channels.py:42-66: at most 2 sentences, at most 280 chars, no links, no markdown, no emoji, only facts in the input. The bank is unit-tested against those rules over all combinations: prototype generated 5,616 messages across 3 langs x 4 tones x 3 states x 4 confidences x 39 customers, 0 violations (it first FAILED with 3 sentences on the reassuring/ask frame, which is why reassurance moved inside sentence 1: the test earns its place). Honest limit: only 73 distinct strings came out of those 5,616, i.e. 1-2 variants per cell. Variety comes from tone x band x evidence x name; add 2-3 variants per cell if time allows.
- Care invariant: care => tone reassuring; playful never used when state is advisor for a care customer by default (customer may still choose it in the sheet).
- Parts: each message is a list of `(text, kind)` so the UI can highlight "facts from your data / style words / decision words" (the "anatomy" view, section 10).
- Wiring: `Channels.intro(...)` order = LLM (only if a key is configured, tone passed in `facts` and a fixed per-tone style line added to SYSTEM_PROMPT) -> validate (<=2 sentences, <=280 chars, no links, NEW: reject digits/€/% not present in facts) -> bank. `written_by` stays "template" for the bank (test_engine.py:30-33). Because the bank changes greetings, update that test: assert `"Lucas" in intro` and `written_by == "template"` instead of `startswith("Hallo Lucas")` (Lucas is direct: "Lucas: ..."), or keep "Hallo {name}" for neutral.
- LLM safety nets for when a key IS set: lower `timeout` to about 3 s and add a circuit breaker (skip the LLM for 60 s after one failure). Today a dead venue network means up to 15 s per uncached item (channels.py:94).
- Cache: template text is never cached; LLM text under `channel=f"app:{tone}:{sig}"` (fixes B3).

Real prototype output (copy-paste verified, French fixed):
- Sofie/en/neutral/ask 0.82: "Hello Sofie, based on a transfer to a notary and a mortgage simulation in the app, we think this is probably relevant for you. Are we right?"
- Sofie/en/reassuring/ask 0.545: "Hello Sofie, based on ..., we think this might be relevant for you, though nothing changes unless you say so. Is that right?"
- Lucas/nl/direct/ask 0.82: "Lucas: 82% zeker op basis van een inschrijving bij een ondernemingsloket, interesse in een zakelijke rekening en een abonnement op boekhoudsoftware. Bevestigen of corrigeren?"
- Lucas/nl/direct/act: "Lucas: één plan, 3 stappen, allemaal optioneel, op basis van ..."
- Marc/fr/reassuring/ask: "Bonjour Marc, d'après un virement à un notaire et une simulation de crédit hypothécaire dans l'app, nous pensons que ceci vous concerne probablement, mais rien ne change sans votre accord. Est-ce exact ?"
- Marc/fr/reassuring/advisor: "Bonjour Marc, nous aimerions qu'une personne vous aide pour ceci. Votre conseiller peut le parcourir avec vous, au moment qui vous convient."

Micro-copy variants in `i18n.ts` (shape: `T[key][lang]` may be `string | Partial<Record<Tone,string>>`, fallback to neutral). Starter set (needs a native NL/FR proofread):
| key | calm (reassuring) | direct | playful |
|---|---|---|---|
| hello | EN "Hello {name}. Take your time." NL "Dag {name}. Neem gerust de tijd." FR "Bonjour {name}. Prenez votre temps." | "{name} — your overview." / "{name} — jouw overzicht." / "{name} — votre aperçu." | "Hey {name}, let's see what's up." / "Hey {name}, eens kijken wat er speelt." / "Salut {name}, voyons ce qui se passe." |
| heroSub | "This is what we think is going on. You decide what is right." / "Dit denken we dat er speelt. Jij beslist wat klopt." / "Voici ce que nous pensons qu'il se passe. Vous décidez de ce qui est exact." | "Assumptions, evidence, confidence. Correct anything." / "Aannames, bewijs, zekerheid. Corrigeer wat niet klopt." / "Hypothèses, indices, niveau de confiance. Corrigez ce qui ne va pas." | "Here's what we've picked up. Tell us what's off." / "Dit is wat we zagen. Zeg maar wat niet klopt." / "Voici ce que nous avons remarqué. Dites-nous ce qui cloche." |
| yes / no | "Yes, that's right" / "No, that's not right"; "Ja, dat klopt" / "Nee, dat klopt niet"; "Oui, c'est exact" / "Non, ce n'est pas exact" | "Confirm" / "Correct it"; "Bevestig" / "Corrigeer"; "Confirmer" / "Corriger" | "Yes!" / "Nope"; "Jep!" / "Nee hoor"; "Oui !" / "Pas du tout" |
| forYouEmpty | "Nothing needs your attention right now." / "Er is nu niets dat je aandacht vraagt." / "Rien ne demande votre attention pour le moment." | "0 active moments." / "0 actieve momenten." / "0 moment actif." | "All quiet. We'll tap you on the shoulder if that changes." / "Alles rustig. We tikken je aan als dat verandert." / "Tout est calme. Nous vous préviendrons si ça change." |

## 8. Listen button without ElevenLabs (`web/src/voice.ts`)

```ts
type Lang = "en" | "nl" | "fr";
type Engine = "server" | "browser" | "readalong";
const TAGS: Record<Lang, readonly string[]> = { en: ["en-GB", "en-US", "en"], nl: ["nl-BE", "nl-NL", "nl"], fr: ["fr-BE", "fr-FR", "fr"] };
export function voicesReady(): Promise<SpeechSynthesisVoice[]>;           // getVoices(), else wait 'voiceschanged', timeout 1500 ms
export function pickVoice(v: readonly SpeechSynthesisVoice[], lang: Lang): SpeechSynthesisVoice | null; // exact tag, then same primary subtag, else null
export function speak(text: string, lang: Lang, rate: number, cb: { onWord(i: number): void; onEnd(): void }): { cancel(): void };
```
Flow on click: if `guidance.voice.provider === "elevenlabs"` use the existing blob path (Mirror.tsx:213-229); on 502/503 fall through. Else `pickVoice`; if a voice exists, speak `item.voice_script` in sentence chunks (defensive: long remote-voice utterances are reported to cut off, NOT reproduced here), highlight words from `boundary` events. If NO voice for the language: do not speak (silent wrong-language output was reproduced); run the same read-along highlight on a timer (about 15 chars/s, slower for calm) and show "Audio for French isn't available on this device; showing read-along." Never render raw backend error text. Rate: calm 0.9, neutral 1.0, direct 1.05, playful 1.1.
Pre-warm on the login click (volume-0 utterance) to avoid the observed multi-second cold start. Security: the client only speaks text the server built for an active decision (same guarantee as README:136); there is no endpoint that accepts arbitrary text.
Demo machine action: install a French (and confirm English) voice in Windows Settings > Time & language > Speech, or test in Edge. Until then rehearse Listen in NL only (README:104) and use the read-along for FR/EN.

## 9. One-click persona switcher: "Demo Deck" (client-side multi-session)

Decision table:
| Option | Verdict |
|---|---|
| A. Client keeps 5 real sessions in memory, swaps the active one | CHOSEN: zero new server capability |
| B. Server endpoint minting tokens for another user (even env-gated) | REJECTED: an authz-bypass primitive in an app built for an IDOR/authn/authz audit (README:5-8, api.py:1-11); one wrong env var on Cloud Run makes it a critical finding |
| C. 3 browser windows/profiles, each logged in | CONTINGENCY, zero code |
| D. Fixture mode (`?fixtures=1`, recorded payloads through the same `Api` interface) | SAFETY NET if the backend dies on stage |

Design:
- Flag: `VITE_DEMO_DECK=1` in git-ignored `web/.env.local` (`.gitignore` already ignores `.env.*`); code path tree-shaken otherwise.
- Login screen: extra button "Start demo deck": the password is typed once, `Promise.allSettled` logs in sofie, lucas, marc, an, po via the existing `/auth/login` (5 logins about 0.6 s total; limits login_ip 30/60 s, login_user 10/60 s per ip+user, security.py:97-104), the input is cleared immediately, tokens go in a module-scoped `Map` (memory only, like api.ts:1-3), nothing in storage. `expires_in` (api.py:166) is kept as `expiresAt`; token TTL is 60 min (config.py:46).
- Refactor (this is the actual safety work): replace the global token/handler (api.ts:4-9, 33; App.tsx:14-19) by `makeApi(getToken, onUnauthorized): Api` and a `SessionProvider`; every role view gets `key={username}`:
```tsx
export type Api = { get<T>(p: string): Promise<T>; send<T>(p: string, m: "POST" | "PUT" | "DELETE", b?: unknown): Promise<T>; blob(p: string): Promise<Blob> };
const switchTo = (u: DeckUser) => {
  const run = () => flushSync(() => setActive(u));
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) run();
  else document.startViewTransition(run);
};
// <RoleView key={active.username} />  // no state bleed between personas
```
  Without `key`, the same `<Mirror />` instance survives a Sofie->Lucas switch (App.tsx:53), showing Sofie's twin under Lucas until the next load resolves and letting `mutate()` (Mirror.tsx:31-41) reload with the wrong token.
- Per-session 401: mark only that persona expired, dock chip shows "sign in again"; do not log everyone out.
- Persona dock: fixed bottom pill with chips S L M A P (labels neutral: "Marc · Liège", never care wording; fixes B5), keys 1-5 (ignored inside inputs), `role="tablist"` + `aria-live` announcing "Now viewing Sofie, customer".
- Prefetch `/me/twin` + `/me/guidance` for the 3 customers at deck start (about 10 ms each) so a switch only renders; invalidate a persona's cache on its own mutation. Do NOT prefetch while the PO run is in flight: a run takes `db.lock` for 2-3 s (engine.py:96-104, db.py:29) and every request stalls.
- Reload protection: `beforeunload` handler while a deck is active (README:144 says reload logs you out), and demo from `npm run build` served by uvicorn (`MIRROR_WEB_DIST`) instead of Vite dev. Verified: the production build serves and works under CSP, including the login and the inline-width meter.
- Security review: no new server surface; each token is exactly as powerful as that user (roles read from the DB per request, api.py:111-138); rate limits unchanged; blast radius of an XSS grows (PO + advisor + customer tokens in one heap) but CSP `default-src 'self'` (api.py:82-85) blocks inline and third-party script (verified); the demo password is shared by all users anyway (generate.py:360-362) so the deck exposes no new credential; logout clears the Map.
- Split Stage (optional, 1.5 h): left a phone frame with Sofie, right the advisor desk with An, each using its own `Api`; a tiny `EventTarget` bus fires after any mutation so the advisor pane refetches and flashes the changed row: "Not true" -> gone on the advisor side instantly, in one window (README:106).
- Multi-window fallback: `BroadcastChannel("mirror-demo")` carrying only `{type:"changed"}` (no tokens) so separate windows refetch with their own tokens.

## 10. Making the algorithm visible (client-only, from existing fields)

Noisy-OR verified against the server numbers (engine output vs hand formula): Sofie buying_home `1-(1-.60)(1-.50)(1-.10)=0.82`; growing_family `1-(.65)(.70)=0.545`; Lucas `1-(.45)(.55)(.65)=0.839`; Marc `1-(.4)(.5)(.7)(.9)=0.874` (dsl.py:200). Evidence arrives sorted by weight desc (engine.py:123).
1. `Fusion` ("doubt burn-down"): one bar, each evidence animates confidence from c(i-1) to c(i)=1-prod(1-w) with "+n pts" labels and ask/act ticks (thresholds in payload, engine.py:162). Sofie: 60 -> 80 -> 82, "3 points short of a plan (0.85)". When the customer clicks "Yes" the server sets confidence 1.0 (dsl.py:213): animate the jump to 100% and morph the ask card into the 3-step plan card (View Transition). Assert `abs(c(n)-inferred) < 0.002` in dev, otherwise show the server value. Rejected beliefs have `evidence: []` (engine.py:163): show only "You said this isn't true".
2. Per preset: calm = 3 dots + words, guided = bar + chips, studio = formula line `1 - (1-0.60)(1-0.50)(1-0.10) = 0.820` with hover-linked factors and "need +0.03 for act".
3. What-if consent preview (client math mirroring the SQL): removing all `source==='app'` evidence for Sofie gives `1-(.4)(.9)=0.64` (still ask); removing transactions gives `0.55` (< ask 0.6, the belief becomes wait; matches the assertion at test_security.py:151); removing both leaves no behavioural signal so the belief disappears (dsl.py:205). Show "Switching this off would lower Buying a home from 82% to 64%" beside each consent toggle (Mirror.tsx:92-107). Label approximate (ignores fatigue/guardrails).
4. Timeline scrubber (studio): sort evidence by `last_seen` ascending and recompute cumulative confidence (Sofie: mortgage sim 2 Sep 0.50, notary 10 Sep 0.80, profile 0.82). Label "by date of last signal"; a precise version needs `first_seen` in `signal_hits`, which requires a population rerun after a migration (engine.py:115 uses INSERT BY NAME), so skip for today.
5. Gate ribbon (optional): the twin_sql CASE order (dsl.py:223-231 plus fatigue cap MAX_ACTIVE=2, config.py:42) as identical-for-everyone plain-language checks: your answer, enough evidence, age rule, "a person should handle it", plan vs question, not too many at once. The care gate is folded into the neutral "checks that protect you" so no customer sees a special label.
6. Anatomy of a message (from `parts`): facts (blue) / style words (violet) / decision words (green), legend "Rules decide. Words are assembled from your facts." If `parts` is null: "Written by AI from these facts: [chips]". With the offline bank the card must not claim AI (today `ai-note` only shows for `llm`, Mirror.tsx:271): for bank text show "Written from your facts, no AI call".
7. PO: pipeline strip with count-up numerals; animate while the request is pending then snap to the server numbers; do not fake the duration (measured 2.1-3.3 s here).

## 11. Role experiences and PO tooling

- Customer: presets above; new `ComfortSheet` ("Display and tone": text size S/M/L, motion, detail, tone, Reset to auto, language) reachable from the topbar; same explanatory sentence for all (S3); "Your details" read-only card (language, city, household size) with "Not right? Talk to us" (demo) if time allows.
- Advisor Desk: rail + brief + "What {first_name} sees" phone mirror via `customer-view`; "X-ray" panel listing derived axes and the rule that fired (allowed here; the advisor already sees the care badge, Advisor.tsx:86); suggested conversation style in plain words.
- Product owner Control room: `adaptation` matrix ("100,000 customers, 4 renderings, N tones"), k-anonymised; "Persona Studio": sliders (age, household, language, moment, state, care) call `simulate-persona` and render the real themed sample card with the real bank copy in a phone frame. This is how the young mover and the care persona are shown without touching real customers and without a 4th demo user.

## 12. Work items (each 1-2 h). Order = priority.

| ID | Item | Files | Est. | Acceptance |
|---|---|---|---|---|
| W0 | Fix B1-B6, B8 (FR grammar x2, cache key, Listen error text, login placeholder/label, html lang) | channels.py, i18n.ts, Mirror.tsx, Login.tsx | 0.75 h | Sofie in FR shows "d'après"; toggle app consent off then intro no longer mentions app; no raw ELEVENLABS text |
| W1 | SpeechSynthesis fallback + `voice_script` + read-along | voice.ts (new), Mirror.tsx, api.py, channels.py | 1.5 h | NL Listen speaks with Bart; FR/EN with no voice shows read-along and a notice; no error event leaks |
| W2 | Demo Deck: `makeApi` + `SessionProvider` + keyed views + dock + view transition + beforeunload | api.ts, App.tsx, Login.tsx, session.tsx, deck/* | 2 h | 5 logins once; keys 1-5 switch under 100 ms with prefetch; no stale data after rapid switching; per-session 401 |
| W3 | `persona.py` + `customer_prefs` + `ui` in twin + prefs endpoint + tests | persona.py (new), api.py, db.py, engine.py | 1.5 h | golden payloads above; no care leakage test; overrides do not change decisions |
| W4 | Token system: px->rem, `data-*` themes, `applyUi`, device signals, role shells | styles.css, theme/*, App.tsx | 2 h | 4 themes + 2 role shells; contrast table holds; no `<style>`/inline script; build passes |
| W5 | `Fusion` + what-if preview | components/Fusion.tsx, WhatIf.tsx | 1.5 h | numbers equal server to 3 decimals for all 4 demo beliefs |
| W6 | `copybank.py` + tone plumbing + i18n micro-copy + tests (+ LLM timeout/circuit breaker) | copybank.py, channels.py, i18n.ts, tests | 2 h | all combos pass sandbox rules; deterministic across restarts; test_engine.py:30-33 updated |
| W7 | Calm layout: one column, one card at a time, accordion, 56px targets, ComfortSheet | Mirror.tsx, components/ComfortSheet.tsx, css | 1.5 h | Marc shows 20px text, no percentages by default, still has Right/Not true |
| W8 | Studio layout: table + formula + shortcuts + timeline | views/mirror/Studio.tsx | 2 h | Lucas (NL) dense dark view, j/k/y/n/l work |
| W9 | Advisor Desk skin + customer-view + X-ray + Split Stage | Advisor.tsx, api.py, deck/SplitStage.tsx | 2 h | Not true in left pane updates right pane at once |
| W10 | PO Control room skin + adaptation matrix + Persona Studio | ProductOwner.tsx, api.py | 2 h | matrix cells under 10 show "<10"; no names/ids |
| W11 | Quick layout (swipe stack) | views/mirror/Quick.tsx | 1.5 h | visible only via Persona Studio/fixtures |
| W12 | Anatomy of message + gate ribbon | components/Anatomy.tsx | 1 h | legend correct for bank and LLM text |
| W13 | Optional: 4th demo customer "noor" (generate.py demo dict + users row), fixtures mode, BroadcastChannel | generate.py, api.mock.ts | 1.5 h | requires stopping the API and regenerating (about 25 s) |

Cut lines: with about 3 h do W0 + W1 + W2 + the theme subset of W4 (daylight, linen, studio) + W5. With about 6 h add W3, W6, W7, W9. Everything else is polish. Do not merge W13's regeneration within the last hour before the demo.

## 13. Test plan (pytest + manual)

- test_persona.py: golden `ui` for sofie/lucas/marc; constant key set for all customers; recursive scan of every `/api/me/*` response for "vulnerable|care|flag"; care customer gets reassuring + motion none + math hidden before overrides; prefs on Marc do not change guidance type or steps; `PrefsIn` rejects extra/invalid; empty body rejected.
- test_copybank.py: every (lang, tone, state, band) renders, at most 2 sentences, at most 280 chars, no link/markdown/emoji, contains the name, deterministic across two subprocess runs; regression for B3 (consent off -> intro has no app signal) and B1.
- test_security additions: advisor `customer-view` 404 for not-assigned; PO `adaptation` has no `first_name`/`customer_id` and hides <10.
- Update test_engine.py:33 (greeting prefix).
- Manual: `npm run build` (strict TS), run under prod CSP, rehearse switching 50 times quickly, check DevTools for CSP violations, test with OS reduced motion on, test at 125% zoom and 375 px width, run an axe scan.

## 14. Open questions for the team

1. Which stack is the demo on: Vite dev (5173/5174 are both running) or uvicorn serving `web/dist`? Four local servers are up (8000, 8001, 5173, 5174); confirm which one the demo uses and which DB file each one holds.
2. Presenter browser (Chrome or Edge) and are French/English voices installed? (Only nl voices exist here.)
3. How much time is left today? (decides the cut line above)
4. OK to regenerate the database (kills the current feedback state, needed only for W13)?
5. Who proofreads the NL and FR bank and micro-copy?
6. Is any KBC brand guidance binding? The palette here is neutral Mirror styling, not KBC branding.

## 15. Scratch artifacts (all in SP; nothing inside the project root was changed)
`copybank_proto.py` (bank + sandbox validator), `persona_proto.py` (derive + invariants), `contrast.py` / `contrast2.py` / `contrast3.py`, `bk/persona_sql_probe2.py` (population SQL), `bk/probe1-4.py`, `timing.py` / `timing2.py`, scratch DB `bk/data/mirror.duckdb`, scratch web build `web/dist`. I stopped only my own scratch server (port 8765); I did not touch 8000, 8001, 5173, 5174, and only read text (no clicks) from the page on 5174.


## RISKS
- Live database could not be copied (Windows exclusive lock held by the running API); all population numbers come from a regenerated scratch copy (seed 42, 100k, 6,116,388 events, matches README). Live feedback/consent edits made since generation are not reflected.
- Verified privacy bug B3: message_cache key has no evidence/tone (channels.py:120-150), so after a customer switches app data off the intro still names the app signal while the README promises the data is not read. Fix before demoing consent toggles.
- Verified visible French error: 'sur la base de un virement...' in the FR ask template (channels.py:27) and 'Sur la base de ...' on Marc's card (i18n.ts:46, Mirror.tsx:249). Marc is the FR demo user.
- Listen currently shows the raw dev message 'Voice channel not configured (set ELEVENLABS_API_KEY)'. On this machine no French voice exists (SAPI: en-US, nl-NL, nl-BE only; Chromium pane only nl-NL, nl-BE). With lang fr-BE/en-GB and no matching voice Chromium still speaks with a default voice and raises no error, so a naive fallback would read French in a Dutch voice. English/French voices on the presenter's real browser NOT VERIFIED.
- README/demo narration says the population run is 'under a second' (README:102,119) but I measured run_ms 2072-3277 ms across 5 runs on this machine while other dev servers were running. The UI prints the real number; rehearse on an idle machine or change the narration. Also the run holds the single DB lock so all requests stall during it.
- Prod CSP (api.py:82-85) verified to block inline <style>, style attributes, Google Fonts links and inline scripts; allows CSSOM style changes, adoptedStyleSheets and registerProperty. Any design that relies on an inline theme bootstrap or web fonts from a CDN will silently break on the prod build.
- Persona switcher safety: current code has a global token (api.ts:4), a global 401 logout (App.tsx:14-19) and an unkeyed <Mirror /> (App.tsx:53). A naive switcher would leak Sofie's data into Lucas's view or log everyone out. Needs makeApi/SessionProvider + key={username}. A server-side impersonation endpoint was rejected because it would be the top finding in an authz audit.
- Deck keeps customer, advisor and PO tokens in one JS heap; acceptable only because the demo password is shared by all users anyway (generate.py:360-362) and CSP blocks third-party script; keep it behind a build-time flag and never persist tokens. Vite HMR or F5 wipes the in-memory tokens (README:144): demo from the production build and add a beforeunload guard.
- Residual inference channel: state 'advisor' occurs only for vulnerable customers (dsl.py:227; 45 of 45 in the population). The customer already sees 'With your advisor'. Any new UI text that explains why, any layout keyed visibly to it, or any ui field that only care customers have would effectively label them. The design keeps an identical ui key set and a persona-independent explanation sentence, but a transparency/GDPR reviewer may still ask about it.
- Never derive care from age: vulnerable is an independent 2% random flag in the data (generate.py:241; 234 of 11,692 people aged 65+ are flagged, the same 2%). Age is only used for tone/quick-layout; customers can override tone, text size, motion and detail.
- The persona rules are hand-written heuristics on synthetic data, not validated with users; on the 100k population 97.5% land in the default preset, 2.0% calm, 0.34% studio, 0.12% quick. The young-mover persona has no demo login; show it via Persona Studio or add a 4th customer (requires regeneration).
- Existing UI fails WCAG AA in several places (measured: Plan-ready chip 3.02:1, ask chip 3.63:1, muted text 4.03:1, 11-13px text dominant, 32px touch targets). The proposed tokens all pass (computed) but text scaling needs a px->rem migration of 37 font-size declarations first.
- Changing the copy bank will break test_engine.py:30-33 (expects 'Hallo Lucas' and template source). The bank prototype's first version violated the 2-sentence rule (caught by its validator); the real module needs that test in CI. Only 73 distinct strings came out of 5,616 generated messages, so variety is thin unless more variants per cell are written; NL/FR text needs a native proofread.
- Gemini/ElevenLabs paths are untested with real keys (README:142). If a key is set and the venue network is down, each uncached guidance item blocks up to 15 s (channels.py:94) and TTS 30 s (channels.py:110). Add a short timeout and circuit breaker, or leave keys unset on stage. With no key the UI correctly says nothing about AI; do not claim AI wrote today's text.
- Animations (View Transitions, @property colour morph, count-up, swipe) were NOT verified frame by frame: the browser pane is throttled. Only API availability and creation of a CSSTransition under CSP were verified. Rehearse on the real projector machine.
- Multiple parallel dev stacks are running (API 8000 and 8001, Vite 5173 and 5174, another agent's Sofie session open on 5174). Mutating demo state (feedback, consents, language) from any of them changes what the presenter sees; confirm the single stack and reset state (regenerate) before going on stage.
- TypeScript ^7.0.2 with strict + noUnusedLocals means any unused import or variable fails `npm run build` (the prod path); run the build after every work item, not only at the end.