"""Show it: a short phone video becomes evidence-linked facts with on-screen overlays.

Someone who can't easily describe a problem out loud (a leak, a warning light, a damaged
parcel) films it for 10-60 s. Gemini watches the clip and returns facts, each tied to WHEN it
is visible (seconds) and WHERE in the frame (a box, 0-1000 scale: [ymin, xmin, ymax, xmax]).
The app plays the clip back with those boxes as tooltips, so the signer checks every fact
against the moment the camera saw it before anything is said.

Same rules as everything else in a call: facts are suggestions. Nothing is spoken until the
signer approves it, and the guards treat video facts like the errand note: a sentence may only
state a number, name or day that the video, the note, the signs or the caller supplied.

Video understanding is Gemini only (long clips, timestamps and boxes in one call). Without
GEMINI_API_KEY the feature says so; there is no fake engine in the product. The clip is sent
to Google for analysis, kept on our server for SHOW_TTL_HOURS so it can be replayed and
shared, then deleted. Patterned on the Process-Annotation engine (upload, fps via
VideoMetadata, structured JSON, validate, retry once).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import time
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field, ValidationError

from .config import settings
from .latency import latency

log = logging.getLogger("show")

Kind = Literal["problem", "reading", "label", "object", "action", "other"]


class VideoFact(BaseModel):
    id: str = ""
    say: str = Field(description="one short spoken sentence stating only this fact, first person, e.g. "
                                  "\"Water is dripping from the front-left corner of the door.\"")
    label: str = Field(default="", description="2-5 word tooltip, e.g. \"Drip starts here\"")
    kind: Kind = "other"
    t: float = Field(default=0.0, description="seconds from the start when this is first clearly visible")
    t_end: float = Field(default=0.0, description="seconds when it stops being visible (>= t)")
    box: Optional[list[int]] = Field(default=None, description="[ymin, xmin, ymax, xmax], 0-1000, where in "
                                                                "the frame at time t; null if it isn't one place")
    sure: bool = Field(default=True, description="false if blurry, partly hidden or a guess")


class ShowResult(BaseModel):
    summary_say: str = Field(default="", description="1-2 sentences the user could say to open the call, "
                                                      "built only from the facts")
    facts: list[VideoFact] = Field(default_factory=list)
    notes: str = Field(default="", description="what couldn't be read or seen clearly")


PROMPT = """You are helping a Deaf or nonspeaking person explain something on a phone call. They
filmed it instead of describing it. Watch the whole clip and list what a helpful person on the
phone (landlord, mechanic, store, support desk) would need to know.

Rules:
- Only state what is actually visible or readable in the video. Never guess a model number, price,
  date or name; if text is unreadable, say so in `notes` instead.
- Copy any text, codes, numbers and labels exactly as shown, digits as digits.
- One fact per item, in the order they appear. At most 10 facts. Prefer the problem first.
- For each fact give `t` (when first clearly visible, seconds, one decimal) and `t_end`.
- Give `box` as [ymin, xmin, ymax, xmax] normalized to 0-1000 for where it is in the frame at `t`.
  Use null when the fact isn't one place (e.g. "it happens every few seconds").
- `say` is a short, natural first-person sentence the user could approve and have spoken, e.g.
  "The dishwasher leaks from the front-left corner of the door."
- `sure` = false if blurry, partly hidden or uncertain.
- `summary_say`: one or two sentences describing the situation for the start of the call, using
  only the facts you listed.
