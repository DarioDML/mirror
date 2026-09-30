const nf = new Intl.NumberFormat("en-GB");

export const fmtInt = (n: number): string => nf.format(Math.round(n));

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export const fmtPct = (x: number | null): string => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

export function stageLabel(id: string): string {
  const known: Record<string, string> = {
    events: "Events",
    signals: "Signals",
    beliefs: "Beliefs",
    above_threshold: "Above threshold",
    messages: "Messages",
    population: "Customers",
    consent: "With consent",
    behavioural: "With signals",
    above_ask: "Above ask",
    delivered: "Delivered",
    advisor: "Human advisor",
    fatigue: "Held back",
  };
  return known[id] ?? id.replace(/_/g, " ");
}
