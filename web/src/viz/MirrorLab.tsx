import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type { Lang } from "../types";
import BeliefWeb from "./BeliefWeb";
import { FIXTURE_WHO, fixturePayload } from "./fixtures";
import { emptyOverrides } from "./model";
import ReasoningTheater from "./ReasoningTheater";
import { t } from "./strings";
import type { FixtureWho, Overrides, TheaterPayload } from "./types";
import WhatIfPanel, { useWhatIf } from "./WhatIfPanel";
import WhyNotList from "./WhyNot";
import "./viz.css";

export interface MirrorLabProps {
  lang: Lang;
  refreshKey: number;
}

type Tab = "theater" | "web" | "whynot";

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; payload: TheaterPayload; demo: boolean };

function readQuery(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

function isWho(v: string | null): v is FixtureWho {
  return v === "sofie" || v === "lucas" || v === "marc";
}

function isTheater(p: TheaterPayload): boolean {
  return Array.isArray(p.frames) && Array.isArray(p.events) && Array.isArray(p.final?.beliefs);
}

export default function MirrorLab({ lang, refreshKey }: MirrorLabProps) {
  const forced = readQuery("fixtures") === "1";
  const queryWho = readQuery("who");
  const [who, setWho] = useState<FixtureWho>(isWho(queryWho) ? queryWho : "sofie");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [tab, setTab] = useState<Tab>("theater");
  const [stage, setStage] = useState<boolean>(readQuery("stage") === "1");
  const [overrides, setOverrides] = useState<Overrides | null>(null);

  useEffect(() => {
    let alive = true;
    if (forced) {
      setLoad({ status: "ok", payload: fixturePayload(who, lang), demo: true });
      return;
    }
    setLoad((l) => (l.status === "ok" ? l : { status: "loading" }));
    api<TheaterPayload>("/me/theater")
      .then((payload) => {
        if (!alive) return;
        if (isTheater(payload)) setLoad({ status: "ok", payload, demo: false });
        else setLoad({ status: "ok", payload: fixturePayload(who, lang), demo: true });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setLoad({ status: "error" });
        else setLoad({ status: "ok", payload: fixturePayload(who, lang), demo: true });
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, forced, who, lang]);

  const payload = load.status === "ok" ? load.payload : null;
  const demo = load.status === "ok" && load.demo;
  useEffect(() => {
    if (payload) setOverrides(emptyOverrides(payload.final));
  }, [payload]);

  const base = useMemo(() => payload?.final ?? { as_of: "", max_active: 1, consents: { transactions: true, app: true }, beliefs: [] }, [payload]);
  const current = overrides ?? emptyOverrides(base);
  const view = useWhatIf(base, current, demo);

  const tabs: { id: Tab; label: string }[] = [
    { id: "theater", label: t(lang, "tabTheater") },
    { id: "web", label: t(lang, "tabWeb") },
    { id: "whynot", label: t(lang, "tabWhyNot") },
  ];

  return (
    <section className={`viz-lab${stage ? " viz-stage" : ""}`} aria-label={t(lang, "title")}>
      <div className="viz-head">
        <div>
          <h2>{t(lang, "title")}</h2>
          <p>{t(lang, "sub")}</p>
        </div>
        <div className="viz-head-tools">
          {demo && <span className="viz-badge">{t(lang, "demoData")}</span>}
          {demo && (
            <select className="viz-select" value={who} aria-label={t(lang, "who")} onChange={(e) => isWho(e.target.value) && setWho(e.target.value)}>
              {FIXTURE_WHO.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          )}
          <button className="viz-btn" aria-pressed={stage} onClick={() => setStage((s) => !s)}>
            {t(lang, "stage")}
          </button>
        </div>
      </div>
      <div className="viz-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={`viz-tab${tab === x.id ? " on" : ""}`} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      {load.status === "loading" && <p className="viz-empty">{t(lang, "loading")}</p>}
      {load.status === "error" && <p className="viz-empty">{t(lang, "error")}</p>}
      {payload && tab === "theater" && (
        <>
          <ReasoningTheater lang={lang} payload={payload} stage={stage} />
          <WhatIfPanel lang={lang} base={base} overrides={current} onChange={setOverrides} view={view} />
        </>
      )}
      {payload && tab === "web" && <BeliefWeb lang={lang} payload={payload} demo={demo} />}
      {payload && tab === "whynot" && (
        <WhyNotList
          lang={lang}
          base={base}
          demo={demo}
          onTry={(key) => {
            setOverrides({ ...current, signalsOn: current.signalsOn.includes(key) ? current.signalsOn : [...current.signalsOn, key] });
            setTab("theater");
          }}
        />
      )}
    </section>
  );
}
