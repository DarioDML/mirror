import { useEffect, useMemo, useRef, useState } from "react";
import "./galaxy.css";
import {
  buildField,
  defaultThreshold,
  diffSnapshots,
  ease,
  H,
  layoutClusters,
  litCount,
  PALETTE,
  pickSprites,
  pixelColor,
  snapshotOf,
  STATE_CSS,
  W,
} from "./galaxyEngine";
import type { Field } from "./galaxyEngine";
import { MomentRows, StageStrip, ThresholdPanel } from "./Hud";
import { fmtInt } from "./format";
import type { ClusterSnapshot, GalaxyCluster, GalaxyData, PlacedCluster } from "./types";

type Live = {
  field: Field;
  placed: PlacedCluster[];
  clusters: GalaxyCluster[];
  lit: number[];
  selected: number;
  budget: number;
  migrate: { flags: boolean[]; start: number } | null;
  glow: { flags: boolean[]; until: number } | null;
  dirty: boolean;
  reduced: boolean;
};

const MIGRATE_MS = 1600;
const GLOW_MS = 5000;
const STATE_NAMES = ["act", "ask", "advisor"];

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function paintField(buf: Uint32Array, live: Live, ts: number): void {
  const { field, lit } = live;
  buf.fill(PALETTE.bg);
  let t = 1;
  if (live.migrate) {
    t = ease((ts - live.migrate.start) / MIGRATE_MS);
    if (ts - live.migrate.start >= MIGRATE_MS) live.migrate = null;
  }
  const flags = live.migrate?.flags ?? null;
  for (let i = 0; i < field.count; i++) {
    const c = field.cluster[i];
    let x = field.x[i];
    let y = field.y[i];
    let color: number;
    if (c < 0) {
      color = PALETTE.field;
    } else {
      if (flags !== null && flags[c]) {
        x = Math.round(field.fx[i] + (x - field.fx[i]) * t);
        y = Math.round(field.fy[i] + (y - field.fy[i]) * t);
      }
      color = pixelColor(field.state[i], field.truth[i], field.rank[i], lit[c] ?? 0);
    }
    buf[y * W + x] = color;
  }
}

