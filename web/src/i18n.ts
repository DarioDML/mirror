import type { Lang } from "./types";

const T = {
  hello: { en: "Hi {name}.", nl: "Hallo {name}.", fr: "Bonjour {name}." },
  heroSub: {
    en: "This is how KBC understands you right now. Confirm it, correct it, or switch data off. What you change here changes everywhere: in the app, in voice messages and with your advisor.",
    nl: "Zo begrijpt KBC jou op dit moment. Bevestig het, corrigeer het of zet gegevens uit. Wat je hier wijzigt, verandert overal: in de app, in spraakberichten en bij je adviseur.",
    fr: "Voici comment KBC vous comprend en ce moment. Confirmez, corrigez ou désactivez des données. Ce que vous changez ici change partout : dans l'app, dans les messages vocaux et chez votre conseiller.",
  },
  believe: { en: "What we think is going on", nl: "Wat we denken dat er speelt", fr: "Ce que nous pensons qu'il se passe" },
  why: { en: "Why we think this", nl: "Waarom we dit denken", fr: "Pourquoi nous le pensons" },
  right: { en: "That's right", nl: "Klopt", fr: "C'est exact" },
  notTrue: { en: "Not true", nl: "Klopt niet", fr: "Ce n'est pas vrai" },
  undo: { en: "Undo", nl: "Ongedaan maken", fr: "Annuler" },
  rejectedNote: {
    en: "You told us this isn't true. We don't use it anywhere anymore: not in the app and not with your advisor.",
    nl: "Je liet weten dat dit niet klopt. We gebruiken het nergens meer: niet in de app en niet bij je adviseur.",
    fr: "Vous nous avez dit que ce n'est pas vrai. Nous ne l'utilisons plus nulle part : ni dans l'app, ni chez votre conseiller.",
  },
  confirmedNote: { en: "You confirmed this.", nl: "Je hebt dit bevestigd.", fr: "Vous l'avez confirmé." },
  toldUs: { en: "You told us about this plan.", nl: "Je vertelde ons over dit plan.", fr: "Vous nous avez parlé de ce projet." },
  sure: { en: "{pct}% sure", nl: "{pct}% zeker", fr: "{pct}% sûr" },
  tellUs: { en: "Tell us about a plan", nl: "Vertel ons over een plan", fr: "Parlez-nous d'un projet" },
  tellUsSub: {
    en: "Planning something? Tell us and we'll prepare. No guessing needed.",
    nl: "Iets gepland? Laat het ons weten en we bereiden het voor. Zonder te raden.",
    fr: "Un projet ? Dites-le-nous et nous préparons tout. Sans deviner.",
  },
  data: { en: "Data you allow us to use", nl: "Gegevens die we mogen gebruiken", fr: "Données que vous nous autorisez à utiliser" },
  dataTx: { en: "Card and account transactions", nl: "Kaart- en rekeningtransacties", fr: "Transactions carte et compte" },
  dataApp: { en: "How you use the app", nl: "Hoe je de app gebruikt", fr: "Votre utilisation de l'app" },
  dataNote: {
    en: "Off means we don't read it at all for suggestions.",
    nl: "Uit betekent dat we het helemaal niet lezen voor suggesties.",
    fr: "Désactivé signifie que nous ne le lisons pas du tout pour nos suggestions.",
  },
  forYou: { en: "For you", nl: "Voor jou", fr: "Pour vous" },
  forYouEmpty: {
    en: "Nothing right now. We only speak up when it's worth it.",
    nl: "Nu even niets. We melden ons alleen als het de moeite waard is.",
    fr: "Rien pour l'instant. Nous ne vous sollicitons que quand ça en vaut la peine.",
  },
  yes: { en: "Yes", nl: "Ja", fr: "Oui" },
  no: { en: "No", nl: "Nee", fr: "Non" },
  listen: { en: "Listen", nl: "Beluisteren", fr: "Écouter" },
  basedOn: { en: "Based on {why}.", nl: "Op basis van {why}.", fr: "Sur la base de {why}." },
  aiWritten: { en: "Intro written by AI from the facts above", nl: "Intro geschreven door AI", fr: "Intro rédigée par IA" },
  talk: { en: "Talk to your advisor", nl: "Praat met je adviseur", fr: "Parler à votre conseiller" },
  talkDone: { en: "Request sent (demo)", nl: "Aanvraag verstuurd (demo)", fr: "Demande envoyée (démo)" },
  optional: { en: "optional", nl: "optioneel", fr: "facultatif" },
  last: { en: "last on {date}", nl: "laatst op {date}", fr: "dernier le {date}" },
  times: { en: "{n}×", nl: "{n}×", fr: "{n}×" },
  src_transactions: { en: "Transactions", nl: "Transacties", fr: "Transactions" },
  src_app: { en: "App", nl: "App", fr: "App" },
  src_profile: { en: "Profile", nl: "Profiel", fr: "Profil" },
  st_ask: { en: "We're asking you", nl: "We vragen het je", fr: "Nous vous le demandons" },
  st_act: { en: "Plan ready", nl: "Plan klaar", fr: "Plan prêt" },
  st_advisor: { en: "With your advisor", nl: "Via je adviseur", fr: "Avec votre conseiller" },
  st_wait: { en: "Not enough to act on", nl: "Te weinig om iets mee te doen", fr: "Pas assez pour agir" },
  st_deferred_fatigue: { en: "Later, not all at once", nl: "Later, niet alles tegelijk", fr: "Plus tard, pas tout à la fois" },
  st_suppressed_feedback: { en: "You said no", nl: "Je zei nee", fr: "Vous avez dit non" },
  st_blocked_guardrail: { en: "Not offered", nl: "Niet aangeboden", fr: "Non proposé" },
} as const;

export type Key = keyof typeof T;

export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  let s: string = T[key][lang] ?? T[key].en;
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function stateLabel(lang: Lang, state: string): string {
  const key = `st_${state}` as Key;
  return key in T ? t(lang, key) : state;
}

export function formatDate(lang: Lang, iso: string): string {
  const locale = { en: "en-GB", nl: "nl-BE", fr: "fr-BE" }[lang];
  return new Date(iso + "T00:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" });
}
