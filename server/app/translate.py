"""Calls in another language (M6).

The signer always works in English: drafts, guards, approvals and the turn analyzer all
run on English text. Only the edges change:

- What the caller says is transcribed by Twilio in their language, then translated to
  English for the captions (the signer sees both).
- What the signer approves is translated just before it is spoken, and the translation
  must pass `translation_guard`: every number, day and "no" in the English line has to
  survive. If it doesn't, nothing is said and the draft comes back to the signer.
- Fixed lines (heads-up intro, fillers, "still here") are written once per language
  below, so they never go through a model and never wait for one.

Translation needs Gemini. Without it, calls stay English-only and the app says so.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import guards


@dataclass(frozen=True)
class Lang:
    code: str                     # BCP-47, what ConversationRelay gets
    name: str                     # shown to the signer
    english_name: str             # used in model prompts
    negation: re.Pattern
    days: dict[str, tuple[str, ...]]
    fixed: dict[str, str] = field(default_factory=dict)


_ES_DAYS = {
    "monday": ("lunes",), "tuesday": ("martes",), "wednesday": ("miércoles", "miercoles"),
    "thursday": ("jueves",), "friday": ("viernes",), "saturday": ("sábado", "sabado"),
    "sunday": ("domingo",), "today": ("hoy",), "tomorrow": ("mañana", "manana"),
    "tonight": ("esta noche", "noche"), "yesterday": ("ayer",),
}
_FR_DAYS = {
    "monday": ("lundi",), "tuesday": ("mardi",), "wednesday": ("mercredi",), "thursday": ("jeudi",),
    "friday": ("vendredi",), "saturday": ("samedi",), "sunday": ("dimanche",),
    "today": ("aujourd'hui", "aujourd’hui"), "tomorrow": ("demain",), "tonight": ("ce soir", "soir"),
    "yesterday": ("hier",),
}
_PT_DAYS = {
    "monday": ("segunda",), "tuesday": ("terça", "terca"), "wednesday": ("quarta",),
    "thursday": ("quinta",), "friday": ("sexta",), "saturday": ("sábado", "sabado"),
    "sunday": ("domingo",), "today": ("hoje",), "tomorrow": ("amanhã", "amanha"),
    "tonight": ("hoje à noite", "noite"), "yesterday": ("ontem",),
}
_EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
              "september", "october", "november", "december"]
_ES_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
              "septiembre", "octubre", "noviembre", "diciembre"]
_FR_MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
              "septembre", "octobre", "novembre", "décembre"]
_PT_MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
              "setembro", "outubro", "novembro", "dezembro"]


def _with_months(days: dict[str, tuple[str, ...]], months: list[str]) -> dict[str, tuple[str, ...]]:
    out = dict(days)
    for en, native in zip(_EN_MONTHS, months):
        out[en] = (native,)
    return out


# The English keys must match the controller's fixed lines exactly (controller.INTRO etc.).
LANGS: dict[str, Lang] = {
    "es-US": Lang(
        "es-US", "Español", "Spanish (US)",
        re.compile(r"\b(no|nunca|nada|ninguno|ninguna|ni|tampoco|jamás|jamas|cancelar|cancela)\b", re.I),
        _with_months(_ES_DAYS, _ES_MONTHS),
        {
            "intro": "¡Hola! Un aviso rápido: soy una persona sorda y una app dice en voz alta lo que escribo "
                     "en señas. Dame un momento, por favor.",
            "intro_order": "¡Hola! Un aviso rápido: soy una persona sorda y una app dice en voz alta lo que "
                           "escribo en señas. Quisiera hacer un pedido para recoger.",
            "Mm, one sec...": "Mm, un segundo...",
            "Mm, just a sec...": "Mm, solo un segundo...",
            "Okay, one sec...": "Okay, un segundo...",
            "Sorry, just a moment...": "Perdón, solo un momento...",
            "Sorry, one more second...": "Perdón, un segundito más...",
            "Yeah, still here!": "¡Sí, aquí sigo!",
            "Yep, I'm here! One sec.": "¡Sí, aquí estoy! Un segundo.",
            "Hey!": "¡Hola!",
            "Sorry, one sec...": "Perdón, un segundo...",
        }),
    "fr-FR": Lang(
        "fr-FR", "Français", "French",
        re.compile(r"\b(ne|pas|non|jamais|rien|aucun|aucune|ni|annuler|annule)\b|\bn['’]", re.I),
        _with_months(_FR_DAYS, _FR_MONTHS),
        {
            "intro": "Bonjour ! Petite précision : je suis une personne sourde, et une application dit à voix "
                     "haute ce que je signe. Un instant, s'il vous plaît.",
            "intro_order": "Bonjour ! Petite précision : je suis une personne sourde, et une application dit à "
                           "voix haute ce que je signe. J'aimerais passer une commande à emporter.",
            "Mm, one sec...": "Mm, une seconde...",
            "Mm, just a sec...": "Mm, juste une seconde...",
            "Okay, one sec...": "D'accord, une seconde...",
            "Sorry, just a moment...": "Pardon, juste un instant...",
            "Sorry, one more second...": "Pardon, encore une seconde...",
            "Yeah, still here!": "Oui, je suis toujours là !",
            "Yep, I'm here! One sec.": "Oui, je suis là ! Une seconde.",
            "Hey!": "Salut !",
            "Sorry, one sec...": "Pardon, une seconde...",
        }),
    "pt-BR": Lang(
        "pt-BR", "Português", "Brazilian Portuguese",
        re.compile(r"\b(não|nao|nunca|nada|nenhum|nenhuma|nem|cancelar|cancela)\b", re.I),
        _with_months(_PT_DAYS, _PT_MONTHS),
        {
            "intro": "Oi! Um aviso rápido: sou uma pessoa surda, e um aplicativo fala em voz alta o que eu "
                     "sinalizo. Só um momento, por favor.",
            "intro_order": "Oi! Um aviso rápido: sou uma pessoa surda, e um aplicativo fala em voz alta o que eu "
                           "sinalizo. Eu queria fazer um pedido para retirar.",
            "Mm, one sec...": "Hum, um segundo...",
            "Mm, just a sec...": "Hum, só um segundo...",
            "Okay, one sec...": "Tá, um segundo...",
            "Sorry, just a moment...": "Desculpa, só um momento...",
            "Sorry, one more second...": "Desculpa, mais um segundinho...",
            "Yeah, still here!": "Sim, ainda estou aqui!",
            "Yep, I'm here! One sec.": "Sim, estou aqui! Um segundo.",
            "Hey!": "Oi!",
            "Sorry, one sec...": "Desculpa, um segundo...",
        }),
}


def lang_for(code: str | None) -> Lang | None:
    """None means English (no translation). Unknown codes also mean English."""
    if not code or code.lower().startswith("en"):
        return None
    if code in LANGS:
        return LANGS[code]
    prefix = code.split("-")[0].lower()
    return next((l for c, l in LANGS.items() if c.split("-")[0].lower() == prefix), None)


def languages() -> list[dict]:
    return [{"code": "en-US", "name": "English"}] + [{"code": l.code, "name": l.name} for l in LANGS.values()]


def fixed_line(lang: Lang, text: str, intro_texts: dict[str, str]) -> str | None:
    """The pre-written translation of a fixed line, or None if this line needs the model."""
    for key, en in intro_texts.items():
        if text == en:
            return lang.fixed.get(key)
    return lang.fixed.get(text)


# ------------------------------------------------------------------ guard

_DIGITS = re.compile(r"\d+(?:[.,:]\d+)*")


def _numbers_in(out: str) -> set[str]:
    vals: set[str] = set()
    for m in _DIGITS.finditer(out):
        tok = m.group()
        vals |= guards._num_values(tok)
        if "," in tok:          # "23,40" is a decimal comma in es/fr/pt
            vals |= guards._num_values(tok.replace(".", "").replace(",", "."))
    return vals


def translation_guard(english: str, translated: str, lang: Lang) -> guards.GuardResult:
    """Everything that matters must survive translation: numbers (as digits), days and months,
    and a "no". Extra numbers or days in the translation are blocked too."""
    problems: list[str] = []
    if not translated.strip():
        return guards.GuardResult(False, ["the translation came back empty"])

    want = guards.extract_numbers(english, include_ambiguous=False)
    have = _numbers_in(translated)
    missing = sorted(n for n in want if n not in have)
    if missing:
        problems.append(f"the translation lost a number ({', '.join(missing)})")
    en_all = guards.extract_numbers(english, include_ambiguous=True)
    extra = [m.group() for m in _DIGITS.finditer(translated) if not (_numbers_in(m.group()) & en_all)]
    if extra:
        problems.append(f"the translation added a number ({', '.join(extra)})")

    low = translated.lower()
    for day in sorted(guards.extract_days(english)):
        native = lang.days.get(day, ())
        if native and not any(n in low for n in native):
            problems.append(f"the translation lost “{day}”")

    if guards.has_negation(english) and not lang.negation.search(translated):
        problems.append("the English says no, but the translation doesn't")
    return guards.GuardResult(not problems, problems)


TRANSLATE_RULES = """Translate for a live phone call. Rules:
- Keep the meaning exactly. Don't add, drop or soften anything. Keep "no" as no, "maybe" as maybe.
- Write every number, price, time and quantity as digits (e.g. 12, $23.40, 7:30).
- Keep names exactly as written.
- Sound like a person talking on the phone, not a document. One or two short sentences.
- Output only the translation."""
