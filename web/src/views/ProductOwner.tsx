import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { EV_EXAMPLE } from "../evExample";
import type { Count, Stats } from "../types";
import Galaxy from "../galaxy/Galaxy";
import { FIXTURE_GALAXY } from "../galaxy/fixtures";
import { fmtInt, fmtMs } from "../galaxy/format";
import { parseGalaxy } from "../galaxy/parse";
import type { GalaxyCluster, GalaxyData, GalaxyStage } from "../galaxy/types";
import "../galaxy/po.css";

const fmt = (n: Count) => (typeof n === "number" ? fmtInt(n) : n);
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const toNum = (c: Count): number => (typeof c === "number" ? c : 5);

type PerMoment = Stats["per_moment"][number];
type RunInfo = { browserMs: number; serverMs: number };
type Msg = { ok: boolean; text: string };

function customCluster(m: PerMoment): GalaxyCluster {
  const reach = toNum(m.reach);
  const precision = m.precision ?? 0;
  const tp = Math.round(reach * precision);
  const trueTotal = m.recall !== null && m.recall > 0 ? tp / m.recall : tp;
  const split = (state: string, n: number) => {
    const t = Math.round(n * precision);
    return [
      { state, truth: "tp" as const, n: t },
      { state, truth: "fp" as const, n: n - t },
    ];
  };
  return {
    moment_id: m.moment_id,
    title: m.title,
    custom: true,
    priority: 50,
    thresholds: { ask: 0.6, act: 0.8 },
    cells: [...split("act", toNum(m.act)), ...split("ask", toNum(m.ask)), ...split("advisor", toNum(m.advisor))],
    missed: Math.max(0, Math.round(trueTotal - tp)),
    operating_points: [{ v: 0.6, n: reach, tp }],
    precision: m.precision,
    recall: m.recall,
    precision_act: m.precision_act,
  };
}

function pipelineStages(stats: Stats): GalaxyStage[] {
  return [
    { id: "events", n: stats.events },
    { id: "signals", n: stats.signal_hits },
    { id: "beliefs", n: stats.beliefs },
    { id: "above_threshold", n: stats.moments },
    { id: "messages", n: stats.messages_to_write },
  ];
}

function fallbackGalaxy(stats: Stats | null): GalaxyData {
  const base = FIXTURE_GALAXY;
  if (!stats) return base;
  return {
    ...base,
    run_ms: stats.run_ms,
    stages: pipelineStages(stats),
    clusters: [...base.clusters, ...stats.per_moment.filter((m) => m.custom).map(customCluster)],
  };
}

function describeJsonError(text: string, e: unknown): string {
  const raw = e instanceof Error ? e.message : "Unknown parse error";
  const m = /position (\d+)/.exec(raw);
  if (!m) return `That is not valid JSON: ${raw}`;
  const pos = Number(m[1]);
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - before.lastIndexOf("\n");
  return `That is not valid JSON (line ${line}, column ${col}): ${raw}`;
}

const errText = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);

