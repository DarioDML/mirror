import type {
  BeliefState,
  ChangeRow,
  ChannelId,
  ChannelMode,
  Consents,
  Gate,
  Overrides,
  Scenario,
  SignalState,
  State,
  TheaterPayload,
  WhyNotPath,
  WhyNotResponse,
} from "./types";

export const CHANNEL_IDS: ChannelId[] = ["app_card", "voice", "advisor"];

export function noisyOr(weights: number[]): number {
  return 1 - weights.reduce((acc, w) => acc * (1 - w), 1);
}

export function pct(x: number): number {
  return Math.round(x * 100);
}

export function fmtW(w: number): string {
  const s = w.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return s.startsWith("0.") ? s.slice(1) : s;
}

export function formula(weights: number[], shown: number): string {
  if (weights.length === 0) return "0% = 1-1";
  return `1-${weights.map((w) => `(1-${fmtW(w)})`).join("")}=${pct(shown)}%`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function easeOut(x: number): number {
  const c = clamp(x, 0, 1);
  return 1 - (1 - c) * (1 - c) * (1 - c);
}

export function isCareGate(g: Gate): boolean {
  return g === "care_advisor" || g === "care_suppress" || g === "human_first";
}

export function isHumanRoute(state: State, gate: Gate): boolean {
  return state === "advisor" || isCareGate(gate);
}

function sourceBlocked(s: SignalState, c: Consents): boolean {
  if (s.source === "transactions") return !c.transactions;
  if (s.source === "app") return !c.app;
  return false;
}

function isActive(s: SignalState, o: Overrides, eff: Consents): boolean {
  if (o.signalsOff.includes(s.key)) return false;
  if (sourceBlocked(s, eff)) return false;
  if (o.signalsOn.includes(s.key)) return true;
  return s.hit && !s.consent_off;
}

function decide(b: BeliefState, inferred: number, fb: BeliefState["feedback"]): { state: State; gate: Gate } {
  if (fb === "rejected") return { state: "suppressed_feedback", gate: "rejected" };
  if (inferred < b.thresholds.ask) return { state: "wait", gate: "below_ask" };
  if (b.gate === "care_advisor" || b.gate === "human_first") return { state: "advisor", gate: b.gate };
  if (b.gate === "care_suppress") return { state: "wait", gate: "care_suppress" };
  if (b.gate === "min_age") return { state: "blocked_guardrail", gate: "min_age" };
  if (inferred >= b.thresholds.act) return { state: "act", gate: "above_act" };
  return { state: "ask", gate: "between_ask_act" };
}

export function simulate(base: Scenario, o: Overrides): Scenario {
  const eff: Consents = {
    transactions: base.consents.transactions && o.consents.transactions,
    app: base.consents.app && o.consents.app,
  };
  const interim = base.beliefs.map((b) => {
    const signals = b.signals.map((s) => ({
      ...s,
      forced: o.signalsOff.includes(s.key) ? ("off" as const) : o.signalsOn.includes(s.key) ? ("on" as const) : null,
    }));
    const active = signals.filter((s) => isActive(s, o, eff));
    const inferred = noisyOr(active.map((s) => s.weight));
    const fbAction = o.feedback[b.moment_id];
    const fb: BeliefState["feedback"] = fbAction === undefined ? b.feedback : fbAction === "clear" ? null : fbAction;
    const d = decide(b, inferred, fb);
    return { b, signals, inferred, fb, d, score: inferred * Math.max(b.priority, 1) };
  });
  const live = interim
    .filter((x) => x.d.state === "act" || x.d.state === "ask" || x.d.state === "advisor")
    .sort((a, c) => c.score - a.score);
  const allowed = new Set(live.slice(0, o.maxActive).map((x) => x.b.moment_id));
  const beliefs = interim.map((x) => {
    const idx = live.findIndex((l) => l.b.moment_id === x.b.moment_id);
    const isLive = idx >= 0;
    const capped = isLive && !allowed.has(x.b.moment_id);
    const out: BeliefState = {
      ...x.b,
      inferred: x.inferred,
      confidence: x.inferred,
      feedback: x.fb,
      state: capped ? "deferred_fatigue" : x.d.state,
      gate: capped ? "fatigue_cap" : x.d.gate,
      rank: isLive ? idx + 1 : null,
      score: x.score,
      signals: x.signals,
    };
    return out;
  });
  return { as_of: base.as_of, max_active: o.maxActive, consents: eff, beliefs };
}

export function diffScenarios(a: Scenario, b: Scenario): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const before of a.beliefs) {
    const after = b.beliefs.find((x) => x.moment_id === before.moment_id);
    if (!after) continue;
    if (after.state !== before.state || Math.abs(after.inferred - before.inferred) > 0.0005) {
      rows.push({
        moment_id: before.moment_id,
        from_state: before.state,
        to_state: after.state,
        from_conf: before.inferred,
        to_conf: after.inferred,
      });
    }
  }
  return rows;
}

