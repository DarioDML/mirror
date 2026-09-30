import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isAbort } from "../api";
import { advisorStateLabel, formatNumber, langName, t } from "../i18n";
import type { AdvisorCustomer, Brief, Lang } from "../types";
import { useView } from "../deck/deck";

function errorText(lang: Lang, e: unknown): string {
  return e instanceof ApiError && e.status < 500 && e.status !== 401 ? e.message : t(lang, "oops");
}

export default function Advisor() {
  const { api, lang } = useView();
  const [q, setQ] = useState("");
  const [list, setList] = useState<AdvisorCustomer[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listSeq = useRef(0);
  const briefSeq = useRef(0);

  const loadList = useCallback(
    async (query: string, signal: AbortSignal) => {
      const seq = ++listSeq.current;
      try {
        const qs = query ? `?q=${encodeURIComponent(query)}` : "";
        const r = await api.json<{ customers: AdvisorCustomer[] }>(`/advisor/customers${qs}`, { signal });
        if (seq !== listSeq.current) return;
        setList(r.customers);
        setError(null);
      } catch (e) {
        if (!isAbort(e) && seq === listSeq.current) setError(errorText(lang, e));
      }
    },
    [api, lang],
  );

  const loadBrief = useCallback(
    async (id: number, signal?: AbortSignal) => {
      const seq = ++briefSeq.current;
      try {
        const b = await api.json<Brief>(`/advisor/customers/${id}/brief`, { signal });
        if (seq === briefSeq.current) setBrief(b);
      } catch (e) {
        if (!isAbort(e) && seq === briefSeq.current) setError(errorText(lang, e));
      }
    },
    [api, lang],
  );

  useEffect(() => {
    const ctl = new AbortController();
    const h = setTimeout(() => {
      void loadList(q, ctl.signal);
    }, 250);
    return () => {
      clearTimeout(h);
      ctl.abort();
    };
  }, [q, loadList]);

  useEffect(() => {
    if (selected === null) return;
    const ctl = new AbortController();
    void loadBrief(selected, ctl.signal);
    return () => ctl.abort();
  }, [selected, loadBrief]);

  return (
    <div className="advisor">
      <div className="stack">
        <h2>{t(lang, "ad_title")}</h2>
        <p className="muted small">{t(lang, "ad_sub")}</p>
        <input
          className="search"
          aria-label={t(lang, "ad_search")}
          placeholder={t(lang, "ad_search")}
          value={q}
          maxLength={40}
          onChange={(e) => setQ(e.target.value.replace(/[^\p{L}\p{N}\- ]/gu, ""))}
        />
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="list">
          {list.map((c) => (
            <button
              key={c.customer_id}
              className={`list-item ${selected === c.customer_id ? "active" : ""}`}
              aria-pressed={selected === c.customer_id}
              onClick={() => setSelected(c.customer_id)}
            >
              <div>
                <strong>{c.first_name}</strong>{" "}
                <span className="muted small">
                  {c.age} · {c.city}
                </span>
              </div>
              <div className="badges">
                {c.needs_you && <span className="badge warn">{t(lang, "ad_needsYou")}</span>}
                {c.last_feedback && <span className="badge info">{t(lang, "ad_updated")}</span>}
                <span className="badge">{t(lang, "ad_active", { n: formatNumber(lang, c.active) })}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="stack">
        {!brief && <div className="card muted">{t(lang, "ad_pick")}</div>}
        {brief && (
          <>
            <div className="card">
              <div className="belief-head">
                <h2>{brief.customer.first_name}</h2>
                {brief.customer.care_flag && <span className="state-chip s-advisor">{t(lang, "ad_careFlag")}</span>}
                <button className="btn ghost small push-right" onClick={() => void loadBrief(brief.customer.customer_id)}>
                  {t(lang, "ad_refresh")}
                </button>
              </div>
              <p>{brief.summary}</p>
              <p className="muted small">
                {t(lang, "ad_speaks", { lang: langName(lang, brief.customer.language) })} · {t(lang, "ad_tx")}{" "}
                {brief.customer.consents.transactions ? t(lang, "ad_allowed") : t(lang, "ad_off")} · {t(lang, "ad_app")}{" "}
                {brief.customer.consents.app ? t(lang, "ad_allowed") : t(lang, "ad_off")}
              </p>
            </div>
            {brief.items.map((i) => {
              const rejected = i.state === "suppressed_feedback";
              return (
                <div key={i.moment_id} className={`card belief ${rejected ? "rejected" : ""}`}>
                  <div className="belief-head">
                    <h3>{i.title}</h3>
                    <span className={`state-chip s-${i.state}`}>{advisorStateLabel(lang, i.state)}</span>
                    {!rejected && (
                      <span className="muted small push-right num">{formatNumber(lang, Math.round(i.confidence * 100))}%</span>
                    )}
                  </div>
                  {rejected && <p className="muted small">{t(lang, "ad_notApplicable")}</p>}
                  <p className="note">{i.note}</p>
                  {i.evidence.length > 0 && (
                    <p className="muted small">
                      {t(lang, "ad_signals")}: {i.evidence.join(", ")}
                    </p>
                  )}
                  {i.talking_points.length > 0 && (
                    <ul className="talking">
                      {i.talking_points.map((tp) => (
                        <li key={tp}>{tp}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
