import type {
  ClusterSnapshot,
  GalaxyCluster,
  GalaxyData,
  OperatingPoint,
  PlacedCluster,
} from "./types";

export const W = 960;
export const H = 540;
export const STATE_ORDER: readonly string[] = [
  "act",
  "ask",
  "advisor",
  "deferred_fatigue",
  "blocked_guardrail",
  "suppressed_feedback",
  "wait",
];
const DELIVERED = 3;
const SLOTS: readonly (readonly [number, number])[] = [
  [150, 270],
  [810, 270],
  [480, 98],
  [480, 442],
  [713, 146],
  [247, 394],
  [713, 394],
  [247, 146],
];

export function rgba(r: number, g: number, b: number, a = 255): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stateIndex(state: string): number {
  const i = STATE_ORDER.indexOf(state);
  return i < 0 ? STATE_ORDER.length - 1 : i;
}

export function clusterTotal(c: GalaxyCluster): number {
  return c.cells.reduce((s, x) => s + x.n, 0);
}

export function deliveredCount(c: GalaxyCluster): number {
  return c.cells.reduce((s, x) => (stateIndex(x.state) < DELIVERED ? s + x.n : s), 0);
}

export function layoutClusters(clusters: readonly GalaxyCluster[]): PlacedCluster[] {
  const maxN = Math.max(1, ...clusters.map(clusterTotal));
  const step = Math.min(1.6, 68 / Math.sqrt(maxN));
  return clusters.map((c, index) => {
    const [ax, ay] = SLOTS[index % SLOTS.length];
    const n = clusterTotal(c);
    return { moment_id: c.moment_id, index, ax, ay, n, radius: step * Math.sqrt(n), step };
  });
}

export type Field = {
  count: number;
  x: Uint16Array;
  y: Uint16Array;
  fx: Uint16Array;
  fy: Uint16Array;
  cluster: Int16Array;
  rank: Uint32Array;
  state: Uint8Array;
  truth: Uint8Array;
  start: number[];
};

const GOLDEN = 2.399963229728653;

