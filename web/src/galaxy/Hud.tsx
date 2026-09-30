import { useEffect, useRef, useState } from "react";
import { defaultThreshold, deliveredCount, metricsAt, sortedPoints } from "./galaxyEngine";
import { fmtInt, fmtPct, stageLabel } from "./format";
import type { GalaxyCluster, GalaxyStage } from "./types";

function useCountUp(target: number, reduced: boolean): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const duration = reduced ? 250 : 900;
    const origin = from.current;
    let raf = 0;
    const tick = (ts: number) => {
      const t = Math.min(1, (ts - start) / duration);
      const v = origin + (target - origin) * (1 - Math.pow(1 - t, 3));
      from.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return value;
}

export function Num({ value, reduced }: { value: number; reduced: boolean }) {
  return <>{fmtInt(useCountUp(value, reduced))}</>;
}

export function StageStrip({ stages, reduced }: { stages: readonly GalaxyStage[]; reduced: boolean }) {
  return (
    <ol className="g-stages" aria-label="Pipeline stages">
      {stages.map((s, i) => (
        <li key={s.id} className="g-stage">
          <span className="g-stage-n">
            <Num value={s.n} reduced={reduced} />
          </span>
          <span className="g-stage-l">{stageLabel(s.id)}</span>
          {i < stages.length - 1 && <span className="g-arrow" aria-hidden="true">›</span>}
        </li>
      ))}
    </ol>
  );
}

type MomentRowsProps = {
  clusters: readonly GalaxyCluster[];
  selectedId: string | null;
  highlight: string | null;
  onSelect: (id: string) => void;
};

export function MomentRows({ clusters, selectedId, highlight, onSelect }: MomentRowsProps) {
  return (
    <table className="g-table">
      <thead>
        <tr>
          <th>Moment</th>
          <th>Reach</th>
          <th>Precision</th>
          <th>Recall</th>
        </tr>
      </thead>
      <tbody>
        {clusters.map((c) => {
          const m = metricsAt(c, defaultThreshold(c));
          const sel = c.moment_id === selectedId;
          return (
            <tr key={c.moment_id} className={`${sel ? "sel" : ""} ${c.moment_id === highlight ? "fresh" : ""}`}>
              <td>
                <button type="button" className="g-link" aria-pressed={sel} onClick={() => onSelect(c.moment_id)}>
                  {c.title}
                </button>
                {c.custom && <span className="g-new">new</span>}
              </td>
              <td>{fmtInt(deliveredCount(c))}</td>
              <td>{fmtPct(c.precision ?? m.precision)}</td>
              <td>{fmtPct(c.recall ?? m.recall)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type ThresholdProps = {
  cluster: GalaxyCluster;
  threshold: number;
  onChange: (v: number) => void;
};

export function ThresholdPanel({ cluster, threshold, onChange }: ThresholdProps) {
  const vs = sortedPoints(cluster)
    .map((p) => p.v)
    .reverse();
  if (vs.length === 0) return <p className="g-muted">No operating points for this moment.</p>;
  const base = defaultThreshold(cluster);
  const cur = metricsAt(cluster, threshold);
  const ref = metricsAt(cluster, base);
  const idx = Math.max(0, vs.findIndex((v) => Math.abs(v - threshold) < 1e-9));
  const extra = cur.n - ref.n;
  const extraTp = cur.tp - ref.tp;
  const cliff =
    extra > 0 && ref.precision !== null && cur.precision !== null && ref.precision - cur.precision >= 0.1;
  return (
    <div className="g-threshold">
      <div className="g-th-head">
        <strong>{cluster.title}</strong>
        <span className="g-th-val">ask threshold {threshold.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={vs.length - 1}
        step={1}
        value={idx}
        aria-label={`Ask threshold for ${cluster.title}`}
        onChange={(e) => onChange(vs[Number(e.target.value)] ?? threshold)}
      />
      <div className="g-th-scale">
        <span>{vs[0].toFixed(2)}</span>
        <span>{vs[vs.length - 1].toFixed(2)}</span>
      </div>
      <div className="g-pr">
        <div>
          <span className="g-pr-n">{fmtPct(cur.precision)}</span>
          <span className="g-pr-l">precision</span>
        </div>
        <div>
          <span className="g-pr-n">{fmtPct(cur.recall)}</span>
          <span className="g-pr-l">recall</span>
        </div>
        <div>
          <span className="g-pr-n">{fmtInt(cur.n)}</span>
          <span className="g-pr-l">customers reached</span>
        </div>
      </div>
      {cliff && (
        <p className="g-cliff" role="status">
          Lowering the threshold pulls in {fmtInt(extra)} more customers, only {fmtInt(extraTp)} of them are true:
          precision falls from {fmtPct(ref.precision)} to {fmtPct(cur.precision)}.
        </p>
      )}
      {!cliff && extra < 0 && (
        <p className="g-note" role="status">
          Raising the threshold drops {fmtInt(-extra)} customers: recall falls from {fmtPct(ref.recall)} to{" "}
          {fmtPct(cur.recall)}.
        </p>
      )}
    </div>
  );
}
