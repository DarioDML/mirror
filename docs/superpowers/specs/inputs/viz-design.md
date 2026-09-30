# Mirror visualization design spec (read-only investigation, nothing in the project root was touched)

## 0. Evidence base (what "verified" means here)
- The live `backend/data/mirror.duckdb` and its `.wal` are locked by the running server (copy failed: "being used by another process"), so I generated a scratch population with the project's own `generate.py` (seed 42, 100,000 customers, 6,116,388 events) and ran the real `Engine` on it, using a stub config so `.env` was never read and no `.pyc` was written into the project.
- The scratch numbers reproduce the README: precision 94.3/86.5/45.6/82.8 % and recall 63.0/50.4/50.3/15.0 % for home/freelance/family/moving; after adding EV, precision 99.8 %, recall 26.5 %, 2.91 % of customers get a message.
- Reference prototypes (not in the project): `scratchpad/viz/proto.py` (read-only what-if + contributions), `replay.py` (timeline and frames), `cf.py` (counterfactual), `galaxy.py`, `opp.py`, `nearmiss.py`, `preview.py`, `conc.py`, `web/probes/*` (bundle probes), `csp/` (CSP test pages).
- VERIFIED means I ran it. DESIGNED means not run (marked).

## 1. Facts about the current code that shape the design
1. `events.ts` is a DATE (`generate.py:333-337`) and there is no event id. The "stream" can only be a day-resolution replay. Signal-relevant events are 2.37 % of all events (12 (source, kind) pairs). Per customer, with any: p50 = 2, p99 = 8, max = 18 events and 18 distinct dates.
2. `compile_hits` (`dsl.py:140-187`) enforces consent in SQL (`:163`). The window is `e.ts > now - within_days` (`:164`) with NO upper bound. VERIFIED: with `now=2026-08-01`, Sofie still gets events dated 2026-09-18. Time travel needs `AND e.ts <= CAST($now AS DATE)`. This is a no-op for the population run because all events are <= SIM_NOW.
3. `twin_sql` (`dsl.py:190-242`): noisy-OR at `:200`, the `behav > 0` guard at `:205` (a belief needs >= 1 behavioural signal), state CASE at `:223-231`, fatigue at `:233-240`. Table names are hard-wired: `feedback` (`:206`), `moments_rt` (`:207`, `:219`), `customers` (`:162`, `:182`, `:220`). That is the only reason a what-if cannot reuse it without writing. The final SELECT (`:239`) drops `rk` and there is no "which rule decided" column.
4. `twin` columns today: customer_id, moment_id, confidence, inferred, feedback, evidence, priority, ask_t, act_t, state.
5. The guardrail and fatigue demo problem. Ages are clipped to >= 18 (`generate.py:229`): VERIFIED 0 customers under 18 and `blocked_guardrail` = 0 rows, so the min_age guardrail never fires. Fatigue fires for exactly 1 customer in 100k (customer 18492 in seed 42; shown as "<10" in the PO UI). Only the care flag visibly fires (45 customers route to `advisor`). Both guardrail and fatigue therefore need what-if controls to be visible.
6. Channel semantics are implicit in three places: guidance = act/ask/advisor only (`api.py:275`), voice = only items from `_guidance_items` (`api.py:302-318`), advisor brief hides `wait` without feedback and blanks talking points for `suppressed_feedback` (`api.py:376`, `:385`). `beliefs()` returns `evidence: []` for rejected (`engine.py:163`).
7. All DB access goes through one connection guarded by an RLock (`db.py:29`, `:35-39`), and `run_population` holds it for the whole run (`engine.py:96-104`).
8. There is no dark theme, no `prefers-reduced-motion`, no `aria-live` and only one media query in `web/src/styles.css` (grep). `api.ts:24-49` has no AbortSignal. No router: views are chosen by role in `App.tsx:52-56`.

## 2. Backend changes (contract first; every item 1-2 h)

### B1 `dsl.py` parameterise relations + as-of bound (1 h) [VERIFIED by prototype, patch applied via string replace]
```python
def compile_hits(moments, customer_filter, *, customers: str = "customers")
#  :162 JOIN {customers} c   :182 FROM {customers} c WHERE
#  :164 "AND e.ts <= CAST($now AS DATE) AND e.ts > CAST($now AS DATE) - CAST(${p}_days AS INTEGER){amount}{cf} "
def twin_sql(hits_from, customer_filter, *, feedback="feedback", customers="customers", moments="moments_rt")
#  :206 FROM {feedback}   :207 and :219 {moments}   :220 JOIN {customers} c
```
Relation arguments are server-built subqueries or VALUES with bound params, never user text. With them, a what-if is one read-only SELECT. Relations used: `customers` = `(SELECT customer_id, age, region, household_size, $ov_v AS vulnerable, $ov_ct AS consent_transactions, $ov_ca AS consent_app FROM customers WHERE customer_id=$cid)`, `feedback` = `(VALUES ...)` or a typed empty select, `moments_rt` = `(VALUES ...)` built from in-memory Moment copies (weights, removed signals and thresholds are just a modified Moment passed to compile_hits).

