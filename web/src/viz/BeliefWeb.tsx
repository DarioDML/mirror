import { useMemo, useState } from "react";
import type { Lang } from "../types";
import { CHANNEL_IDS, channelMode, emptyOverrides, pct, simulate } from "./model";
import { channelLabel, modeLabel, stateLabel, t } from "./strings";
import type { BeliefState, ChannelId, ChannelMode, TheaterPayload } from "./types";

interface Props {
  lang: Lang;
  payload: TheaterPayload;
  demo: boolean;
}

const W = 900;
const COL = { sig: 16, belief: 290, decision: 530, channel: 740 };
const NODE = { sig: 230, belief: 200, decision: 170, channel: 144 };
const ROW_H = 36;
const ROW_GAP = 8;
const TOP = 34;

interface Pos {
  x: number;
  y: number;
}

function curve(a: Pos, b: Pos): string {
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
}

function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function isDelivering(mode: ChannelMode): boolean {
  return mode === "deliver" || mode === "note_only";
}

export default function BeliefWeb({ lang, payload, demo }: Props) {
  const base = payload.final;
  const [hover, setHover] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);

  const scenario = useMemo(
    () => (preview ? simulate(base, { ...emptyOverrides(base), feedback: { [preview]: "rejected" } }) : base),
    [base, preview],
  );

  const layout = useMemo(() => {
    let y = TOP;
    const sigPos = new Map<string, Pos>();
    const beliefPos = new Map<string, Pos>();
    for (const b of scenario.beliefs) {
      const start = y;
      for (const s of b.signals) {
        sigPos.set(s.key, { x: COL.sig + NODE.sig, y: y + ROW_H / 2 });
        y += ROW_H + ROW_GAP;
      }
      const end = y - ROW_GAP;
      beliefPos.set(b.moment_id, { x: COL.belief, y: (start + end) / 2 });
      y += 14;
    }
    return { sigPos, beliefPos, height: Math.max(y, 220) };
  }, [scenario]);

  const chPos = (i: number): Pos => ({
    x: COL.channel,
    y: TOP + 20 + i * ((layout.height - TOP - 60) / Math.max(1, CHANNEL_IDS.length - 1)),
  });

  const related = (momentId: string): boolean => hover === null || hover === momentId;

  const edgesChannels = scenario.beliefs.flatMap((b) =>
    CHANNEL_IDS.map((c, ci) => {
      const before = base.beliefs.find((x) => x.moment_id === b.moment_id);
      const was = before ? channelMode(payload, before.state, c) : "muted";
      const now = channelMode(payload, b.state, c);
      const severing = preview === b.moment_id && isDelivering(was) && !isDelivering(now);
      return { b, c, ci, mode: now, severing };
    }),
  );

  const start = (b: BeliefState): void => {
    setPreview(b.moment_id);
    setRuns((r) => r + 1);
  };

  return (
    <div>
      <p className="muted" style={{ marginBottom: 10 }}>
        {t(lang, "webHint")}
      </p>
      <div className="viz-web-wrap">
        <svg className="viz-web" viewBox={`0 0 ${W} ${layout.height}`} role="img" aria-label={t(lang, "tabWeb")}>
          <text className="col-head" x={COL.sig} y={18}>{t(lang, "colSignals")}</text>
          <text className="col-head" x={COL.belief} y={18}>{t(lang, "colBeliefs")}</text>
          <text className="col-head" x={COL.decision} y={18}>{t(lang, "colDecision")}</text>
          <text className="col-head" x={COL.channel} y={18}>{t(lang, "colChannels")}</text>

          {scenario.beliefs.map((b) =>
            b.signals.map((s) => {
              const from = layout.sigPos.get(s.key);
              const to = layout.beliefPos.get(b.moment_id);
              if (!from || !to) return null;
              const active = s.hit && !s.consent_off && b.state !== "suppressed_feedback";
              return (
                <path
                  key={s.key}
                  className={`viz-edge${active ? "" : " off"}${related(b.moment_id) ? "" : " fade"}`}
                  d={curve(from, { x: to.x, y: to.y })}
                  strokeWidth={active ? 1.5 + s.weight * 9 : 1.5}
                />
              );
            }),
          )}
          {scenario.beliefs.map((b) => {
            const p = layout.beliefPos.get(b.moment_id);
            if (!p) return null;
            return (
              <path
                key={`d-${b.moment_id}`}
                className={`viz-edge viz-edge-decision${related(b.moment_id) ? "" : " fade"}`}
                d={curve({ x: p.x + NODE.belief, y: p.y }, { x: COL.decision, y: p.y })}
                strokeWidth={1.5 + b.inferred * 9}
              />
            );
          })}
          {edgesChannels.map(({ b, c, ci, mode, severing }) => {
            const p = layout.beliefPos.get(b.moment_id);
            if (!p) return null;
            const cls = severing
              ? `viz-edge viz-edge-channel sever`
              : `viz-edge viz-edge-channel${isDelivering(mode) ? "" : " off"}${related(b.moment_id) ? "" : " fade"}`;
            return (
              <path
                key={`c-${b.moment_id}-${c}-${severing ? runs : 0}`}
                className={cls}
                d={curve({ x: COL.decision + NODE.decision, y: p.y }, chPos(ci))}
                strokeWidth={isDelivering(mode) ? 2 + b.inferred * 5 : 2}
              />
            );
          })}

          {scenario.beliefs.map((b) =>
            b.signals.map((s) => {
              const p = layout.sigPos.get(s.key);
              if (!p) return null;
              const lit = s.hit && !s.consent_off;
              return (
                <g key={s.key} className={`viz-node${lit ? " lit" : ""}${related(b.moment_id) ? "" : " fade"}`} transform={`translate(${COL.sig}, ${p.y - ROW_H / 2})`}>
                  <rect width={NODE.sig} height={ROW_H} rx={8} />
                  <text x={10} y={15}>{trunc(s.label, 30)}</text>
                  <text className="dim-text" x={10} y={29}>{lit ? `+${Math.round(s.weight * 100)}` : t(lang, "dark")}</text>
                </g>
              );
            }),
          )}
          {scenario.beliefs.map((b) => {
            const p = layout.beliefPos.get(b.moment_id);
            if (!p) return null;
            return (
              <g
                key={b.moment_id}
                className={`viz-node${hover === b.moment_id ? " hot" : ""}${related(b.moment_id) ? "" : " fade"}`}
                transform={`translate(${p.x}, ${p.y - 24})`}
                onMouseEnter={() => setHover(b.moment_id)}
                onMouseLeave={() => setHover(null)}
              >
                <rect width={NODE.belief} height={48} rx={10} />
                <text x={12} y={21}>{trunc(b.title, 26)}</text>
                <text className="dim-text" x={12} y={38}>{t(lang, "sure", { pct: pct(b.inferred) })}</text>
              </g>
            );
          })}
          {scenario.beliefs.map((b) => {
            const p = layout.beliefPos.get(b.moment_id);
            if (!p) return null;
            return (
              <g key={`dn-${b.moment_id}`} className={`viz-node${related(b.moment_id) ? "" : " fade"}`} transform={`translate(${COL.decision}, ${p.y - 24})`}>
                <rect width={NODE.decision} height={48} rx={10} />
                <text x={10} y={29}>{trunc(stateLabel(lang, b.state, b.gate), 24)}</text>
              </g>
            );
          })}
          {CHANNEL_IDS.map((c: ChannelId, ci) => {
            const p = chPos(ci);
            return (
              <g key={c} className="viz-node" transform={`translate(${p.x}, ${p.y - 18})`}>
                <rect width={NODE.channel} height={36} rx={8} />
                <text x={10} y={23}>{channelLabel(lang, c)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="viz-web-actions">
        {base.beliefs.map((b) => (
          <button key={b.moment_id} className="viz-btn" onClick={() => start(b)} onMouseEnter={() => setHover(b.moment_id)} onMouseLeave={() => setHover(null)}>
            {t(lang, "notTrue")}: {b.title}
          </button>
        ))}
        {preview && (
          <>
            <span className="viz-verify viz-verify-bad">{t(lang, "previewing")}</span>
            <button className="viz-btn" onClick={() => setPreview(null)}>
              {t(lang, "clearPreview")}
            </button>
          </>
        )}
        {preview && (
          <ul className="viz-lane-list" aria-live="polite">
            {CHANNEL_IDS.map((c) => {
              const b = scenario.beliefs.find((x) => x.moment_id === preview);
              return b ? (
                <li key={c}>
                  {channelLabel(lang, c)}: {modeLabel(lang, channelMode(payload, b.state, c))}
                </li>
              ) : null;
            })}
          </ul>
        )}
        {demo && <span className="muted small">{t(lang, "demoData")}</span>}
      </div>
    </div>
  );
}
