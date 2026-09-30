import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { makeApi, setToken, setUnauthorizedHandler, ApiError, type Api } from "./api";
import { t, pickLang } from "./i18n";
import type { Lang, Role, Session } from "./types";
import { applyLang, applyUi, DEFAULT_UI } from "./theme/theme";
import { DECK_USERS, ViewCtx, type DeckSession, type ViewContext } from "./deck/deck";
import Dock from "./deck/Dock";
import LangSwitch from "./deck/LangSwitch";
import ErrorBoundary from "./deck/ErrorBoundary";
import Login from "./views/Login";
import Mirror from "./views/Mirror";
import Advisor from "./views/Advisor";
import ProductOwner from "./views/ProductOwner";

const ROLE_KEY: Record<Role, "role_customer" | "role_advisor" | "role_product_owner"> = {
  customer: "role_customer",
  advisor: "role_advisor",
  product_owner: "role_product_owner",
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default function App() {
  const [sessions, setSessions] = useState<DeckSession[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [deck, setDeck] = useState(false);
  const [lang, setLangState] = useState<Lang>(pickLang);
  const tokens = useRef(new Map<string, string>());
  const activeRef = useRef<string | null>(null);
  const deckRef = useRef(false);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
  }, []);

  useEffect(() => applyLang(lang), [lang]);

  const markExpired = useCallback((username: string) => {
    setSessions((prev) => prev.map((s) => (s.username === username ? { ...s, expired: true } : s)));
  }, []);

  const logout = useCallback(() => {
    tokens.current.clear();
    activeRef.current = null;
    deckRef.current = false;
    setToken(null);
    setSessions([]);
    setActive(null);
    setDeck(false);
  }, []);

  const onExpired = useCallback(
    (username: string) => {
      if (deckRef.current) markExpired(username);
      else logout();
    },
    [markExpired, logout],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const u = activeRef.current;
      if (u) onExpired(u);
    });
  }, [onExpired]);

  const activate = useCallback((username: string, list: readonly DeckSession[]) => {
    const s = list.find((x) => x.username === username);
    if (!s) return;
    activeRef.current = username;
    setToken(s.expired ? null : s.token);
    setActive(username);
  }, []);

  const adopt = useCallback(
    (list: DeckSession[], isDeck: boolean, first: string) => {
      tokens.current = new Map(list.map((s) => [s.username, s.token]));
      deckRef.current = isDeck;
      setDeck(isDeck);
      setSessions(list);
      activate(first, list);
    },
    [activate],
  );

  const switchTo = useCallback(
    (username: string) => {
      if (username === activeRef.current) return;
      activate(username, sessions);
    },
    [activate, sessions],
  );

  useEffect(() => {
    if (!deck) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const n = Number(e.key);
      const user = Number.isInteger(n) ? DECK_USERS[n - 1] : undefined;
      if (user && sessions.some((s) => s.username === user.username)) switchTo(user.username);
    };
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [deck, sessions, switchTo]);

  const current = sessions.find((s) => s.username === active) ?? null;

  useLayoutEffect(() => {
    applyUi(DEFAULT_UI, current?.role ?? "customer");
  }, [current?.username, current?.role]);

  const apis = useMemo(() => new Map<string, Api>(), []);
  const apiFor = useCallback(
    (username: string): Api => {
      const hit = apis.get(username);
      if (hit) return hit;
      const made = makeApi(
        () => tokens.current.get(username) ?? null,
        () => onExpired(username),
      );
      apis.set(username, made);
      return made;
    },
    [apis, onExpired],
  );

  if (!current) {
    return (
      <Login
        lang={lang}
        onLang={setLang}
        onLogin={(username, s: Session) =>
          adopt([{ username, role: s.role, display_name: s.display_name, token: s.token, expired: false }], false, username)
        }
        onDeck={(list) => {
          const first = DECK_USERS.find((u) => list.some((s) => s.username === u.username))?.username ?? list[0]?.username;
          if (first) adopt(list, true, first);
        }}
      />
    );
  }

  const ctx: ViewContext = { api: apiFor(current.username), lang, setLang };

  return (
    <div className="app" data-role={current.role}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Mirror
        </div>
        <div className="topbar-right">
          {current.role !== "customer" && <LangSwitch lang={lang} onLang={setLang} />}
          <span className="role-pill">{t(lang, ROLE_KEY[current.role])}</span>
          <span className="muted">{current.display_name}</span>
          <button className="btn ghost small" onClick={logout}>
            {t(lang, "logout")}
          </button>
        </div>
      </header>
      <main className="content">
        <ErrorBoundary key={current.username} lang={lang}>
          {current.expired ? (
            <Reauth
              lang={lang}
              session={current}
              onDone={(s) => {
                tokens.current.set(s.username, s.token);
                setSessions((prev) => prev.map((x) => (x.username === s.username ? s : x)));
                setToken(s.token);
              }}
            />
          ) : (
            <ViewCtx.Provider value={ctx}>
              {current.role === "customer" && <Mirror />}
              {current.role === "advisor" && <Advisor />}
              {current.role === "product_owner" && <ProductOwner />}
            </ViewCtx.Provider>
          )}
        </ErrorBoundary>
      </main>
      {deck && <Dock lang={lang} sessions={sessions} active={current.username} onSwitch={switchTo} />}
    </div>
  );
}

const plainApi = makeApi(
  () => null,
  () => undefined,
);

function Reauth({ lang, session, onDone }: { lang: Lang; session: DeckSession; onDone: (s: DeckSession) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await plainApi.json<Session>("/auth/login", {
        method: "POST",
        body: { username: session.username, password },
      });
      setPassword("");
      onDone({ ...session, token: s.token, expired: false });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t(lang, "lp_badLogin") : t(lang, "lp_unreachable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card reauth stack" onSubmit={submit}>
      <h2>{session.display_name}</h2>
      <label className="field">
        <span>{t(lang, "lp_password")}</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
      </label>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <button className="btn primary" disabled={busy || !password}>
        {t(lang, "lp_signIn")}
      </button>
    </form>
  );
}
