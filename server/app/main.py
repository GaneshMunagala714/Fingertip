"""Sign2Speak backend: one FastAPI service.

HTTP
  POST /twilio/voice                 incoming call webhook (Twilio)
  POST /twilio/status/{sid}          call status callback (Twilio)
  POST /twilio/relay-ended/{sid}     <Connect action> when ConversationRelay ends (Twilio)
  POST /api/calls                    signer dials out
  POST /api/calls/{sid}/answer|decline|hangup|send|signs|confirm
  GET  /api/health                   what's configured, latency medians
WebSocket
  /ws/relay/{sid}                    Twilio ConversationRelay
  /ws/app                            the signer's app (events; reattaches to live calls)
"""
from __future__ import annotations

import asyncio
import io
import logging
import math
import os
import re
import secrets
import struct
import time
import wave
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from twilio.request_validator import RequestValidator

from . import relay
from .ai import make_brain
from .config import settings
from .controller import ENDED, RINGING, Contact, Controller
from .latency import latency
from .telephony import make_telephony

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("main")


# ------------------------------------------------------------------ state

class Hub:
    """Signer app sockets. Single-user demo: every connected device sees every call."""

    def __init__(self) -> None:
        self.sockets: set[WebSocket] = set()
        self.contacts: list[dict] = []
        self.voice_id: Optional[str] = None

    async def broadcast(self, msg: dict) -> None:
        dead = []
        for ws in list(self.sockets):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.sockets.discard(ws)

    def contact_for(self, number: str) -> Contact:
        digits = re.sub(r"\D", "", number or "")[-10:]
        for c in self.contacts:
            if digits and re.sub(r"\D", "", c.get("number", ""))[-10:] == digits:
                return Contact(id=c.get("id", ""), name=c.get("name", number), number=number,
                               knows_sign=bool(c.get("knows_sign")), kind=c.get("kind", "person"),
                               style=c.get("style", ""))
        return Contact(name=_pretty(number), number=number, kind="person", knows_sign=False)


def _pretty(n: str) -> str:
    d = re.sub(r"\D", "", n or "")
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return f"({d[:3]}) {d[3:6]}-{d[6:]}" if len(d) == 10 else (n or "Unknown")


hub = Hub()
sessions: dict[str, Controller] = {}
by_call_sid: dict[str, str] = {}
relay_reconnects: dict[str, int] = {}
state = {"telephony": None, "brain": None}


def new_session(contact: Contact, direction: str, note: str = "") -> Controller:
    sid = secrets.token_urlsafe(18)
    c = Controller(sid, contact, state["brain"], direction=direction, note=note, voice_id=hub.voice_id,
                   emit=hub.broadcast)
    sessions[sid] = c
    return c


def get_session(sid: str) -> Controller:
    c = sessions.get(sid)
    if not c:
        raise HTTPException(404, "That call isn't active any more.")
    return c


async def _forget_later(sid: str, after_s: float = 600) -> None:
    await asyncio.sleep(after_s)
    c = sessions.pop(sid, None)
    if c:
        by_call_sid.pop(c.call_sid, None)
        relay_reconnects.pop(sid, None)


async def end_session(c: Controller, reason: str) -> None:
    if c.state != ENDED:
        await c.end(reason)
        asyncio.create_task(_forget_later(c.id))


# ------------------------------------------------------------------ ringback

def _ringback_wav() -> bytes:
    """US ringback: 440 + 480 Hz, 2 s on / 4 s off. 8 kHz mono 16-bit."""
    rate, buf = 8000, io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(rate * 6):
            t = i / rate
            v = 0.0 if t >= 2 else 0.25 * (math.sin(2 * math.pi * 440 * t) + math.sin(2 * math.pi * 480 * t))
            frames += struct.pack("<h", int(v * 32767 / 2))
        w.writeframes(bytes(frames))
    return buf.getvalue()


RINGBACK = _ringback_wav()


# ------------------------------------------------------------------ app

@asynccontextmanager
async def lifespan(app: FastAPI):
    latency.configure(settings.log_dir)
    state["telephony"] = make_telephony()
    state["brain"] = make_brain()
    if hasattr(state["brain"], "check"):
        asyncio.create_task(state["brain"].check())
    yield


app = FastAPI(title="Sign2Speak", lifespan=lifespan)


