import type { Lang, Role, Ui } from "../types";

export type Layout = "calm" | "studio" | "default";

export const DEFAULT_UI: Ui = {
  v: 1,
  layout: "guided",
  theme: "daylight",
  density: "normal",
  text_scale: 1,
  motion: "subtle",
  tone: "neutral",
  register: "informal",
  accent: "other",
  emphasis: "overview",
  math: "summary",
};

export function layoutOf(ui: Ui): Layout {
  if (ui.theme === "linen" || ui.density === "airy") return "calm";
  if (ui.layout === "studio" || ui.theme === "studio") return "studio";
  return "default";
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function applyUi(ui: Ui, role: Role): void {
  const root = document.documentElement;
  const customer = role === "customer";
  root.dataset["role"] = role;
  root.dataset["theme"] = customer ? ui.theme : "daylight";
  root.dataset["density"] = customer ? ui.density : role === "advisor" ? "compact" : "normal";
  root.dataset["motion"] = prefersReducedMotion() ? "none" : ui.motion;
  root.dataset["layout"] = customer ? layoutOf(ui) : "default";
  root.dataset["accent"] = customer ? ui.accent : "other";
  root.style.setProperty("--text-scale", String(customer ? ui.text_scale : 1));
}

export function applyLang(lang: Lang): void {
  document.documentElement.lang = lang;
}

export function uiOrDefault(ui: Ui | undefined): Ui {
  return ui ?? DEFAULT_UI;
}