### B2 `gate`, `rk`, `score` columns: single source of truth for "which rule decided" (1 h) [DESIGNED, mechanical transform of `dsl.py:223-240`]
```sql
s AS (SELECT *, CASE WHEN feedback='rejected' THEN 'rejected' WHEN confidence<ask_t THEN 'below_ask'
   WHEN age<min_age THEN 'min_age' WHEN vulnerable AND vulnerable_policy='advisor' THEN 'care_advisor'
   WHEN vulnerable THEN 'care_suppress' WHEN confidence>=act_t THEN 'above_act' ELSE 'between_ask_act' END AS gate FROM j),
-- state0 = CASE gate WHEN 'rejected' THEN 'suppressed_feedback' WHEN 'below_ask' THEN 'wait'
--   WHEN 'min_age' THEN 'blocked_guardrail' WHEN 'care_suppress' THEN 'blocked_guardrail'
--   WHEN 'care_advisor' THEN 'advisor' WHEN 'above_act' THEN 'act' ELSE 'ask' END
-- final: gate -> 'fatigue_cap' when state0 IN ('act','ask') AND rk > $max_active; also SELECT rk, priority*confidence AS score
```
MIGRATION TRAP: the live `twin` table lacks these columns, and `refresh_customer` uses `INSERT ... BY NAME` (`engine.py:116`), which would fail on the first feedback click. In `Engine.__init__` (`:38`) also run `run_population()` when `twin.gate` is missing (check `information_schema.columns`).

### B3 `Engine.simulate(cid, WhatIfIn, *, as_of=None, feedback=None) -> Scenario` (1.5 h) [VERIFIED]
Read-only: only SELECTs, never `refresh_customer`, never DDL. Stored consent is AND-ed with the override: a what-if can only reduce consent. Otherwise "what if I switch it back on" would read data the customer switched off, contradicting the UI promise (`i18n.ts` dataNote, README "never read"). Verified: stored app-OFF plus what-if ON returns the stored-OFF result.

Per-signal contributions (same noisy-OR, window functions over the same hits):
```sql
WITH h AS (SELECT * FROM (<compile_hits sql>)),
x AS (SELECT *, sum(ln(1-weight)) OVER w AS all_ln,
             count(*) FILTER (WHERE source<>'profile') OVER w AS behav
      FROM h WINDOW w AS (PARTITION BY customer_id, moment_id))
SELECT moment_id, signal_id, source, weight, n, last_seen,
  1-exp(sum(ln(1-weight)) OVER (PARTITION BY customer_id, moment_id ORDER BY weight DESC, signal_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS cumulative,
  CASE WHEN behav-CAST(source<>'profile' AS INTEGER)=0 THEN 0.0 ELSE 1-exp(all_ln-ln(1-weight)) END AS without_this
FROM x ORDER BY moment_id, weight DESC, signal_id
```
Sofie buying_home, real output: notary 0.60 (cum 0.60, without 0.55), mortgage 0.50 (cum 0.80, without 0.64), life_stage 0.10 (cum 0.82, without 0.80). Add `signal_id` as the tie-break (`dsl.py:202` orders by weight only, so ties are non-deterministic).

