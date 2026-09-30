# Mirror

**KBC case, Tectonic Hackathon 2026.** A proof of concept for a new way a bank understands, supports and guides its customers.

> Kate already knows 140+ situations, and each one was built by hand. That can't scale to 2.3 million different lives.
> Mirror is what comes after situation 140: **one shared understanding of each customer, which the customer can see and correct**,
> **one decision engine for every product and channel**, and **new moments added as data, not features**.

## The idea in 30 seconds

| | Today | Mirror |
|---|---|---|
| Who defines what matters | Each product team, separately | One shared model per customer |
| What the customer sees | Offers | *What the bank believes about them*, with reasons and confidence |
| When the bank is unsure | It guesses (or stays silent) | It **asks** one question |
| When the customer says "that's wrong" | Nothing changes | The belief is gone **everywhere**: app, voice, advisor |
| Adding a new situation | A new feature / campaign | A validated JSON/YAML definition, live for everyone in under a second |
| Where AI is used | Everywhere, or nowhere | Rules decide for everyone; AI only *writes the words* for the ~3% where a moment fired |

**The AI writes, the rules decide.** Consent, suitability and care guardrails are enforced by the engine on the server,
not by the AI and not by the UI.

## What's in the box

```
backend/
  mirror/generate.py   synthetic population: customers, 6 months of transactions + app events,
                       hidden life events (with ground truth) and deliberate confounders
  mirror/dsl.py        the moment language + compiler to parameterized SQL (no user-written SQL, ever)
  mirror/engine.py     signals -> beliefs (noisy-OR) -> decisions (act / ask / advisor / wait)
                       same SQL for 1 customer or the whole population; quality metrics vs ground truth
  mirror/channels.py   app card, voice script (ElevenLabs), advisor brief; optional Gemini intro with fallback
  mirror/api.py        FastAPI: customer (/me), advisor (assigned only), product owner (aggregates only)
  mirror/security.py   scrypt passwords, pinned-algorithm JWT, rate limiting
  moments/*.yaml       4 built-in moments (home, moving in, family, freelance)
  examples/ev_purchase.json   the moment you add live in the demo
  tests/               22 tests: IDOR, role separation, forged tokens, injection, consent, guardrails
web/                   React + Vite: customer "Mirror", advisor desk, product owner console
Dockerfile             single container for Google Cloud Run
```

```
 events (6.1M) ──► signal rules (SQL, consent-filtered) ──► beliefs per customer ──► decision policy ──► channels
                     cheap, runs on everyone                 + customer feedback      thresholds          app / voice / advisor
                                                                                       guardrails          AI writes intro only
                                                                                       fatigue cap         (lazy + cached)
```

## Run it

Requirements: Python 3.10+ (tested on 3.10 and 3.11), Node 20+.

```bash
cp .env.example .env            # Windows: copy .env.example .env
# edit .env: set DEMO_PASSWORD and MIRROR_JWT_SECRET (32+ chars)

cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m mirror.generate --customers 100000             # ~25 s, writes backend/data/mirror.duckdb
uvicorn mirror.api:app --port 8000                       # API on http://localhost:8000 (docs: /api/docs)

# second terminal
cd web
npm install
npm run dev                                              # open http://localhost:5173
```

Tests: `cd backend && pytest -q` (builds its own small population, about 5 s).

Optional: set `GEMINI_API_KEY` (or `GOOGLE_CLOUD_PROJECT` + `pip install -r requirements-vertex.txt`) for AI-written intros,
and `ELEVENLABS_API_KEY` for the voice channel. Without them everything works with templates, and the Listen button says voice isn't configured.

To regenerate a clean demo state, stop the API and run the generator again.

### Deploy on Cloud Run (optional)

```bash
gcloud run deploy mirror --source . --region europe-west1 --memory 2Gi --allow-unauthenticated \
  --set-env-vars "MIRROR_JWT_SECRET=<32+ random chars>,DEMO_PASSWORD=<password>,MIRROR_CUSTOMERS=100000"
```

The container generates the synthetic population on start, runs as a non-root user and hides `/api/docs` (`MIRROR_ENV=prod`).
For anything beyond a demo, put the secrets in Secret Manager instead of env vars.

### Reset the demo to a clean state

Stop the API first (the database file is locked while it runs), then:

```bash
cd backend
python reset_demo.py --verify     # regenerates the 100k population (~20 s) and checks the demo numbers
cd ../web && npm run build        # production build, served by the API on :8000 (real CSP)
cd ../backend && uvicorn mirror.api:app --port 8000
```

`--verify` asserts Sofie 0.82 / 0.545 (ask), Lucas 0.839 (act), Marc 0.874 (advisor, even after confirming) and that `jan` cannot open Sofie.

## Making the algorithm visible

- **Watch Mirror think** (customer view): a replay of how evidence arrived, computed by the real engine SQL. Signals light up, the doubt bar shrinks by `(1 - weight)` per signal, the ask/act thresholds and the guardrail/fatigue gates are shown, and a plain-language sentence explains the decision in EN/NL/FR.
- **What-if**: switch a data source off, remove a signal, change the cap. Read-only and reduce-only (it can never read data the customer switched off); the screen shows "engine-verified" when the server agrees.
- **Why not?**: for a moment that did not fire, the smallest verified evidence that would change the answer.
- **Belief web**: signals -> belief -> decision -> app / voice / advisor. "Not true" severs the belief across all channels.
- **Population galaxy** (product owner): 100,000 pixels, one per customer, grouped by moment, with precision/recall against synthetic ground truth and a threshold slider. Built from aggregate counts only; small cells are hidden or rounded.
- **Adapts to who you are**: the server derives a display persona from the customer's age, household, language and situation (calm, large type and no percentages for Marc; dense studio view for Lucas). Advisors and product owners get their own visual language. The care flag is never shown to the customer. Offline per-persona copy in EN/NL/FR works without any API key, and Listen falls back to browser speech.
- **Demo Deck**: on the login screen type the password once and press *Start demo deck*. Six sessions are kept in memory (nothing is stored), switch user with one click or keys 1-6. Press 1-6 once before presenting to warm every view.

