import { useEffect, useState } from "react";
import { api } from "../api";
import type { Lang } from "../types";
import { clamp, pct, whyNotLocal } from "./model";
import { t } from "./strings";
import type { Scenario, WhyNotResponse } from "./types";

interface GapBarProps {
  current: number;
  target: number;
  ghost: number[];
}

export function GapBar({ current, target, ghost }: GapBarProps) {
  const W = 320;
  const x = (v: number): number => clamp(v, 0, 1) * W;
  return (
    <svg className="viz-gapbar" viewBox={`0 0 ${W} 44`} role="img" aria-label={`${pct(current)}% → ${pct(target)}%`}>
      <rect x={0} y={12} width={W} height={18} rx={6} fill="#1e2738" stroke="#2b3750" />
      {ghost.map((g, i) => (
        <rect key={i} x={0} y={12} width={x(g)} height={18} rx={6} fill="none" stroke="#2ed3b7" strokeWidth={2} strokeDasharray="5 4" />
      ))}
      <rect x={0} y={12} width={x(current)} height={18} rx={6} fill="#4d8dff" />
      <line x1={x(target)} x2={x(target)} y1={4} y2={38} stroke="#ffb547" strokeWidth={2.5} />
      <text x={Math.min(x(target) + 5, W - 34)} y={10} fill="#ffb547" fontSize={11}>
        {pct(target)}%
      </text>
      <text x={Math.max(x(current) - 4, 4)} y={43} fill="#93a1bb" fontSize={11} textAnchor={x(current) > 40 ? "end" : "start"}>
        {pct(current)}%
      </text>
    </svg>
  );
}

function verdictText(lang: Lang, v: WhyNotResponse): string {
  switch (v.verdict) {
    case "already_there":
      return t(lang, "alreadyThere");
    case "rejected_by_you":
      return t(lang, "rejectedByYou");
    case "blocked_by_rule":
    case "held_back":
      return t(lang, "blockedRule");
    case "unreachable":
      return t(lang, "unreachable");
    case "evidence_gap":
      return t(lang, "gap", { target: t(lang, v.target), pts: Math.max(0, pct(v.target_threshold) - pct(v.current.confidence)) });
  }
}

interface CardProps {
  lang: Lang;
  data: WhyNotResponse;
  onTry: (key: string) => void;
}

function WhyNotCard({ lang, data, onTry }: CardProps) {
  return (
    <article className="viz-card">
      <div className="viz-row-head">
        <h3>{data.title}</h3>
        <span className="viz-chip">
          {t(lang, "target")}: {t(lang, data.target)} {pct(data.target_threshold)}%
        </span>
      </div>
      <GapBar current={data.current.confidence} target={data.target_threshold} ghost={data.paths.map((p) => p.result.confidence)} />
      <p aria-live="polite">{verdictText(lang, data)}</p>
      {data.paths.map((p, i) => (
        <div key={i} className="viz-path">
          <span>
            {t(lang, "reachedBy")}: <b>{p.add.map((a) => a.label).join(" + ")}</b> → {pct(p.result.confidence)}%
            {p.result.verified ? " ✓" : ""}
          </span>
          <button className="viz-btn" onClick={() => onTry(p.add[0].key)}>
            {t(lang, "tryIt")}
          </button>
        </div>
      ))}
      {data.cannot_change.length > 0 && (
        <p className="muted small">
          {t(lang, "cannotChange")}: {data.cannot_change.map((c) => c.label).join(", ")}
        </p>
      )}
    </article>
  );
}

interface ListProps {
  lang: Lang;
  base: Scenario;
  demo: boolean;
  onTry: (key: string) => void;
}

export default function WhyNotList({ lang, base, demo, onTry }: ListProps) {
  const [items, setItems] = useState<WhyNotResponse[]>([]);
  useEffect(() => {
    let alive = true;
    const run = async (): Promise<void> => {
      const out: WhyNotResponse[] = [];
      for (const b of base.beliefs) {
        const local = whyNotLocal(base, b.moment_id);
        let data = local;
        if (!demo) {
          const target = b.inferred < b.thresholds.ask ? "ask" : "act";
          try {
            data = await api<WhyNotResponse>(`/me/why-not/${encodeURIComponent(b.moment_id)}?target=${target}`);
          } catch {
            data = local;
          }
        }
        if (data) out.push(data);
        if (!alive) return;
      }
      if (alive) setItems(out);
    };
    void run();
    return () => {
      alive = false;
    };
  }, [base, demo]);
  return (
    <div>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t(lang, "whyNotIntro")}
      </p>
      <div className="viz-cards">
        {items.map((d) => (
          <WhyNotCard key={d.moment_id} lang={lang} data={d} onTry={onTry} />
        ))}
      </div>
    </div>
  );
}
