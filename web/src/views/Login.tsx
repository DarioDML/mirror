import { useState, type FormEvent } from "react";
import { makeApi, ApiError } from "../api";
import { t } from "../i18n";
import type { Lang, Session } from "../types";
import { DECK_USERS, type DeckSession } from "../deck/deck";
import LangSwitch from "../deck/LangSwitch";

const loginApi = makeApi(
  () => null,
  () => undefined,
);

type Props = {
  lang: Lang;
  onLang: (l: Lang) => void;
  onLogin: (username: string, s: Session) => void;
  onDeck: (sessions: DeckSession[]) => void;
};

function failureText(lang: Lang, err: unknown): string {
  return err instanceof ApiError && (err.status === 401 || err.status === 422) ? t(lang, "lp_badLogin") : t(lang, "lp_unreachable");
}

export default function Login({ lang, onLang, onLogin, onDeck }: Props) {
  const [username, setUsername] = useState("sofie");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await loginApi.json<Session>("/auth/login", { method: "POST", body: { username: username.trim(), password } });
      setPassword("");
      onLogin(username.trim(), s);
    } catch (err) {
      setError(failureText(lang, err));
    } finally {
      setBusy(false);
    }
  }

  async function startDeck() {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    const results = await Promise.allSettled(
      DECK_USERS.map((u) => loginApi.json<Session>("/auth/login", { method: "POST", body: { username: u.username, password } })),
    );
    setPassword("");
    const sessions: DeckSession[] = [];
    results.forEach((r, i) => {
      const u = DECK_USERS[i];
      if (u && r.status === "fulfilled") {
        sessions.push({ username: u.username, role: r.value.role, display_name: r.value.display_name, token: r.value.token, expired: false });
      }
    });
    setBusy(false);
    if (sessions.length === 0) {
      const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      setError(failureText(lang, first?.reason));
      return;
    }
    if (sessions.length < DECK_USERS.length) setError(t(lang, "lp_deckFail"));
    onDeck(sessions);
  }

  return (
    <div className="login-wrap">
      <div className="login-lang">
        <LangSwitch lang={lang} onLang={onLang} />
      </div>
      <div className="login-card">
        <div className="brand big">
          <span className="brand-mark" aria-hidden />
          Mirror
        </div>
        <p className="lead">{t(lang, "lp_tagline")}</p>
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>{t(lang, "lp_username")}</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label className="field">
            <span>{t(lang, "lp_password")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder={t(lang, "lp_passwordPh")}
            />
          </label>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <button className="btn primary" disabled={busy || !password}>
            {busy ? t(lang, "lp_signingIn") : t(lang, "lp_signIn")}
          </button>
        </form>
        <div className="demo-users">
          {DECK_USERS.map((u) => (
            <button
              key={u.username}
              type="button"
              className={`demo-user ${username === u.username ? "active" : ""}`}
              onClick={() => setUsername(u.username)}
            >
              <strong>{u.label}</strong>
              <span>{t(lang, u.key)}</span>
            </button>
          ))}
        </div>
        <div className="deck-start">
          <button type="button" className="btn deck-btn" disabled={busy || !password} onClick={startDeck}>
            {t(lang, "lp_deck")}
          </button>
          <p className="muted small">{t(lang, "lp_deckSub")}</p>
        </div>
      </div>
    </div>
  );
}
