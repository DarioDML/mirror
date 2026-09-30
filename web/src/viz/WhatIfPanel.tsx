import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Lang } from "../types";
import { diffScenarios, emptyOverrides, pct, scenariosAgree, simulate } from "./model";
import { stateLabel, t } from "./strings";
import type { BeliefState, ChangeRow, Overrides, Scenario, WhatIfRequest, WhatIfResponse } from "./types";

export type VerifyStatus = "local" | "checking" | "verified" | "differs" | "offline";

export interface WhatIfView {
  baseline: Scenario;
  scenario: Scenario;
  changes: ChangeRow[];
  status: VerifyStatus;
}

export function isPristine(o: Overrides, base: Scenario): boolean {
  return (
    o.consents.transactions &&
    o.consents.app &&
    o.signalsOff.length === 0 &&
    o.signalsOn.length === 0 &&
    o.maxActive === base.max_active &&
    Object.keys(o.feedback).length === 0
  );
}

function toRequest(o: Overrides, base: Scenario): WhatIfRequest {
  const body: WhatIfRequest = {};
  const consents: { transactions?: boolean; app?: boolean } = {};
  if (!o.consents.transactions) consents.transactions = false;
  if (!o.consents.app) consents.app = false;
  if (Object.keys(consents).length > 0) body.consents = consents;
  if (Object.keys(o.feedback).length > 0) body.feedback = o.feedback;
  if (o.signalsOff.length > 0) body.signals_off = o.signalsOff;
  if (o.signalsOn.length > 0) body.signals_on = o.signalsOn;
  if (o.maxActive !== base.max_active) body.max_active = o.maxActive;
  return body;
}

