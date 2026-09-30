import type { Lang } from "../types";
import type { ChannelId, ChannelMode, Gate, State } from "./types";

type Tri = Record<Lang, string>;

const UI = {
  tabTheater: { en: "Theater", nl: "Theater", fr: "Théâtre" },
  tabWeb: { en: "Belief web", nl: "Overtuigingsweb", fr: "Toile de croyances" },
  tabWhyNot: { en: "Why not", nl: "Waarom niet", fr: "Pourquoi pas" },
  title: { en: "How Mirror thinks", nl: "Zo denkt Mirror", fr: "Comment Mirror réfléchit" },
  sub: {
    en: "Every step is computed by the real engine. Watch the evidence arrive and the doubt shrink.",
    nl: "Elke stap komt uit de echte engine. Zie het bewijs binnenkomen en de twijfel krimpen.",
    fr: "Chaque étape vient du vrai moteur. Regardez les preuves arriver et le doute diminuer.",
  },
  loading: { en: "Loading the reasoning...", nl: "Redenering laden...", fr: "Chargement du raisonnement..." },
  error: { en: "Could not load the reasoning.", nl: "Kon de redenering niet laden.", fr: "Impossible de charger le raisonnement." },
  demoData: { en: "demo data", nl: "demodata", fr: "données démo" },
  play: { en: "Play", nl: "Afspelen", fr: "Lecture" },
  pause: { en: "Pause", nl: "Pauze", fr: "Pause" },
  replay: { en: "Replay", nl: "Opnieuw", fr: "Rejouer" },
  prev: { en: "Previous step", nl: "Vorige stap", fr: "Étape précédente" },
  next: { en: "Next step", nl: "Volgende stap", fr: "Étape suivante" },
  stage: { en: "Stage mode", nl: "Podiummodus", fr: "Mode scène" },
  keys: { en: "Space play/pause, arrows step", nl: "Spatie afspelen/pauze, pijltjes stappen", fr: "Espace lecture/pause, flèches pas à pas" },
  step: { en: "Step {i} of {n}", nl: "Stap {i} van {n}", fr: "Étape {i} sur {n}" },
  events: { en: "Events that matter", nl: "Gebeurtenissen die tellen", fr: "Événements qui comptent" },
  ignored: { en: "{n} ignored", nl: "{n} genegeerd", fr: "{n} ignorés" },
  signals: { en: "Signals", nl: "Signalen", fr: "Signaux" },
  doubt: { en: "Remaining doubt", nl: "Resterende twijfel", fr: "Doute restant" },
  ask: { en: "ask", nl: "vragen", fr: "demander" },
  act: { en: "act", nl: "handelen", fr: "agir" },
  sure: { en: "{pct}% sure", nl: "{pct}% zeker", fr: "{pct}% sûr" },
  lit: { en: "seen", nl: "gezien", fr: "vu" },
  dark: { en: "not seen", nl: "niet gezien", fr: "non vu" },
  gates: { en: "Safety gates", nl: "Veiligheidspoorten", fr: "Portes de sécurité" },
  gConsent: { en: "Consent", nl: "Toestemming", fr: "Consentement" },
  gThreshold: { en: "Threshold", nl: "Drempel", fr: "Seuil" },
  gGuard: { en: "Guardrail", nl: "Vangrail", fr: "Garde-fou" },
  gFatigue: { en: "Message slot", nl: "Berichtenplek", fr: "Créneau message" },
  gDecision: { en: "Decision", nl: "Beslissing", fr: "Décision" },
  pass: { en: "passed", nl: "ok", fr: "ok" },
  stop: { en: "stopped", nl: "gestopt", fr: "arrêté" },
  route: { en: "a person helps", nl: "een persoon helpt", fr: "une personne aide" },
  skipped: { en: "not reached", nl: "niet bereikt", fr: "non atteint" },
  dConsentPartial: { en: "some data off", nl: "deel uit", fr: "partiel" },
  stAct: { en: "Act: prepare the plan", nl: "Handelen: plan klaarzetten", fr: "Agir : préparer le plan" },
  stAsk: { en: "Ask you first", nl: "Eerst aan jou vragen", fr: "Vous demander d'abord" },
  stHuman: { en: "A person will help you", nl: "Een persoon helpt je verder", fr: "Une personne vous aidera" },
  stWait: { en: "Wait", nl: "Wachten", fr: "Attendre" },
  stBlocked: { en: "Not shown (rule)", nl: "Niet getoond (regel)", fr: "Non montré (règle)" },
  stDeferred: { en: "Later (slot taken)", nl: "Later (plek bezet)", fr: "Plus tard (créneau pris)" },
  stSuppressed: { en: "Dropped: you said no", nl: "Laten vallen: jij zei nee", fr: "Abandonné : vous avez dit non" },
  whatIf: { en: "What if?", nl: "Wat als?", fr: "Et si ?" },
  whatIfSub: {
    en: "Try a change. Nothing is saved. Switching a data source off only removes evidence, it can never add any.",
    nl: "Probeer een wijziging. Er wordt niets bewaard. Een gegevensbron uitzetten haalt enkel bewijs weg, het voegt nooit iets toe.",
    fr: "Essayez un changement. Rien n'est enregistré. Désactiver une source retire seulement des preuves, jamais l'inverse.",
  },
  cTx: { en: "Card and account transactions", nl: "Kaart- en rekeningtransacties", fr: "Transactions carte et compte" },
  cApp: { en: "App behaviour", nl: "Gedrag in de app", fr: "Comportement dans l'app" },
  maxActive: { en: "Messages at a time", nl: "Berichten tegelijk", fr: "Messages à la fois" },
  signalsToggle: { en: "Evidence", nl: "Bewijs", fr: "Preuves" },
  yes: { en: "Yes", nl: "Ja", fr: "Oui" },
  notTrue: { en: "Not true", nl: "Klopt niet", fr: "Pas vrai" },
  baseline: { en: "Now", nl: "Nu", fr: "Maintenant" },
  scenario: { en: "If you change it", nl: "Met je wijziging", fr: "Avec votre changement" },
  changes: { en: "What changes", nl: "Wat verandert", fr: "Ce qui change" },
  noChange: { en: "No change yet. Flip something above.", nl: "Nog geen verandering. Wijzig hierboven iets.", fr: "Pas encore de changement. Modifiez quelque chose ci-dessus." },
  reset: { en: "Reset", nl: "Herstel", fr: "Réinitialiser" },
  verified: { en: "engine-verified", nl: "door engine bevestigd", fr: "vérifié par le moteur" },
  localOnly: { en: "instant estimate", nl: "directe schatting", fr: "estimation instantanée" },
  checking: { en: "checking with the engine...", nl: "controleren met de engine...", fr: "vérification par le moteur..." },
  disagree: { en: "engine differs: showing engine answer", nl: "engine wijkt af: engine-antwoord getoond", fr: "le moteur diffère : réponse du moteur" },
  whyNotIntro: {
    en: "What would it take for each belief to reach the next step? Every path below is verified by the engine.",
    nl: "Wat zou er nodig zijn opdat elke overtuiging de volgende stap haalt? Elk pad hieronder is door de engine geverifieerd.",
    fr: "Que faudrait-il pour que chaque croyance passe à l'étape suivante ? Chaque piste est vérifiée par le moteur.",
  },
  target: { en: "Target", nl: "Doel", fr: "Cible" },
  gap: { en: "Gap to {target}: {pts} points", nl: "Kloof naar {target}: {pts} punten", fr: "Écart vers {target} : {pts} points" },
  tryIt: { en: "Try it", nl: "Probeer", fr: "Essayer" },
  reachedBy: { en: "Reached if we also saw", nl: "Bereikt als we ook zagen", fr: "Atteint si nous voyions aussi" },
  alreadyThere: { en: "Already there.", nl: "Al bereikt.", fr: "Déjà atteint." },
  rejectedByYou: { en: "You told us this is not true, so we stay out of it.", nl: "Je zei dat dit niet klopt, dus we laten het rusten.", fr: "Vous avez dit que ce n'est pas vrai, nous nous abstenons." },
  blockedRule: { en: "A safety rule decides this one, not the evidence.", nl: "Een veiligheidsregel beslist hier, niet het bewijs.", fr: "Une règle de sécurité décide ici, pas les preuves." },
  unreachable: { en: "No single extra signal gets there.", nl: "Geen enkel extra signaal is genoeg.", fr: "Aucun signal supplémentaire ne suffit." },
  cannotChange: { en: "Cannot change", nl: "Niet aan te passen", fr: "Non modifiable" },
  webHint: {
    en: "Evidence flows left to right. Hover a belief to isolate its path. Press Not true to see what gets cut.",
    nl: "Bewijs stroomt van links naar rechts. Wijs een overtuiging aan om het pad te isoleren. Kies Klopt niet om te zien wat wegvalt.",
    fr: "Les preuves vont de gauche à droite. Survolez une croyance pour isoler son chemin. Choisissez Pas vrai pour voir ce qui est coupé.",
  },
  colSignals: { en: "Signals", nl: "Signalen", fr: "Signaux" },
  colBeliefs: { en: "Beliefs", nl: "Overtuigingen", fr: "Croyances" },
  colDecision: { en: "Decision", nl: "Beslissing", fr: "Décision" },
  colChannels: { en: "Channels", nl: "Kanalen", fr: "Canaux" },
  chApp: { en: "App card", nl: "App-kaart", fr: "Carte app" },
  chVoice: { en: "Voice", nl: "Stem", fr: "Voix" },
  chAdvisor: { en: "Advisor note", nl: "Adviseursnotitie", fr: "Note conseiller" },
  mDeliver: { en: "delivered", nl: "geleverd", fr: "livré" },
  mMuted: { en: "muted", nl: "gedempt", fr: "en sourdine" },
  mSevered: { en: "severed", nl: "doorgeknipt", fr: "coupé" },
  mDoNot: { en: "do not mention", nl: "niet vermelden", fr: "ne pas évoquer" },
  mNote: { en: "note only", nl: "enkel notitie", fr: "note seule" },
  previewing: { en: "Preview: nothing is saved", nl: "Voorbeeld: niets wordt bewaard", fr: "Aperçu : rien n'est enregistré" },
  clearPreview: { en: "Undo preview", nl: "Voorbeeld wissen", fr: "Annuler l'aperçu" },
  noBeliefs: { en: "No beliefs yet for this customer.", nl: "Nog geen overtuigingen.", fr: "Pas encore de croyances." },
  who: { en: "Demo customer", nl: "Democlient", fr: "Client démo" },
} satisfies Record<string, Tri>;

