import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiBlob, ApiError } from "../api";
import { formatDate, stateLabel, t } from "../i18n";
import type { Belief, GuidanceItem, Lang, Twin } from "../types";

const CATEGORY_ICON: Record<string, string> = {
  housing: "⌂", household: "⚭", family: "✿", work: "◆", mobility: "➜", energy: "ϟ", savings: "◎", other: "•",
};

export default function Mirror() {
  const [twin, setTwin] = useState<Twin | null>(null);
  const [items, setItems] = useState<GuidanceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tw, g] = await Promise.all([api<Twin>("/me/twin"), api<{ items: GuidanceItem[] }>("/me/guidance")]);
      setTwin(tw);
      setItems(g.items);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function mutate(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const feedback = (moment_id: string, status: "confirmed" | "rejected" | "clear") =>
    mutate(() => api(`/me/beliefs/${moment_id}/feedback`, { method: "POST", body: { status } }));

  if (!twin) return <div className="loading">{error ?? "Loading…"}</div>;
  const lang = twin.customer.language;

  return (
    <div className={`mirror ${busy ? "is-busy" : ""}`}>
      <section className="hero">
        <div>
          <h1>{t(lang, "hello", { name: twin.customer.first_name })}</h1>
          <p className="lead">{t(lang, "heroSub")}</p>
        </div>
        <div className="lang-switch" role="group" aria-label="Language">
          {(["en", "nl", "fr"] as Lang[]).map((l) => (
            <button
              key={l}
              className={l === lang ? "active" : ""}
              onClick={() => mutate(() => api("/me/preferences", { method: "PUT", body: { language: l } }))}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </section>
      {error && <div className="error">{error}</div>}

      <div className="mirror-grid">
        <div className="stack">
          <h2>{t(lang, "believe")}</h2>
          {twin.beliefs.length === 0 && <p className="muted">—</p>}
          {twin.beliefs.map((b) => (
            <BeliefCard key={b.moment_id} b={b} lang={lang} onFeedback={feedback} />
          ))}

          <div className="card">
            <h3>{t(lang, "tellUs")}</h3>
            <p className="muted small">{t(lang, "tellUsSub")}</p>
            <div className="chips">
              {twin.plans.map((p) => (
                <button key={p.moment_id} className="chip" onClick={() => feedback(p.moment_id, "confirmed")}>
                  <span aria-hidden>{CATEGORY_ICON[p.category] ?? "•"}</span> {p.title}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>{t(lang, "data")}</h3>
            <Toggle
              label={t(lang, "dataTx")}
              checked={twin.customer.consents.transactions}
              onChange={(v) =>
                mutate(() =>
                  api("/me/consents", { method: "PUT", body: { ...twin.customer.consents, transactions: v } }),
                )
              }
            />
            <Toggle
              label={t(lang, "dataApp")}
              checked={twin.customer.consents.app}
              onChange={(v) =>
                mutate(() => api("/me/consents", { method: "PUT", body: { ...twin.customer.consents, app: v } }))
              }
            />
            <p className="muted small">{t(lang, "dataNote")}</p>
          </div>
        </div>

        <aside className="stack">
          <h2>{t(lang, "forYou")}</h2>
          {items.length === 0 && <div className="card muted">{t(lang, "forYouEmpty")}</div>}
          {items.map((i) => (
            <GuidanceCard key={i.moment_id} item={i} lang={lang} onFeedback={feedback} />
          ))}
        </aside>
      </div>
    </div>
  );
}

function BeliefCard({
  b,
  lang,
  onFeedback,
}: {
  b: Belief;
  lang: Lang;
  onFeedback: (id: string, s: "confirmed" | "rejected" | "clear") => void;
}) {
  const pct = Math.round(b.confidence * 100);
  const rejected = b.feedback === "rejected";
  const confirmed = b.feedback === "confirmed";
  return (
    <div className={`card belief ${rejected ? "rejected" : ""}`}>
      <div className="belief-head">
        <span className="cat-icon" aria-hidden>
          {CATEGORY_ICON[b.category] ?? "•"}
        </span>
        <h3>{b.title}</h3>
        <span className={`state-chip s-${b.state}`}>{stateLabel(lang, b.state)}</span>
      </div>

      {!rejected && (
        <>
          <div className="meter" title={`ask ≥ ${b.thresholds.ask} · act ≥ ${b.thresholds.act}`}>
            <div className="meter-fill" style={{ width: `${pct}%` }} />
            <div className="meter-tick" style={{ left: `${b.thresholds.ask * 100}%` }} />
            <div className="meter-tick strong" style={{ left: `${b.thresholds.act * 100}%` }} />
          </div>
          <div className="meter-label">{t(lang, "sure", { pct })}</div>
        </>
      )}

      {!rejected && b.evidence.length > 0 && (
        <div className="evidence">
          <div className="evidence-title">{t(lang, "why")}</div>
          <ul>
            {b.evidence.map((e) => (
              <li key={e.signal_id}>
                <span className={`src src-${e.source}`}>{t(lang, `src_${e.source}`)}</span>
                <span className="ev-label">{e.label}</span>
                {e.source !== "profile" && (
                  <span className="muted small">
                    {e.count > 1 ? t(lang, "times", { n: e.count }) + " · " : ""}
                    {e.last_seen ? t(lang, "last", { date: formatDate(lang, e.last_seen) }) : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rejected && <p className="note">{t(lang, "rejectedNote")}</p>}
      {confirmed && <p className="note ok">{b.evidence.length ? t(lang, "confirmedNote") : t(lang, "toldUs")}</p>}

      <div className="actions">
        {b.feedback ? (
          <button className="btn ghost small" onClick={() => onFeedback(b.moment_id, "clear")}>
            {t(lang, "undo")}
          </button>
        ) : (
          <>
            <button className="btn small" onClick={() => onFeedback(b.moment_id, "confirmed")}>
              ✓ {t(lang, "right")}
            </button>
            <button className="btn ghost small" onClick={() => onFeedback(b.moment_id, "rejected")}>
              ✕ {t(lang, "notTrue")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function GuidanceCard({
  item,
  lang,
  onFeedback,
}: {
  item: GuidanceItem;
  lang: Lang;
  onFeedback: (id: string, s: "confirmed" | "rejected" | "clear") => void;
}) {
  const [voice, setVoice] = useState<"idle" | "loading" | "playing" | string>("idle");
  const [talked, setTalked] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  async function listen() {
    setVoice("loading");
    try {
      const blob = await apiBlob(`/me/guidance/${item.moment_id}/voice`);
      const url = URL.createObjectURL(blob);
      audio.current?.pause();
      audio.current = new Audio(url);
      audio.current.onended = () => {
        URL.revokeObjectURL(url);
        setVoice("idle");
      };
      await audio.current.play();
      setVoice("playing");
    } catch (e) {
      setVoice(e instanceof ApiError ? e.message : "Voice failed");
    }
  }

  return (
    <div className={`card guidance g-${item.type}`}>
      <div className="g-kind">{stateLabel(lang, item.type)}</div>
      <h3>{item.title}</h3>
      <p>{item.intro}</p>
      {item.type === "ask" && item.question && <p className="question">{item.question}</p>}
      {item.steps.length > 0 && (
        <ol className="steps">
          {item.steps.map((s) => (
            <li key={s.product}>
              <div className="step-title">
                {s.title} <span className="tag">{t(lang, "optional")}</span>
              </div>
              <div className="muted small">{s.body}</div>
            </li>
          ))}
        </ol>
      )}
      {item.why && item.type !== "ask" && <p className="muted small">{t(lang, "basedOn", { why: item.why })}</p>}
      <div className="actions">
        {item.type === "ask" && (
          <>
            <button className="btn primary small" onClick={() => onFeedback(item.moment_id, "confirmed")}>
              {t(lang, "yes")}
            </button>
            <button className="btn ghost small" onClick={() => onFeedback(item.moment_id, "rejected")}>
              {t(lang, "no")}
            </button>
          </>
        )}
        {item.type === "advisor" && (
          <button className="btn primary small" disabled={talked} onClick={() => setTalked(true)}>
            {talked ? t(lang, "talkDone") : t(lang, "talk")}
          </button>
        )}
        <button className="btn ghost small" onClick={listen} disabled={voice === "loading"}>
          ▶ {voice === "loading" ? "…" : t(lang, "listen")}
        </button>
      </div>
      {voice !== "idle" && voice !== "loading" && voice !== "playing" && <div className="muted small">{voice}</div>}
      {item.written_by === "llm" && <div className="ai-note">{t(lang, "aiWritten")}</div>}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  );
}
