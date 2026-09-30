import { t } from "../i18n";
import type { Lang } from "../types";
import { DECK_USERS, type DeckSession } from "./deck";

type Props = {
  lang: Lang;
  sessions: readonly DeckSession[];
  active: string;
  onSwitch: (username: string) => void;
};

export default function Dock({ lang, sessions, active, onSwitch }: Props) {
  const current = sessions.find((s) => s.username === active);
  return (
    <nav className="dock" aria-label={t(lang, "dock_label")}>
      <div role="tablist" className="dock-tabs">
        {DECK_USERS.map((u, i) => {
          const s = sessions.find((x) => x.username === u.username);
          if (!s) return null;
          const on = u.username === active;
          return (
            <button
              key={u.username}
              role="tab"
              aria-selected={on}
              className={`dock-chip ${on ? "on" : ""} ${s.expired ? "expired" : ""}`}
              onClick={() => onSwitch(u.username)}
              title={t(lang, u.key)}
            >
              <kbd>{i + 1}</kbd>
              <span>{u.label}</span>
              {s.expired && <em>{t(lang, "dock_expired")}</em>}
            </button>
          );
        })}
      </div>
      <span className="sr-only" aria-live="polite">
        {current ? t(lang, "dock_now", { name: current.display_name }) : ""}
      </span>
    </nav>
  );
}
