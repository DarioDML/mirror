import { useEffect, useState } from "react";
import { setToken, setUnauthorizedHandler } from "./api";
import type { Session } from "./types";
import Login from "./views/Login";
import Mirror from "./views/Mirror";
import Advisor from "./views/Advisor";
import ProductOwner from "./views/ProductOwner";

const ROLE_LABEL = { customer: "Customer app", advisor: "Advisor desk", product_owner: "Product owner" } as const;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setSession(null);
    });
  }, []);

  const logout = () => {
    setToken(null);
    setSession(null);
  };

  if (!session) {
    return (
      <Login
        onLogin={(s) => {
          setToken(s.token);
          setSession(s);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Mirror
        </div>
        <div className="topbar-right">
          <span className="role-pill">{ROLE_LABEL[session.role]}</span>
          <span className="muted">{session.display_name}</span>
          <button className="btn ghost small" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main className="content">
        {session.role === "customer" && <Mirror />}
        {session.role === "advisor" && <Advisor />}
        {session.role === "product_owner" && <ProductOwner />}
      </main>
    </div>
  );
}
