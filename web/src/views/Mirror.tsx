import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, isAbort } from "../api";
import { formatDate, formatNumber, stateLabel, sureWord, t, langName } from "../i18n";
import type { Belief, GuidanceItem, Lang, Twin } from "../types";
import { useView } from "../deck/deck";
import { applyUi, layoutOf, uiOrDefault } from "../theme/theme";
import { pickVoice, rateFor, readAlong, speak, speechSupported, voicesReady, type SpeakHandle } from "../voice";
import MirrorLab from "../viz/MirrorLab";

const CATEGORY_ICON: Record<string, string> = {
  housing: "⌂", household: "⚭", family: "✿", work: "◆", mobility: "➜", energy: "ϟ", savings: "◎", other: "•",
};

type Feedback = "confirmed" | "rejected" | "clear";
type GuidanceResponse = { items: GuidanceItem[]; voice?: { provider: "elevenlabs" | "browser" } };
type Consents = { transactions: boolean; app: boolean };

function friendly(lang: Lang, e: unknown): string {
  return e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 ? e.message : t(lang, "oops");
}

export default function Mirror() {
  const { api, lang: shellLang, setLang } = useView();
  const [twin, setTwin] = useState<Twin | null>(null);
  const [items, setItems] = useState<GuidanceItem[]>([]);
  const [provider, setProvider] = useState<"elevenlabs" | "browser">("browser");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [labOpen, setLabOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const ctlRef = useRef<AbortController | null>(null);
  const consentsRef = useRef<Consents | null>(null);

  const lang: Lang = twin?.customer.language ?? shellLang;
  const ui = uiOrDefault(twin?.ui);
  const layout = layoutOf(ui);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    try {
      const [tw, g] = await Promise.all([
        api.json<Twin>("/me/twin", { signal: ctl.signal }),
        api.json<GuidanceResponse>("/me/guidance", { signal: ctl.signal }),
      ]);
      if (seq !== seqRef.current) return;
      consentsRef.current = tw.customer.consents;
      setTwin(tw);
      setItems(g.items);
      setProvider(g.voice?.provider ?? "browser");
      setError(null);
      setRev((r) => r + 1);
    } catch (e) {
      if (isAbort(e) || seq !== seqRef.current) return;
      setError(friendly(shellLang, e));
    }
  }, [api, shellLang]);

  useEffect(() => {
    void load();
    return () => {
      seqRef.current += 1;
      ctlRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (twin) setLang(twin.customer.language);
  }, [twin?.customer.language, setLang]);

  useEffect(() => {
    if (twin) applyUi(uiOrDefault(twin.ui), "customer");
  }, [twin]);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await fn();
      } catch (e) {
        setError(friendly(shellLang, e));
      }
      try {
        await load();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [load, shellLang],
  );

  const feedback = useCallback(
    (moment_id: string, status: Feedback) =>
      mutate(() => api.json(`/me/beliefs/${moment_id}/feedback`, { method: "POST", body: { status } })),
    [mutate, api],
  );

  const setConsent = useCallback(
    (key: keyof Consents, value: boolean) => {
      const base = consentsRef.current;
      if (!base) return;
      const next: Consents = { ...base, [key]: value };
      consentsRef.current = next;
      setTwin((prev) => (prev ? { ...prev, customer: { ...prev.customer, consents: next } } : prev));
      void mutate(() => api.json("/me/consents", { method: "PUT", body: next }));
    },
    [mutate, api],
  );

  const changeLang = useCallback(
    (l: Lang) => {
      setTwin((prev) => (prev ? { ...prev, customer: { ...prev.customer, language: l } } : prev));
      void mutate(() => api.json("/me/preferences", { method: "PUT", body: { language: l } }));
    },
    [mutate, api],
  );

  const visibleBeliefs = useMemo(() => {
    if (!twin) return [];
    if (layout !== "calm" || showMore) return twin.beliefs;
    return twin.beliefs.slice(0, 1);
  }, [twin, layout, showMore]);

  if (!twin) return <div className="loading">{error ?? t(shellLang, "loading")}</div>;

  const hiddenCount = twin.beliefs.length - visibleBeliefs.length;
  const showMath = layout !== "calm";

  const beliefs = (
    <div className="stack">
      <h2>{t(lang, "believe")}</h2>
      {twin.beliefs.length === 0 && <p className="muted">—</p>}
      {visibleBeliefs.map((b) => (
        <BeliefCard key={b.moment_id} b={b} lang={lang} showMath={showMath} disabled={busy} onFeedback={feedback} />
      ))}
      {layout === "calm" && twin.beliefs.length > 1 && (
        <button className="btn ghost show-more" onClick={() => setShowMore((v) => !v)}>
          {showMore ? t(lang, "showLess") : `${t(lang, "showMore")} (${formatNumber(lang, hiddenCount || twin.beliefs.length - 1)})`}
        </button>
      )}
      <div className="card">
        <h3>{t(lang, "tellUs")}</h3>
        <p className="muted small">{t(lang, "tellUsSub")}</p>
        <div className="chips">
          {twin.plans.map((p) => (
            <button key={p.moment_id} className="chip" disabled={busy} onClick={() => void feedback(p.moment_id, "confirmed")}>
              <span aria-hidden>{CATEGORY_ICON[p.category] ?? "•"}</span> {p.title}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>{t(lang, "data")}</h3>
        <Toggle label={t(lang, "dataTx")} checked={twin.customer.consents.transactions} onChange={(v) => setConsent("transactions", v)} />
        <Toggle label={t(lang, "dataApp")} checked={twin.customer.consents.app} onChange={(v) => setConsent("app", v)} />
        <p className="muted small">{t(lang, "dataNote")}</p>
      </div>
    </div>
  );

  const guidance = (
    <aside className="stack">
      <h2>{t(lang, "forYou")}</h2>
      {items.length === 0 && <div className="card muted">{t(lang, "forYouEmpty")}</div>}
      {items.map((i) => (
        <GuidanceCard key={i.moment_id} item={i} lang={lang} provider={provider} calm={layout === "calm"} disabled={busy} onFeedback={feedback} />
      ))}
    </aside>
  );

  return (
    <div className={`mirror layout-${layout} ${busy ? "is-busy" : ""}`} aria-busy={busy}>
      <section className="hero">
        <div>
          <h1>{t(lang, "hello", { name: twin.customer.first_name })}</h1>
          <p className="lead">{t(lang, "heroSub")}</p>
        </div>
        <div className="lang-switch" role="group" aria-label={t(lang, "language")}>
          {(["en", "nl", "fr"] as Lang[]).map((l) => (
            <button key={l} className={l === lang ? "active" : ""} aria-pressed={l === lang} disabled={busy} onClick={() => changeLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </section>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <section className="lab-teaser" aria-label={t(lang, "lab_title")}>
        <div>
          <h2>{t(lang, "lab_title")}</h2>
          <p className="muted">{t(lang, "lab_sub")}</p>
        </div>
        <button className="btn primary lab-open" onClick={() => setLabOpen(true)}>
          {t(lang, "lab_open")}
        </button>
      </section>

      {layout === "calm" ? (
        <div className="calm-col">
          {guidance}
          {beliefs}
        </div>
      ) : (
        <div className="mirror-grid">
          {beliefs}
          {guidance}
        </div>
      )}

      {labOpen && (
        <div className="lab-panel" role="dialog" aria-modal="true" aria-label={t(lang, "lab_title")}>
          <div className="lab-panel-head">
            <h2>{t(lang, "lab_title")}</h2>
            <button className="btn" onClick={() => setLabOpen(false)} autoFocus>
              {t(lang, "lab_close")}
            </button>
          </div>
          <div className="lab-panel-body">
            <MirrorLab lang={lang} refreshKey={rev} />
          </div>
        </div>
      )}
    </div>
  );
}

function BeliefMeter({ b, lang }: { b: Belief; lang: Lang }) {
  const pct = Math.round(b.confidence * 100);
  const ask = Math.round(b.thresholds.ask * 100);
  const act = Math.round(b.thresholds.act * 100);
  return (
    <div className="meter-wrap">
      <div className="meter" title={t(lang, "meterHint")} role="img" aria-label={t(lang, "sure", { pct: formatNumber(lang, pct) })}>
        <div className="meter-fill" style={{ width: `${pct}%` }} />
        <div className="meter-tick" style={{ left: `${ask}%` }} />
        <div className="meter-tick strong" style={{ left: `${act}%` }} />
      </div>
      <div className="meter-scale" aria-hidden>
        <span className="meter-mark" style={{ left: `${ask}%` }}>
          {t(lang, "markAsk")} {formatNumber(lang, ask)}%
        </span>
        <span className="meter-mark strong" style={{ left: `${act}%` }}>
          {t(lang, "markAct")} {formatNumber(lang, act)}%
        </span>
      </div>
      <div className="meter-label">{t(lang, "sure", { pct: formatNumber(lang, pct) })}</div>
    </div>
  );
}

function BeliefCard({
  b,
  lang,
  showMath,
  disabled,
  onFeedback,
}: {
  b: Belief;
  lang: Lang;
  showMath: boolean;
  disabled: boolean;
  onFeedback: (id: string, s: Feedback) => void;
}) {
  const [how, setHow] = useState(false);
  const rejected = b.feedback === "rejected";
  const confirmed = b.feedback === "confirmed";
  const showBar = !rejected && (showMath || how);
  return (
    <div className={`card belief ${rejected ? "rejected" : ""}`}>
      <div className="belief-head">
        <span className="cat-icon" aria-hidden>
          {CATEGORY_ICON[b.category] ?? "•"}
        </span>
        <h3>{b.title}</h3>
        <span className={`state-chip s-${b.state}`}>{stateLabel(lang, b.state)}</span>
      </div>

      {!rejected && !showMath && <p className="sure-words">{sureWord(lang, b.confidence)}</p>}
      {!rejected && !showMath && !how && (
        <button className="link-btn" onClick={() => setHow(true)}>
          {t(lang, "showHow")}
        </button>
      )}
      {showBar && <BeliefMeter b={b} lang={lang} />}

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
                    {e.count > 1 ? t(lang, "times", { n: formatNumber(lang, e.count) }) + " · " : ""}
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
          <button className="btn ghost small" disabled={disabled} onClick={() => onFeedback(b.moment_id, "clear")}>
            {t(lang, "undo")}
          </button>
        ) : (
          <>
            <button className="btn small" disabled={disabled} onClick={() => onFeedback(b.moment_id, "confirmed")}>
              ✓ {t(lang, "right")}
            </button>
            <button className="btn ghost small" disabled={disabled} onClick={() => onFeedback(b.moment_id, "rejected")}>
              ✕ {t(lang, "notTrue")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type Listen =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "audio" }
  | { kind: "speech"; word: number }
  | { kind: "readalong"; word: number; notice: string | null };

function scriptFor(item: GuidanceItem): string {
  if (item.voice_script) return item.voice_script;
  return [item.intro, item.type === "ask" ? item.question : null].filter((x): x is string => Boolean(x)).join(" ");
}

function GuidanceCard({
  item,
  lang,
  provider,
  calm,
  disabled,
  onFeedback,
}: {
  item: GuidanceItem;
  lang: Lang;
  provider: "elevenlabs" | "browser";
  calm: boolean;
  disabled: boolean;
  onFeedback: (id: string, s: Feedback) => void;
}) {
  const { api } = useView();
  const [listen, setListen] = useState<Listen>({ kind: "idle" });
  const [talked, setTalked] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const handle = useRef<SpeakHandle | null>(null);
  const token = useRef(0);

  const stop = useCallback(() => {
    token.current += 1;
    audio.current?.pause();
    audio.current = null;
    handle.current?.cancel();
    handle.current = null;
    setListen({ kind: "idle" });
  }, []);

  useEffect(
    () => () => {
      token.current += 1;
      audio.current?.pause();
      handle.current?.cancel();
    },
    [],
  );

  async function playServer(my: number): Promise<boolean> {
    try {
      const blob = await api.blob(`/me/guidance/${item.moment_id}/voice`);
      if (my !== token.current) return true;
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audio.current = a;
      a.onended = () => {
        URL.revokeObjectURL(url);
        if (my === token.current) setListen({ kind: "idle" });
      };
      await a.play();
      setListen({ kind: "audio" });
      return true;
    } catch {
      return false;
    }
  }

  async function onListen() {
    if (listen.kind !== "idle") {
      stop();
      return;
    }
    const my = ++token.current;
    setListen({ kind: "loading" });
    if (provider === "elevenlabs" && (await playServer(my))) return;
    if (my !== token.current) return;
    const text = scriptFor(item);
    const rate = rateFor(item.tone);
    const done = () => {
      if (my === token.current) setListen({ kind: "idle" });
    };
    const voices = speechSupported() ? await voicesReady() : [];
    if (my !== token.current) return;
    const voice = pickVoice(voices, lang);
    if (voice) {
      setListen({ kind: "speech", word: 0 });
      handle.current = speak(text, voice, rate, {
        onWord: (i) => {
          if (my === token.current) setListen({ kind: "speech", word: i });
        },
        onEnd: done,
      });
      return;
    }
    const notice = t(lang, "voiceNoAudio", { lang: langName(lang, lang) });
    setListen({ kind: "readalong", word: 0, notice });
    handle.current = readAlong(text, rate, {
      onWord: (i) => {
        if (my === token.current) setListen({ kind: "readalong", word: i, notice });
      },
      onEnd: done,
    });
  }

  const playing = listen.kind !== "idle" && listen.kind !== "loading";
  const word = listen.kind === "speech" || listen.kind === "readalong" ? listen.word : -1;
  const text = scriptFor(item);
  const words = text.split(/\s+/).filter(Boolean);

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
            <button className="btn primary" disabled={disabled} onClick={() => onFeedback(item.moment_id, "confirmed")}>
              {t(lang, "yes")}
            </button>
            <button className="btn ghost" disabled={disabled} onClick={() => onFeedback(item.moment_id, "rejected")}>
              {t(lang, "no")}
            </button>
          </>
        )}
        {item.type === "advisor" && (
          <button className="btn primary" disabled={talked} onClick={() => setTalked(true)}>
            {talked ? t(lang, "talkDone") : t(lang, "talk")}
          </button>
        )}
        <button className={`btn ghost listen ${calm && item.type === "advisor" ? "prominent" : ""}`} disabled={listen.kind === "loading"} onClick={() => void onListen()}>
          {playing ? `■ ${t(lang, "voiceStop")}` : `▶ ${listen.kind === "loading" ? "…" : t(lang, "listen")}`}
        </button>
      </div>
      {(listen.kind === "readalong" || listen.kind === "speech") && (
        <p className="readalong" aria-live="off">
          {words.map((w, i) => (
            <span key={`${i}-${w}`} className={i === word ? "ra-word now" : i < word ? "ra-word done" : "ra-word"}>
              {w}{" "}
            </span>
          ))}
        </p>
      )}
      {listen.kind === "readalong" && listen.notice && <div className="muted small">{listen.notice}</div>}
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
