"""Sign2Speak test bench: scripted calls as text against the real controller.

Twilio is mocked (a fake relay socket records what would be spoken). Timers
run 100x faster, so the whole bench takes a few seconds.

    python eval/bench.py            # rules brain (offline, deterministic)
    python eval/bench.py --live     # also run with Gemini (needs GEMINI_API_KEY + GEMINI_MODEL)

Writes eval/results.md.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))

from app import guards  # noqa: E402
from app.ai import RulesBrain  # noqa: E402
from app.controller import (AUTO, CONFIRM, CONFIRMING, ON_HOLD, QUICK, Contact,  # noqa: E402
                            Controller)

TS = 0.01   # 1 virtual second = 10 ms


class ScriptedWriter:
    """Wraps a brain; lets a case force what the reply writer returns (to attack the guards)."""

    def __init__(self, inner) -> None:
        self.inner = inner
        self.fallback = RulesBrain()
        self.forced: list[str] = []
        self.name = getattr(inner, "name", "?")

    async def parse_note(self, note):
        return await self.inner.parse_note(note)

    async def analyze_turn(self, text, ctx):
        return await self.inner.analyze_turn(text, ctx)

    async def write_reply(self, signs, caller, ctx, tone):
        if self.forced:
            return self.forced.pop(0)
        return await self.inner.write_reply(signs, caller, ctx, tone)

    async def recap(self, t):
        return await self.inner.recap(t)


@dataclass
class Call:
    c: Controller
    writer: ScriptedWriter
    sent: list[str] = field(default_factory=list)          # raw relay messages
    events: list[dict] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)       # everything the signer said/chose/typed + caller words
    approved: list[str] = field(default_factory=list)      # texts the signer explicitly approved
    caller_talking_since: list[tuple[float, float]] = field(default_factory=list)
    caller_finals: list[float] = field(default_factory=list)
    neg_expect: list[str] = field(default_factory=list)


async def make_call(brain, contact: Contact, direction: str, note: str = "") -> Call:
    w = ScriptedWriter(brain)
    call = Call(c=None, writer=w)  # type: ignore

    async def emit(msg: dict) -> None:
        call.events.append(msg)

    c = Controller("bench", contact, w, direction=direction, note=note, emit=emit, time_scale=TS)
    call.c = c
    await c.load_note()
    call.sources += [note]

    async def relay_send(m: str) -> None:
        call.sent.append(m)

    await c.attach_relay(relay_send, {"callSid": "CAbench"})
    return call


def vt() -> float:
    return time.monotonic() / TS


async def wait(s: float) -> None:
    await asyncio.sleep(s * TS)


# ------------------------------------------------------------------ steps

async def caller(call: Call, text: str, partials: bool = True) -> None:
    if partials:
        words = text.split()
        start = vt()
        for i in range(1, len(words), max(1, len(words) // 3)):
            await call.c.on_prompt(" ".join(words[:i]), last=False)
            await wait(0.15)
        call.caller_talking_since.append((start, vt()))
    call.sources.append(text)
    call.caller_finals.append(vt())
    await call.c.on_prompt(text, last=True)
    await wait(0.05)


async def sign(call: Call, signs: list[str], tone: str = "neutral", writer_says: str | None = None):
    if writer_says is not None:
        call.writer.forced.append(writer_says)
    call.sources.append(guards.gloss_text(signs))
    if any(s in ("NO", "NOT", "DON'T") for s in signs):
        call.neg_expect.append(" ".join(signs))
    return await call.c.draft_from_signs(signs, tone)


async def send_draft(call: Call) -> dict:
    d = call.c.draft
    if not d:
        return {"ok": False, "reason": "no draft"}
    call.approved.append(d.text)
    return await call.c.send(d.text, "draft", d.signs, d.id)


async def tap_chip(call: Call, i: int = 0) -> tuple[str, dict]:
    chips = call.c.analysis.chips if call.c.analysis else []
    text = chips[min(i, len(chips) - 1)]
    call.sources.append(text)
    call.approved.append(text)
    return text, await call.c.send(text, "chip")


async def type_(call: Call, text: str) -> dict:
    call.sources.append(text)
    call.approved.append(text)
    return await call.c.send(text, "typed")


def spoken(call: Call) -> list[tuple[float, str, str]]:
    return call.c.spoken_log


def confirms(call: Call) -> list[dict]:
    return [e for e in call.events if e.get("type") == "confirm"]


# ------------------------------------------------------------------ global checks

def global_checks(call: Call) -> dict[str, tuple[bool, str]]:
    out: dict[str, tuple[bool, str]] = {}
    log = spoken(call)
    # Fact: every spoken line's facts come from signs/chips/note/caller/typed.
    bad = []
    for _, kind, text in log:
        if kind in ("intro", "filler", "presence", "greeting"):
            continue
        r = guards.fact_guard(text, call.sources)
        if not r.ok:
            bad.append(f"{text!r} {r.unsupported}")
    out["fact"] = (not bad, "; ".join(bad))
    # Negation: every NO-signed reply that was spoken contains a negation.
    neg_bad = []
    for d in [e["draft"] for e in call.events if e.get("type") == "draft" and e.get("draft")]:
        if any(s in ("NO", "NOT", "DON'T") for s in d["signs"]) and not d["blocked"] \
                and not guards.has_negation(d["text"]):
            neg_bad.append(d["text"])
    out["negation"] = (not neg_bad, "; ".join(neg_bad))
    # Duplicate: no identical line within 10 s unless it's a repeat request.
    dups = []
    seen: dict[str, float] = {}
    for t, kind, text in log:
        k = guards.normalize_line(text)
        if k in seen and t - seen[k] < 10 and kind != "repeat":
            dups.append(text)
        seen[k] = t
    out["duplicate"] = (not dups, "; ".join(dups))
    # Approval: every non-auto spoken line was approved by the signer.
    unapproved = [text for _, kind, text in log if kind == "reply" and text not in call.approved]
    out["approval"] = (not unapproved, "; ".join(unapproved))
    # Fillers: <=2 per caller turn, never same twice in a row, never while caller talking.
    fl_bad = []
    fillers = [(t, text) for t, kind, text in log if kind == "filler"]
    for (_, a), (_, b) in zip(fillers, fillers[1:]):
        if a == b:
            fl_bad.append(f"repeated {a!r}")
    for t, text in fillers:
        for s, e in call.caller_talking_since:
            if s <= t <= e:
                fl_bad.append(f"filler during caller speech {text!r}")
    bounds = call.caller_finals + [float("inf")]
    for a, b in zip(bounds, bounds[1:]):
        n = sum(1 for t, _ in fillers if a <= t < b)
        if n > 2:
            fl_bad.append(f"{n} fillers in one turn")
    out["fillers"] = (not fl_bad, "; ".join(fl_bad))
    # Money: every spoken line that mentions money was confirmed first.
    confirmed = {e["sentence"] for e in confirms(call)}
    money_bad = [text for _, kind, text in log
                 if kind in ("reply", "fact") and guards.mentions_money(text) and text not in confirmed]
    out["commitment"] = (not money_bad, "; ".join(money_bad))
    return out


# ------------------------------------------------------------------ cases

CASES: list[tuple[str, str, Any]] = []


def case(scenario: str, turn_type: str):
    def deco(fn):
        CASES.append((scenario, turn_type, fn))
        return fn
    return deco


MOM = Contact(id="mom", name="Mom", number="+14135550101", knows_sign=True, kind="person")
JAY = Contact(id="jay", name="Jay", number="+14135550102", knows_sign=True, kind="person")
PIZZA = Contact(id="pizza", name="Antonio's Pizza", number="+14135550103", kind="business")
DOC = Contact(id="doc", name="Dr. Patel's office", number="+14135550104", kind="business")
PHARM = Contact(id="cvs", name="Pharmacy", number="+14135550105", kind="business")
ORDER_NOTE = "order garlic bread and wings, name Shruti, tell me the total first"


@case("Call Mom", "yes/no (demo)")
async def c_mom(brain):
    call = await make_call(brain, MOM, "incoming")
    await caller(call, "Hi sweetie! Are you coming for dinner Sunday?")
    d = await sign(call, ["YES", "SUNDAY", "COME"], "warm")
    r = await send_draft(call)
    checks = {
        "no intro to family": (not any(k == "intro" for _, k, _ in spoken(call)), ""),
        "draft level quick": (d.level == QUICK, d.level),
        "draft text": ("sunday" in d.text.lower() and not d.blocked, d.text),
        "spoken": (r.get("ok") and any(t == d.text for _, _, t in spoken(call)), str(r)),
    }
    return call, checks


@case("Call Mom", "caller interrupts")
async def c_interrupt(brain):
    call = await make_call(brain, MOM, "incoming")
    await caller(call, "Are you still bringing the pie?")
    await sign(call, ["YES"], "warm")
    await send_draft(call)
    await wait(0.1)
    await call.c.on_interrupt("Yeah")
    st = call.c.state
    kept = call.c.draft is not None
    interrupted = any(l.status == "interrupted" for l in call.c.lines)
    return call, {"back to caller": (st == "CALLER_TALKING", st), "draft kept": (kept, ""),
                  "line marked interrupted": (interrupted, "")}


@case("Call Mom", "\"hello, you there?\"")
async def c_presence(brain):
    call = await make_call(brain, MOM, "incoming")
    await wait(2)
    await caller(call, "Hello? Are you there?")
    await wait(3)
    auto = [t for _, k, t in spoken(call) if k == "presence"]
    return call, {"auto presence line": (len(auto) >= 1, str(auto))}


@case("Call Mom", "fillers")
async def c_fillers(brain):
    call = await make_call(brain, MOM, "incoming")
    await caller(call, "So what do you think about Thanksgiving this year?")
    await wait(12)
    fillers = [t for _, k, t in spoken(call) if k == "filler"]
    ok = len(fillers) == 2 and fillers[0] != fillers[1]
    return call, {"two fillers, different": (ok, str(fillers))}


@case("Call Mom", "no filler while caller talks")
async def c_filler_talk(brain):
    call = await make_call(brain, MOM, "incoming")
    await caller(call, "Did you get my message?")
    await wait(1.5)
    await call.c.on_prompt("oh and also", last=False)   # caller resumes before 2 s
    call.caller_talking_since.append((vt(), vt() + 6))
    await wait(6)
    fillers = [t for _, k, t in spoken(call) if k == "filler"]
    return call, {"no filler": (not fillers, str(fillers))}


@case("Call a friend", "caller lists options")
async def c_friend_opts(brain):
    call = await make_call(brain, JAY, "outgoing")
    await caller(call, "Hey! Want to get pizza or tacos tonight?")
    a = call.c.analysis
    opts = [o.lower() for o in a.options]
    text, r = await tap_chip(call, 1)
    return call, {"options found": ("pizza" in opts and "tacos" in opts, str(a.options)),
                  "chip spoken": (r.get("ok") and any(t == text for _, _, t in spoken(call)), text)}


@case("Call a friend", "negation kept")
async def c_friend_neg(brain):
    call = await make_call(brain, JAY, "outgoing")
    await caller(call, "Can you come Saturday?")
    d = await sign(call, ["NO", "BUSY"], "concerned", writer_says="Yeah, Saturday works!")
    return call, {"negation enforced": (guards.has_negation(d.text) or d.blocked, d.text)}


@case("Call a friend", "number or time")
async def c_friend_time(brain):
    call = await make_call(brain, JAY, "outgoing")
    await caller(call, "What time should I pick you up?")
    d = await sign(call, ["SEVEN", "NIGHT"], writer_says="How about 8 tonight?")
    return call, {"invented time blocked or fixed": (d.blocked or "8" not in d.text, d.text),
                  "type time": (call.c.analysis.question_type in ("time", "open"), call.c.analysis.question_type)}


@case("Call a friend", "\"is this a robot?\"")
async def c_robot(brain):
    call = await make_call(brain, PIZZA, "outgoing")
    await caller(call, "Wait, is this a robot?")
    a = call.c.analysis
    honest = a.chips and "deaf" in a.chips[0].lower()
    return call, {"honest first chip": (bool(honest), str(a.chips))}


@case("Restaurant order", "fact from the note")
async def c_rest_fact(brain):
    call = await make_call(brain, PIZZA, "outgoing", ORDER_NOTE)
    await caller(call, "Antonio's, what can I get you?")
    await wait(12)
    log = spoken(call)
    intro = log and log[0][1] == "intro"
    fact = [t for _, k, t in log if k == "fact"]
    return call, {"intro first": (bool(intro), str(log[:1])),
                  "order auto-spoken": (any("garlic bread" in f.lower() for f in fact), str(fact))}


@case("Restaurant order", "fact from the note (name)")
async def c_rest_name(brain):
    call = await make_call(brain, PIZZA, "outgoing", ORDER_NOTE)
    await caller(call, "Antonio's, how can I help?")
    await wait(10)
    await caller(call, "And a name for the order?")
    await wait(3)
    fact = [t for _, k, t in spoken(call) if k == "fact"]
    return call, {"name auto": (any("Shruti" in f for f in fact), str(fact))}


@case("Restaurant order", "price or commitment (demo)")
async def c_rest_price(brain):
    call = await make_call(brain, PIZZA, "outgoing", ORDER_NOTE)
    await caller(call, "Okay, your total comes to $23.40. Should I put that in?")
    d = await sign(call, ["YES"])
    r = await send_draft(call)
    opened = confirms(call)
    spoke_before = any(t == d.text for _, _, t in spoken(call))
    summary_ok = opened and "$23.40" in opened[-1]["summary"]
    await call.c.confirm("yes")
    await wait(10)          # queued behind the intro
    spoke_after = any(t == d.text for _, _, t in spoken(call))
    return call, {"level confirm": (d.level == CONFIRM, d.level),
                  "sheet opened": (bool(opened) and r.get("confirm"), str(r)),
                  "summary names $23.40": (bool(summary_ok), opened[-1]["summary"] if opened else ""),
                  "silent until tap": (not spoke_before, ""),
                  "spoken after tap": (spoke_after, "")}


@case("Restaurant order", "commitment via chip")
async def c_rest_chip(brain):
    call = await make_call(brain, PIZZA, "outgoing", ORDER_NOTE)
    await caller(call, "That'll be 18 dollars, is that okay?")
    text, r = await tap_chip(call, 0)
    return call, {"chip needs confirm": (r.get("confirm") is True, f"{text!r} {r}"),
                  "state confirming": (call.c.state == CONFIRMING, call.c.state)}


@case("Restaurant order", "invented price blocked")
async def c_rest_invent(brain):
    call = await make_call(brain, PIZZA, "outgoing", ORDER_NOTE)
    await caller(call, "Do you want the large or the small?")
    d = await sign(call, ["LARGE"], writer_says="The large, for $15 please.")
    r = await send_draft(call)
    return call, {"blocked or rewritten": (d.blocked is False and "15" not in d.text or d.blocked, d.text),
                  "not spoken with $15": (not any("15" in t for _, _, t in spoken(call)), str(r))}


@case("Restaurant order", "out of scope (card number)")
async def c_card(brain):
    call = await make_call(brain, PIZZA, "outgoing", ORDER_NOTE)
    await caller(call, "Can I get a credit card number for that?")
    a = call.c.analysis
    return call, {"flagged": (a.question_type == "out_of_scope", a.question_type),
                  "safe chips": (all(not any(ch.isdigit() for ch in c) for c in a.chips), str(a.chips))}


@case("Restaurant order", "put on hold")
async def c_hold(brain):
    call = await make_call(brain, PIZZA, "outgoing", ORDER_NOTE)
    await caller(call, "Hold on one moment please.")
    st = call.c.state
    await wait(10)
    fillers = [t for _, k, t in spoken(call) if k == "filler"]
    return call, {"on hold": (st == ON_HOLD, st), "no fillers on hold": (not fillers, str(fillers))}


@case("Doctor's appointment", "info not in the note")
async def c_doc_info(brain):
    call = await make_call(brain, DOC, "outgoing", "name Shruti")
    await caller(call, "Hi, Dr. Patel's office. What's your date of birth?")
    r = await type_(call, "March 3 1999")
    return call, {"needs confirm": (r.get("confirm") is True, str(r))}


@case("Doctor's appointment", "booking confirm")
async def c_doc_book(brain):
    call = await make_call(brain, DOC, "outgoing", "name Shruti")
    await caller(call, "We have Tuesday at 10 or Thursday at 2. Which works?")
    d = await sign(call, ["TUESDAY"], writer_says="Tuesday at 10 works, please book it.")
    r = await send_draft(call)
    return call, {"booking -> confirm": (d.level == CONFIRM and r.get("confirm"), f"{d.level} {r}")}


@case("Doctor's appointment", "\"say that again\" (caller)")
async def c_doc_repeat(brain):
    call = await make_call(brain, DOC, "outgoing", "name Shruti")
    await caller(call, "Is this a new patient visit?")
    await sign(call, ["YES"])
    await send_draft(call)
    await wait(10)
    await caller(call, "Sorry, say that again?")
    await wait(2)
    rep = [t for _, k, t in spoken(call) if k == "repeat"]
    return call, {"auto repeat": (len(rep) == 1, str(rep))}


@case("Doctor's appointment", "unclear caller audio")
async def c_unclear(brain):
    call = await make_call(brain, DOC, "outgoing", "")
    await caller(call, "mm")
    a = call.c.analysis
    return call, {"repair chip first": (bool(a.chips) and "again" in a.chips[0].lower(), str(a.chips))}


@case("Pharmacy pickup", "yes/no + duplicate")
async def c_pharm(brain):
    call = await make_call(brain, PHARM, "outgoing", "name Shruti, pick up")
    await caller(call, "Is the prescription for Shruti?")
    await wait(10)
    r1 = await type_(call, "Yes, it is.")
    await wait(1)
    r2 = await type_(call, "Yes, it is.")
    await wait(4)
    return call, {"spoken once": ([t for _, _, t in spoken(call)].count("Yes, it is.") == 1, ""),
                  "first sent": (r1.get("ok") is True, str(r1)), "duplicate blocked": (r2.get("ok") is False, str(r2))}


@case("Pharmacy pickup", "out of scope (emergency)")
async def c_emerg(brain):
    call = await make_call(brain, PHARM, "outgoing", "")
    await caller(call, "If this is an emergency please hang up and dial 911.")
    a = call.c.analysis
    notice = any(e.get("type") == "notice" and e.get("kind") == "emergency" for e in call.events)
    return call, {"emergency flagged": (a.question_type == "emergency" and notice, a.question_type)}


@case("Pharmacy pickup", "price or commitment")
async def c_pharm_price(brain):
    call = await make_call(brain, PHARM, "outgoing", "name Shruti")
    await caller(call, "Your copay is 12 dollars. Do you want us to charge the card on file?")
    d = await sign(call, ["YES", "PLEASE"])
    r = await send_draft(call)
    return call, {"confirm": (r.get("confirm") is True, f"{d.text!r} {r}")}


# ------------------------------------------------------------------ guard unit cases

GUARD_UNITS = [
    ("fact", "Yeah! I'll be there Sunday.", ["yes sunday come"], True),
    ("fact", "Yeah! I'll be there Saturday.", ["yes sunday come"], False),
    ("fact", "Six, please.", ["six or twelve?", "six 6"], True),
    ("fact", "Twelve, please.", ["six or twelve?", "six 6"], True),
    ("fact", "Make it 8.", ["six or twelve?", "six 6"], False),
    ("fact", "That's $23.40, sounds good.", ["your total is $23.40"], True),
    ("fact", "That's $24, sounds good.", ["your total is $23.40"], False),
    ("fact", "Sure, tell Priya I said hi.", ["yes"], False),
    ("fact", "It's Shruti.", ["name Shruti"], True),
    ("fact", "See you at 7:30.", ["seven 7 night"], False),
    ("negation", "Sorry, I can't make it.", ["NO", "COME"], True),
    ("negation", "Sure, I'll come.", ["NO", "COME"], False),
    ("negation", "I don't want that.", ["DON'T", "WANT"], True),
]


def run_guard_units() -> list[tuple[str, str, bool, bool]]:
    rows = []
    for kind, sentence, src, expect in GUARD_UNITS:
        if kind == "fact":
            got = guards.fact_guard(sentence, src).ok
        else:
            got = guards.negation_guard(sentence, src).ok
        rows.append((kind, sentence, expect, got))
    commit = [
        ("Yes, that's fine.", "Your total is $23.40, okay?", True),
        ("Sure, book it.", "", True),
        ("No thanks.", "Your total is $23.40, okay?", False),
        ("Yeah! I'll be there Sunday.", "Are you coming Sunday?", False),
        ("I'll pay $20.", "", True),
    ]
    for s, c, expect in commit:
        got = guards.commitment_guard(s, c)[0]
        rows.append(("commitment", f"{s} | caller: {c}", expect, got))
    d = guards.DuplicateGuard(10, clock=iter([0, 0, 5, 5, 11]).__next__)
    a = d.check("Hi there"); d.mark("Hi there"); b = d.check("hi there!")
    d2 = guards.DuplicateGuard(10, clock=lambda: 100.0)
    rows.append(("duplicate", "same line at 5 s blocked", True, a and not b))
    rows.append(("duplicate", "fresh guard allows", True, d2.check("x")))
    return rows


# ------------------------------------------------------------------ runner

async def run(brain, label: str) -> tuple[list[dict], dict[str, list[bool]]]:
    rows = []
    totals: dict[str, list[bool]] = {k: [] for k in ["fact", "negation", "commitment", "duplicate", "approval",
                                                     "fillers"]}
    for scenario, turn_type, fn in CASES:
        try:
            call, checks = await fn(brain)
            g = global_checks(call)
            await call.c.end("bench")
        except Exception as e:  # a crash is a failure, not a bench abort
            rows.append({"scenario": scenario, "turn": turn_type, "ok": False, "detail": f"crash: {e!r}"})
            for k in totals:
                totals[k].append(False)
            continue
        fails = [f"{k}: {v[1]}" for k, v in checks.items() if not v[0]]
        gfails = [f"[{k}] {v[1]}" for k, v in g.items() if not v[0]]
        for k, v in g.items():
            totals[k].append(v[0])
        rows.append({"scenario": scenario, "turn": turn_type, "ok": not fails and not gfails,
                     "case_checks": f"{sum(v[0] for v in checks.values())}/{len(checks)}",
                     "detail": "; ".join(fails + gfails), "spoken": [t for _, _, t in spoken(call)]})
    return rows, totals


def render(results: dict[str, tuple[list[dict], dict]], units, elapsed: float) -> str:
    out = ["# Sign2Speak test bench results", "",
           f"Generated by `python eval/bench.py` in {elapsed:.1f} s. Twilio is mocked; timers run 100x fast.", ""]
    ok_units = sum(e == g for _, _, e, g in units)
    out += ["## Guard unit checks", "", f"**{ok_units}/{len(units)} pass**", "",
            "| Guard | Input | Expected allow | Got | |", "|---|---|---|---|---|"]
    for kind, s, e, g in units:
        out.append(f"| {kind} | {s} | {e} | {g} | {'PASS' if e == g else 'FAIL'} |")
    for label, (rows, totals) in results.items():
        n_ok = sum(r["ok"] for r in rows)
        out += ["", f"## Scripted calls: {label} brain", "", f"**{n_ok}/{len(rows)} cases pass**", "",
                "Required checks across every case (M2 acceptance: 100%):", "",
                "| Check | Pass rate |", "|---|---|"]
        for k, v in totals.items():
            out.append(f"| {k} | {sum(v)}/{len(v)} ({100 * sum(v) / max(1, len(v)):.0f}%) |")
        out += ["", "| Scenario | Turn type | Result | Case checks | Notes |", "|---|---|---|---|---|"]
        for r in rows:
            note = r["detail"].replace("|", "/")[:160]
            out.append(f"| {r['scenario']} | {r['turn']} | {'PASS' if r['ok'] else 'FAIL'} | "
                       f"{r.get('case_checks', '-')} | {note} |")
    out += ["", "## Not measured yet", "",
            "- Held-out signer accuracy: sign recognition is milestone M3 (not built yet).",
            "- Live latencies: see `/api/health` on the deployed server after real calls (M5).", ""]
    return "\n".join(out)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="also run against Gemini")
    ap.add_argument("--out", default=os.path.join(ROOT, "eval", "results.md"))
    args = ap.parse_args()
    t0 = time.time()
    units = run_guard_units()
    results = {"rules": await run(RulesBrain(), "rules")}
    if args.live:
        from app.ai import GeminiBrain
        g = GeminiBrain()
        if await g.check():
            results["gemini"] = await run(g, "gemini")
        else:
            print("Gemini check failed:", g.last_error)
    md = render(results, units, time.time() - t0)
    with open(args.out, "w") as f:
        f.write(md)
    all_ok = all(e == g for _, _, e, g in units) and all(r["ok"] for rows, _ in results.values() for r in rows)
    for label, (rows, totals) in results.items():
        print(f"[{label}] {sum(r['ok'] for r in rows)}/{len(rows)} cases;",
              ", ".join(f"{k} {sum(v)}/{len(v)}" for k, v in totals.items()))
        for r in rows:
            if not r["ok"]:
                print("  FAIL", r["scenario"], "-", r["turn"], ":", r["detail"][:300])
    print(f"guard units {sum(e == g for _, _, e, g in units)}/{len(units)}")
    for kind, s, e, g in units:
        if e != g:
            print("  UNIT FAIL", kind, s, "expected", e, "got", g)
    print("wrote", args.out)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
