import { createContext, useContext } from "react";
import type { Api } from "../api";
import type { Lang, Role } from "../types";

export type DeckSession = {
  username: string;
  role: Role;
  display_name: string;
  token: string;
  expired: boolean;
};

export const DECK_USERS: readonly { username: string; role: Role; key: "lp_sofie" | "lp_lucas" | "lp_marc" | "lp_an" | "lp_jan" | "lp_po"; label: string }[] = [
  { username: "sofie", role: "customer", key: "lp_sofie", label: "Sofie" },
  { username: "lucas", role: "customer", key: "lp_lucas", label: "Lucas" },
  { username: "marc", role: "customer", key: "lp_marc", label: "Marc" },
  { username: "an", role: "advisor", key: "lp_an", label: "An" },
  { username: "jan", role: "advisor", key: "lp_jan", label: "Jan" },
  { username: "po", role: "product_owner", key: "lp_po", label: "PO" },
];

export type ViewContext = { api: Api; lang: Lang; setLang: (l: Lang) => void };

export const ViewCtx = createContext<ViewContext | null>(null);

export function useView(): ViewContext {
  const v = useContext(ViewCtx);
  if (!v) throw new Error("ViewCtx missing");
  return v;
}