async def twilio_form(request: Request) -> dict:
    form = dict((await request.form()).items())
    if settings.validate_twilio_signature:
        url = settings.public_url + request.url.path + (f"?{request.url.query}" if request.url.query else "")
        sig = request.headers.get("X-Twilio-Signature", "")
        if not RequestValidator(settings.twilio_auth_token).validate(url, form, sig):
            log.warning("bad Twilio signature on %s", request.url.path)
            raise HTTPException(403, "Invalid signature")
    return form


def xml(body: str) -> Response:
    return Response(content=body, media_type="application/xml")


def check_key(key: Optional[str]) -> None:
    if settings.app_access_key and not secrets.compare_digest(key or "", settings.app_access_key):
        raise HTTPException(401, "This app needs its access link.")


@app.get("/static-audio/ringback.wav")
async def ringback() -> Response:
    return Response(RINGBACK, media_type="audio/wav")


@app.get("/api/health")
async def health() -> dict:
    brain = state["brain"]
    return {
        "ok": True,
        "twilio": settings.twilio_ready,
        "gemini": {"configured": settings.gemini_ready, "model": settings.gemini_model,
                   "model_ok": getattr(brain, "ok", None), "error": getattr(brain, "last_error", "")},
        "brain": getattr(brain, "name", "?"),
        "voice": settings.voice_string(hub.voice_id),
        "active_calls": sum(1 for c in sessions.values() if c.state != ENDED),
        "app_connected": len(hub.sockets),
        "latency": latency.summary(),
    }


# ---------------------------------------------------------------- Twilio webhooks

@app.post("/twilio/voice")
async def twilio_voice(request: Request) -> Response:
    form = await twilio_form(request)
    call_sid, caller = form.get("CallSid", ""), form.get("From", "")
    c = new_session(hub.contact_for(caller), "incoming")
    c.call_sid = call_sid
    by_call_sid[call_sid] = c.id
    await hub.broadcast({"type": "ringing", "sid": c.id, "contact": asdict(c.contact)})
    asyncio.create_task(_ring_timeout(c))
    log.info("incoming %s from %s -> session %s", call_sid, caller, c.id)
    return xml(relay.ringback_twiml(c.id))


async def _ring_timeout(c: Controller) -> None:
    await asyncio.sleep(settings.ring_timeout_s)
    if c.state == RINGING:
        try:
            await state["telephony"].update_twiml(
                c.call_sid, relay.goodbye_twiml("Sorry, they can't pick up right now. Please try again later."))
        except Exception:
            log.exception("ring timeout")
        await end_session(c, "missed")


@app.post("/twilio/status/{sid}")
async def twilio_status(sid: str, request: Request) -> Response:
    form = await twilio_form(request)
    status = form.get("CallStatus", "")
    c = sessions.get(sid)
    if c:
        if form.get("CallSid") and not c.call_sid:
            c.call_sid = form["CallSid"]
            by_call_sid[c.call_sid] = sid
        await hub.broadcast({"type": "call_status", "sid": sid, "status": status})
        if status in {"completed", "busy", "no-answer", "failed", "canceled"}:
            await end_session(c, {"completed": "hangup"}.get(status, status))
    return Response(status_code=204)


@app.post("/twilio/status")
async def twilio_status_incoming(request: Request) -> Response:
    """Status callback configured on the phone number (incoming calls)."""
    form = await twilio_form(request)
    sid = by_call_sid.get(form.get("CallSid", ""))
    c = sessions.get(sid or "")
    if c and form.get("CallStatus") in {"completed", "busy", "no-answer", "failed", "canceled"}:
        await end_session(c, "hangup")
    return Response(status_code=204)


@app.post("/twilio/relay-ended/{sid}")
async def relay_ended(sid: str, request: Request) -> Response:
    """ConversationRelay finished. If we didn't mean it to, reconnect once."""
    form = await twilio_form(request)
    c = sessions.get(sid)
    log.info("relay ended %s: %s", sid, {k: v for k, v in form.items() if k.startswith(("Session", "Handoff"))})
    if c and c.state != ENDED and "Handoff" not in "".join(form.keys()):
        n = relay_reconnects.get(sid, 0)
        if n < 2:
            relay_reconnects[sid] = n + 1
            await hub.broadcast({"type": "notice", "sid": sid, "kind": "reconnecting",
                                 "text": "Reconnecting the call..."})
            return xml(relay.relay_twiml(sid, c.voice_id))
    if c:
        await end_session(c, "hangup")
    return xml(relay.goodbye_twiml(""))


# ---------------------------------------------------------------- ConversationRelay socket