export default function ProductOwner() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [galaxy, setGalaxy] = useState<GalaxyData | null>(null);
  const [sample, setSample] = useState(false);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [lastRun, setLastRun] = useState<RunInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState(EV_EXAMPLE);
  const [editorMsg, setEditorMsg] = useState<Msg | null>(null);
  const [orphan, setOrphan] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const startRef = useRef(0);
  const forceFixtures = useRef(new URLSearchParams(window.location.search).get("fixtures") === "1");

  const loadGalaxy = useCallback(async (s: Stats | null) => {
    if (!forceFixtures.current) {
      try {
        const g = parseGalaxy(await api<unknown>("/po/galaxy"));
        if (g) {
          setGalaxy(g);
          setSample(false);
          return;
        }
      } catch {
        setSample(true);
      }
    }
    setGalaxy(fallbackGalaxy(s));
    setSample(true);
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await api<Stats>("/po/funnel");
      setStats(s);
      await loadGalaxy(s);
    } catch (e) {
      setError(errText(e, "Something went wrong"));
    }
  }, [loadGalaxy]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setElapsed(performance.now() - startRef.current), 100);
    return () => window.clearInterval(id);
  }, [running]);

  async function run(): Promise<boolean> {
    setRunning(true);
    setError(null);
    startRef.current = performance.now();
    setElapsed(0);
    try {
      const s = await api<Stats>("/po/run", { method: "POST" });
      setStats(s);
      setLastRun({ browserMs: performance.now() - startRef.current, serverMs: s.run_ms });
      await loadGalaxy(s);
      return true;
    } catch (e) {
      setError(`The run failed: ${errText(e, "no response from the server")}`);
      return false;
    } finally {
      setRunning(false);
    }
  }

  async function addMoment() {
    setEditorMsg(null);
    let body: unknown;
    try {
      body = JSON.parse(editor);
    } catch (e) {
      setEditorMsg({ ok: false, text: describeJsonError(editor, e) });
      return;
    }
    startRef.current = performance.now();
    setElapsed(0);
    setRunning(true);
    let created: string;
    try {
      created = (await api<{ created: string }>("/po/moments", { method: "POST", body })).created;
    } catch (e) {
      setRunning(false);
      setEditorMsg({ ok: false, text: errText(e, "Could not add the moment") });
      return;
    }
    setOrphan(created);
    setRunning(false);
    setEditorMsg({ ok: true, text: `Moment '${created}' saved. Running it on every customer…` });
    const ok = await run();
    if (!ok) {
      setEditorMsg({
        ok: false,
        text: `Moment '${created}' is saved but NOT live: the run failed. Retry the run or remove the moment.`,
      });
      return;
    }
    setOrphan(null);
    setHighlight(created);
    setEditorMsg({ ok: true, text: `Moment '${created}' is live for every customer and every channel.` });
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/po/moments/${id}`, { method: "DELETE" });
    } catch (e) {
      setError(`Could not remove '${id}': ${errText(e, "delete failed")}`);
      return;
    }
    setOrphan(null);
    setHighlight(null);
    setEditorMsg({ ok: true, text: `Moment '${id}' removed.` });
    await run();
  }

  async function retryRun() {
    const ok = await run();
    if (ok && orphan) {
      setHighlight(orphan);
      setEditorMsg({ ok: true, text: `Moment '${orphan}' is live for every customer and every channel.` });
      setOrphan(null);
    }
  }

  const galaxyView = useMemo(
    () => (galaxy && stats ? { ...galaxy, stages: pipelineStages(stats) } : null),
    [galaxy, stats],
  );

  if (!stats) return <div className="loading">{error ?? "Loading…"}</div>;

  const noAi = 1 - stats.ai_share_of_customers;
  const runLabel = running ? `Running… ${fmtMs(elapsed)}` : "Run on all customers";

  return (
    <div className="po control-room stack">
      <section className="hero">
        <div>
          <h1>One engine, every customer</h1>
          <p className="lead">
            {fmtInt(stats.customers)} synthetic customers processed in {fmtMs(stats.run_ms)} of server compute. Rules
            run on everyone. AI only writes words for the {(stats.ai_share_of_customers * 100).toFixed(1)}% where a
            moment fired.
          </p>
          {lastRun && !running && (
            <p className="muted small" role="status">
              Last run: {fmtMs(lastRun.browserMs)} measured in the browser, {fmtMs(lastRun.serverMs)} server compute.
            </p>
          )}
        </div>
        <button className="btn primary" onClick={run} disabled={running}>
          {runLabel}
        </button>
      </section>
      {running && (
        <div className="running" role="status" aria-live="polite">
          Running the engine on all {fmtInt(stats.customers)} customers… {fmtMs(elapsed)} elapsed
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {galaxyView && (
        <Galaxy data={galaxyView} sample={sample} highlight={highlight} aiShare={stats.ai_share_of_customers} />
      )}

      <div className="kpis">
        <Kpi label="Customers" value={fmt(stats.customers)} />
        <Kpi label="Events" value={fmt(stats.events)} />
        <Kpi label="Customers reached" value={fmt(stats.customers_reached)} />
        <Kpi label="Routed to a human" value={fmt(stats.states.advisor ?? 0)} />
        <Kpi label="Run time" value={fmtMs(stats.run_ms)} />
      </div>

      <div className="po-grid">
        <div className="card">
          <h3>Delivery states</h3>
          <p className="muted small">Counts under 10 are hidden; larger counts are rounded.</p>
          <div className="states">
            {Object.entries(stats.states).map(([s, n]) => (
              <span key={s} className={`state-chip s-${s}`}>
                {s.replace(/_/g, " ")}: {fmt(n)}
              </span>
            ))}
          </div>
        </div>

        <div className="card scale">
          <h3>At KBC scale</h3>
          <div className="big-number">{fmtInt(stats.scale.target_customers)}</div>
          <p className="muted small">customers ({stats.scale.method})</p>
          <ul>
            <li>
              <strong>{fmtInt(stats.scale.messages)}</strong> messages for the AI to write per run
            </li>
            <li>
              <strong>{fmtInt(Math.round(stats.scale.tokens / 1e6))}M</strong> tokens (at{" "}
              {stats.scale.avg_tokens_per_message} per message)
              {stats.scale.eur !== null && <> · ≈ €{fmtInt(stats.scale.eur)}</>}
            </li>
            <li>
              <strong>{pct(noAi)}</strong> of customers need no AI call at all
            </li>
            <li>
              Opted out: {fmtInt(stats.opted_out.transactions)} transaction data, {fmtInt(stats.opted_out.app)} app
              data (never read)
            </li>
          </ul>
        </div>
      </div>

      <div className="card">
        <h3>Moments</h3>
        <p className="muted small">
          Measured against life events hidden in the synthetic data. “When acting” = how often the engine is right
          when it is sure enough to show a plan without asking. Counts under 10 are hidden.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Moment</th>
                <th>Reach</th>
                <th>Plan</th>
                <th>Ask</th>
                <th>Human</th>
                <th>Said no</th>
                <th>Precision</th>
                <th>When acting</th>
                <th>Recall</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stats.per_moment.map((m) => (
                <tr key={m.moment_id}>
                  <td>
                    {m.title} {m.custom && <span className="tag">new</span>}
                  </td>
                  <td>{fmt(m.reach)}</td>
                  <td>{fmt(m.act)}</td>
                  <td>{fmt(m.ask)}</td>
                  <td>{fmt(m.advisor)}</td>
                  <td>{fmt(m.rejected_by_customer)}</td>
                  <td>{pct(m.precision)}</td>
                  <td>{pct(m.precision_act)}</td>
                  <td>{pct(m.recall)}</td>
                  <td>
                    {m.custom && (
                      <button className="btn ghost small" onClick={() => remove(m.moment_id)} disabled={running}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Add a moment</h3>
        <p className="muted small">
          A product team describes a moment as data: signals, thresholds, guardrails and a journey. No campaign, no
          new screens. It is validated, compiled to parameterized SQL and runs on every customer at once. The run
          takes a few seconds; the timer above shows the real time.
        </p>
        <textarea
          className="editor"
          value={editor}
          onChange={(e) => setEditor(e.target.value)}
          spellCheck={false}
          readOnly={running}
          aria-label="Moment definition (JSON)"
        />
        {editorMsg && (
          <div className={editorMsg.ok ? "success" : "error"} role="status">
            {editorMsg.text}
          </div>
        )}
        <div className="actions">
          <button className="btn primary" onClick={addMoment} disabled={running}>
            {running ? `Working… ${fmtMs(elapsed)}` : "Validate & go live"}
          </button>
          <button className="btn ghost" onClick={() => setEditor(EV_EXAMPLE)} disabled={running}>
            Reset example
          </button>
          {orphan && (
            <>
              <button className="btn ghost" onClick={retryRun} disabled={running}>
                Retry the run
              </button>
              <button className="btn ghost" onClick={() => remove(orphan)} disabled={running}>
                Remove '{orphan}'
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