## Demo users

All use `DEMO_PASSWORD`.

| User | Role | What they show |
|---|---|---|
| `sofie` | customer | Buying a home (82%, asked, not assumed) + a wrong guess "growing family" (toy and baby shop purchases are gifts for her nephew) |
| `lucas` | customer | Going freelance, confident enough for a plan (in Dutch) |
| `marc` | customer | Buying a home, but flagged for care: routed to a human, never an automated offer, even if he confirms |
| `an` | advisor | Sofie and Marc's advisor: sees the same decisions, including Sofie's corrections |
| `jan` | advisor | A different advisor: cannot open Sofie (404) |
| `po` | product owner | Population view, quality metrics, adding a moment live. Never sees names |

## 3-minute demo script

1. **0:00 Problem.** 140 hand-built situations vs 2.3M lives, each product guessing on its own.
2. **0:20 `po`: Run on all customers.** 100k customers, 6.1M events, a few seconds (the screen shows the measured time). The population galaxy shows every customer as a pixel. AI is only needed for ~3%.
3. **0:50 `sofie`.** Mirror shows what KBC believes and why. It is 82% sure she is buying a home, so it **asks**. She says yes, and one plan appears (mortgage, insurance from key handover, EPC check) instead of three ads.
   She sees "growing family, 55%, from toy shop purchases", clicks **Not true**, and it disappears everywhere. Switch to **NL**, press **Listen**.
4. **1:50 `an`.** Same decisions on the advisor desk: "confirmed", "the customer said this is not true, don't bring it up". Marc is routed to her because of the care flag.
5. **2:15 `po`: Validate & go live** with the electric-car moment. Reach, precision and recall appear for 100k customers. No new screens, no campaign.
6. **2:40 Close.** Vision + security by design + what 2.3M would take.

## Results on the synthetic population (seed 42, 100,000 customers)

| Moment | Precision (when asking) | Precision (when acting) | Recall |
|---|---|---|---|
| Buying a home | 94% | 100% | 63% |
| Starting as a freelancer | 87% | 100% | 50% |
| A growing family | 46% | 100% | 50% |
| Moving in together | 83% | 100% | 15% |
| A new electric car (added live) | 100% | 100% | 27% |

A full run takes roughly 2 to 4 s in our test environment (the product owner screen shows the measured time, so don't promise "under a second"). 2.5% of customers get a message (2.9% after adding the electric-car moment); the rest need no AI call.

**Read these honestly.** The data is synthetic, and we planted the life events ourselves. These numbers show that the pipeline works
and measures itself, *not* how accurate it would be on real KBC data. They do show the design choice: ambiguous moments
(growing family) get asked, never assumed, and the engine only shows a plan without asking when it is very sure.

## Security design

What we built for the Aikido audit (IDOR, authentication, authorization, business logic):

- **No IDOR by construction.** Customers only use `/api/me/*`; the customer id comes from the authenticated user record, never from the URL or body. Unknown fields are rejected (`extra="forbid"`).
- **Advisors** only see customers assigned to them; everything else returns 404, so ids can't be probed.
- **Product owners** see aggregates only; counts under 10 are hidden. No names or ids in any product owner response.
- **Roles are read from the database on every request**, not trusted from the token. JWTs are HS256 with a pinned algorithm (no `none`), plus expiry and issuer checks.
- **Passwords**: scrypt with a per-user salt, constant-time compare, identical errors for unknown users (timing-safe dummy hash), and rate-limited login.
- **Moment definitions are data, not code.** Strict schema; identifiers come from whitelists; every value is a bound SQL parameter. There's a test that tries SQL injection through the definition.
- **Consent is enforced in the query**: switched-off data is never read. **Guardrails run after customer confirmation**, so confirming can't bypass the care flag (tested).
- **AI is sandboxed.** It gets structured facts only (never customer free text), writes at most 2 sentences, is rejected if its output contains links, and never decides eligibility. The voice endpoint only speaks text the server built for an active decision.
- **Other hardening**: security headers + CSP, no stack traces in errors, CORS allow-list, docs off in prod, secrets only from env, synthetic data only, and dependency versions pinned with `npm audit` clean.

## What's not finished (honest list)

- **The data is synthetic.** Real signals would come from KBC event streams. The engine design (same SQL for one customer or all) is meant for a warehouse or streaming SQL engine, but we have only run it on DuckDB.
- **The Gemini and ElevenLabs paths haven't been tested with real keys in this repo.** They fall back to templates if a call fails.
- **Rate limiting is per process and in memory.** Use a shared store (e.g. Redis) when running more than one instance.
- **Tokens can't be revoked before they expire (60 min).** The token lives in memory in the browser, so a reload logs you out.
- **"Talk to your advisor" is demo-only.** It doesn't create an appointment.
- **Not built yet: discovery.** The idea is to mine event sequences that precede product needs and propose them as new moments to product teams, so the system finds situation #141 itself.
- **The EPC renovation example is illustrative.** Check the current Flemish rules before relying on it.