Return JSON only: {"summary_say": str, "facts": [...], "notes": str}."""


def normalize(raw: ShowResult, duration: float) -> ShowResult:
    """Make model output safe to draw and to speak: clamp times and boxes, drop empty facts,
    give stable ids, keep a summary only built from facts."""
    dur = duration if duration and duration > 0 else None
    out: list[VideoFact] = []
    for f in raw.facts[:12]:
        say = re.sub(r"\s+", " ", f.say or "").strip()
        if not say:
            continue
        t = max(0.0, float(f.t or 0.0))
        if dur is not None:
            t = min(t, dur)
        t_end = max(t + 0.5, float(f.t_end or 0.0))
        if dur is not None:
            t_end = min(max(t_end, t), dur)
        box = None
        if f.box and len(f.box) == 4:
            y0, x0, y1, x1 = [max(0, min(1000, int(v))) for v in f.box]
            if y1 > y0 and x1 > x0:
                box = [y0, x0, y1, x1]
        label = (f.label or "").strip() or " ".join(say.rstrip(".").split()[:4])
        out.append(VideoFact(id=f"v{len(out) + 1}", say=say[:240], label=label[:48], kind=f.kind,
                             t=round(t, 1), t_end=round(t_end, 1), box=box, sure=bool(f.sure)))
    summary = re.sub(r"\s+", " ", raw.summary_say or "").strip()
    if not summary and out:
        summary = " ".join(f.say for f in out[:2])
    return ShowResult(summary_say=summary[:400], facts=out, notes=(raw.notes or "").strip()[:400])


def _extract_json(text: str) -> dict:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-z]*\s*|\s*```$", "", t)
    a, b = t.find("{"), t.rfind("}")
    return json.loads(t[a:b + 1] if a >= 0 and b > a else t)


class GeminiVideo:
    """One Gemini call per clip. Small clips go inline; bigger ones through the Files API."""

    name = "gemini"
    INLINE_MAX = 18 * 1024 * 1024

    def __init__(self) -> None:
        from google import genai
        from google.genai import types

        self.types = types
        self.client = genai.Client(api_key=settings.gemini_api_key)
        self.model = settings.gemini_video_model
        self.fps = settings.show_fps

    def _part(self, data: bytes, mime: str, path: Path):
        t = self.types
        meta = t.VideoMetadata(fps=self.fps)
        if len(data) <= self.INLINE_MAX:
            return t.Part(inline_data=t.Blob(data=data, mime_type=mime), video_metadata=meta), None
        f = self.client.files.upload(file=str(path))
        deadline = time.monotonic() + 300
        while str(getattr(f, "state", "")).upper().endswith("PROCESSING"):
            if time.monotonic() > deadline:
                raise RuntimeError("Gemini took too long to process the video.")
            time.sleep(2)
            f = self.client.files.get(name=f.name)
        if not str(getattr(f, "state", "")).upper().endswith("ACTIVE"):
            raise RuntimeError("Gemini couldn't process that video.")
        return t.Part(file_data=t.FileData(file_uri=f.uri, mime_type=mime), video_metadata=meta), f

    def _run(self, data: bytes, mime: str, path: Path, context: str) -> ShowResult:
        part, uploaded = self._part(data, mime, path)
        prompt = PROMPT + (f"\nWhat the call is about (from the user): {context[:300]!r}" if context.strip() else "")
        cfg = self.types.GenerateContentConfig(response_mime_type="application/json", temperature=0.1)
        try:
            last: Exception | None = None
            for _ in range(2):
                resp = self.client.models.generate_content(model=self.model, contents=[part, prompt], config=cfg)
                try:
                    return ShowResult.model_validate(_extract_json(resp.text or ""))
                except (ValueError, ValidationError) as e:
                    last = e
                    log.warning("show: malformed model output, retrying: %s", str(e)[:200])
            raise RuntimeError(f"The model returned malformed results twice: {last}")
        finally:
            if uploaded is not None:
                try:
                    self.client.files.delete(name=uploaded.name)
                except Exception:
                    log.warning("show: couldn't delete the uploaded file from Gemini")

    async def analyze(self, data: bytes, mime: str, path: Path, duration: float, context: str = "") -> ShowResult:
        t0 = time.perf_counter()
        try:
            raw = await asyncio.wait_for(asyncio.to_thread(self._run, data, mime, path, context),
                                         timeout=settings.show_timeout_s)
        finally:
            latency.record("show_video_ms", (time.perf_counter() - t0) * 1000)
        return normalize(raw, duration)


def make_video_engine():
    return GeminiVideo() if settings.gemini_ready else None


# ------------------------------------------------------------------ storage

class ShowStore:
    """Clips and their facts on disk, deleted after SHOW_TTL_HOURS. Ids are unguessable;
    the share token is a separate secret that only grants read access to one clip."""

    def __init__(self, root: str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _dir(self, sid: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,40}", sid):
            raise KeyError(sid)
        return self.root / sid

    def new(self, data: bytes, ext: str) -> tuple[str, Path]:
        self.cleanup()
        sid = secrets.token_urlsafe(12)
        d = self._dir(sid)
        d.mkdir()
        p = d / f"clip.{ext}"
        p.write_bytes(data)
        return sid, p

    def save(self, sid: str, record: dict) -> None:
        (self._dir(sid) / "show.json").write_text(json.dumps(record), encoding="utf-8")

    def load(self, sid: str) -> dict:
        p = self._dir(sid) / "show.json"
        if not p.exists():
            raise KeyError(sid)
        return json.loads(p.read_text(encoding="utf-8"))

    def by_share(self, token: str) -> dict:
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,64}", token or ""):
            raise KeyError(token)
        for d in self.root.iterdir():
            p = d / "show.json"
            if p.exists():
                r = json.loads(p.read_text(encoding="utf-8"))
                if r.get("share") and secrets.compare_digest(r.get("share_token", ""), token):
                    return r
        raise KeyError(token)

    def video(self, sid: str) -> Path:
        d = self._dir(sid)
        clips = list(d.glob("clip.*"))
        if not clips:
            raise KeyError(sid)
        return clips[0]

    def delete(self, sid: str) -> None:
        d = self._dir(sid)
        for p in d.glob("*"):
            p.unlink(missing_ok=True)
        d.rmdir()

    def cleanup(self) -> None:
        cutoff = time.time() - settings.show_ttl_hours * 3600
        for d in self.root.iterdir():
            if d.is_dir() and d.stat().st_mtime < cutoff:
                for p in d.glob("*"):
                    p.unlink(missing_ok=True)
                d.rmdir()


VIDEO_TYPES = {"video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp",
               "video/x-matroska": "mkv"}


def public_record(r: dict) -> dict:
    """What the signer's app gets (everything but the server path)."""
    return {k: v for k, v in r.items() if k not in ("path",)}


def shared_record(r: dict) -> dict:
    """What the other person sees through a share link: the clip and the facts, nothing about the call."""
    return {"id": r["id"], "facts": r["facts"], "summary_say": r["summary_say"], "duration": r.get("duration", 0),
            "created": r.get("created"), "title": r.get("title", "")}
