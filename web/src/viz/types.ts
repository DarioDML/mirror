import type { Lang } from "../types";

export type Gate =
  | "rejected"
  | "below_ask"
  | "min_age"
  | "care_advisor"
  | "care_suppress"
  | "human_first"
  | "above_act"
  | "between_ask_act"
  | "fatigue_cap";

export type State =
  | "act"
  | "ask"
  | "advisor"
  | "wait"
  | "blocked_guardrail"
  | "deferred_fatigue"
  | "suppressed_feedback";

export type SignalSource = "transactions" | "app" | "profile";

export interface SignalState {
  key: string;
  signal_id: string;
  label: string;
  source: SignalSource;
  weight: number;
  hit: boolean;
  n: number;
  last_seen: string | null;
  cumulative: number | null;
  without_this: number | null;
  forced: "on" | "off" | null;
  consent_off: boolean;
}

export interface BeliefState {
  moment_id: string;
  title: string;
  category: string;
  priority: number;
  inferred: number;
  confidence: number;
  feedback: "confirmed" | "rejected" | null;
  state: State;
  gate: Gate;
  thresholds: { ask: number; act: number };
  rank: number | null;
  score: number;
  signals: SignalState[];
}

export interface Consents {
  transactions: boolean;
  app: boolean;
}

export interface Scenario {
  as_of: string;
  max_active: number;
  consents: Consents;
  beliefs: BeliefState[];
}

export interface TheaterMatch {
  key: string;
  counts: boolean | number;
}

export interface TheaterEvent {
  i: number;
  date: string;
  source: string;
  kind: string;
  amount: number | null;
  matches: TheaterMatch[];
}

export interface FrameBelief {
  moment_id: string;
  inferred: number;
  state: State;
  gate: Gate;
  hit_keys: string[];
}

export interface TheaterFrame {
  as_of: string;
  event_ids: number[];
  beliefs: FrameBelief[];
}

export interface TheaterPayload {
  as_of: string;
  customer: { first_name: string; language: Lang; consents: Consents; max_active: number };
  events: TheaterEvent[];
  ignored_events: number;
  frames: TheaterFrame[];
  final: Scenario;
  channels?: unknown;
}

export type ChannelId = "app_card" | "voice" | "advisor";
export type ChannelMode = "deliver" | "muted" | "severed" | "flag_do_not_mention" | "note_only";

export interface ChangeRow {
  moment_id: string;
  from_state: State;
  to_state: State;
  from_conf: number;
  to_conf: number;
}

export type FeedbackAction = "confirmed" | "rejected" | "clear";

export interface WhatIfRequest {
  consents?: { transactions?: boolean; app?: boolean };
  feedback?: Record<string, FeedbackAction>;
  signals_off?: string[];
  signals_on?: string[];
  max_active?: number;
}

export interface WhatIfResponse {
  baseline: Scenario;
  scenario: Scenario;
  effective_consents: Consents;
  changes: ChangeRow[];
  matches_stored: boolean;
}

export interface WhyNotAddition {
  key: string;
  signal_id: string;
  label: string;
  weight: number;
  need: { min_count: number | null; min_amount: number | null; within_days: number | null };
  have: number | null;
  missing_events: number | null;
  saw_amount_below_min: boolean | null;
}

export interface WhyNotPath {
  add: WhyNotAddition[];
  result: { confidence: number; state: State; gate: Gate; displaces: string[]; verified: boolean };
}

export interface WhyNotResponse {
  moment_id: string;
  title: string;
  target: "ask" | "act";
  target_threshold: number;
  current: { state: State; gate: Gate; confidence: number; inferred: number };
  verdict: "already_there" | "evidence_gap" | "blocked_by_rule" | "rejected_by_you" | "held_back" | "unreachable";
  blockers: { code: string; detail: string }[];
  paths: WhyNotPath[];
  cannot_change: { key: string; label: string; reason: "profile" | "consent_off" }[];
}

export interface Overrides {
  consents: Consents;
  signalsOff: string[];
  signalsOn: string[];
  maxActive: number;
  feedback: Record<string, FeedbackAction>;
}

export type FixtureWho = "sofie" | "lucas" | "marc";
