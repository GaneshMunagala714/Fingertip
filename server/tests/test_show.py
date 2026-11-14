"""Show it: video -> evidence-linked facts. Gemini is replaced by a scripted engine here, so these
test our plumbing and safety rules, not Gemini's video understanding (that needs the real key)."""
import asyncio
import os

os.environ["VALIDATE_TWILIO_SIGNATURE"] = "false"
os.environ.pop("TWILIO_ACCOUNT_SID", None)
os.environ.pop("GEMINI_API_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402
from app.ai import RulesBrain  # noqa: E402
from app.controller import Contact, Controller  # noqa: E402
from app.show import ShowResult, ShowStore, VideoFact, normalize  # noqa: E402

RAW = ShowResult(
    summary_say="My dishwasher leaks from the front-left corner of the door, and it shows error E24.",
    facts=[
        VideoFact(say="Water drips from the front-left corner of the door.", label="Drip starts here", kind="problem",
                  t=6.2, t_end=9.0, box=[620, 80, 820, 260]),
        VideoFact(say="The panel shows error code E24.", label="Error E24", kind="reading", t=11.0, t_end=14.0,
                  box=[100, 400, 180, 560]),
        VideoFact(say="The label says model DW80R5061.", label="Model label", kind="label", t=15.5, t_end=18.0,
                  box=[300, 700, 380, 900]),
    ],
    notes="Serial number too blurry to read.",
)


class FakeEngine:
    name = "scripted"

    def __init__(self, raw=RAW):
        self.raw = raw
        self.calls = 0

    async def analyze(self, data, mime, path, duration, context=""):
        self.calls += 1
        return normalize(self.raw, duration)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "shows", ShowStore(str(tmp_path / "shows")))
    with TestClient(main.app) as c:
        yield c


def upload(c, mime="video/mp4", data=b"\x00\x00\x00\x18ftypmp42fake", duration="20"):
    return c.post("/api/show", files={"file": ("clip.mp4", data, mime)}, data={"duration": duration, "title": "Dishwasher"})


# ------------------------------------------------------------------ normalize

def test_normalize_clamps_and_cleans():
    raw = ShowResult(facts=[
        VideoFact(say="  Too   late  ", t=99, t_end=120, box=[0, 0, 1200, 1200]),
        VideoFact(say="", t=1),                                     # empty: dropped
        VideoFact(say="Backwards box.", t=-3, t_end=-1, box=[500, 500, 400, 400]),
        VideoFact(say="Three numbers only.", box=[1, 2, 3]),
    ])
    out = normalize(raw, duration=20)
    assert [f.id for f in out.facts] == ["v1", "v2", "v3"]
    a, b, c = out.facts
    assert a.say == "Too late" and a.t == 20 and a.t_end == 20 and a.box == [0, 0, 1000, 1000]
    assert b.t == 0 and b.t_end >= b.t and b.box is None
    assert c.box is None and c.label == "Three numbers only"
    assert out.summary_say == "Too late Backwards box."           # built only from facts when missing


# ------------------------------------------------------------------ endpoints

def test_needs_gemini(client):
    main.state["video"] = None
    r = upload(client)
    assert r.status_code == 400 and "Gemini" in r.json()["detail"]
    assert client.get("/api/health").json()["show"]["available"] is False


def test_create_view_share_delete(client):
    main.state["video"] = FakeEngine()
    r = upload(client)
    assert r.status_code == 200, r.text
    rec = r.json()
    assert len(rec["facts"]) == 3 and rec["facts"][0]["box"] == [620, 80, 820, 260]
    assert "path" not in rec and rec["share"] is False
    sid, token = rec["id"], rec["share_token"]

    assert client.get(f"/api/show/{sid}").json()["summary_say"].startswith("My dishwasher")
    v = client.get(f"/api/show/{sid}/video")
    assert v.status_code == 200 and v.content.startswith(b"\x00\x00\x00\x18ftyp")

    assert client.get(f"/api/shared/{token}").status_code == 404           # sharing is off by default
    assert client.post(f"/api/show/{sid}/share", json={"share": True}).json()["share_token"] == token
    shared = client.get(f"/api/shared/{token}").json()
    assert len(shared["facts"]) == 3 and "context" not in shared and "share_token" not in shared
    assert client.get(f"/api/shared/{token}/video").status_code == 200
    client.post(f"/api/show/{sid}/share", json={"share": False})
    assert client.get(f"/api/shared/{token}").status_code == 404

    assert client.delete(f"/api/show/{sid}").json()["ok"]
    assert client.get(f"/api/show/{sid}").status_code == 404


def test_rejects_non_video_and_too_big(client, monkeypatch):
    main.state["video"] = FakeEngine()
    assert upload(client, mime="image/png").status_code == 400
    monkeypatch.setattr(main.settings, "show_max_mb", 0)
    assert upload(client).status_code == 413


def test_bad_ids_are_404(client):
    assert client.get("/api/show/no.such!id").status_code == 404           # ids are checked before any file access
    assert client.get("/api/show/no.such!id/video").status_code == 404
    assert client.get("/api/shared/short").status_code == 404


# ------------------------------------------------------------------ in a call

def test_attach_to_call_drafts_but_says_nothing(client):
    main.state["video"] = FakeEngine()
    rec = upload(client).json()
    sid = client.post("/api/calls", json={"number": "4135550101", "name": "Landlord", "kind": "business"}).json()["sid"]
    r = client.post(f"/api/calls/{sid}/show/{rec['id']}").json()
    assert r["ok"] and r["facts"] == 3
    d = r["draft"]
    assert d["source"] == "video" and not d["blocked"] and d["text"].startswith("My dishwasher")
    c = main.sessions[sid]
    assert c.spoken_log == []                                  # nothing spoken until approved
    assert c.state == "RINGING"                                # a draft never skips ringing / connecting
    client.post(f"/api/calls/{sid}/hangup")


def test_video_facts_are_allowed_sources_but_inventions_are_not():
    async def go():
        c = Controller("t", Contact(name="Shop", kind="business"), RulesBrain(), direction="outgoing", time_scale=0.01)
        await c.attach_video([f.model_dump() for f in normalize(RAW, 20).facts],
                             "The dishwasher shows error E24 and leaks at the door.", "show1")
        ok = c._check_draft("It's model DW80R5061, and it says E24.", ["NAME"], source="signs")
        bad = c._check_draft("It's model DW90 and it's 12 years old.", ["NAME"], source="signs")
        made_up_summary = c._check_draft("It has leaked since March 3.", [], source="video")
        return c, ok, bad, made_up_summary
    c, ok, bad, made_up = asyncio.run(go())
    assert c.draft is not None and not c.draft.blocked and c.draft.source == "video"
    assert not ok.blocked
    assert bad.blocked
    assert made_up.blocked and made_up.problems
