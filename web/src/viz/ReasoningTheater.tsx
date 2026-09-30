import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Lang } from "../types";
import { clamp, easeOut, formula, isHumanRoute, pct } from "./model";
import { narrate, stateLabel, t } from "./strings";
import type { BeliefState, FrameBelief, TheaterEvent, TheaterPayload } from "./types";

const FRAME_MS = 2800;
const TWEEN_SHARE = 0.5;

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = (): void => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

interface DoubtBarProps {
  lang: Lang;
  weights: number[];
  shown: number;
  target: number;
  ask: number;
  act: number;
}

export function DoubtBar({ lang, weights, shown, target, ask, act }: DoubtBarProps) {
  const doubt = clamp(1 - shown, 0, 1);
  return (
    <div className="viz-doubt">
      <div className="viz-row-head">
        <span className="viz-label">{t(lang, "doubt")}</span>
        <span className="viz-big" aria-hidden="true">
          {t(lang, "sure", { pct: pct(shown) })}
        </span>
      </div>
      <div className="viz-doubt-track">
        <div className="viz-doubt-fill" style={{ width: `${doubt * 100}%` }} />
        <div className="viz-tick viz-tick-ask" style={{ left: `${(1 - ask) * 100}%` }}>
          <span>{t(lang, "ask")} {pct(ask)}%</span>
        </div>
        <div className="viz-tick viz-tick-act" style={{ left: `${(1 - act) * 100}%` }}>
          <span>{t(lang, "act")} {pct(act)}%</span>
        </div>
      </div>
      <code className="viz-formula">{formula(weights, target)}</code>
    </div>
  );
}

interface EventLaneProps {
  lang: Lang;
  events: TheaterEvent[];
  visible: number[];
  current: number[];
  ignored: number;
  dates: [string, string];
}

function dayNum(d: string): number {
  return Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
}

export function EventLane({ lang, events, visible, current, ignored, dates }: EventLaneProps) {
  const lo = dayNum(dates[0]);
  const span = Math.max(1, dayNum(dates[1]) - lo);
  return (
    <div className="viz-lane">
      <div className="viz-row-head">
        <span className="viz-label">{t(lang, "events")}</span>
        <span className="viz-chip viz-chip-dim">{t(lang, "ignored", { n: ignored })}</span>
      </div>
      <div className="viz-lane-axis">
        <div className="viz-lane-line" />
        {events
          .filter((e) => visible.includes(e.i))
          .map((e) => (
            <div
              key={e.i}
              className={`viz-dot${current.includes(e.i) ? " viz-dot-now viz-fly" : ""}`}
              style={{ left: `${clamp(((dayNum(e.date) - lo) / span) * 94 + 3, 2, 98)}%` }}
              title={`${e.date} ${e.kind}`}
            />
          ))}
        <span className="viz-lane-date viz-lane-date-l">{dates[0]}</span>
        <span className="viz-lane-date viz-lane-date-r">{dates[1]}</span>
      </div>
      <ul className="viz-lane-list">
        {events
          .filter((e) => current.includes(e.i))
          .map((e) => (
            <li key={e.i} className="viz-fly">
              <b>{e.date}</b> {e.kind.split("_").join(" ")}
              {e.amount !== null ? ` · ${e.amount.toFixed(2)} EUR` : ""}
            </li>
          ))}
      </ul>
    </div>
  );
}

interface SignalChipsProps {
  lang: Lang;
  belief: BeliefState;
  hitKeys: string[];
}

