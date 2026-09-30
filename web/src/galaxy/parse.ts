import type { GalaxyCell, GalaxyCluster, GalaxyData, GalaxyStage, OperatingPoint, Truth } from "./types";

type Rec = Record<string, unknown>;

function isRec(x: unknown): x is Rec {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
const num = (x: unknown, d = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : d);
const numOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown, d = ""): string => (typeof x === "string" ? x : d);

function asTruth(x: unknown): Truth {
  return x === "tp" || x === "fp" ? x : "any";
}

function parseCell(x: unknown): GalaxyCell | null {
  if (!isRec(x)) return null;
  return { state: str(x.state, "wait"), truth: asTruth(x.truth), n: Math.max(0, Math.round(num(x.n))) };
}

function parsePoint(x: unknown): OperatingPoint | null {
  if (!isRec(x)) return null;
  return { v: num(x.v), n: Math.max(0, num(x.n)), tp: Math.max(0, num(x.tp)) };
}

function compact<T>(xs: readonly (T | null)[]): T[] {
  return xs.filter((x): x is T => x !== null);
}

function parseCluster(x: unknown): GalaxyCluster | null {
  if (!isRec(x) || typeof x.moment_id !== "string") return null;
  const th = isRec(x.thresholds) ? x.thresholds : {};
  return {
    moment_id: x.moment_id,
    title: str(x.title, x.moment_id),
    custom: x.custom === true,
    priority: num(x.priority),
    thresholds: { ask: num(th.ask, 0.6), act: num(th.act, 0.85) },
    cells: Array.isArray(x.cells) ? compact(x.cells.map(parseCell)) : [],
    missed: Math.max(0, num(x.missed)),
    operating_points: Array.isArray(x.operating_points) ? compact(x.operating_points.map(parsePoint)) : [],
    precision: numOrNull(x.precision),
    recall: numOrNull(x.recall),
    precision_act: numOrNull(x.precision_act),
  };
}

function parseStage(x: unknown): GalaxyStage | null {
  if (!isRec(x) || typeof x.id !== "string") return null;
  return { id: x.id, n: num(x.n) };
}

export function parseGalaxy(x: unknown): GalaxyData | null {
  if (!isRec(x) || !Array.isArray(x.clusters) || typeof x.customers !== "number") return null;
  return {
    customers: x.customers,
    events: num(x.events),
    run_ms: num(x.run_ms),
    synthetic_ground_truth: x.synthetic_ground_truth !== false,
    stages: Array.isArray(x.stages) ? compact(x.stages.map(parseStage)) : [],
    no_signal: num(x.no_signal),
    clusters: compact(x.clusters.map(parseCluster)),
  };
}