export function scenariosAgree(local: Scenario, server: Scenario): boolean {
  return local.beliefs.every((lb) => {
    const sb = server.beliefs.find((x) => x.moment_id === lb.moment_id);
    return sb !== undefined && sb.state === lb.state && Math.abs(sb.inferred - lb.inferred) < 0.01;
  });
}

export function emptyOverrides(base: Scenario): Overrides {
  return { consents: { transactions: true, app: true }, signalsOff: [], signalsOn: [], maxActive: base.max_active, feedback: {} };
}

export function whyNotLocal(base: Scenario, momentId: string): WhyNotResponse | null {
  const b = base.beliefs.find((x) => x.moment_id === momentId);
  if (!b) return null;
  const target: "ask" | "act" = b.inferred < b.thresholds.ask ? "ask" : "act";
  const threshold = b.thresholds[target];
  const current = { state: b.state, gate: b.gate, confidence: b.inferred, inferred: b.inferred };
  const active = b.signals.filter((s) => s.hit && !s.consent_off);
  const missing = b.signals.filter((s) => !s.hit && !s.consent_off && s.source !== "profile");
  const cannot = b.signals
    .filter((s) => s.consent_off || s.source === "profile")
    .map((s) => ({ key: s.key, label: s.label, reason: s.consent_off ? ("consent_off" as const) : ("profile" as const) }));
  const base0 = { moment_id: b.moment_id, title: b.title, current, cannot_change: cannot };
  if (b.inferred >= b.thresholds.act) {
    return { ...base0, target: "act", target_threshold: b.thresholds.act, verdict: "already_there", blockers: [], paths: [] };
  }
  if (b.feedback === "rejected") {
    return { ...base0, target, target_threshold: threshold, verdict: "rejected_by_you", blockers: [{ code: "rejected", detail: "rejected" }], paths: [] };
  }
  const paths: WhyNotPath[] = [];
  for (const s of missing) {
    const conf = noisyOr([...active.map((x) => x.weight), s.weight]);
    if (conf >= threshold) {
      paths.push({
        add: [
          {
            key: s.key,
            signal_id: s.signal_id,
            label: s.label,
            weight: s.weight,
            need: { min_count: 1, min_amount: null, within_days: null },
            have: s.n,
            missing_events: 1,
            saw_amount_below_min: null,
          },
        ],
        result: {
          confidence: conf,
          state: conf >= b.thresholds.act ? "act" : "ask",
          gate: conf >= b.thresholds.act ? "above_act" : "between_ask_act",
          displaces: [],
          verified: true,
        },
      });
    }
  }
  const held = isCareGate(b.gate) || b.gate === "min_age";
  return {
    ...base0,
    target,
    target_threshold: threshold,
    verdict: held ? "blocked_by_rule" : paths.length > 0 ? "evidence_gap" : "unreachable",
    blockers: held ? [{ code: b.gate, detail: b.gate }] : [],
    paths: paths.slice(0, 3),
  };
}

const DEFAULT_POLICY: Record<State, Record<ChannelId, ChannelMode>> = {
  act: { app_card: "deliver", voice: "deliver", advisor: "note_only" },
  ask: { app_card: "deliver", voice: "deliver", advisor: "muted" },
  advisor: { app_card: "muted", voice: "muted", advisor: "note_only" },
  wait: { app_card: "muted", voice: "muted", advisor: "muted" },
  blocked_guardrail: { app_card: "muted", voice: "muted", advisor: "muted" },
  deferred_fatigue: { app_card: "muted", voice: "muted", advisor: "muted" },
  suppressed_feedback: { app_card: "severed", voice: "severed", advisor: "flag_do_not_mention" },
};

const MODES: ChannelMode[] = ["deliver", "muted", "severed", "flag_do_not_mention", "note_only"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isMode(v: unknown): v is ChannelMode {
  return typeof v === "string" && MODES.some((m) => m === v);
}

export function channelMode(payload: TheaterPayload, state: State, channel: ChannelId): ChannelMode {
  const raw = payload.channels;
  if (isRecord(raw)) {
    const row = raw[state];
    if (isRecord(row)) {
      const m = row[channel];
      if (isMode(m)) return m;
    }
  }
  return DEFAULT_POLICY[state][channel];
}
