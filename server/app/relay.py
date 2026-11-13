"""Twilio ConversationRelay adapter: TwiML builders and WebSocket message shapes.

Everything protocol-specific lives here so it can be checked against the
current Twilio docs in one place (see DECISIONS.md, D-003).

TwiML attribute names come from the official `twilio` Python SDK (9.13),
which generates them from Twilio's TwiML schema.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from twilio.twiml.voice_response import Connect, VoiceResponse

from .config import settings

# ---------------------------------------------------------------- TwiML


def relay_twiml(session_id: str, voice_id: str | None = None) -> str:
    """<Connect><ConversationRelay/></Connect> for a live call."""
    r = VoiceResponse()
    c = Connect(action=f"{settings.public_url}/twilio/relay-ended/{session_id}")
    c.conversation_relay(
        url=f"{settings.ws_base}/ws/relay/{session_id}",
        language=settings.language,
        tts_provider=settings.tts_provider,
        voice=settings.voice_string(voice_id),
        partial_prompts="true",          # stream the caller's words as they speak
        interruptible="speech",          # caller can talk over our voice
        welcome_greeting_interruptible="speech",
        dtmf_detection="true",
        application_reconnect="true",    # Twilio re-dials our socket if it drops
        elevenlabs_text_normalization="on",
    )
    r.append(c)
    return str(r)


def ringback_twiml(session_id: str) -> str:
    """What the caller hears while the signer's phone rings."""
    r = VoiceResponse()
    r.play(f"{settings.public_url}/static-audio/ringback.wav", loop=0)
    return str(r)


def goodbye_twiml(text: str) -> str:
    r = VoiceResponse()
    if text:
        r.say(text)
    r.hangup()
    return str(r)


# ---------------------------------------------------------------- WS messages


@dataclass
class RelayEvent:
    type: str
    raw: dict[str, Any]

    @property
    def text(self) -> str:
        return (self.raw.get("voicePrompt") or "").strip()

    @property
    def last(self) -> bool:
        return bool(self.raw.get("last", True))


def parse(message: str) -> RelayEvent:
    """Incoming types: setup, prompt, interrupt, dtmf, error (and others we ignore)."""
    data = json.loads(message)
    return RelayEvent(type=str(data.get("type", "")), raw=data)


def text_message(text: str, *, interruptible: bool = True, preemptible: bool = False) -> str:
    """Send one complete line to be spoken."""
    return json.dumps({
        "type": "text",
        "token": text,
        "last": True,
        "interruptible": interruptible,
        "preemptible": preemptible,
    })


def end_message(reason: str = "hangup") -> str:
    return json.dumps({"type": "end", "handoffData": json.dumps({"reason": reason})})
