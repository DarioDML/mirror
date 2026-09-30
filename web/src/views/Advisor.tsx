import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { stateLabel } from "../i18n";
import type { AdvisorCustomer, Brief } from "../types";

export default function Advisor() {
  const [q, setQ] = useState("");
  const [list, setList] = useState<AdvisorCustomer[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async (query: string) => {
    try {
      const qs = query ? `?q=${encodeURIComponent(query)}` : "";
      const r = await api<{ customers: AdvisorCustomer[] }>(`/advisor/customers${qs}`);
      setList(r.customers);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    }
  }, []);

  const loadBrief = useCallback(async (id: number) => {
    try {
      setBrief(await api<Brief>(`/advisor/customers/${id}/brief`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    }
  }, []);

  useEffect(() => {
    const h = setTimeout(() => loadList(q), 250);
    return () => clearTimeout(h);
  }, [q, loadList]);

  useEffect(() => {
    if (selected !== null) loadBrief(selected);
  }, [selected, loadBrief]);

  return (
    <div className="advisor">
      <div className="stack">
        <h2>Your customers</h2>
        <p className="muted small">
          Only customers assigned to you. Recently active ones first, then the ones that need a personal conversation.
        </p>
        <input
          className="search"
          placeholder="Search by first name"
          value={q}
          maxLength={40}
          onChange={(e) => setQ(e.target.value.replace(/[^\p{L}\p{N}\- ]/gu, ""))}
        />
        {error && <div className="error">{error}</div>}
        <div className="list">
          {list.map((c) => (
            <button
              key={c.customer_id}
              className={`list-item ${selected === c.customer_id ? "active" : ""}`}
              onClick={() => setSelected(c.customer_id)}
            >
              <div>
                <strong>{c.first_name}</strong>{" "}
                <span className="muted small">
                  {c.age} · {c.city}
                </span>
              </div>
              <div className="badges">
                {c.needs_you && <span className="badge warn">needs you</span>}
                {c.last_feedback && <span className="badge info">updated</span>}
                <span className="badge">{c.active} active</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="stack">
        {!brief && <div className="card muted">Pick a customer to see the shared brief.</div>}
        {brief && (
          <>
            <div className="card">
              <div className="belief-head">
                <h2 style={{ margin: 0 }}>{brief.customer.first_name}</h2>
                {brief.customer.care_flag && <span className="state-chip s-advisor">care flag</span>}
                <button className="btn ghost small push-right" onClick={() => loadBrief(brief.customer.customer_id)}>
                  Refresh
                </button>
              </div>
              <p>{brief.summary}</p>
              <p className="muted small">
                Speaks {brief.customer.language.toUpperCase()} · transactions{" "}
                {brief.customer.consents.transactions ? "allowed" : "switched off"} · app data{" "}
                {brief.customer.consents.app ? "allowed" : "switched off"}
              </p>
            </div>
            {brief.items.map((i) => (
              <div key={i.moment_id} className={`card belief ${i.state === "suppressed_feedback" ? "rejected" : ""}`}>
                <div className="belief-head">
                  <h3>{i.title}</h3>
                  <span className={`state-chip s-${i.state}`}>{stateLabel("en", i.state)}</span>
                  <span className="muted small push-right">{Math.round(i.confidence * 100)}%</span>
                </div>
                <p className="note">{i.note}</p>
                {i.evidence.length > 0 && (
                  <p className="muted small">Signals: {i.evidence.join(", ")}</p>
                )}
                {i.talking_points.length > 0 && (
                  <ul className="talking">
                    {i.talking_points.map((tp) => (
                      <li key={tp}>{tp}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
