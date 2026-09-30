"""Display persona: a pure function from profile and twin state to presentation axes.

The result never contains decisions and has the same keys for every customer. Nothing here names or
serialises the internal care input; it only selects a presentation preset.
"""
from __future__ import annotations

from typing import Literal, Optional, TypedDict

Layout = Literal["guided", "studio", "quick"]
Theme = Literal["daylight", "linen", "studio", "pop"]
Density = Literal["airy", "normal", "compact"]
Motion = Literal["none", "subtle", "lively"]
Tone = Literal["neutral", "reassuring", "direct", "playful"]
Register = Literal["informal", "formal"]
Emphasis = Literal["overview", "question", "plan", "human"]
Math = Literal["hidden", "summary", "full"]

TextScaleOverride = Literal["auto", "s", "m", "l"]
MotionOverride = Literal["auto", "none", "subtle"]
DetailOverride = Literal["auto", "simple", "standard", "full"]
ToneOverride = Literal["auto", "neutral", "reassuring", "direct", "playful"]

ACCENTS = ("housing", "household", "family", "work", "mobility", "energy", "savings")
STUDIO_MIN_APP_EVENTS = 12
TEXT_SCALES: dict[str, float] = {"s": 1.0, "m": 1.125, "l": 1.25}
DETAIL_MATH: dict[str, Math] = {"simple": "hidden", "standard": "summary", "full": "full"}
TONES: dict[str, Tone] = {"neutral": "neutral", "reassuring": "reassuring", "direct": "direct", "playful": "playful"}
STATE_EMPHASIS: dict[str, Emphasis] = {"advisor": "human", "act": "plan", "ask": "question"}


class Auto(TypedDict):
    text_scale: bool
    motion: bool
    detail: bool
    tone: bool


class Ui(TypedDict):
    v: Literal[1]
    layout: Layout
    theme: Theme
    density: Density
    text_scale: float
    motion: Motion
    tone: Tone
    register: Register
    accent: str
    emphasis: Emphasis
    math: Math
    auto: Auto


class Overrides(TypedDict, total=False):
    text_scale: Optional[str]
    motion: Optional[str]
    detail: Optional[str]
    tone: Optional[str]


def _base(
    age: int, care: bool, top_category: Optional[str], consent_app: bool, app_events: int
) -> tuple[Layout, Theme, Density, float, Motion, Tone, Register, Math]:
    if care:
        return "guided", "linen", "airy", 1.25, "none", "reassuring", "formal", "hidden"
    if top_category == "work" and consent_app and app_events >= STUDIO_MIN_APP_EVENTS:
        return "studio", "studio", "compact", 1.0, "subtle", "direct", "informal", "full"
    if age < 30 and top_category in ("household", "housing"):
        return "quick", "pop", "normal", 1.0, "lively", "playful", "informal", "hidden"
    return "guided", "daylight", "normal", 1.0, "subtle", "playful" if age < 30 else "neutral", "informal", "summary"


def _set(value: Optional[str]) -> Optional[str]:
    return None if value in (None, "auto") else value


def derive(
    *,
    age: int,
    household_size: int,
    language: str,
    top_category: Optional[str],
    top_state: Optional[str],
    confidence: float,
    consent_app: bool,
    app_events_180d: int,
    care: bool,
    overrides: Optional[Overrides] = None,
) -> Ui:
    """household_size, language and confidence are accepted for a stable contract but do not change today's rules."""
    layout, theme, density, scale, motion, tone, register, math = _base(
        age, care, top_category, consent_app, app_events_180d if consent_app else 0
    )
    ov = overrides or {}
    auto: Auto = {"text_scale": True, "motion": True, "detail": True, "tone": True}

    scale_ov = _set(ov.get("text_scale"))
    if scale_ov in TEXT_SCALES:
        scale, auto["text_scale"] = TEXT_SCALES[scale_ov], False
    motion_ov = _set(ov.get("motion"))
    if motion_ov == "none" or motion_ov == "subtle":
        motion, auto["motion"] = motion_ov, False
    detail_ov = _set(ov.get("detail"))
    if detail_ov in DETAIL_MATH:
        math, auto["detail"] = DETAIL_MATH[detail_ov], False
    tone_ov = _set(ov.get("tone"))
    if tone_ov in TONES:
        tone, auto["tone"] = TONES[tone_ov], False

    return {
        "v": 1,
        "layout": layout,
        "theme": theme,
        "density": density,
        "text_scale": scale,
        "motion": motion,
        "tone": tone,
        "register": register,
        "accent": top_category if top_category in ACCENTS else "other",
        "emphasis": STATE_EMPHASIS.get(top_state or "", "overview"),
        "math": math,
        "auto": auto,
    }
