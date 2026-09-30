export type Truth = "tp" | "fp" | "any";

export type GalaxyCell = { state: string; truth: Truth; n: number };
export type OperatingPoint = { v: number; n: number; tp: number };

export type GalaxyCluster = {
  moment_id: string;
  title: string;
  custom: boolean;
  priority: number;
  thresholds: { ask: number; act: number };
  cells: GalaxyCell[];
  missed: number;
  operating_points: OperatingPoint[];
  precision: number | null;
  recall: number | null;
  precision_act: number | null;
};

export type GalaxyStage = { id: string; n: number };

export type GalaxyData = {
  customers: number;
  events: number;
  run_ms: number;
  synthetic_ground_truth: boolean;
  stages: GalaxyStage[];
  no_signal: number;
  clusters: GalaxyCluster[];
};

export type PlacedCluster = {
  moment_id: string;
  index: number;
  ax: number;
  ay: number;
  n: number;
  radius: number;
  step: number;
};

export type PointTarget = { x: number; y: number; color: number };

export type Sprite = { x: number; y: number; state: string; cluster: string };

export type ClusterSnapshot = Record<string, number>;
