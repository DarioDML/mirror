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
  loading: { en: "Loading…", nl: "Laden…", fr: "Chargement…" },
  oops: { en: "Something went wrong. Please try again.", nl: "Er ging iets mis. Probeer het opnieuw.", fr: "Une erreur s'est produite. Veuillez réessayer." },
  retry: { en: "Try again", nl: "Opnieuw proberen", fr: "Réessayer" },
  viewCrashed: { en: "This part of the screen hit a problem. You are still signed in.", nl: "Dit deel van het scherm had een probleem. Je bent nog aangemeld.", fr: "Cette partie de l'écran a rencontré un problème. Vous êtes toujours connecté." },
  role_customer: { en: "Customer app", nl: "Klantenapp", fr: "App client" },
  role_advisor: { en: "Advisor desk", nl: "Adviseursbureau", fr: "Bureau du conseiller" },
  role_product_owner: { en: "Product owner", nl: "Product owner", fr: "Product owner" },
  logout: { en: "Log out", nl: "Afmelden", fr: "Se déconnecter" },
  language: { en: "Language", nl: "Taal", fr: "Langue" },
  lp_tagline: {
    en: "One shared understanding of every customer, which the customer can see and correct.",
    nl: "Eén gedeeld beeld van elke klant, dat de klant kan zien en corrigeren.",
    fr: "Une compréhension partagée de chaque client, que le client peut voir et corriger.",
  },
  lp_username: { en: "Username", nl: "Gebruikersnaam", fr: "Nom d'utilisateur" },
  lp_password: { en: "Password", nl: "Wachtwoord", fr: "Mot de passe" },
  lp_passwordPh: { en: "Demo password", nl: "Demowachtwoord", fr: "Mot de passe de démo" },
  lp_signIn: { en: "Sign in", nl: "Aanmelden", fr: "Se connecter" },
  lp_signingIn: { en: "Signing in…", nl: "Aanmelden…", fr: "Connexion…" },
  lp_unreachable: { en: "Could not reach the server.", nl: "De server is niet bereikbaar.", fr: "Le serveur est injoignable." },
  lp_badLogin: { en: "That username and password do not match.", nl: "Gebruikersnaam en wachtwoord komen niet overeen.", fr: "Ce nom d'utilisateur et ce mot de passe ne correspondent pas." },
  lp_deck: { en: "Start demo deck", nl: "Start demodeck", fr: "Lancer le deck de démo" },
  lp_deckSub: {
    en: "Type the password once. Six sessions stay in memory only, so you can switch user with one click or keys 1 to 6.",
    nl: "Typ het wachtwoord één keer. Zes sessies blijven enkel in het geheugen, zodat je met één klik of toetsen 1 tot 6 wisselt.",
    fr: "Saisissez le mot de passe une fois. Six sessions restent en mémoire seulement : changez d'utilisateur en un clic ou avec les touches 1 à 6.",
  },
  lp_deckFail: { en: "Some demo users could not sign in.", nl: "Sommige demogebruikers konden niet aanmelden.", fr: "Certains utilisateurs de démo n'ont pas pu se connecter." },
  lp_sofie: { en: "Customer · buying a home", nl: "Klant · woning kopen", fr: "Client · achat d'un logement" },
  lp_lucas: { en: "Customer · going freelance", nl: "Klant · freelancer worden", fr: "Client · devenir indépendant" },
  lp_marc: { en: "Customer · prefers a person", nl: "Klant · praat liever met iemand", fr: "Client · préfère une personne" },
  lp_an: { en: "Advisor", nl: "Adviseur", fr: "Conseiller" },
  lp_jan: { en: "Advisor · other customers", nl: "Adviseur · andere klanten", fr: "Conseiller · autres clients" },
  lp_po: { en: "Population view", nl: "Populatieoverzicht", fr: "Vue population" },
  dock_expired: { en: "sign in again", nl: "opnieuw aanmelden", fr: "se reconnecter" },
  dock_now: { en: "Now viewing {name}", nl: "Nu bekijk je {name}", fr: "Vous voyez maintenant {name}" },
  dock_label: { en: "Switch demo user", nl: "Wissel van demogebruiker", fr: "Changer d'utilisateur de démo" },
  lab_title: { en: "Watch Mirror think", nl: "Zie Mirror denken", fr: "Voir Mirror réfléchir" },
  lab_sub: {
    en: "Replay how the evidence builds up, what it would take to change the answer, and why something was not suggested.",
    nl: "Bekijk hoe het bewijs zich opbouwt, wat nodig is om het antwoord te wijzigen en waarom iets niet werd voorgesteld.",
    fr: "Revoyez comment les indices s'accumulent, ce qu'il faudrait pour changer la réponse et pourquoi quelque chose n'a pas été proposé.",
  },
  lab_open: { en: "Open", nl: "Openen", fr: "Ouvrir" },
  lab_close: { en: "Close", nl: "Sluiten", fr: "Fermer" },
  showMore: { en: "Show more", nl: "Toon meer", fr: "Afficher plus" },
  showLess: { en: "Show less", nl: "Toon minder", fr: "Afficher moins" },
  sureWords_low: { en: "a few signs", nl: "enkele aanwijzingen", fr: "quelques indices" },
  sureWords_mid: { en: "fairly sure", nl: "vrij zeker", fr: "assez sûr" },
  sureWords_high: { en: "quite sure", nl: "best zeker", fr: "plutôt sûr" },
  showHow: { en: "Show me how sure", nl: "Toon hoe zeker", fr: "Montrer le degré de certitude" },
  markAsk: { en: "ask", nl: "vraag", fr: "question" },
  markAct: { en: "plan", nl: "plan", fr: "plan" },
  meterHint: { en: "Below the first mark we wait; past it we ask you; past the second we prepare a plan.", nl: "Onder het eerste streepje wachten we; erboven vragen we het je; voorbij het tweede bereiden we een plan voor.", fr: "Sous le premier repère nous attendons ; au-delà nous vous posons la question ; après le second nous préparons un plan." },
  voiceNoAudio: { en: "Audio is not available on this device in {lang}. Showing read-along instead.", nl: "Audio is op dit toestel niet beschikbaar in het {lang}. We tonen meelezen.", fr: "L'audio n'est pas disponible sur cet appareil en {lang}. Lecture suivie affichée à la place." },
  voiceStop: { en: "Stop", nl: "Stop", fr: "Arrêter" },
  voiceFailed: { en: "Could not play the audio. You can read it below.", nl: "Het geluid kon niet worden afgespeeld. Je kunt het hieronder lezen.", fr: "Impossible de lire l'audio. Vous pouvez le lire ci-dessous." },
  langName_en: { en: "English", nl: "Engels", fr: "anglais" },
  langName_nl: { en: "Dutch", nl: "Nederlands", fr: "néerlandais" },
  langName_fr: { en: "French", nl: "Frans", fr: "français" },
  ad_title: { en: "Your customers", nl: "Je klanten", fr: "Vos clients" },
  ad_sub: {
    en: "Only customers assigned to you. Recently active ones first, then the ones that need a personal conversation.",
    nl: "Enkel klanten die aan jou zijn toegewezen. Recent actieve eerst, dan zij die een persoonlijk gesprek nodig hebben.",
    fr: "Uniquement les clients qui vous sont attribués. Les plus actifs d'abord, puis ceux qui ont besoin d'un entretien personnel.",
  },
  ad_search: { en: "Search by first name", nl: "Zoek op voornaam", fr: "Rechercher par prénom" },
  ad_needsYou: { en: "needs you", nl: "heeft jou nodig", fr: "a besoin de vous" },
  ad_updated: { en: "updated", nl: "bijgewerkt", fr: "mis à jour" },
  ad_active: { en: "{n} active", nl: "{n} actief", fr: "{n} actifs" },
  ad_pick: { en: "Pick a customer to see the shared brief.", nl: "Kies een klant om het gedeelde dossier te zien.", fr: "Choisissez un client pour voir le dossier partagé." },
  ad_careFlag: { en: "care flag", nl: "zorgvlag", fr: "drapeau soin" },
  ad_refresh: { en: "Refresh", nl: "Vernieuwen", fr: "Actualiser" },
  ad_speaks: { en: "Speaks {lang}", nl: "Spreekt {lang}", fr: "Parle {lang}" },
  ad_tx: { en: "transactions", nl: "transacties", fr: "transactions" },
  ad_app: { en: "app data", nl: "appgegevens", fr: "données de l'app" },
  ad_allowed: { en: "allowed", nl: "toegestaan", fr: "autorisé" },
  ad_off: { en: "switched off", nl: "uitgezet", fr: "désactivé" },
  ad_signals: { en: "Signals", nl: "Signalen", fr: "Signaux" },
  ad_notApplicable: { en: "Customer said this does not apply", nl: "Klant gaf aan dat dit niet klopt", fr: "Le client indique que ce n'est pas le cas" },
  ad_state_ask: { en: "Asked", nl: "Gevraagd", fr: "Demandé" },
  ad_state_act: { en: "Plan ready", nl: "Plan klaar", fr: "Plan prêt" },
  ad_state_advisor: { en: "Needs you", nl: "Voor jou", fr: "Pour vous" },
  ad_state_wait: { en: "Waiting", nl: "Wachten", fr: "En attente" },
  ad_state_deferred_fatigue: { en: "Deferred", nl: "Uitgesteld", fr: "Différé" },
  ad_state_suppressed_feedback: { en: "Customer said no", nl: "Klant zei nee", fr: "Le client a dit non" },
  ad_state_blocked_guardrail: { en: "Blocked by guardrail", nl: "Geblokkeerd door vangrail", fr: "Bloqué par garde-fou" },
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

const LOCALES: Record<Lang, string> = { en: "en-GB", nl: "nl-BE", fr: "fr-BE" };

export function formatNumber(lang: Lang, n: number, digits = 0): string {
  return new Intl.NumberFormat(LOCALES[lang], { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function formatDuration(lang: Lang, ms: number): string {
  if (ms < 1000) return `${formatNumber(lang, Math.round(ms))} ms`;
  return `${formatNumber(lang, ms / 1000, 1)} s`;
}

export function advisorStateLabel(lang: Lang, state: string): string {
  const key = `ad_state_${state}` as Key;
  return key in T ? t(lang, key) : state;
}

export function sureWord(lang: Lang, confidence: number): string {
  if (confidence < 0.65) return t(lang, "sureWords_low");
  if (confidence < 0.8) return t(lang, "sureWords_mid");
  return t(lang, "sureWords_high");
}

export function langName(lang: Lang, of: Lang): string {
  return t(lang, `langName_${of}`);
}

export function pickLang(): Lang {
  const l = (typeof navigator === "undefined" ? "en" : navigator.language).slice(0, 2).toLowerCase();
  return l === "nl" || l === "fr" ? l : "en";
}
