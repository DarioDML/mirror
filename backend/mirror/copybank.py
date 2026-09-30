"""Deterministic offline copy: slot-based intros per state x tone x language, built only from the customer's facts.

Sandbox parity with the LLM prompt: at most 2 sentences, at most 280 characters, no links, no markdown.
A frame has a message part and, after "||", the decision words (kind "rule").
"""
from __future__ import annotations

import re
import zlib
from dataclasses import dataclass, replace
from typing import Literal

Kind = Literal["fact", "tone", "rule"]
Part = tuple[str, Kind]

MAX_CHARS = 280
MAX_SENTENCES = 2
LANGS = ("en", "nl", "fr")
TONE_NAMES = ("neutral", "reassuring", "direct", "playful")
STATES = ("ask", "act", "advisor")
AND = {"en": "and", "nl": "en", "fr": "et"}
GENERIC_EVIDENCE = {"en": "what you told us", "nl": "wat je ons vertelde", "fr": "ce que vous nous avez dit"}

CLAIMS: dict[str, dict[str, dict[str, str]]] = {
    "neutral": {
        "en": {"low": "might be relevant for you", "mid": "could be relevant for you", "high": "is probably relevant for you"},
        "nl": {"low": "misschien relevant is voor jou", "mid": "relevant kan zijn voor jou", "high": "waarschijnlijk relevant is voor jou"},
        "fr": {"low": "pourrait peut-être vous concerner", "mid": "pourrait vous concerner", "high": "vous concerne probablement"},
    },
    "reassuring": {
        "en": {"low": "might be relevant for you", "mid": "might be relevant for you", "high": "is probably relevant for you"},
        "nl": {"low": "misschien relevant is voor u", "mid": "misschien relevant is voor u", "high": "waarschijnlijk relevant is voor u"},
        "fr": {"low": "pourrait peut-être vous concerner", "mid": "pourrait vous concerner", "high": "vous concerne probablement"},
    },
    "playful": {
        "en": {"low": "might be your thing", "mid": "could be your thing", "high": "is probably your thing"},
        "nl": {"low": "misschien iets voor jou is", "mid": "iets voor jou kan zijn", "high": "zeker iets voor jou is"},
        "fr": {"low": "pourrait peut-être vous intéresser", "mid": "pourrait vous intéresser", "high": "vous intéressera sûrement"},
    },
}

FRAMES: dict[str, dict[str, dict[str, tuple[str, ...]]]] = {
    "ask": {
        "neutral": {
            "en": ("Hello {name}, based on {ev}, we think this {claim}.||Are we right?",
                   "Hi {name}, based on {ev}, we think this {claim}.||Are we right?"),
            "nl": ("Hallo {name}, op basis van {ev} denken we dat dit {claim}.||Klopt dat?",
                   "Dag {name}, op basis van {ev} denken we dat dit {claim}.||Klopt dat?"),
            "fr": ("Bonjour {name}, d'après {ev}, nous pensons que ceci {claim}.||Avons-nous raison ?",),
        },
        "reassuring": {
            "en": ("Hello {name}, based on {ev}, we think this {claim}, though nothing changes unless you say so.||Is that right?",),
            "nl": ("Dag {name}, op basis van {ev} denken we dat dit {claim}, maar er verandert niets zonder uw akkoord.||Klopt dat?",),
            "fr": ("Bonjour {name}, d'après {ev}, nous pensons que ceci {claim}, mais rien ne change sans votre accord.||Est-ce exact ?",),
        },
        "direct": {
            "en": ("{name}: {pct}% sure, based on {ev}.||Confirm or correct?",),
            "nl": ("{name}: {pct}% zeker op basis van {ev}.||Bevestigen of corrigeren?",),
            "fr": ("{name} : {pct} % de certitude d'après {ev}.||Confirmer ou corriger ?",),
        },
        "playful": {
            "en": ("Hey {name}, we noticed {ev}, so we think this {claim}.||Did we get it right?",),
            "nl": ("Hey {name}, we zagen {ev}, dus we denken dat dit {claim}.||Raak?",),
            "fr": ("Salut {name}, nous avons remarqué {ev}, donc nous pensons que ceci {claim}.||Avons-nous vu juste ?",),
        },
    },
    "act": {
        "neutral": {
            "en": ("Hello {name}, here is one plan for this moment instead of separate offers.||Every step is optional.",),
            "nl": ("Hallo {name}, hier is één plan voor dit moment in plaats van losse aanbiedingen.||Elke stap is optioneel.",),
            "fr": ("Bonjour {name}, voici un seul plan pour ce moment plutôt que des offres séparées.||Chaque étape est facultative.",),
        },
        "reassuring": {
            "en": ("Hello {name}, here is one plan for this moment, and you can skip any step or stop whenever you like.||Take your time.",),
            "nl": ("Dag {name}, hier is één plan voor dit moment, en u kunt elke stap overslaan of stoppen wanneer u wilt.||Neem gerust de tijd.",),
            "fr": ("Bonjour {name}, voici un seul plan pour ce moment, et vous pouvez ignorer chaque étape ou arrêter quand vous voulez.||Prenez votre temps.",),
        },
        "direct": {
            "en": ("{name}: one plan, {n} steps, all optional, based on {ev}.",),
            "nl": ("{name}: één plan, {n} stappen, allemaal optioneel, op basis van {ev}.",),
            "fr": ("{name} : un plan, {n} étapes, toutes facultatives, d'après {ev}.",),
        },
        "playful": {
            "en": ("Hey {name}, one plan instead of a pile of offers.||Pick the steps you like, skip the rest.",),
            "nl": ("Hey {name}, één plan in plaats van een stapel aanbiedingen.||Kies de stappen die je bevallen, sla de rest over.",),
            "fr": ("Salut {name}, un seul plan plutôt qu'une pile d'offres.||Gardez les étapes qui vous plaisent, ignorez le reste.",),
        },
    },
    "advisor": {
        "neutral": {
            "en": ("Hello {name}, this is a moment where a personal conversation helps.||Your advisor can go through it with you.",),
            "nl": ("Hallo {name}, dit is een moment waarop een persoonlijk gesprek helpt.||Je adviseur overloopt het graag met jou.",),
            "fr": ("Bonjour {name}, c'est un moment où un échange personnel aide.||Votre conseiller peut le parcourir avec vous.",),
        },
        "reassuring": {
            "en": ("Hello {name}, we would like a person to help you with this.||Your advisor can go through it with you, at a time that suits you.",),
            "nl": ("Dag {name}, we willen graag dat iemand u hiermee helpt.||Uw adviseur overloopt het met u, wanneer het u past.",),
            "fr": ("Bonjour {name}, nous aimerions qu'une personne vous aide pour ceci.||Votre conseiller peut le parcourir avec vous, au moment qui vous convient.",),
        },
        "direct": {
            "en": ("{name}: a personal conversation is the best route here.||Your advisor can take you through it.",),
            "nl": ("{name}: een persoonlijk gesprek is hier de beste weg.||Je adviseur loopt het met je door.",),
            "fr": ("{name} : un échange personnel est la meilleure voie ici.||Votre conseiller peut vous accompagner.",),
        },
        "playful": {
            "en": ("Hey {name}, this one is best done with a real person.||Your advisor can walk you through it.",),
            "nl": ("Hey {name}, dit doe je het best met een echt persoon.||Je adviseur loopt het graag met je door.",),
            "fr": ("Salut {name}, ceci se fait mieux avec une vraie personne.||Votre conseiller peut vous accompagner.",),
        },
    },
}