function paintOverlay(ctx: CanvasRenderingContext2D, live: Live, ts: number): void {
  ctx.clearRect(0, 0, W, H);
  const { placed, clusters, lit, field } = live;
  const pulse = live.reduced ? 1 : 0.5 + 0.5 * Math.sin(ts / 420);
  if (live.glow && ts > live.glow.until) live.glow = null;
  if (live.glow) {
    live.glow.flags.forEach((on, c) => {
      const p = placed[c];
      if (!on || !p) return;
      const r = p.radius + 34;
      const g = ctx.createRadialGradient(p.ax, p.ay, p.radius * 0.6, p.ax, p.ay, r);
      g.addColorStop(0, `rgba(255, 183, 3, ${0.05 + 0.3 * pulse})`);
      g.addColorStop(1, "rgba(255, 183, 3, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.ax, p.ay, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  const sprites = pickSprites(field, lit, live.budget);
  for (let s = 0; s < STATE_NAMES.length; s++) {
    ctx.fillStyle = STATE_CSS[STATE_NAMES[s]];
    for (const sp of sprites) {
      if (sp.state !== s) continue;
      ctx.globalAlpha = live.reduced ? 0.95 : 0.55 + 0.45 * Math.sin(ts / 450 + sp.x * 0.13 + sp.y * 0.07);
      ctx.fillRect(sp.x - 1, sp.y - 1, 3, 3);
    }
  }
  ctx.globalAlpha = 1;
  ctx.font = "600 17px system-ui, sans-serif";
  ctx.textAlign = "center";
  placed.forEach((p, c) => {
    const sel = c === live.selected;
    const ringR = p.step * Math.sqrt(Math.max(1, lit[c] ?? 0));
    ctx.beginPath();
    ctx.arc(p.ax, p.ay, ringR + 2, 0, Math.PI * 2);
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeStyle = sel ? "rgba(255,255,255,0.95)" : "rgba(160,180,215,0.35)";
    ctx.setLineDash(sel ? [5, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    const ly = Math.min(p.ay + p.radius + 16, H - 6);
    ctx.fillStyle = sel ? "#ffffff" : "#b9c4da";
    const title = clusters[c]?.title ?? "";
    ctx.fillText(clusters[c]?.custom ? `${title} (new)` : title, p.ax, ly);
  });
}

type GalaxyProps = {
  data: GalaxyData;
  sample: boolean;
  highlight: string | null;
  aiShare: number | null;
};

export default function Galaxy({ data, sample, highlight, aiShare }: GalaxyProps) {
  const reduced = useMemo(prefersReducedMotion, []);
  const placed = useMemo(() => layoutClusters(data.clusters), [data]);
  const field = useMemo(() => buildField(data, placed), [data, placed]);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const canvasA = useRef<HTMLCanvasElement>(null);
  const canvasB = useRef<HTMLCanvasElement>(null);
  const prevSnap = useRef<ClusterSnapshot | null>(null);

  useEffect(() => setThresholds({}), [data]);
  useEffect(() => {
    if (highlight) setSelected(highlight);
  }, [highlight]);

  const selectedId =
    selected !== null && data.clusters.some((c) => c.moment_id === selected)
      ? selected
      : (data.clusters[0]?.moment_id ?? null);
  const selIdx = data.clusters.findIndex((c) => c.moment_id === selectedId);
  const lit = useMemo(
    () => data.clusters.map((c) => litCount(c, thresholds[c.moment_id] ?? defaultThreshold(c))),
    [data, thresholds],
  );

  const liveRef = useRef<Live>({
    field,
    placed,
    clusters: data.clusters,
    lit,
    selected: selIdx,
    budget: 3000,
    migrate: null,
    glow: null,
    dirty: true,
    reduced,
  });

  useEffect(() => {
    const l = liveRef.current;
    l.field = field;
    l.placed = placed;
    l.clusters = data.clusters;
    l.lit = lit;
    l.selected = selIdx;
    l.dirty = true;
  }, [field, placed, data, lit, selIdx]);

  useEffect(() => {
    const snap = snapshotOf(data);
    const prev = prevSnap.current;
    prevSnap.current = snap;
    if (prev === null) return;
    const { added } = diffSnapshots(prev, snap);
    if (added.length === 0) return;
    const flags = data.clusters.map((c) => added.includes(c.moment_id));
    const now = performance.now();
    liveRef.current.migrate = reduced ? null : { flags, start: now };
    liveRef.current.glow = { flags, until: now + GLOW_MS };
    liveRef.current.dirty = true;
  }, [data, reduced]);

  useEffect(() => {
    const a = canvasA.current;
    const b = canvasB.current;
    const ctxA = a?.getContext("2d");
    const ctxB = b?.getContext("2d");
    if (!a || !b || !ctxA || !ctxB) return;
    const img = ctxA.createImageData(W, H);
    const buf = new Uint32Array(img.data.buffer);
    let raf = 0;
    let last = 0;
    let slow = 0;
    let lastOverlay = 0;
    const frame = (ts: number) => {
      const live = liveRef.current;
      const dt = last === 0 ? 16 : ts - last;
      last = ts;
      if (dt < 250) {
        slow = dt > 24 ? slow + dt : Math.max(0, slow - dt);
        if (slow >= 1000) {
          live.budget = Math.max(250, Math.floor(live.budget / 2));
          slow = 0;
        }
      }
      const animating = live.migrate !== null || live.glow !== null;
      if (live.dirty || live.migrate) {
        paintField(buf, live, ts);
        ctxA.putImageData(img, 0, 0);
      }
      if (live.dirty || (!live.reduced && animating)) paintOverlay(ctxB, live, ts);
      else if (!live.reduced && ts - lastOverlay > 66) paintOverlay(ctxB, live, ts);
      if (live.dirty || animating) lastOverlay = ts;
      live.dirty = false;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cluster = selIdx >= 0 ? data.clusters[selIdx] : null;
  const delivered = lit.reduce((s, n) => s + n, 0);

  return (
    <section className="galaxy" aria-label="Population galaxy">
      <div className="g-head">
        <div>
          <h2 className="g-title">Population galaxy</h2>
          <p className="g-sub">
            {fmtInt(data.customers)} pixels, one per customer, grouped by the moment the engine believes in. The
            bright dots are customers with a delivered act, ask or advisor route.
          </p>
        </div>
        <div className="g-badges">
          {data.synthetic_ground_truth && <span className="g-badge warn">synthetic ground truth</span>}
          {sample && <span className="g-badge sample">sample data</span>}
        </div>
      </div>
      <StageStrip stages={data.stages} reduced={reduced} />
      <div className="g-main">
        <div className="g-stage-wrap">
          <div className="g-canvas-box">
            <canvas
              ref={canvasA}
              width={W}
              height={H}
              className="g-layer g-layer-a"
              role="img"
              aria-label={`${fmtInt(data.customers)} customers in ${data.clusters.length} moment clusters, ${fmtInt(delivered)} with a delivered route`}
            />
            <canvas ref={canvasB} width={W} height={H} className="g-layer g-layer-b" aria-hidden="true" />
          </div>
          <ul className="g-legend">
            <li>
              <i className="lg act" />
              act
            </li>
            <li>
              <i className="lg ask" />
              ask
            </li>
            <li>
              <i className="lg advisor" />
              human advisor
            </li>
            <li>
              <i className="lg wrong" />
              wrong guess
            </li>
            <li>
              <i className="lg pulled" />
              pulled in by a lower threshold
            </li>
            <li>
              <i className="lg wait" />
              below threshold
            </li>
            <li>
              <i className="lg none" />
              no signal ({fmtInt(data.no_signal)})
            </li>
          </ul>
        </div>
        <aside className="g-side">
          <h3 className="g-h3">Precision and recall per moment</h3>
          <MomentRows clusters={data.clusters} selectedId={selectedId} highlight={highlight} onSelect={setSelected} />
          {cluster && (
            <ThresholdPanel
              cluster={cluster}
              threshold={thresholds[cluster.moment_id] ?? defaultThreshold(cluster)}
              onChange={(v) => setThresholds((t) => ({ ...t, [cluster.moment_id]: v }))}
            />
          )}
          {aiShare !== null && (
            <p className="g-ai">
              AI only writes for <strong>{(aiShare * 100).toFixed(1)}%</strong> of customers. The other{" "}
              {((1 - aiShare) * 100).toFixed(1)}% are handled by rules alone.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