def relay_handshake_ok(ws: WebSocket, sid: str) -> bool:
    """Twilio signs the ConversationRelay WebSocket handshake with X-Twilio-Signature over the URL."""
    if not settings.validate_twilio_signature:
        return True
    sig = ws.headers.get("x-twilio-signature", "")
    validator = RequestValidator(settings.twilio_auth_token)
    q = f"?{ws.url.query}" if ws.url.query else ""
    for url in (f"{settings.ws_base}/ws/relay/{sid}{q}", f"{settings.public_url}/ws/relay/{sid}{q}"):
        if sig and validator.validate(url, {}, sig):
            return True
    return False


@app.websocket("/ws/relay/{sid}")
async def ws_relay(ws: WebSocket, sid: str) -> None:
    c = sessions.get(sid)
    if not c or not relay_handshake_ok(ws, sid):
        log.warning("relay handshake rejected for %s", sid)
        await ws.close(code=1008)
        return
    await ws.accept()
    lock = asyncio.Lock()

    async def send(text: str) -> None:
        async with lock:
            await ws.send_text(text)

    try:
        while True:
            ev = relay.parse(await ws.receive_text())
            if ev.type == "setup":
                if c.call_sid and ev.raw.get("callSid") and ev.raw["callSid"] != c.call_sid:
                    log.warning("relay setup callSid mismatch for %s", sid)
                    await ws.close(code=1008)
                    return
                if ev.raw.get("callSid"):
                    by_call_sid[ev.raw["callSid"]] = sid
                await c.attach_relay(send, ev.raw)
            elif ev.type == "prompt":
                await c.on_prompt(ev.text, ev.last)
            elif ev.type == "interrupt":
                await c.on_interrupt(ev.raw.get("utteranceUntilInterrupt", ""))
            elif ev.type == "error":
                log.error("relay error %s: %s", sid, ev.raw)
            else:
                log.debug("relay %s ignored %s", sid, ev.type)
    except WebSocketDisconnect:
        log.info("relay socket closed for %s", sid)
    finally:
        c.detach_relay()


# ---------------------------------------------------------------- signer app socket

@app.websocket("/ws/app")
async def ws_app(ws: WebSocket, key: Optional[str] = None) -> None:
    if settings.app_access_key and not secrets.compare_digest(key or "", settings.app_access_key):
        await ws.close(code=1008)
        return
    await ws.accept()
    hub.sockets.add(ws)
    try:
        # Reattach: send every live (or just-ended) call so a reload picks up where it was.
        for c in list(sessions.values()):
            if c.state == RINGING and c.direction == "incoming":
                await ws.send_json({"type": "ringing", "sid": c.id, "contact": asdict(c.contact)})
            elif c.state != ENDED or (c.started_at and time.time() - c.started_at < 900):
                await ws.send_json(c.snapshot())
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "hello":
                hub.contacts = msg.get("contacts", [])[:200]
                hub.voice_id = msg.get("voice_id") or hub.voice_id
            elif msg.get("type") == "ping":
                await ws.send_json({"type": "pong", "t": msg.get("t")})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.sockets.discard(ws)


# ---------------------------------------------------------------- signer actions

class DialIn(BaseModel):
    number: str
    name: str = ""
    contact_id: str = ""
    knows_sign: bool = False
    kind: str = "person"
    style: str = ""
    note: str = ""


def _e164(n: str) -> str:
    d = re.sub(r"[^\d+]", "", n)
    if d.startswith("+"):
        return d
    d = re.sub(r"\D", "", d)
    if len(d) == 10:
        return "+1" + d
    if len(d) == 11 and d.startswith("1"):
        return "+" + d
    raise HTTPException(400, "That number doesn't look right. Use a 10-digit US number.")


@app.post("/api/calls")
async def dial(body: DialIn, key: Optional[str] = None) -> dict:
    check_key(key)
    to = _e164(body.number)
    contact = Contact(id=body.contact_id, name=body.name or _pretty(to), number=to,
                      knows_sign=body.knows_sign, kind=body.kind, style=body.style)
    c = new_session(contact, "outgoing", note=body.note)
    await c.load_note()
    try:
        c.call_sid = await state["telephony"].dial(
            to, relay.relay_twiml(c.id, c.voice_id), f"{settings.public_url}/twilio/status/{c.id}")
    except Exception as e:
        log.exception("dial failed")
        sessions.pop(c.id, None)
        raise HTTPException(502, "Couldn't start the call. Check the number and try again.") from e
    by_call_sid[c.call_sid] = c.id
    await hub.broadcast(c.snapshot())
    return {"sid": c.id, "note_facts": c.note_facts, "note_confirm": c.note_confirm,
            "first_words": None if c.intro_done else c.intro_text}


