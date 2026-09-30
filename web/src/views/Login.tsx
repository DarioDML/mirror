import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import type { Session } from "../types";

const DEMO_USERS = [
  { username: "sofie", label: "Sofie", hint: "Customer · buying a home" },
  { username: "lucas", label: "Lucas", hint: "Customer · going freelance" },
  { username: "marc", label: "Marc", hint: "Customer · needs a human" },
  { username: "an", label: "An", hint: "Advisor for Sofie & Marc" },
  { username: "po", label: "Product owner", hint: "Population view" },
];

export default function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState("sofie");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api<Session>("/auth/login", { method: "POST", body: { username, password } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand big">
          <span className="brand-mark" aria-hidden />
          Mirror
        </div>
        <p className="lead">One shared understanding of every customer, which the customer can see and correct.</p>
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="DEMO_PASSWORD from your .env"
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="btn primary" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="demo-users">
          {DEMO_USERS.map((u) => (
            <button
              key={u.username}
              type="button"
              className={`demo-user ${username === u.username ? "active" : ""}`}
              onClick={() => setUsername(u.username)}
            >
              <strong>{u.label}</strong>
              <span>{u.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