export function useWhatIf(base: Scenario, o: Overrides, demo: boolean): WhatIfView {
  const local = useMemo(() => simulate(base, o), [base, o]);
  const [remote, setRemote] = useState<{ res: WhatIfResponse; agree: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  const pristine = isPristine(o, base);

  useEffect(() => {
    setRemote(null);
    if (demo || pristine) {
      setChecking(false);
      return;
    }
    const mine = ++seq.current;
    setChecking(true);
    const timer = window.setTimeout(() => {
      api<WhatIfResponse>("/me/whatif", { method: "POST", body: toRequest(o, base) })
        .then((res) => {
          if (seq.current !== mine) return;
          setRemote({ res, agree: scenariosAgree(local, res.scenario) });
          setChecking(false);
        })
        .catch(() => {
          if (seq.current === mine) setChecking(false);
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
    };
  }, [o, base, demo, pristine, local]);

  if (remote && !remote.agree) {
    return { baseline: base, scenario: remote.res.scenario, changes: remote.res.changes, status: "differs" };
  }
  const status: VerifyStatus = demo ? "offline" : pristine ? "local" : remote ? "verified" : checking ? "checking" : "local";
  return { baseline: base, scenario: local, changes: diffScenarios(base, local), status };
}

interface Props {
  lang: Lang;
  base: Scenario;
  overrides: Overrides;
  onChange: (o: Overrides) => void;
  view: WhatIfView;
}

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

function verifyLabel(lang: Lang, s: VerifyStatus): { text: string; cls: string } {
  switch (s) {
    case "verified":
      return { text: t(lang, "verified"), cls: "viz-verify-ok" };
    case "checking":
      return { text: t(lang, "checking"), cls: "viz-verify-wait" };
    case "differs":
      return { text: t(lang, "disagree"), cls: "viz-verify-bad" };
    default:
      return { text: t(lang, "localOnly"), cls: "viz-verify-wait" };
  }
}

function BeliefList({ lang, beliefs }: { lang: Lang; beliefs: BeliefState[] }) {
  return (
    <ul>
      {beliefs.map((b) => (
        <li key={b.moment_id}>
          <span>{b.title}</span>
          <span>
            <b>{pct(b.inferred)}%</b> · {stateLabel(lang, b.state, b.gate)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function WhatIfPanel({ lang, base, overrides, onChange, view }: Props) {
  const signals = base.beliefs.flatMap((b) => b.signals.map((s) => ({ ...s, moment: b.title })));
  const verify = verifyLabel(lang, view.status);
  const titleOf = (id: string): string => base.beliefs.find((b) => b.moment_id === id)?.title ?? id;
  return (
    <section className="viz-whatif" aria-label={t(lang, "whatIf")}>
      <div className="viz-row-head">
        <h3>{t(lang, "whatIf")}</h3>
        <span className={`viz-verify ${verify.cls}`}>{verify.text}</span>
      </div>
      <p className="viz-whatif-sub">{t(lang, "whatIfSub")}</p>
      <div className="viz-controls-row">
        <label className="viz-toggle">
          <input
            type="checkbox"
            checked={overrides.consents.transactions}
            disabled={!base.consents.transactions}
            onChange={(e) => onChange({ ...overrides, consents: { ...overrides.consents, transactions: e.target.checked } })}
          />
          {t(lang, "cTx")}
        </label>
        <label className="viz-toggle">
          <input
            type="checkbox"
            checked={overrides.consents.app}
            disabled={!base.consents.app}
            onChange={(e) => onChange({ ...overrides, consents: { ...overrides.consents, app: e.target.checked } })}
          />
          {t(lang, "cApp")}
        </label>
        <span className="viz-stepper">
          <span className="muted">{t(lang, "maxActive")}</span>
          <button className="viz-btn" disabled={overrides.maxActive <= 1} onClick={() => onChange({ ...overrides, maxActive: overrides.maxActive - 1 })} aria-label="-">
            −
          </button>
          <b>{overrides.maxActive}</b>
          <button className="viz-btn" disabled={overrides.maxActive >= 5} onClick={() => onChange({ ...overrides, maxActive: overrides.maxActive + 1 })} aria-label="+">
            +
          </button>
        </span>
        <button className="viz-btn" onClick={() => onChange(emptyOverrides(base))} disabled={isPristine(overrides, base)}>
          {t(lang, "reset")}
        </button>
      </div>
      <div className="viz-sig-rows" aria-label={t(lang, "signalsToggle")}>
        {signals.map((s) => {
          const off = overrides.signalsOff.includes(s.key);
          const on = overrides.signalsOn.includes(s.key);
          return (
            <div key={s.key} className="viz-sig-row">
              <span className="grow">
                {s.label} <span className="muted">· {s.moment} · {Math.round(s.weight * 100)}</span>
              </span>
              <span className="viz-seg">
                <button className={on ? "on" : ""} aria-pressed={on} onClick={() => onChange({ ...overrides, signalsOn: toggle(overrides.signalsOn, s.key), signalsOff: overrides.signalsOff.filter((k) => k !== s.key) })}>
                  {t(lang, "yes")}
                </button>
                <button className={off ? "on" : ""} aria-pressed={off} onClick={() => onChange({ ...overrides, signalsOff: toggle(overrides.signalsOff, s.key), signalsOn: overrides.signalsOn.filter((k) => k !== s.key) })}>
                  {t(lang, "notTrue")}
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <div className="viz-compare">
        <div>
          <span className="viz-label">{t(lang, "baseline")}</span>
          <BeliefList lang={lang} beliefs={view.baseline.beliefs} />
        </div>
        <div>
          <span className="viz-label">{t(lang, "scenario")}</span>
          <BeliefList lang={lang} beliefs={view.scenario.beliefs} />
        </div>
      </div>
      <div className="viz-changes" aria-live="polite">
        <span className="viz-label">{t(lang, "changes")}</span>
        {view.changes.length === 0 ? (
          <p className="muted">{t(lang, "noChange")}</p>
        ) : (
          view.changes.map((c) => (
            <div key={c.moment_id} className="viz-change">
              <b>{titleOf(c.moment_id)}</b>
              <span>
                {pct(c.from_conf)}% → <b>{pct(c.to_conf)}%</b>
              </span>
              <span className="muted">
                {c.from_state === c.to_state ? "" : `${stateLabel(lang, c.from_state, "between_ask_act")} → ${stateLabel(lang, c.to_state, "between_ask_act")}`}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