@app.post("/api/calls/{sid}/answer")
async def answer(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    c = get_session(sid)
    if c.state != RINGING:
        return {"ok": True}
    try:
        await state["telephony"].update_twiml(c.call_sid, relay.relay_twiml(c.id, c.voice_id))
    except Exception as e:
        log.exception("answer failed")
        await end_session(c, "failed")
        raise HTTPException(502, "Couldn't pick up. The caller may have hung up.") from e
    c.started_at = c.started_at or time.time()
    await c._set_state("CONNECTED")
    await hub.broadcast(c.snapshot())
    return {"ok": True}


@app.post("/api/calls/{sid}/decline")
async def decline(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    c = get_session(sid)
    try:
        await state["telephony"].update_twiml(
            c.call_sid, relay.goodbye_twiml("Sorry, they can't pick up right now. Please try again later."))
    except Exception:
        log.exception("decline")
    await end_session(c, "declined")
    return {"ok": True}


@app.post("/api/calls/{sid}/hangup")
async def hangup(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    c = get_session(sid)
    if c._relay_send:
        try:
            await c._relay_send(relay.end_message("hangup"))
        except Exception:
            pass
    if c.call_sid:
        await state["telephony"].hangup(c.call_sid)
    await end_session(c, "hangup")
    return {"ok": True, "recap": c.recap}


class NoteIn(BaseModel):
    note: str


@app.post("/api/note/parse")
async def parse_note(body: NoteIn, key: Optional[str] = None) -> dict:
    """Live preview on the errand-note screen: what can be said vs. checked first."""
    check_key(key)
    p = await state["brain"].parse_note(body.note[:1000])
    return {"auto_facts": [f.model_dump() for f in p.auto_facts], "needs_confirmation": p.needs_confirmation}


@app.post("/api/calls/{sid}/draft/clear")
async def clear_draft(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    await get_session(sid).clear_draft()
    return {"ok": True}


class SendIn(BaseModel):
    text: str
    source: str = "typed"           # typed | chip | draft
    draft_id: Optional[str] = None
    signs: list[str] = []
    force: bool = False
    hash: Optional[str] = None      # required for source=draft: the hash shown with that draft
    tone: str = ""


@app.post("/api/calls/{sid}/send")
async def send(sid: str, body: SendIn, key: Optional[str] = None) -> dict:
    check_key(key)
    c = get_session(sid)
    return await c.send(body.text, body.source, body.signs, body.draft_id, body.force, body.hash, body.tone)


class SignsIn(BaseModel):
    signs: list[str]
    tone: str = ""                  # "" = from the contact's talk style
    tone_source: str = "signer"     # signer | face (face is ignored unless FACE_TONE=true)


@app.post("/api/calls/{sid}/signs")
async def signs(sid: str, body: SignsIn, key: Optional[str] = None) -> dict:
    check_key(key)
    c = get_session(sid)
    tone = body.tone if (body.tone_source != "face" or settings.face_tone) else ""
    d = await c.draft_from_signs(body.signs, tone)
    return {"draft": asdict(d)}


class ConfirmIn(BaseModel):
    decision: str                   # yes | change | later
    hash: Optional[str] = None      # required for yes


@app.post("/api/calls/{sid}/confirm")
async def confirm(sid: str, body: ConfirmIn, key: Optional[str] = None) -> dict:
    check_key(key)
    return await get_session(sid).confirm(body.decision, body.hash)


@app.post("/api/calls/{sid}/stop")
async def stop(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    await get_session(sid).stop_speaking()
    return {"ok": True}


@app.exception_handler(Exception)
async def plain_errors(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled")
    return JSONResponse({"detail": "Something went wrong. Please try again."}, status_code=500)


# ---------------------------------------------------------------- static app

_static = settings.static_dir or os.path.join(os.path.dirname(__file__), "..", "..", "app", "dist")
if os.path.isdir(_static):
    app.mount("/assets", StaticFiles(directory=os.path.join(_static, "assets")), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str) -> FileResponse:
        f = os.path.normpath(os.path.join(_static, path))
        if path and f.startswith(os.path.normpath(_static)) and os.path.isfile(f):
            return FileResponse(f)
        return FileResponse(os.path.join(_static, "index.html"))
