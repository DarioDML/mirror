import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { EV_EXAMPLE } from "../evExample";
import type { Count, Stats } from "../types";

const nf = new Intl.NumberFormat("en-BE");
const fmt = (n: Count) => (typeof n === "number" ? nf.format(n) : n);
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

export default function ProductOwner() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState(EV_EXAMPLE);
  const [editorMsg, setEditorMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await api<Stats>("/po/funnel"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setStats(await api<Stats>("/po/run", { method: "POST" }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function addMoment() {
    setEditorMsg(null);
    let body: unknown;
    try {
      body = JSON.parse(editor);
    } catch {
      setEditorMsg({ ok: false, text: "That is not valid JSON." });
      return;
    }
    try {
      const r = await api<{ created: string }>("/po/moments", { method: "POST", body });
      setEditorMsg({ ok: true, text: `Moment '${r.created}' added. Running it on every customer…` });
      await run();
      setEditorMsg({ ok: true, text: `Moment '${r.created}' is live for every customer and every channel.` });
    } catch (e) {
      setEditorMsg({ ok: false, text: e instanceof ApiError ? e.message : "Could not add the moment" });
    }
  }

  async function remove(id: string) {
    try {
      await api(`/po/moments/${id}`, { method: "DELETE" });
      await run();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  if (!stats) return <div className="loading">{error ?? "Loading…"}</div>;

  const funnel: [string, number][] = [
    ["Events processed", stats.events],
    ["Signals matched", stats.signal_hits],
    ["Beliefs formed", stats.beliefs],
    ["Moments above threshold", stats.moments],
    ["Messages to write (AI tier)", stats.messages_to_write],
  ];
  const maxLog = Math.log10(stats.events);
  const noAi = 1 - stats.ai_share_of_customers;

  return (
    <div className="po stack">
      <section className="hero">
        <div>
          <h1>One engine, every customer</h1>
          <p className="lead">
            {nf.format(stats.customers)} synthetic customers processed in {nf.format(stats.run_ms)} ms. Rules run on
            everyone. AI only writes words for the {pct(stats.ai_share_of_customers)} where a moment fired.
          </p>
        </div>
        <button className="btn primary" onClick={run} disabled={running}>
          {running ? "Running…" : "Run on all customers"}
        </button>
      </section>
      {error && <div className="error">{error}</div>}

      <div className="kpis">
        <Kpi label="Customers" value={fmt(stats.customers)} />
        <Kpi label="Events" value={fmt(stats.events)} />
        <Kpi label="Customers reached" value={fmt(stats.customers_reached)} />
        <Kpi label="Routed to a human" value={fmt(stats.states.advisor ?? 0)} />
        <Kpi label="Run time" value={`${nf.format(stats.run_ms)} ms`} />
      </div>

      <div className="po-grid">
        <div className="card">
          <h3>Funnel</h3>
          <p className="muted small">Log scale. Each step is cheaper than the next; the AI sits at the very end.</p>
          <div className="funnel">
            {funnel.map(([label, n]) => (
              <div key={label} className="funnel-row">
                <div className="funnel-label">{label}</div>
                <div className="funnel-bar">
                  <div style={{ width: `${Math.max(4, (Math.log10(Math.max(n, 1)) / maxLog) * 100)}%` }} />
                </div>
                <div className="funnel-value">{nf.format(n)}</div>
              </div>
            ))}
          </div>
          <div className="states">
            {Object.entries(stats.states).map(([s, n]) => (
              <span key={s} className={`state-chip s-${s}`}>
                {s.replace("_", " ")}: {fmt(n)}
              </span>
            ))}
          </div>
        </div>

        <div className="card scale">
          <h3>At KBC scale</h3>
          <div className="big-number">{nf.format(stats.scale.target_customers)}</div>
          <p className="muted small">customers ({stats.scale.method})</p>
          <ul>
            <li>
              <strong>{nf.format(stats.scale.messages)}</strong> messages for the AI to write per run
            </li>
            <li>
              <strong>{nf.format(Math.round(stats.scale.tokens / 1e6))}M</strong> tokens (at{" "}
              {stats.scale.avg_tokens_per_message} per message)
              {stats.scale.eur !== null && <> · ≈ €{nf.format(stats.scale.eur)}</>}
            </li>
            <li>
              <strong>{pct(noAi)}</strong> of customers need no AI call at all
            </li>
            <li>
              Opted out: {nf.format(stats.opted_out.transactions)} transaction data,{" "}
              {nf.format(stats.opted_out.app)} app data (never read)
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
                      <button className="btn ghost small" onClick={() => remove(m.moment_id)}>
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
          new screens. It is validated, compiled to parameterized SQL and runs on every customer at once.
        </p>
        <textarea className="editor" value={editor} onChange={(e) => setEditor(e.target.value)} spellCheck={false} />
        {editorMsg && <div className={editorMsg.ok ? "success" : "error"}>{editorMsg.text}</div>}
        <div className="actions">
          <button className="btn primary" onClick={addMoment} disabled={running}>
            Validate & go live
          </button>
          <button className="btn ghost" onClick={() => setEditor(EV_EXAMPLE)}>
            Reset example
          </button>
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
