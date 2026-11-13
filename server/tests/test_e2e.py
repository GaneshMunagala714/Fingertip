"""End-to-end through the real HTTP + WebSocket endpoints, with Twilio faked.

Simulates: incoming webhook -> app sees ringing -> Answer -> ConversationRelay
connects -> caller speaks -> app gets captions + chips -> signer sends ->
relay receives the text -> app reloads mid-call and reattaches -> hang up.
"""
import json
import os
import time

os.environ["VALIDATE_TWILIO_SIGNATURE"] = "false"
os.environ["PUBLIC_URL"] = "https://s2s.test"
os.environ.pop("TWILIO_ACCOUNT_SID", None)
os.environ.pop("GEMINI_API_KEY", None)
os.environ["LOG_DIR"] = "/tmp/claude-0/s2s-logs"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app, sessions, state  # noqa: E402


def recv_until(ws, pred, limit=50):
    seen = []
    for _ in range(limit):
        m = ws.receive_json()
        seen.append(m)
        if pred(m):
            return m, seen
    raise AssertionError(f"never got it; saw {[s.get('type') for s in seen]}")


def test_health():
    with TestClient(app) as c:
        h = c.get("/api/health").json()
        assert h["ok"] and h["brain"] == "rules" and h["twilio"] is False


def test_twilio_signature_required():
    os.environ["VALIDATE_TWILIO_SIGNATURE"] = "true"
    from app import config
    config.settings.validate_twilio_signature = True
    try:
        with TestClient(app) as c:
            r = c.post("/twilio/voice", data={"CallSid": "CA1", "From": "+14135550101"})
            assert r.status_code == 403
    finally:
        config.settings.validate_twilio_signature = False


def test_incoming_call_full_loop():
    with TestClient(app) as c:
        with c.websocket_connect("/ws/app") as appws:
            appws.send_json({"type": "hello", "voice_id": "VOICE123", "contacts": [
                {"id": "mom", "name": "Mom", "number": "(413) 555-0101", "knows_sign": True, "kind": "person"}]})
            time.sleep(0.05)
            r = c.post("/twilio/voice", data={"CallSid": "CAin1", "From": "+14135550101"})
            assert r.status_code == 200 and "<Play" in r.text and "ringback.wav" in r.text
            ring, _ = recv_until(appws, lambda m: m["type"] == "ringing")
            assert ring["contact"]["name"] == "Mom"
            sid = ring["sid"]
            assert len(sid) >= 20

            assert c.post(f"/api/calls/{sid}/answer").json()["ok"]
            fake = state["telephony"]
            kind, call_sid, twiml = fake.calls[-1]
            assert kind == "update" and call_sid == "CAin1"
            assert "ConversationRelay" in twiml and f"/ws/relay/{sid}" in twiml and "VOICE123" in twiml

            with c.websocket_connect(f"/ws/relay/{sid}") as relayws:
                relayws.send_text(json.dumps({"type": "setup", "callSid": "CAin1", "from": "+14135550101"}))
                hey = json.loads(relayws.receive_text())
                assert hey["type"] == "text" and hey["token"] == "Hey!" and hey["last"] is True

                relayws.send_text(json.dumps({"type": "prompt", "voicePrompt": "Hi sweetie, are you", "last": False}))
                cap, _ = recv_until(appws, lambda m: m["type"] == "caption")
                assert cap["line"]["status"] == "partial"
                relayws.send_text(json.dumps({"type": "prompt", "voicePrompt": "Hi sweetie, are you coming Sunday?",
                                              "last": True}))
                turn, _ = recv_until(appws, lambda m: m["type"] == "turn")
                assert turn["analysis"]["question_type"] == "yes_no" and turn["analysis"]["chips"]

                d = c.post(f"/api/calls/{sid}/signs", json={"signs": ["YES", "SUNDAY", "COME"], "tone": "warm"}).json()
                assert "Sunday" in d["draft"]["text"] and d["draft"]["level"] == "quick"
                r = c.post(f"/api/calls/{sid}/send", json={"text": d["draft"]["text"], "source": "draft",
                                                           "draft_id": d["draft"]["id"]}).json()
                assert r["ok"]
                spoken = json.loads(relayws.receive_text())
                assert spoken["token"] == d["draft"]["text"]

                # Same line again within 10 s is refused.
                r2 = c.post(f"/api/calls/{sid}/send", json={"text": d["draft"]["text"], "source": "typed"}).json()
                assert r2["ok"] is False

        # App reload mid-call: a new socket gets the full snapshot.
        with c.websocket_connect("/ws/app") as appws2:
            snap, _ = recv_until(appws2, lambda m: m["type"] == "snapshot" and m["sid"] == sid)
            assert any("Sunday" in l["text"] for l in snap["lines"] if l["who"] == "me")
            assert any(l["who"] == "caller" for l in snap["lines"])

            assert c.post(f"/api/calls/{sid}/hangup").json()["ok"]
            ended, _ = recv_until(appws2, lambda m: m["type"] == "ended")
            assert ended["recap"]
        assert ("hangup", "CAin1") in state["telephony"].calls


def test_outgoing_call_with_confirm():
    with TestClient(app) as c:
        r = c.post("/api/calls", json={"number": "413-555-0103", "name": "Antonio's Pizza", "kind": "business",
                                       "note": "order garlic bread and wings, name Shruti, tell me the total first"})
        assert r.status_code == 200, r.text
        body = r.json()
        sid = body["sid"]
        assert any(f["key"] == "name" for f in body["note_facts"])
        kind, to, twiml = state["telephony"].calls[-1]
        assert kind == "dial" and to == "+14135550103"
        call_sid = sessions[sid].call_sid
        with c.websocket_connect("/ws/app") as appws, c.websocket_connect(f"/ws/relay/{sid}") as relayws:
            relayws.send_text(json.dumps({"type": "setup", "callSid": call_sid}))
            relayws.send_text(json.dumps({"type": "prompt", "voicePrompt": "Antonio's, what can I get you?",
                                          "last": True}))
            intro = json.loads(relayws.receive_text())
            assert "deaf" in intro["token"]
            relayws.send_text(json.dumps({"type": "prompt", "voicePrompt": "Your total is $23.40, okay?",
                                          "last": True}))
            recv_until(appws, lambda m: m["type"] == "turn" and m["analysis"]["involves_money"])
            r = c.post(f"/api/calls/{sid}/send", json={"text": "Yes, that's fine.", "source": "chip"}).json()
            assert r.get("confirm") is True
            conf, _ = recv_until(appws, lambda m: m["type"] == "confirm")
            assert "$23.40" in conf["summary"]
            assert c.post(f"/api/calls/{sid}/confirm", json={"decision": "yes"}).json()["ok"]


def test_relay_rejects_wrong_call_sid():
    with TestClient(app) as c:
        r = c.post("/api/calls", json={"number": "4135550199"})
        sid = r.json()["sid"]
        with c.websocket_connect(f"/ws/relay/{sid}") as relayws:
            relayws.send_text(json.dumps({"type": "setup", "callSid": "CAnotthisone"}))
            try:
                relayws.receive_text()
                raise AssertionError("socket should have closed")
            except Exception as e:
                assert "1008" in repr(e) or "Disconnect" in type(e).__name__


def test_bad_number_plain_error():
    with TestClient(app) as c:
        r = c.post("/api/calls", json={"number": "12"})
        assert r.status_code == 400 and "number" in r.json()["detail"]
