import type { Lang } from "../types";
import { noisyOr } from "./model";
import type {
  BeliefState,
  FixtureWho,
  FrameBelief,
  Gate,
  Scenario,
  SignalSource,
  SignalState,
  State,
  TheaterEvent,
  TheaterFrame,
  TheaterPayload,
} from "./types";

type Tri = Record<Lang, string>;

interface SigDef {
  id: string;
  source: SignalSource;
  weight: number;
  label: Tri;
}

interface MomentDef {
  id: string;
  title: Tri;
  category: string;
  priority: number;
  ask: number;
  act: number;
  signals: SigDef[];
}

interface EventDef {
  date: string;
  source: string;
  kind: string;
  amount: number | null;
  key: string;
}

interface FrameDef {
  as_of: string;
  events: number[];
}

interface PersonaDef {
  first_name: string;
  language: Lang;
  moments: MomentDef[];
  events: EventDef[];
  frames: FrameDef[];
  ignored: number;
  human: boolean;
}

const GROWING: MomentDef = {
  id: "growing_family",
  title: { en: "Growing family", nl: "Gezin dat groeit", fr: "Famille qui s'agrandit" },
  category: "family",
  priority: 5,
  ask: 0.5,
  act: 0.8,
  signals: [
    { id: "baby_store", source: "transactions", weight: 0.3, label: { en: "Baby shop purchase", nl: "Aankoop in babywinkel", fr: "Achat en magasin bébé" } },
    { id: "baby_store_repeat", source: "transactions", weight: 0.35, label: { en: "Second baby shop purchase", nl: "Tweede aankoop in babywinkel", fr: "Deuxième achat en magasin bébé" } },
  ],
};

const HOME: MomentDef = {
  id: "buying_home",
  title: { en: "Buying a home", nl: "Een woning kopen", fr: "Acheter un logement" },
  category: "housing",
  priority: 8,
  ask: 0.6,
  act: 0.85,
  signals: [
    { id: "mortgage_search", source: "app", weight: 0.55, label: { en: "Mortgage calculator in the app", nl: "Hypotheekrekenmachine in de app", fr: "Simulateur hypothécaire dans l'app" } },
    { id: "notary_deposit", source: "transactions", weight: 0.6, label: { en: "Notary deposit", nl: "Voorschot bij de notaris", fr: "Acompte chez le notaire" } },
    { id: "home_insurance_look", source: "app", weight: 0.3, label: { en: "Looked at home insurance", nl: "Woningverzekering bekeken", fr: "Assurance habitation consultée" } },
  ],
};

const FREELANCE: MomentDef = {
  id: "freelance",
  title: { en: "Starting as a freelancer", nl: "Starten als zelfstandige", fr: "Devenir indépendant" },
  category: "work",
  priority: 6,
  ask: 0.6,
  act: 0.8,
  signals: [
    { id: "kvk_registration", source: "transactions", weight: 0.55, label: { en: "Business registration fee", nl: "Kosten ondernemingsregistratie", fr: "Frais d'inscription d'entreprise" } },
    { id: "invoice_tool", source: "app", weight: 0.45, label: { en: "Invoice tool opened", nl: "Factuurtool geopend", fr: "Outil de facturation ouvert" } },
    { id: "accountant", source: "transactions", weight: 0.35, label: { en: "Accountant payment", nl: "Betaling aan boekhouder", fr: "Paiement au comptable" } },
  ],
};

const PERSONAS: Record<FixtureWho, PersonaDef> = {
  sofie: {
    first_name: "Sofie",
    language: "en",
    moments: [GROWING, HOME],
    events: [
      { date: "2026-08-16", source: "transactions", kind: "baby_store", amount: 84.5, key: "growing_family.baby_store" },
      { date: "2026-08-21", source: "transactions", kind: "baby_store", amount: 42, key: "growing_family.baby_store_repeat" },
      { date: "2026-08-26", source: "app", kind: "mortgage_calculator", amount: null, key: "buying_home.mortgage_search" },
      { date: "2026-09-10", source: "transactions", kind: "notary", amount: 2500, key: "buying_home.notary_deposit" },
    ],
    frames: [
      { as_of: "2026-08-16", events: [0] },
      { as_of: "2026-08-21", events: [1] },
      { as_of: "2026-08-26", events: [2] },
      { as_of: "2026-09-10", events: [3] },
    ],
    ignored: 66,
    human: false,
  },
  lucas: {
    first_name: "Lucas",
    language: "nl",
    moments: [FREELANCE],
    events: [
      { date: "2026-09-05", source: "transactions", kind: "kvk_registration", amount: 120, key: "freelance.kvk_registration" },
      { date: "2026-09-08", source: "app", kind: "invoice_tool", amount: null, key: "freelance.invoice_tool" },
      { date: "2026-09-16", source: "transactions", kind: "accountant", amount: 350, key: "freelance.accountant" },
    ],
    frames: [
      { as_of: "2026-09-05", events: [0] },
      { as_of: "2026-09-08", events: [1] },
      { as_of: "2026-09-16", events: [2] },
    ],
    ignored: 41,
    human: false,
  },
  marc: {
    first_name: "Marc",
    language: "fr",
    moments: [HOME],
    events: [
      { date: "2026-08-29", source: "app", kind: "mortgage_calculator", amount: null, key: "buying_home.mortgage_search" },
      { date: "2026-08-31", source: "transactions", kind: "notary", amount: 1800, key: "buying_home.notary_deposit" },
      { date: "2026-09-04", source: "app", kind: "home_insurance", amount: null, key: "buying_home.home_insurance_look" },
    ],
    frames: [
      { as_of: "2026-08-31", events: [0, 1] },
      { as_of: "2026-09-04", events: [2] },
    ],
    ignored: 52,
    human: true,
  },
};

