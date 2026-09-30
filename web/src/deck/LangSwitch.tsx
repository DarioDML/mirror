import { t } from "../i18n";
import type { Lang } from "../types";

export default function LangSwitch({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  return (
    <div className="lang-switch" role="group" aria-label={t(lang, "language")}>
      {(["en", "nl", "fr"] as const).map((l) => (
        <button key={l} className={l === lang ? "active" : ""} aria-pressed={l === lang} onClick={() => onLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