_SLOT = re.compile(r"(\{\w+\})")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
_BANNED = re.compile(r"https?:|www\.|[*_#`>]|[\U0001F300-\U0001FAFF☀-➿]", re.IGNORECASE)


@dataclass(frozen=True)
class Facts:
    customer_id: int
    name: str
    lang: str
    state: str
    tone: str
    moment_id: str
    confidence: float
    evidence: tuple[str, ...]
    steps: int
    signature: str


def band(confidence: float) -> str:
    return "low" if confidence < 0.65 else "mid" if confidence < 0.8 else "high"


def evidence_text(labels: tuple[str, ...] | list[str], lang: str) -> str:
    labels = [x for x in labels if x][:3]
    if not labels:
        return GENERIC_EVIDENCE[lang]
    if len(labels) == 1:
        return labels[0]
    return ", ".join(labels[:-1]) + f" {AND[lang]} " + labels[-1]


def _pick(options: tuple[str, ...], facts: Facts) -> str:
    seed = f"{facts.customer_id}|{facts.moment_id}|{facts.state}|{facts.lang}|{facts.signature}".encode()
    return options[zlib.crc32(seed) % len(options)]


def _render(frame: str, facts: Facts, evidence: tuple[str, ...]) -> list[Part]:
    message, _, decision = frame.partition("||")
    claims = CLAIMS.get(facts.tone, CLAIMS["neutral"])[facts.lang]
    values = {
        "name": facts.name,
        "ev": evidence_text(evidence, facts.lang),
        "pct": str(round(facts.confidence * 100)),
        "n": str(facts.steps),
        "claim": claims[band(facts.confidence)],
    }
    parts: list[Part] = []
    for piece in _SLOT.split(message):
        if not piece:
            continue
        slot = _SLOT.fullmatch(piece)
        if slot is None:
            parts.append((piece, "tone"))
        elif slot.group(0) == "{claim}":
            parts.append((values["claim"], "tone"))
        else:
            parts.append((values[slot.group(0)[1:-1]], "fact"))
    if decision:
        parts.append((" " + decision, "rule"))
    return parts


def _sentences(text: str) -> int:
    return len([s for s in _SENTENCE_END.split(text.strip()) if s])


def is_valid(text: str) -> bool:
    return bool(text) and len(text) <= MAX_CHARS and _sentences(text) <= MAX_SENTENCES and not _BANNED.search(text)


def compose(facts: Facts) -> list[Part]:
    tone = facts.tone if facts.tone in TONE_NAMES else "neutral"
    facts = replace(facts, tone=tone)
    frame = _pick(FRAMES[facts.state][tone][facts.lang], facts)
    for keep in (3, 2, 1, 0):
        parts = _render(frame, facts, facts.evidence[:keep])
        if is_valid("".join(t for t, _ in parts)):
            return parts
    return _render(frame, facts, ())


def render(facts: Facts) -> str:
    return "".join(t for t, _ in compose(facts))


def signature(state: str, signal_ids: list[str]) -> str:
    return f"{state}:{','.join(sorted(signal_ids))}"