export type UiKey = keyof typeof UI;

export function t(lang: Lang, key: UiKey, vars: Record<string, string | number> = {}): string {
  let s: string = UI[key][lang];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

const NARRATION: Record<Gate, Tri> = {
  rejected: {
    en: "You told me \"{title}\" is not true, so I drop it everywhere. Doubt is irrelevant now.",
    nl: "Je zei dat \"{title}\" niet klopt, dus ik laat het overal vallen. Twijfel speelt geen rol meer.",
    fr: "Vous avez dit que \"{title}\" n'est pas vrai, je l'abandonne partout. Le doute n'a plus d'importance.",
  },
  below_ask: {
    en: "I'm {pct}% sure about \"{title}\". That is below {ask}% (ask), so I stay quiet and keep watching.",
    nl: "Ik ben {pct}% zeker over \"{title}\". Dat is onder {ask}% (vragen), dus ik zwijg en blijf opletten.",
    fr: "Je suis sûr à {pct}% pour \"{title}\". C'est sous {ask}% (demander), donc je me tais et je continue d'observer.",
  },
  between_ask_act: {
    en: "I'm {pct}% sure. That is above {ask}% (ask) but below {act}% (act), so I ask instead of assuming.",
    nl: "Ik ben {pct}% zeker. Dat is boven {ask}% (vragen) maar onder {act}% (handelen), dus ik vraag het liever dan te veronderstellen.",
    fr: "Je suis sûr à {pct}%. C'est au-dessus de {ask}% (demander) mais sous {act}% (agir), donc je demande plutôt que de supposer.",
  },
  above_act: {
    en: "I'm {pct}% sure. That is above {act}% (act), so I prepare the next steps for \"{title}\" right away.",
    nl: "Ik ben {pct}% zeker. Dat is boven {act}% (handelen), dus ik zet meteen de volgende stappen voor \"{title}\" klaar.",
    fr: "Je suis sûr à {pct}%. C'est au-dessus de {act}% (agir), donc je prépare tout de suite les prochaines étapes pour \"{title}\".",
  },
  care_advisor: {
    en: "I'm {pct}% sure about \"{title}\". Here a person can help you better than an app message, so a person will help you.",
    nl: "Ik ben {pct}% zeker over \"{title}\". Hier helpt een persoon je beter dan een appbericht, dus een persoon helpt je verder.",
    fr: "Je suis sûr à {pct}% pour \"{title}\". Ici, une personne vous aide mieux qu'un message dans l'app : une personne vous aidera.",
  },
  human_first: {
    en: "I'm {pct}% sure about \"{title}\". Here a person can help you better than an app message, so a person will help you.",
    nl: "Ik ben {pct}% zeker over \"{title}\". Hier helpt een persoon je beter dan een appbericht, dus een persoon helpt je verder.",
    fr: "Je suis sûr à {pct}% pour \"{title}\". Ici, une personne vous aide mieux qu'un message dans l'app : une personne vous aidera.",
  },
  care_suppress: {
    en: "I'm {pct}% sure about \"{title}\". I keep the app quiet here; a person will help you if you want.",
    nl: "Ik ben {pct}% zeker over \"{title}\". Ik hou de app hier stil; een persoon helpt je als je dat wilt.",
    fr: "Je suis sûr à {pct}% pour \"{title}\". Je laisse l'app silencieuse ici ; une personne vous aidera si vous le souhaitez.",
  },
  min_age: {
    en: "I'm {pct}% sure, but a rule on age says this message is not shown, so I stay quiet.",
    nl: "Ik ben {pct}% zeker, maar een leeftijdsregel zegt dat dit bericht niet getoond wordt, dus ik zwijg.",
    fr: "Je suis sûr à {pct}%, mais une règle d'âge interdit ce message, donc je me tais.",
  },
  fatigue_cap: {
    en: "I'm {pct}% sure, but you already have the maximum number of messages at a time. This one waits its turn.",
    nl: "Ik ben {pct}% zeker, maar je hebt al het maximum aantal berichten tegelijk. Dit wacht op zijn beurt.",
    fr: "Je suis sûr à {pct}%, mais vous avez déjà le nombre maximal de messages. Celui-ci attend son tour.",
  },
};

export function narrate(lang: Lang, gate: Gate, vars: { title: string; inferred: number; ask: number; act: number }): string {
  return (NARRATION[gate] ?? NARRATION.between_ask_act)[lang]
    .split("{pct}")
    .join(String(Math.round(vars.inferred * 100)))
    .split("{ask}")
    .join(String(Math.round(vars.ask * 100)))
    .split("{act}")
    .join(String(Math.round(vars.act * 100)))
    .split("{title}")
    .join(vars.title);
}

export function stateLabel(lang: Lang, state: State, gate: Gate): string {
  if (state === "advisor" || gate === "care_advisor" || gate === "care_suppress" || gate === "human_first") return t(lang, "stHuman");
  switch (state) {
    case "act":
      return t(lang, "stAct");
    case "ask":
      return t(lang, "stAsk");
    case "wait":
      return t(lang, "stWait");
    case "blocked_guardrail":
      return t(lang, "stBlocked");
    case "deferred_fatigue":
      return t(lang, "stDeferred");
    case "suppressed_feedback":
      return t(lang, "stSuppressed");
  }
}

export function channelLabel(lang: Lang, id: ChannelId): string {
  return id === "app_card" ? t(lang, "chApp") : id === "voice" ? t(lang, "chVoice") : t(lang, "chAdvisor");
}

export function modeLabel(lang: Lang, mode: ChannelMode): string {
  switch (mode) {
    case "deliver":
      return t(lang, "mDeliver");
    case "muted":
      return t(lang, "mMuted");
    case "severed":
      return t(lang, "mSevered");
    case "flag_do_not_mention":
      return t(lang, "mDoNot");
    case "note_only":
      return t(lang, "mNote");
  }
}