function weightOf(m: MomentDef, sigId: string): number {
  return m.signals.find((s) => s.id === sigId)?.weight ?? 0;
}

function decide(m: MomentDef, inferred: number, human: boolean): { state: State; gate: Gate } {
  if (inferred < m.ask) return { state: "wait", gate: "below_ask" };
  if (human) return { state: "advisor", gate: "care_advisor" };
  if (inferred >= m.act) return { state: "act", gate: "above_act" };
  return { state: "ask", gate: "between_ask_act" };
}

function hitsFor(m: MomentDef, keys: string[]): string[] {
  return keys.filter((k) => k.startsWith(`${m.id}.`));
}

function inferredFor(m: MomentDef, keys: string[]): number {
  return noisyOr(hitsFor(m, keys).map((k) => weightOf(m, k.slice(m.id.length + 1))));
}

function buildSignals(m: MomentDef, hit: string[], events: TheaterEvent[], lang: Lang): SignalState[] {
  return m.signals.map((s) => {
    const key = `${m.id}.${s.id}`;
    const seen = events.filter((e) => e.matches.some((x) => x.key === key));
    return {
      key,
      signal_id: s.id,
      label: s.label[lang],
      source: s.source,
      weight: s.weight,
      hit: hit.includes(key),
      n: seen.length,
      last_seen: seen.length > 0 ? seen[seen.length - 1].date : null,
      cumulative: null,
      without_this: null,
      forced: null,
      consent_off: false,
    };
  });
}

export function fixturePayload(who: FixtureWho, lang: Lang): TheaterPayload {
  const p = PERSONAS[who];
  const events: TheaterEvent[] = p.events.map((e, i) => ({
    i,
    date: e.date,
    source: e.source,
    kind: e.kind,
    amount: e.amount,
    matches: [{ key: e.key, counts: true }],
  }));
  const seenKeys: string[] = [];
  const frames: TheaterFrame[] = p.frames.map((f) => {
    for (const id of f.events) seenKeys.push(p.events[id].key);
    const beliefs: FrameBelief[] = p.moments.map((m) => {
      const inferred = inferredFor(m, seenKeys);
      const d = decide(m, inferred, p.human);
      return { moment_id: m.id, inferred, state: d.state, gate: d.gate, hit_keys: hitsFor(m, seenKeys) };
    });
    return { as_of: f.as_of, event_ids: f.events, beliefs };
  });
  const beliefs: BeliefState[] = p.moments.map((m, idx) => {
    const inferred = inferredFor(m, seenKeys);
    const d = decide(m, inferred, p.human);
    const live = d.state === "act" || d.state === "ask" || d.state === "advisor";
    return {
      moment_id: m.id,
      title: m.title[lang],
      category: m.category,
      priority: m.priority,
      inferred,
      confidence: inferred,
      feedback: null,
      state: d.state,
      gate: d.gate,
      thresholds: { ask: m.ask, act: m.act },
      rank: live ? idx + 1 : null,
      score: inferred * m.priority,
      signals: buildSignals(m, hitsFor(m, seenKeys), events, lang),
    };
  });
  const final: Scenario = { as_of: "2026-09-30", max_active: 2, consents: { transactions: true, app: true }, beliefs };
  return {
    as_of: "2026-09-30",
    customer: { first_name: p.first_name, language: p.language, consents: { transactions: true, app: true }, max_active: 2 },
    events,
    ignored_events: p.ignored,
    frames,
    final,
  };
}

export const FIXTURE_WHO: FixtureWho[] = ["sofie", "lucas", "marc"];
