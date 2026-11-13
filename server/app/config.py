"""All settings come from the environment. Keys never leave the server."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    # Public base URL, e.g. https://sign2speak.example.com (no trailing slash).
    public_url: str = field(default_factory=lambda: os.getenv("PUBLIC_URL", "http://localhost:8000").rstrip("/"))

    twilio_account_sid: str = field(default_factory=lambda: os.getenv("TWILIO_ACCOUNT_SID", ""))
    twilio_auth_token: str = field(default_factory=lambda: os.getenv("TWILIO_AUTH_TOKEN", ""))
    twilio_number: str = field(default_factory=lambda: os.getenv("TWILIO_NUMBER", ""))
    # Turn off only for local tests. Never in production.
    validate_twilio_signature: bool = field(default_factory=lambda: _bool("VALIDATE_TWILIO_SIGNATURE", True))

    # ElevenLabs voice through ConversationRelay. Format (Twilio docs):
    #   VOICE_ID-MODEL-SPEED_STABILITY_SIMILARITY  (all settings or none)
    # Default model is flash_v2_5. Expressive models (v3/v4) do not accept speed.
    tts_provider: str = field(default_factory=lambda: os.getenv("TTS_PROVIDER", "ElevenLabs"))
    tts_model: str = field(default_factory=lambda: os.getenv("TTS_MODEL", "flash_v2_5"))
    tts_voice_settings: str = field(default_factory=lambda: os.getenv("TTS_VOICE_SETTINGS", ""))
    default_voice_id: str = field(default_factory=lambda: os.getenv("DEFAULT_VOICE_ID", "XrExE9yKIg1WjnnlVkGX"))
    language: str = field(default_factory=lambda: os.getenv("CALL_LANGUAGE", "en-US"))

    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    # Set from the current Gemini docs. The server checks it exists at startup.
    gemini_model: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL", ""))
    gemini_timeout_s: float = field(default_factory=lambda: float(os.getenv("GEMINI_TIMEOUT_S", "2.5")))

    # Optional shared key for the signer app (?key=... once, kept in the browser).
    app_access_key: str = field(default_factory=lambda: os.getenv("APP_ACCESS_KEY", ""))

    ring_timeout_s: int = field(default_factory=lambda: int(os.getenv("RING_TIMEOUT_S", "35")))
    static_dir: str = field(default_factory=lambda: os.getenv("STATIC_DIR", ""))
    log_dir: str = field(default_factory=lambda: os.getenv("LOG_DIR", "logs"))

    @property
    def twilio_ready(self) -> bool:
        return bool(self.twilio_account_sid and self.twilio_auth_token and self.twilio_number)

    @property
    def gemini_ready(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_model)

    @property
    def ws_base(self) -> str:
        if self.public_url.startswith("https://"):
            return "wss://" + self.public_url[len("https://"):]
        return "ws://" + self.public_url[len("http://"):]

    def voice_string(self, voice_id: str | None) -> str:
        vid = voice_id or self.default_voice_id
        parts = [vid]
        if self.tts_model:
            parts.append(self.tts_model)
        if self.tts_voice_settings:
            parts.append(self.tts_voice_settings)
        return "-".join(parts)


settings = Settings()