export function SignalChips({ lang, belief, hitKeys }: SignalChipsProps) {
  return (
    <div className="viz-signals">
      <span className="viz-label">{t(lang, "signals")}</span>
      <div className="viz-chips">
        {belief.signals.map((s) => {
          const lit = hitKeys.includes(s.key);
          return (
            <span key={s.key} className={`viz-signal${lit ? " lit" : ""}`}>
              <span className="viz-signal-mark" aria-hidden="true">{lit ? "●" : "○"}</span>
              <span className="viz-signal-name">{s.label}</span>
              <span className="viz-signal-w">
                {lit ? "+" : ""}
                {Math.round(s.weight * 100)}
              </span>
              <span className="viz-sr">{lit ? t(lang, "lit") : t(lang, "dark")}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

type StepStatus = "pass" | "stop" | "route" | "skip";

interface GateStripProps {
  lang: Lang;
  fb: FrameBelief;
  belief: BeliefState;
  consents: { transactions: boolean; app: boolean };
}

export function GateStrip({ lang, fb, belief, consents }: GateStripProps) {
  const human = isHumanRoute(fb.state, fb.gate);
  const belowAsk = fb.gate === "below_ask";
  const rejected = fb.gate === "rejected";
  const consentAll = consents.transactions && consents.app;
  const steps: { label: string; status: StepStatus; note: string }[] = [
    { label: t(lang, "gConsent"), status: "pass", note: consentAll ? t(lang, "pass") : t(lang, "dConsentPartial") },
    {
      label: t(lang, "gThreshold"),
      status: rejected || belowAsk ? "stop" : "pass",
      note: `${pct(fb.inferred)}% / ${pct(belief.thresholds.ask)}%`,
    },
    {
      label: t(lang, "gGuard"),
      status: rejected || belowAsk ? "skip" : human ? "route" : fb.gate === "min_age" ? "stop" : "pass",
      note: rejected || belowAsk ? t(lang, "skipped") : human ? t(lang, "route") : fb.gate === "min_age" ? t(lang, "stop") : t(lang, "pass"),
    },
    {
      label: t(lang, "gFatigue"),
      status: rejected || belowAsk || fb.gate === "min_age" ? "skip" : fb.gate === "fatigue_cap" ? "stop" : "pass",
      note: rejected || belowAsk || fb.gate === "min_age" ? t(lang, "skipped") : fb.gate === "fatigue_cap" ? t(lang, "stop") : t(lang, "pass"),
    },
  ];
  return (
    <div className="viz-gates">
      <span className="viz-label">{t(lang, "gates")}</span>
      <ol className="viz-gate-list">
        {steps.map((s) => (
          <li key={s.label} className={`viz-gate viz-gate-${s.status}`}>
            <span className="viz-gate-name">{s.label}</span>
            <span className="viz-gate-note">{s.note}</span>
          </li>
        ))}
        <li className={`viz-gate viz-gate-decision viz-state-${fb.state}`}>
          <span className="viz-gate-name">{t(lang, "gDecision")}</span>
          <span className="viz-gate-note">{stateLabel(lang, fb.state, fb.gate)}</span>
        </li>
      </ol>
    </div>
  );
}

interface TheaterProps {
  lang: Lang;
  payload: TheaterPayload;
  stage: boolean;
}

function findBelief(frame: { beliefs: FrameBelief[] }, id: string): FrameBelief | undefined {
  return frame.beliefs.find((b) => b.moment_id === id);
}

export default function ReasoningTheater({ lang, payload, stage }: TheaterProps) {
  const reduced = usePrefersReducedMotion();
  const frames = payload.frames;
  const n = frames.length;
  const defaultMoment = useMemo(() => {
    const last = frames[n - 1];
    const ranked = [...(last?.beliefs ?? [])].sort((a, b) => b.inferred - a.inferred);
    return ranked[0]?.moment_id ?? payload.final.beliefs[0]?.moment_id ?? "";
  }, [frames, n, payload.final.beliefs]);
  const [momentId, setMomentId] = useState<string>(defaultMoment);
  const [pos, setPos] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(!reduced);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMomentId(defaultMoment);
    setPos(0);
    setPlaying(!reduced);
  }, [payload, defaultMoment, reduced]);

  useEffect(() => {
    if (!playing || n === 0) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const dt = Math.min(now - last, 1000);
      last = now;
      setPos((p) => Math.min(n, p + dt / FRAME_MS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, n]);

  useEffect(() => {
    if (pos >= n && playing) setPlaying(false);
  }, [pos, n, playing]);

  const goto = useCallback(
    (idx: number): void => {
      setPlaying(false);
      setPos(clamp(idx, 0, n - 1) + 0.999);
    },
    [n],
  );

  const idx = Math.min(Math.floor(pos), n - 1);
  const frac = pos >= n ? 1 : pos - idx;

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const tag = e.target instanceof HTMLElement ? e.target.tagName : "";
    if (tag === "INPUT" || tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA") {
      if (!(e.key === "ArrowLeft" || e.key === "ArrowRight") || tag !== "BUTTON") return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (pos >= n) setPos(0);
      setPlaying((p) => !p);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goto(idx + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goto(idx - 1);
    }
  };

  if (n === 0) return <p className="viz-empty">{t(lang, "noBeliefs")}</p>;

  const frame = frames[idx];
  const belief = payload.final.beliefs.find((b) => b.moment_id === momentId) ?? payload.final.beliefs[0];
  if (!belief) return <p className="viz-empty">{t(lang, "noBeliefs")}</p>;
  const fb = findBelief(frame, belief.moment_id) ?? {
    moment_id: belief.moment_id,
    inferred: 0,
    state: "wait" as const,
    gate: "below_ask" as const,
    hit_keys: [],
  };
  const prevFrame = idx > 0 ? findBelief(frames[idx - 1], belief.moment_id) : undefined;
  const prevInferred = prevFrame?.inferred ?? 0;
  const tween = reduced ? 1 : easeOut(frac / TWEEN_SHARE);
  const shown = prevInferred + (fb.inferred - prevInferred) * tween;
  const weights = fb.hit_keys
    .map((k) => belief.signals.find((s) => s.key === k)?.weight)
    .filter((w): w is number => w !== undefined);
  const visibleIds = frames.slice(0, idx + 1).flatMap((f) => f.event_ids);
  const progressed = (idx + Math.min(1, frac)) / n;
  const ignoredNow = Math.round(payload.ignored_events * (reduced ? (idx + 1) / n : progressed));
  const dates: [string, string] = [
    payload.events.reduce((m, e) => (e.date < m ? e.date : m), frames[0].as_of),
    frames[n - 1].as_of,
  ];
  const narration = narrate(lang, fb.gate, {
    title: belief.title,
    inferred: fb.inferred,
    ask: belief.thresholds.ask,
    act: belief.thresholds.act,
  });

  return (
    <div
      ref={rootRef}
      className={`viz-theater${stage ? " viz-stage" : ""}`}
      tabIndex={0}
      onKeyDown={onKey}
      aria-label={t(lang, "keys")}
    >
      <div className="viz-moments" role="tablist">
        {payload.final.beliefs.map((b) => {
          const fbm = findBelief(frame, b.moment_id);
          return (
            <button
              key={b.moment_id}
              role="tab"
              aria-selected={b.moment_id === belief.moment_id}
              className={`viz-moment${b.moment_id === belief.moment_id ? " on" : ""}`}
              onClick={() => setMomentId(b.moment_id)}
            >
              <span>{b.title}</span>
              <b>{pct(fbm?.inferred ?? 0)}%</b>
            </button>
          );
        })}
      </div>

      <div className="viz-grid">
        <EventLane
          lang={lang}
          events={payload.events}
          visible={visibleIds}
          current={frame.event_ids}
          ignored={ignoredNow}
          dates={dates}
        />
        <SignalChips lang={lang} belief={belief} hitKeys={fb.hit_keys} />
        <DoubtBar
          lang={lang}
          weights={weights}
          shown={shown}
          target={fb.inferred}
          ask={belief.thresholds.ask}
          act={belief.thresholds.act}
        />
        <GateStrip lang={lang} fb={fb} belief={belief} consents={payload.customer.consents} />
      </div>

      <p className="viz-narration" aria-live="polite" role="status">
        {narration}
      </p>

      <div className="viz-controls">
        <button
          className="viz-btn viz-btn-primary"
          onClick={() => {
            if (pos >= n) setPos(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? t(lang, "pause") : pos >= n ? t(lang, "replay") : t(lang, "play")}
        </button>
        <button className="viz-btn" onClick={() => goto(idx - 1)} disabled={idx === 0} aria-label={t(lang, "prev")}>
          ‹
        </button>
        <button className="viz-btn" onClick={() => goto(idx + 1)} disabled={idx >= n - 1} aria-label={t(lang, "next")}>
          ›
        </button>
        <input
          className="viz-scrub"
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={idx}
          aria-label={t(lang, "step", { i: idx + 1, n })}
          onChange={(e) => goto(Number(e.target.value))}
        />
        <span className="viz-step muted">
          {t(lang, "step", { i: idx + 1, n })} · {frame.as_of}
        </span>
        <span className="viz-keys muted">{t(lang, "keys")}</span>
      </div>
    </div>
  );
}
