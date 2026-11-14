"""Other-language calls (M6): TwiML, API gating and the translation guard."""
import os

os.environ["VALIDATE_TWILIO_SIGNATURE"] = "false"
os.environ["PUBLIC_URL"] = "https://s2s.test"
os.environ.pop("TWILIO_ACCOUNT_SID", None)
os.environ.pop("GEMINI_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from app import relay  # noqa: E402
from app.main import app, state  # noqa: E402
from app.translate import LANGS, lang_for, translation_guard  # noqa: E402

ES = LANGS["es-US"]


def test_twiml_language():
    assert 'language="en-US"' in relay.relay_twiml("s1")
    assert 'language="es-US"' in relay.relay_twiml("s1", language="es-US")


def test_lang_for():
    assert lang_for("") is None and lang_for("en-GB") is None
    assert lang_for("es-MX").code == "es-US"
    assert lang_for("xx-YY") is None


def test_health_lists_languages():
    with TestClient(app) as c:
        h = c.get("/api/health").json()
        assert h["languages"]["available"] is False          # rules brain can't translate
        assert {l["code"] for l in h["languages"]["list"]} >= {"en-US", "es-US", "fr-FR", "pt-BR"}


def test_dial_in_spanish_needs_gemini():
    with TestClient(app) as c:
        r = c.post("/api/calls", json={"number": "4135550101", "language": "es-US"})
        assert r.status_code == 400 and "Gemini" in r.json()["detail"]
        r = c.post("/api/calls", json={"number": "4135550101", "language": "xx-YY"})
        assert r.status_code == 400
        # English still dials, through the fake Twilio.
        r = c.post("/api/calls", json={"number": "4135550101", "language": "en-US"})
        assert r.status_code == 200
        assert 'language="en-US"' in state["telephony"].calls[-1][2]


def test_guard_numbers_days_negation():
    assert translation_guard("2 tacos at 7:30.", "2 tacos a las 7:30.", ES).ok
    assert not translation_guard("2 tacos at 7:30.", "2 tacos a las 8:30.", ES).ok
    assert translation_guard("It's $23.40.", "Son $23,40.", ES).ok
    assert not translation_guard("See you Sunday.", "Nos vemos el sábado.", ES).ok
    assert not translation_guard("No, thanks.", "Sí, gracias.", ES).ok
    assert not translation_guard("Okay.", "", ES).ok