Extra overrides, all VERIFIED: `signals_off`, `weights`, `thresholds`, `guardrails` (Sofie min_age=40: buying_home becomes `blocked_guardrail`), `max_active` (Sofie cap=1: growing_family becomes `deferred_fatigue`), `care_flag` (advisor-only), `signals_on` (virtual hits UNION-ed into the hits relation with the signal's real source and weight; rejected if the source consent is off or the signal is a profile signal).

Parity (VERIFIED):
- simulate() with no overrides vs stored `twin` for 978 customers (with beliefs, without, advisor, act, fatigue): 0 mismatches.
- For 7 real mutations (consent off x2, reject, confirm, care-flag confirm, confirm-without-evidence, MAX_ACTIVE=1) simulate == real `refresh_customer` result, and the DB was unchanged after simulate.
- Put both as pytest tests (`test_whatif_matches_stored`, `test_whatif_matches_reality`, `test_whatif_is_read_only` = row-checksum of feedback/customers/twin/signal_hits before and after).

### B4 `Engine.theater(cid, audience)` events and frames (1.5 h) [VERIFIED in prototype]
Events: `SELECT ts, source, kind, amount FROM events WHERE customer_id=$cid AND ((source=$s0 AND kind=$k0) OR ...) ORDER BY ts, rowid`. The OR-list comes from the union of `(source,kind)` of all moments' behavioural signals, with every pair whose source consent is off dropped (1.8 ms). Do not return `rowid`; use the array index as `i`. Also return `ignored_events = count(allowed events) - len(events)` (Sofie: 73 allowed, 7 relevant, 66 ignored). For each event, `matches:[{key, counts}]` where `counts = min_amount is None or amount >= min_amount` (so a EUR 600 notary payment shows as "seen, does not count").

Frames: `dates = sorted({event dates}) | {SIM_NOW}` (the last frame must equal the stored twin without feedback), capped at 24 (max real = 18). For each date run simulate with `as_of=date` and empty feedback (so frames show model inference and the customer's correction is a separate final act). The hits query can be reused for signal lighting.

Real frames (VERIFIED):
- Sofie: 08-16 growing_family 0.30 wait -> 08-21 0.545 ask -> 08-26 buying_home 0.55 wait -> 09-10 buying_home 0.82 ask.
- Lucas: 09-05 freelance 0.55 wait -> 09-08 0.753 ask -> 09-16 0.839 act.
- Marc: 08-31 buying_home 0.82 `advisor` (guardrail fires on the frame where it crosses ask) -> 09-04 0.874 advisor.
- 18492: 11 frames, last frame `growing_family 0.545 deferred_fatigue` and signals expiring from windows between events.
Optional `include_expiry=true`: add `event_date + within_days + 1` frames so confidence visibly decays.
Cost: 37-55 ms/frame, so 7 frames ~0.26-0.4 s, 18 frames <1 s. Take the DB lock per frame, not for the whole replay.

### B5 `Engine.why_not(cid, moment_id, target)` + `dsl.near_miss_sql` (2 h) [VERIFIED core; amount-below-min path untested]
Order of reasoning must follow the `gate` (B2):
1. `rejected` -> verdict `rejected_by_you`, fix = clear.
2. `min_age` / care -> `blocked_by_rule` (customer JSON uses the neutral code `human_first`, never "vulnerable/care"; see S3).
3. `fatigue_cap` -> `held_back`, and list the moments that hold the slots with `score = priority*confidence` (confirmed first, then score, then moment_id, as in `dsl.py:236`).
4. otherwise an evidence gap.

Evidence gap: addable signals = behavioural, not already hit, source consent ON. Consent-OFF signals are listed with `have:null, consent_off:true` and their data is never queried. Profile signals go to `cannot_change`. Near-miss per signal (bound params only):
```sql
SELECT $sid AS signal_id, count(*) AS n_any, count(*) FILTER (WHERE $amt IS NULL OR e.amount >= $amt) AS n_ok,
       max(e.amount) AS best_amount, max(e.ts) AS last_seen
FROM events e JOIN customers c USING (customer_id)
WHERE e.customer_id=$cid AND c.consent_<src> AND e.source=$src AND e.kind=$kind
  AND e.ts <= CAST($now AS DATE) AND e.ts > CAST($now AS DATE) - CAST($days AS INTEGER)   -- UNION ALL per signal
```
Smallest added evidence = minimum number of signals for which `1-(1-inferred)*prod(1-w_i) >= target` (for noisy-OR the largest weights first is count-optimal). Better: brute-force all subsets of <= 12 addable signals (4,095 subsets = 2.8 ms) and sort by (signals, total missing events). Always verify the top 2 paths with the real policy SQL via `signals_on`: closed-form alone is wrong. Example, VERIFIED on customer 18492: adding child_savings (0.45) lifts growing_family to 0.75 but it stays `deferred_fatigue`. Adding child_savings + baby_store_repeat gives 0.85 `act`, and going_freelance flips to `deferred_fatigue` (displacement). The response therefore carries `result:{confidence,state,gate,displaces:[moment_id]}`.

Real examples (VERIFIED):
- Sofie buying_home -> act: one signal, "a look at home insurance" (+0.3) gives 0.874 act.
- Sofie growing_family -> act: child_savings + baby_store_repeat (needs 2 more baby purchases) gives 0.85.
- Lucas buying_home -> ask: only life_stage (0.1) is present, so `notary_deposit` alone gives 0.64.

### B6 `Engine.galaxy()` computed inside `run_population` and stored in `runs.stats` (1.5 h) [VERIFIED SQL, k-anon rule DESIGNED]
Queries (measured on scratch DB): stage counts 61 ms, best-row cells 44 ms, confusion incl. FN 17 ms, operating points 32 ms; total ~150 ms per run, so `GET /po/galaxy` is a cached read.
```sql
-- best-row partition of the 19,437 customers that have a belief row (customer-level, disjoint)
WITH ranked AS (SELECT t.*, row_number() OVER (PARTITION BY customer_id ORDER BY
   CASE state WHEN 'act' THEN 1 WHEN 'ask' THEN 2 WHEN 'advisor' THEN 3 WHEN 'deferred_fatigue' THEN 4
        WHEN 'blocked_guardrail' THEN 5 WHEN 'suppressed_feedback' THEN 6 ELSE 7 END,
   priority*confidence DESC, moment_id) rk FROM twin t)
SELECT r.moment_id, r.state, (tr.customer_id IS NOT NULL) AS is_true, count(*) n
FROM ranked r LEFT JOIN truth tr ON tr.customer_id=r.customer_id AND tr.moment_id=r.moment_id
WHERE rk=1 GROUP BY ALL
-- exact precision/recall at ANY threshold: distinct inferred values (36 points total, 7-11 per moment)
SELECT t.moment_id, round(t.inferred,4) v, count(*) n, count(tr.customer_id) tp
FROM twin t LEFT JOIN truth tr USING (customer_id, moment_id) WHERE t.inferred>0 GROUP BY 1,2 ORDER BY 1,2 DESC
```
Real stage numbers: population 100,000; >= 1 consent 98,786 (21,859 partial, 1,214 none); >= 1 behavioural signal 19,437; above ask 2,442; delivered act/ask 2,397; advisor 45; fatigue 1. `no_signal` = 80,563.

The PR data is a STEP function (inferred takes few distinct values), so draw operating points, not a smooth curve. Real cliff for buying_home: ask 0.60 gives precision 94.3 %/recall 63 %, ask 0.55 gives precision 59.8 %/recall 66 % (+692 customers of whom 47 are true). That is a strong PO slider moment.

### B7 `Engine.preview_moment(m)`: read-only "what would happen" (1 h) [VERIFIED]
`compile_hits([m], False)` for the NEW moment only, UNION ALL with the stored `signal_hits`, `moments_rt` replaced by VALUES(existing + new), full `twin_sql`, then the cell query. Result: preview cells == committed cells (True), no writes, 1.22 s vs 4.63 s for add_custom + run_population on the same loaded machine. EV numbers: reach 434 (act 67, ask 355, advisor 9), 422 customers newly reached, precision 0.998, recall 0.265, AI share 2.91 %. UX: Validate then preview (~1.2 s, galaxy animates) then "Go live" (commit runs while the animation plays).

### B8 `channel_policy` constant + graph payload (1 h) [DESIGNED from code reading]
Extract one dict `CHANNELS_BY_STATE`, for example `act:{app_card,voice,advisor:'brief'}`, `ask:{app_card,voice,advisor:'brief'}`, `advisor:{app_card,voice,advisor:'needs_you'}`, `wait:{}`, `deferred_fatigue:{advisor:'held_back'}`, `blocked_guardrail:{advisor:'blocked'}`, `suppressed_feedback:{advisor:'do_not_mention'}` (app belief list shows all, struck-through when rejected). Use it in `api.py:275`, `:376` and the graph, so the visual cannot drift from the real behaviour. Add a test that every state in `twin` maps to a policy entry.

## 3. API spec (new endpoints; all JSON; `extra="forbid"`; `Cache-Control: no-store` is inherited from the `/api/` middleware)
Common: customer id ALWAYS from the authenticated user (`role("customer")`); advisor variants use one helper `_assigned_customer(user, id)` with the same uniform 404 as `api.py:362-370`. New rate buckets in `security.py:97-104`: `sim` (120/60 s), `theater` (20/60 s), `whynot` (60/60 s), `galaxy` (30/60 s), `preview` (12/60 s).

| Route | Role | Notes |
|---|---|---|
| GET `/api/me/theater` | customer | events + frames + final; ~0.3-1 s |
| GET `/api/advisor/customers/{id}/theater` | advisor, assigned only | same payload, `amount: null`, care flag visible |
| POST `/api/me/whatif` | customer | ~54 ms median |
| POST `/api/advisor/customers/{id}/whatif` | advisor | + `care_flag` |
| GET `/api/me/why-not/{moment_id}?target=ask|act` | customer | ~90 ms + 2 verifications |
| GET `/api/advisor/customers/{id}/why-not/{moment_id}` | advisor | |
| GET `/api/me/graph`, GET `/api/advisor/customers/{id}/graph` | customer/advisor | |
| GET `/api/po/galaxy` | PO | cached from last run |
| POST `/api/po/moments/preview` | PO | body = `Moment`; read-only |

```ts
type Gate = "rejected"|"below_ask"|"min_age"|"care_advisor"|"care_suppress"|"above_act"|"between_ask_act"|"fatigue_cap";
type State = "act"|"ask"|"advisor"|"wait"|"blocked_guardrail"|"deferred_fatigue"|"suppressed_feedback";
type SignalState = { key: string /*"buying_home.notary_deposit"*/; signal_id: string; label: string /*localised*/;
  source: "transactions"|"app"|"profile"; weight: number; hit: boolean; n: number; last_seen: string|null;
  cumulative: number|null; without_this: number|null; forced: "on"|"off"|null; consent_off: boolean };
type BeliefState = { moment_id: string; title: string; category: string; priority: number;
  inferred: number; confidence: number; feedback: "confirmed"|"rejected"|null; state: State; gate: Gate;
  thresholds: {ask: number; act: number}; rank: number|null; score: number; signals: SignalState[] };
type Scenario = { as_of: string; max_active: number; consents: {transactions: boolean; app: boolean}; beliefs: BeliefState[] };
```
`/theater` -> `{as_of, customer:{first_name,language,consents,max_active}, events:[{i,date,source,kind,amount|null,matches:[{key,counts}]}], ignored_events:number, frames:[{as_of,event_ids:number[],beliefs:[{moment_id,inferred,state,gate,hit_keys:string[]}]}], final: Scenario}`. `final` = stored state incl. feedback, built from the stored `twin` + contributions over stored `signal_hits` (cheap, no events scan).

`POST /whatif` body (Pydantic): `as_of?: date` (within SIM_NOW-180 d..SIM_NOW), `consents?:{transactions?:bool, app?:bool}` (reduce-only), `feedback?: dict[MomentId, 'confirmed'|'rejected'|'clear']` (<= 8), `signals_off?: Key[]` (<= 12), `signals_on?: Key[]` (<= 12), `weights?: dict[Key, 0.01..0.95]` (<= 12), `thresholds?: dict[MomentId,{ask,act}]` (ask < act), `guardrails?: dict[MomentId,{min_age?:18..100, vulnerable?:'advisor'|'suppress'}]`, `max_active?: 1..5`. `Key` = `^[a-z][a-z0-9_]{1,39}\.[a-z][a-z0-9_]{1,39}$` and must exist in `engine.moments()` (else 422). Returns `{baseline: Scenario (stored), scenario: Scenario, effective_consents, changes:[{moment_id,from_state,to_state,from_conf,to_conf}], matches_stored: bool}`; `matches_stored` runs the no-override path once and is a built-in regression alarm.

`/why-not` -> `{moment_id,title,target,target_threshold,current:{state,gate,confidence,inferred},verdict:'already_there'|'evidence_gap'|'blocked_by_rule'|'rejected_by_you'|'held_back'|'unreachable',blockers:[{code,detail}],paths:[{add:[{key,signal_id,label,weight,need:{min_count,min_amount,within_days},have:number|null,missing_events,saw_amount_below_min}],result:{confidence,state,gate,displaces:string[],verified:true}}] (<= 3),near_misses:[...],cannot_change:[{key,label,reason:'profile'|'consent_off'}]}`.

`/graph` -> `{signals:[SignalState+moment_id], beliefs:[BeliefState without signals], edges_sb:[{from,to,weight,contribution,active}], decisions:[{moment_id,state,gate,rank,score}], channels:[{id:'app_card'|'voice'|'advisor',label}], edges_dc:[{moment_id,channel,mode:'deliver'|'muted'|'severed'|'flag_do_not_mention'|'note_only',detail}]}`, where `edges_dc` comes only from `CHANNELS_BY_STATE`.

`/po/galaxy` -> `{run_id,as_of,customers,events,run_ms,timings:{hits_ms,twin_ms,stats_ms,galaxy_ms},synthetic_ground_truth:true,stages:[{id,n}],no_signal:n,clusters:[{moment_id,title,custom,priority,thresholds,cells:[{state,truth:'tp'|'fp'|'any',n}],missed:n,operating_points:[{v,n,tp}],precision,recall,precision_act}],scale:{...existing}}`. NO ids, no age/region/demographic splits, ever. `run_population` should also return `timings` (hits/twin/stats), so the UI can show an honest breakdown.

`/po/moments/preview` -> `{took_ms, delta:{newly_reached,reach,precision,recall,ai_share}, clusters:[...same as galaxy...]}`.

## 4. Privacy and security spec (new surface)
S1. Existing k-anonymity leak, VERIFIED on real `stats()` output: `states.advisor = 45` is shown, per-moment advisor counts are 16, 13, 12 and "<10", so the hidden cell is 45-16-13-12 = 4 (`engine.py:25-29`, `:218-221`, `:244`). The care flag is sensitive. Do not repeat this in the galaxy: publish counts rounded to multiples of the dot weight (or 5) for any state in (advisor, deferred, blocked), never split them by moment AND anything else, and apply the same rounding in `stats()`. Do not add age/region dimensions: VERIFIED that splitting by region x age band gives cells of n=1 for advisor.
S2. Galaxy particles are SYNTHESISED on the client from aggregate cells. The payload must never contain a per-customer row or sample.
S3. Customer-role JSON must not contain "vulnerable/care". Map `care_*` gates to `human_first` (UI: existing `st_advisor` "With your advisor"). `care_flag` override exists only on the advisor what-if. Add a test that greps Marc's responses for "vulnerable|care".
S4. Consent: what-if is reduce-only; the timeline and near-miss queries include the consent predicate; consent-OFF signals return `have:null` without touching events. Test: customer with app consent off gets zero `source:"app"` events in `/theater`.
S5. Bounds: `max_length` on every dict/list, weights 0.01..0.95, dates bounded, unknown keys 422, frames capped at 24, rate limits. A what-if costs ~54 ms under the global lock, so 120/min/user is acceptable.
S6. Advisor variants reuse the 404-not-403 assignment check. Extend `test_advisor_only_sees_assigned_customers`: `jan` gets 404 on `/advisor/customers/1/theater|whatif|graph|why-not`. Extend `test_product_owner_sees_no_personal_data` to the galaxy and preview (no `first_name|customer_id|Sofie` substrings).
S7. The customer `/theater` returns amounts (own data). Advisor variant returns `amount:null` (data minimisation; the brief today shows only labels).
S8. Counterfactuals reveal rule thresholds, but `/me/twin` already reveals weights and thresholds (`engine.py:162`, evidence weights), so this is consistent. Document it as a deliberate transparency choice (gaming risk accepted).
S9. Do not use EventSource or WebSocket for streaming. EventSource cannot send the `Authorization: Bearer` header (token lives in memory, `api.ts:4-8`). Deterministic client replay of `frames` is simpler and more reliable on stage. (A `fetch` ReadableStream with the header did work under the production CSP, 3 chunks VERIFIED, if ever needed.)

## 5. Performance and concurrency (measured on a loaded 16-core dev box while sibling processes were running, so treat as upper-ish bounds)
- Single customer: `refresh_customer` 28-51 ms median (max 190). Hits SELECT for one customer 15 ms. simulate (twin+contributions) median 54 ms, p95 116, max 147. Twin-only 28 ms median. Full timeline query 1.8 ms.
- Population: `run_population` 1.7-4.6 s over repeated runs (up to ~9 s outliers). SELECT-only compute is ~0.4-0.5 s (hits 335-368 ms, twin 60-106 ms); the rest is table materialisation/WAL. I could not find a setting that helps (threads, preserve_insertion_order and checkpoint_threshold were all noise or worse). README `:102` and `:119` claim "under a second"/"0.6 to 1 s": not reproduced here. Warm-run once before the demo and re-measure on the demo laptop; do not say "under a second" unless measured.
- Concurrency: with the current lock, a reader arriving during a population run stalled up to 4.47 s (2 runs = 7.3 s). With per-call `db.con.cursor()` reads (no lock): 483 reads in 6.3 s, median 2 ms, max 100 ms, 0 errors (VERIFIED). Snapshot consistency across the two separate `CREATE OR REPLACE` statements is NOT verified; if you adopt cursor reads, wrap the run in `BEGIN ... COMMIT`. For a single presenter this is optional.
- Theater load 0.3-1 s; what-if debounce 150 ms with AbortController. For 60 fps scrubbing compute weight and signal-removal locally: `conf = 1-prod(1-w)` over the server's `hit` set is 3 lines of JS; then show the server-verified number when the response lands (badge "engine-verified" if |delta| < 0.0005). Everything else (consent, feedback, guardrail, fatigue, as_of) is server-authoritative.

## 6. Front-end rendering approach (offline, CSP `default-src 'self'; style-src 'self'`, `api.py:82-85`)
Measured under the EXACT production CSP in Chromium 152 with a scratch static server (VERIFIED):
- ALLOWED: CSSOM `el.style.x=`, `el.style.cssText`, React `style={{}}` on div and svg, `adoptedStyleSheets`, WAAPI `element.animate`, CSS keyframes/transitions from an external stylesheet, SVG presentation attributes, canvas 2D, same-origin Worker, fetch streaming, `new WebSocket` (no violation).
- BLOCKED (violation events fired): `setAttribute('style',...)` (style-src-attr), runtime `<style>` elements (style-src-elem), `blob:` Workers (so never `?worker&inline`), `data:` fonts (font-src; Vite inlines assets < 4 KB, so set `build.assetsInlineLimit: 0` if you add a font), external fetch. The Vite production `index.html` has no inline script or style. Vite dev has no CSP, so always test the production build.
- `motion` (v13) also works under this CSP with zero violations (motion.div, animate(), motion/mini, motion.circle all reached their final values).
- Caution: rAF does not fire in a hidden/minimised window (verified: `visibilityState: hidden`, no rAF in 1 s). Use timestamp-driven tweens so scenes catch up instead of freezing.

Bundle costs (vite build, this repo's versions; probe entries in `viz/web/probes`):
| Option | min | gzip |
|---|---|---|
| Current app (React 19 + views) | 247.3 KB | 77.3 KB (+CSS 2.9 KB) |
| React alone | 219.5 KB | 68.6 KB |
| d3-force | 13.9 KB | 5.4 KB |
| d3-sankey (+shape) | 8.8 KB | 3.1 KB |
| motion `animate` | 53.4 KB | 19.3 KB |
| motion/mini | 10.0 KB | 4.0 KB |
| motion/react (delta over React) | +128 KB | +41.5 KB |
| motion/react LazyMotion (delta) | +77 KB | +26.6 KB |
| native WAAPI | 0.7 KB | 0.4 KB |

Canvas 2D benchmark at 1920x1080 (VERIFIED, hidden tab, loaded 16-core box, so a projector laptop may be 2-4x slower):
| Method | 5k | 10k | 25k | 100k |
|---|---|---|---|---|
| per-particle fillRect | 9 ms | 14.5 ms | 35 ms | 135 ms |
| ImageData pixel buffer @960x540 | - | 7.9 ms | - | 5.8 ms (250k: 6.7 ms) |
| ImageData @1920x1080 | - | - | - | 15.1 ms |

Recommendations:
1. Theater = plain SVG + DOM + CSS transitions/WAAPI. Zero new dependencies. Signal "lights up" = CSS class toggle; doubt bar width via React `style` (CSSOM, allowed); numbers via a 30-line timestamp tween. No motion library needed.
2. Galaxy = two stacked canvases and no library. Layer A: 100,000 REAL pixels (1 pixel = 1 customer, `Uint32Array`, 960x540 scaled with `image-rendering: pixelated`, ~6 ms/frame). Layer B: <= 3k sprites (delivered act/ask/advisor, the new cluster, glow) with fillRect/arc (~5 ms). HUD in DOM/SVG. Cluster anchors on a fixed circle (hand placement, no force layout: deterministic, no jitter on stage). Per-particle DOM/SVG at this scale and three.js/pixi (150 KB+ gz, GPU risk) are rejected. Add an FPS guard that halves sprite count if the average frame > 24 ms for 1 s; `prefers-reduced-motion` renders static frames with count-up.
3. Belief web = SVG with a deterministic 4-column layout (signals | beliefs | decision | channels), cubic Bezier paths, edge width = contribution. "Sever" = class toggle that animates `stroke-dashoffset` plus opacity and a scissors glyph. Avoid d3-force (non-deterministic, risky live); d3-sankey (3.1 KB gz) is acceptable but hand layout has fewer surprises with <= 25 nodes.
4. Why-not = DOM cards + an SVG "gap bar": current confidence, ghost (dashed) segments for candidate signals, the target tick; "Try it" calls `/whatif` with `signals_on`.
5. Do not add CDN fonts (blocked anyway). The existing system-font stack works offline.

Adaptation to who the viewer is (same components, different data and copy):
- Language: server already localises signal/moment labels (`engine.py:144`, `:149`); add ~30 UI keys x EN/NL/FR in `i18n.ts`. Narration sentences are templates keyed by `gate` (no LLM needed): "I'm 82% sure. That is above 60% (ask) but below 85% (act), so I ask instead of assuming."
- Story by data: Sofie (two asks, 82 % and 55 %, wrong guess to correct), Lucas (NL, climbs to act), Marc (FR, guardrail gate fires, human_first), a customer with consent off (signals go dark; empty-state privacy message).
- Role: customer = Theater + Belief web + Why-not (plain words, amounts); advisor = compact theater + "what the customer sees" vs "what you see" + care-flag what-if, no amounts; PO = Galaxy + threshold slider + preview + near-miss.
- Device/a11y: `?stage=1` (font x1.25, chrome hidden, keyboard: Space play/pause, Left/Right frame, 1-4 switch view), dark "theater" theme via CSS variables in an external stylesheet, `prefers-reduced-motion`, `aria-live="polite"` narration, non-colour cues (shape/label), minimum line width 2 px.
- Optional voice: reuse `tts()` with a server-built narration string (same pattern as `api.py:302-318`).

## 7. Component list (each 1-2 h; files under `web/src/viz/` unless noted; strict TS, no `any`)
Shared: S-1 `types.ts` (types above, 0.5 h); S-2 `api.ts` AbortSignal + `useAbortable` (0.5 h); S-3 `tween.ts` (timestamp tween, reduced-motion aware, 0.5 h); S-4 `viz.css` (dark theater tokens, `.lit`, `.sever`, reduced-motion, stage mode, 1 h); S-5 `narration.ts` + `i18n.ts` keys (1.5 h); S-6 fixtures + `?fixtures=1` offline mode (export JSON from the API for Sofie/Lucas/Marc + galaxy, 1.5 h).

Theater (customer + advisor): T1 `DoubtBar.tsx` (doubt 100 % shrinking by (1-w) per signal, ask/act ticks, live formula `1-(1-.6)(1-.5)(1-.1)=82%`, 1.5 h); T2 `EventLane.tsx` (date axis, relevant events, "66 ignored" counter, playhead, 1.5 h); T3 `SignalChips.tsx` (lit/dark signals, event to signal link, shows double-counting of overlapping signals explicitly, 1 h); T4 `GateStrip.tsx` (consent, threshold, guardrail, fatigue slots with rank/score bars, decision, 1.5 h); T5 `WhatIfPanel.tsx` (consent x2, signal on/off, weight sliders, cap stepper, Not-true/Yes, "Make it real" calling the existing real endpoints `api.py:218`, `:244`; advisor adds care flag and min_age; 2 h); T6 `ReasoningTheater.tsx` (fetch, replay controller, audience prop, 1.5 h).

Galaxy (PO): G1 `galaxyEngine.ts` (pure: cluster layout, particle assignment from cells, snapshot diff to animate migration, 2 h); G2 `GalaxyCanvas.tsx` (two canvases, dt loop, FPS guard, 2 h); G3 `GalaxyHud.tsx` (stage counters, per-moment precision/recall, synthetic-truth badge, threshold slider driven by `operating_points` with cluster ring moving, 1.5 h); G4 wire into `ProductOwner.tsx:41-58` (preview then commit, honest elapsed-ms timer during the run, 1 h).

Belief web: W1 `beliefLayout.ts` (1 h); W2 `BeliefWeb.tsx` (SVG, hover isolates a path, sever animation, 2 h); W3 hover-preview of "Not true" through `/whatif {feedback}` then commit (0.5 h).

Why-not: N1 `WhyNotCard.tsx` (1.5 h); N2 PO near-miss bars (1 h, stretch). Near-miss aggregate VERIFIED (102 ms): "customers one signal away from ask", e.g. baby_store_repeat 7,527, notary 2,880; label as hypothetical, not a forecast (most are single weak signals).

Backend: B1 (1 h), B2 (1 h), B3 (1.5 h), B4 (1.5 h), B5 (2 h), B6 (1.5 h), B7 (1 h), B8 (1 h), routes/models/rate-limits/tests for customer+advisor (1.5 h) and PO (1 h).

Suggested split for today: backend track B1->B3->B4->routes and frontend track S-1..S-4 + T1/T2/T6 against fixtures from the prototypes, then galaxy (B6/B7 + G1-G4), then belief web, then why-not.

## 8. Demo choreography mapped to the 3-minute script
- 0:20 PO: Validate (preview ~1 s, new EV cluster lights, "+422 customers reached", precision 99.8 %, recall 26.5 %), then "Go live". Slide ask 0.60 to 0.55 on buying_home: precision 94 % to 60 % (real data). Note: fatigue is invisible at population scale (1 of 100k); show it in the theater instead.
- 0:50 Sofie: replay (10 s): growing_family crosses ask at the baby-shop event, buying_home crosses ask at the notary event but stays below act (0.82 vs 0.85). Toggle "looked at home insurance" (`signals_on`): 0.874, flips to act. Why-not shows exactly this. Cap stepper 2 to 1: growing_family shows `deferred_fatigue`. "Not true" on growing_family: belief web severs app card, voice and advisor note (advisor shows "do not bring up"). Use Marc to show the care gate (0.874 would be act without the flag; with `care_flag=false` what-if as An it does become act).
- 1:50 An: same theater, care-flag what-if and min_age what-if (`blocked_guardrail` only appears through this what-if).

## 9. Questions for the team
1. May customers edit weights/thresholds in the what-if (lab mode) or only toggle signals/consent/feedback? (Spec allows weights; hide the control for customers if you prefer.)
2. Do advisors get amounts? (Spec says no.)
3. Is the double-counting of overlapping signals (baby_store + baby_store_repeat on the same purchases) something to show or to rename before a judge notices in the event-to-signal links?
4. Accept "reduce-only" consent what-if (stricter than a literal "toggle")?
5. Is a preview-then-commit flow for "Validate & go live" acceptable as the demo moment?
6. Are you happy to replace the PO funnel card (`ProductOwner.tsx:71-127`) with the galaxy, or keep both?


## RISKS
- Live DB drift: `backend/data/mirror.duckdb` is locked by the running server, so I could not inspect the demo DB itself; all numbers come from a fresh seed-42 scratch DB that reproduces the README. If earlier demo clicks left feedback or consent changes in the live DB, the theater's `final` (stored state) will differ from the scripted story. Reset per README:74 (stop API, regenerate) and re-check Sofie=0.82/0.545, Lucas=0.839 act, Marc=0.874 advisor before going on stage.
- Population run time is not 'under a second': measured 1.7-4.6 s (outliers ~9 s) on a loaded machine (README.md:102 and :119 claim under a second). SELECT-only compute is only ~0.4-0.5 s; most time is table materialisation. Mitigation: read-only preview (1.2 s, verified identical result to the committed run), show an honest elapsed-ms counter, warm-run before the demo, and do not say 'under a second' unless re-measured on the demo laptop.
- Single DuckDB connection + RLock (db.py:29) means any request arriving during a population run stalls up to ~4.5 s (measured 4,471 ms). Harmless for one presenter, visible if judges click concurrently. Per-call cursors removed the stall in a test (483 reads, 0 errors) but snapshot consistency across the two CREATE OR REPLACE statements was not verified; wrap the run in BEGIN/COMMIT if adopted.
- Schema migration trap: adding gate/rk/score to twin_sql changes the persisted `twin` table. The existing live DB lacks those columns, and refresh_customer's `INSERT ... BY NAME` (engine.py:116) will fail on the first feedback click until `run_population()` recreates the table. Add a column-existence check in Engine.__init__ (engine.py:38).
- k-anonymity differencing leak already in the PO API: states.advisor=45 is shown while per-moment advisor cells are 16, 13, 12 and '<10', so the hidden cell is exactly 4 (engine.py:25-29, 218-221, 244). A care-flag count that small is singling-out risk. The galaxy must not copy the `<10` pattern; use rounding to the dot weight or complementary suppression and never split care/advisor cells by any other dimension (region x age split produced cells of 1).
- What-if vs consent promise: a literal 'toggle consent ON' what-if would read data the customer switched off (UI copy: 'we don't read it at all'). The spec makes it reduce-only (stored AND override). If the team wants a real ON-toggle in the demo, it contradicts README/i18n claims.
- Guardrail and fatigue are nearly invisible in the synthetic data: 0 customers under 18 (generate.py:229) so `blocked_guardrail` is never produced, and fatigue fires for 1 customer in 100k. The 'guardrails and fatigue cap visibly fire' requirement is only met through what-if controls (min_age, max_active, care_flag) and through Marc (care gate). Label those scenes as what-if so judges do not think they are real decisions.
- Counterfactual correctness: closed-form noisy-OR 'smallest evidence' is wrong when the fatigue cap re-ranks moments (verified: customer 18492, adding evidence to growing_family displaces going_freelance into deferred_fatigue). Every proposed path must be verified through the real twin_sql via signals_on. The near-miss path for 'amount below min_amount' is implemented in SQL but I have no sample data that exercises it.
- Model honesty risk on stage: noisy-OR assumes independent signals, but baby_store and baby_store_repeat fire on the same purchases (growing_family.yaml), and the theater will draw both links from one event. A judge may call it double counting. Decide whether to show it, rename, or describe it as a calibrated approximation. Precision/recall come from ground truth we planted ourselves (synthetic); the UI must keep the 'synthetic ground truth' badge.
- CSP constraints are real in production only: Vite dev has no CSP. Verified blocked under the prod CSP: setAttribute('style'), runtime <style> elements, blob: workers, data: fonts (Vite inlines assets < 4 KB, set assetsInlineLimit: 0 if a font is added), external hosts. Verified allowed: React style props, WAAPI, CSS transitions, canvas, same-origin workers, motion. Always test the production build served by FastAPI (MIRROR_WEB_DIST) and watch for securitypolicyviolation events.
- Animation robustness on a projector: rAF stops firing in a hidden/minimised window (verified), so frame-count-based animations freeze then glitch; use timestamp-driven tweens. Per-particle canvas drawing does not scale (10k = 14.5 ms, 100k = 135 ms per frame on a fast box); the two-layer ImageData design (100k pixels at 960x540 = 5.8 ms) is the only approach measured to fit. Unmeasured: GPU behaviour of the actual projector laptop. Keep an FPS guard and a reduced-motion static fallback.
- Streaming is fake by design: events have day resolution and no ids (generate.py:333-337), and EventSource cannot carry the Bearer header. The 'live stream' is a deterministic client replay of server-computed frames; do not describe it as real-time ingestion. Profile fields (age, household, region) are taken as of today in every replay frame.
- Customer-facing leak risk: the word 'vulnerable/care flag' must not appear in any customer-role JSON (advisor UI shows a 'care flag' chip, Advisor.tsx:86). Counterfactuals also reveal rule thresholds and weights to customers; consistent with /me/twin but a conscious choice.
- Team/process risk: the project folder is not a git repository and lives inside OneDrive, while the CLAUDE.md workflow demands branch + PR. Take a zip/copy snapshot (or git init + commit) before editing today, and consider putting the DuckDB file outside OneDrive via MIRROR_DB_PATH (OneDrive sync on a live DB file is unverified but plausible trouble).
- Shared-resource hygiene: other agents in this session also write to the same scratchpad and drive the same Browser pane (my tab was navigated away once; port 8765 was already held by another uvicorn). I used my own subfolder `scratchpad/viz`, my own port and tab, and stopped/closed them. Nothing inside the project root was created, edited or deleted (verified with find -mmin; the only recently modified files are the live DB/WAL written by the running server, the project's own __pycache__ from its earlier run, and web/package-lock.json, none written by me).