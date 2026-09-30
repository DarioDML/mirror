export type Lang = "en" | "nl" | "fr";
export type Role = "customer" | "advisor" | "product_owner";

export type Session = { token: string; role: Role; display_name: string; expires_in?: number };

export type Ui = {
  v: number;
  layout: "guided" | "studio" | "quick";
  theme: "daylight" | "linen" | "studio" | "pop";
  density: "airy" | "normal" | "compact";
  text_scale: number;
  motion: "none" | "subtle" | "lively";
  tone: "neutral" | "reassuring" | "direct" | "playful";
  register: "informal" | "formal";
  accent: string;
  emphasis: "overview" | "question" | "plan" | "human";
  math: "hidden" | "summary" | "full";
};

export type Evidence = {
  signal_id: string;
  label: string;
  source: "transactions" | "app" | "profile";
  weight: number;
  count: number;
  last_seen: string | null;
};

export type Belief = {
  moment_id: string;
  title: string;
  category: string;
  confidence: number;
  inferred: number;
  feedback: "confirmed" | "rejected" | null;
  state: string;
  thresholds: { ask: number; act: number };
  evidence: Evidence[];
};

export type Twin = {
  customer: { first_name: string; language: Lang; consents: { transactions: boolean; app: boolean } };
  beliefs: Belief[];
  plans: { moment_id: string; title: string; category: string }[];
  ui?: Ui;
  as_of?: string;
};

export type GuidanceItem = {
  moment_id: string;
  type: "act" | "ask" | "advisor";
  title: string;
  category: string;
  intro: string;
  written_by: "llm" | "template";
  question: string | null;
  steps: { product: string; title: string; body: string }[];
  why: string | null;
  confirmed_by_you: boolean;
  voice_script?: string;
  tone?: string;
};

export type AdvisorCustomer = {
  customer_id: number;
  first_name: string;
  age: number;
  city: string;
  active: number;
  needs_you: boolean;
  last_feedback: string | null;
  moments: string[] | null;
};

export type Brief = {
  customer: {
    customer_id: number;
    first_name: string;
    age: number;
    city: string;
    language: Lang;
    care_flag: boolean;
    consents: { transactions: boolean; app: boolean };
  };
  summary: string;
  items: {
    moment_id: string;
    title: string;
    state: string;
    confidence: number;
    feedback: string | null;
    evidence: string[];
    talking_points: string[];
    note: string;
  }[];
};

export type Count = number | string;

export type Stats = {
  run_ms: number;
  customers: number;
  events: number;
  signal_hits: number;
  beliefs: number;
  moments: number;
  customers_reached: number;
  messages_to_write: number;
  ai_share_of_customers: number;
  opted_out: { transactions: number; app: number };
  states: Record<string, Count>;
  per_moment: {
    moment_id: string;
    title: string;
    custom: boolean;
    act: Count;
    ask: Count;
    advisor: Count;
    deferred: Count;
    blocked: Count;
    rejected_by_customer: Count;
    reach: Count;
    precision: number | null;
    recall: number | null;
    precision_act: number | null;
  }[];
  scale: {
    target_customers: number;
    method: string;
    messages: number;
    tokens: number;
    avg_tokens_per_message: number;
    eur: number | null;
  };
};