export function buildField(data: GalaxyData, placed: readonly PlacedCluster[]): Field {
  const total = Math.max(1, Math.round(data.customers));
  const count = total;
  const field: Field = {
    count,
    x: new Uint16Array(count),
    y: new Uint16Array(count),
    fx: new Uint16Array(count),
    fy: new Uint16Array(count),
    cluster: new Int16Array(count).fill(-1),
    rank: new Uint32Array(count),
    state: new Uint8Array(count).fill(STATE_ORDER.length - 1),
    truth: new Uint8Array(count),
    start: [],
  };
  const rng = mulberry32(20260930);
  let i = 0;
  data.clusters.forEach((c, ci) => {
    const p = placed[ci];
    field.start.push(i);
    const cells = [...c.cells].sort((a, b) => stateIndex(a.state) - stateIndex(b.state) || a.truth.localeCompare(b.truth));
    const seed = mulberry32(1000 + ci * 7919);
    const phase = seed() * Math.PI * 2;
    let k = 0;
    for (const cell of cells) {
      for (let j = 0; j < cell.n && i < count; j++, k++, i++) {
        const r = p.step * Math.sqrt(k + 0.5);
        const a = phase + k * GOLDEN;
        field.x[i] = clamp(Math.round(p.ax + r * Math.cos(a)), 0, W - 1);
        field.y[i] = clamp(Math.round(p.ay + r * Math.sin(a)), 0, H - 1);
        field.fx[i] = Math.floor(rng() * W);
        field.fy[i] = Math.floor(rng() * H);
        field.cluster[i] = ci;
        field.rank[i] = k;
        field.state[i] = stateIndex(cell.state);
        field.truth[i] = cell.truth === "tp" ? 1 : cell.truth === "fp" ? 2 : 0;
      }
    }
  });
  field.start.push(i);
  for (; i < count; i++) {
    field.x[i] = Math.floor(rng() * W);
    field.y[i] = Math.floor(rng() * H);
  }
  return field;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function sortedPoints(c: GalaxyCluster): OperatingPoint[] {
  return [...c.operating_points].sort((a, b) => b.v - a.v);
}

export type Metrics = { n: number; tp: number; precision: number | null; recall: number | null };

export function metricsAt(c: GalaxyCluster, threshold: number): Metrics {
  let n = 0;
  let tp = 0;
  let allTp = 0;
  for (const p of c.operating_points) {
    allTp += p.tp;
    if (p.v >= threshold - 1e-9) {
      n += p.n;
      tp += p.tp;
    }
  }
  const trueTotal = allTp + c.missed;
  return { n, tp, precision: n > 0 ? tp / n : null, recall: trueTotal > 0 ? tp / trueTotal : null };
}

export function defaultThreshold(c: GalaxyCluster): number {
  const pts = sortedPoints(c);
  let best: number | null = null;
  for (const p of pts) if (p.v >= c.thresholds.ask - 1e-9) best = p.v;
  return best ?? (pts.length > 0 ? pts[pts.length - 1].v : c.thresholds.ask);
}

export function litCount(c: GalaxyCluster, threshold: number): number {
  const total = clusterTotal(c);
  const delivered = deliveredCount(c);
  const base = metricsAt(c, defaultThreshold(c)).n;
  if (base <= 0) return delivered;
  return clamp(Math.round((delivered * metricsAt(c, threshold).n) / base), 0, total);
}

export function snapshotOf(data: GalaxyData): ClusterSnapshot {
  const snap: ClusterSnapshot = {};
  for (const c of data.clusters) snap[c.moment_id] = clusterTotal(c);
  return snap;
}

export type SnapshotDiff = { added: string[]; changed: string[]; removed: string[] };

export function diffSnapshots(prev: ClusterSnapshot, next: ClusterSnapshot): SnapshotDiff {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const id of Object.keys(next)) {
    if (!(id in prev)) added.push(id);
    else if (prev[id] !== next[id]) changed.push(id);
  }
  for (const id of Object.keys(prev)) if (!(id in next)) removed.push(id);
  return { added, changed, removed };
}

export function ease(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - Math.pow(1 - c, 3);
}

export const PALETTE = {
  bg: rgba(10, 14, 24),
  field: rgba(34, 44, 64),
  wait: rgba(58, 72, 100),
  withdrawn: rgba(44, 56, 80),
  act: rgba(61, 220, 151),
  ask: rgba(76, 201, 240),
  advisor: rgba(179, 136, 255),
  wrong: rgba(255, 107, 107),
  pulled: rgba(255, 183, 3),
};

export const STATE_CSS: Record<string, string> = {
  act: "#3ddc97",
  ask: "#4cc9f0",
  advisor: "#b388ff",
};

export function pixelColor(state: number, truth: number, rank: number, lit: number): number {
  const delivered = state < DELIVERED;
  if (rank < lit) {
    if (!delivered) return PALETTE.pulled;
    if (truth === 2) return PALETTE.wrong;
    return state === 0 ? PALETTE.act : state === 1 ? PALETTE.ask : PALETTE.advisor;
  }
  return delivered ? PALETTE.withdrawn : PALETTE.wait;
}

export function pickSprites(
  field: Field,
  lit: readonly number[],
  budget: number,
): { x: number; y: number; state: number; cluster: number }[] {
  let total = 0;
  for (let c = 0; c < lit.length; c++) total += Math.min(lit[c], field.start[c + 1] - field.start[c]);
  const stride = Math.max(1, Math.ceil(total / Math.max(1, budget)));
  const out: { x: number; y: number; state: number; cluster: number }[] = [];
  for (let c = 0; c < lit.length; c++) {
    const from = field.start[c];
    const to = from + Math.min(lit[c], field.start[c + 1] - from);
    for (let i = from; i < to; i += stride) {
      if (field.state[i] < DELIVERED) out.push({ x: field.x[i], y: field.y[i], state: field.state[i], cluster: c });
    }
  }
  return out;
}
