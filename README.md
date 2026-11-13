# Sign2Speak

A Deaf person who signs ASL can make and take a real phone call. They read the other person's
words live, sign or type back, and the other person hears a natural voice. The hearing person
uses their ordinary phone and installs nothing.

Built at HackUMass XIV. Sponsor tech: **Vultr** (hosting), **Gemini API** (turn analysis, reply
writing, recap).

## Status

| Milestone | State |
|---|---|
| M0 Skeleton (FastAPI + app, Twilio TwiML, ConversationRelay socket, Docker + Caddy) | Code done; **needs keys and a deploy to pass its live-call test** |
| M1 Full call loop with typing (incoming, outgoing, captions, fillers, interruptions, hang-up) | Code done; verified end to end with a fake Twilio; **real 2-minute call not yet run** |
| M2 Turn analyzer, quick replies, reply writer, guards, confirm sheet, note parser | Done. Test bench passes 100% (rules brain): see `eval/results.md` |
| M3 Sign recognition | Not started. Plan in `model/PLAN.md`. The app's signing views are built and wait for the recognizer |
| M4 UI polish | All 22 design frames built (`/#gallery`) |
| M5 In-person, reconnects, latency logging | In-person and reconnect built; latency medians logged at `/api/health`; live numbers not measured yet |
| M6 Meet extension | Stretch: panel view only |

What's honest to say today: phone calls with live captions, typed and quick-reply answers in a
natural voice, and a conversation-aware assistant that never agrees to money or bookings
without the signer's tap. Sign recognition: "a tested set of everyday signs, with typing for
the rest", once M3's evaluation exists. No accuracy or latency figure is claimed until it's
measured.

## How it works

- **Signer app** (`app/`): React + Vite + TypeScript PWA, phone-first. It talks to the server
  over one WebSocket (events) and REST (actions). The camera stays on the device.
- **Backend** (`server/`): one FastAPI service. Twilio webhooks, the ConversationRelay
  WebSocket, a deterministic call controller, guards, and the Gemini jobs.
- **Telephony**: one Twilio number with ConversationRelay. Twilio does speech-to-text, turn
  detection, interruptions and ElevenLabs text-to-speech. The backend only sends and receives
  text.

See `docs/architecture.md` and `DECISIONS.md`.

### The rules the code enforces
- Nothing is spoken that the signer didn't approve, except Auto lines: intro, note facts,
  repeats, "still here", fillers.
- Money, payment, bookings, final confirmations and info not in the note open the confirm
  sheet. The approval is bound to a hash of the exact sentence and the current terms. An edit,
  or a new price from the caller, voids it.
- Every number, price, day, time and name in an AI-written sentence must come from the signs,
  a chip, the note or the caller (fact guard). Signed NO means the sentence says no (negation
  guard). "Maybe" only if MAYBE was signed (hedge guard). No line is repeated within 10 s.
- Strangers and businesses always hear a short, honest heads-up.

## Run locally

```bash
cd server && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
```

```bash
cd app && npm ci && npm run build
```

```bash
cd server && VALIDATE_TWILIO_SIGNATURE=false uvicorn app.main:app --port 8000
```

Open http://localhost:8000 for the app, or http://localhost:8000/#gallery for all 22 screens.
Without keys the server uses a fake Twilio and the rules brain, so you can click through
everything but no phone rings.

Tests and the test bench:

```bash
cd server && python -m pytest -q tests
```

```bash
python eval/bench.py
```

Add `--live` to `eval/bench.py` to also run against Gemini (needs `GEMINI_API_KEY`).

## Deploy (Vultr)

1. Create a Vultr instance with Docker. Point a DNS A record (e.g. `sign2speak.example.com`) at it.
2. `cp .env.example .env` and fill it in (keys stay on the server).
3. Start it:

```bash
docker compose up -d --build
```

Caddy gets the HTTPS/WSS certificate automatically. Check `https://<domain>/api/health`. It
shows whether Twilio and Gemini are configured, whether the Gemini model exists, and latency
medians.

### Twilio setup (M0)
1. Upgrade the account from trial (trial accounts only call verified numbers and play a notice).
2. **Complete the ConversationRelay onboarding steps in the Twilio Console, and accept the
   "Predictive and Generative AI/ML Features Addendum".** Upgrading alone isn't enough.
3. Buy a number. Voice webhook: `POST https://<domain>/twilio/voice`. Status callback:
   `POST https://<domain>/twilio/status`.
4. Every webhook and the ConversationRelay WebSocket handshake are checked against
   `X-Twilio-Signature`. Keep `VALIDATE_TWILIO_SIGNATURE=true` in production.
5. Put the real phone numbers of the people in the room into the app's contacts (tap a contact
   → tap the number). **Only call phones whose owners are present and have agreed.**

### M0 checklist (what the build environment couldn't verify)
- [ ] A test call reaches ConversationRelay and speaks in an ElevenLabs voice.
- [ ] ConversationRelay message shapes match `server/app/relay.py` (DECISIONS D-003).
- [ ] The WebSocket handshake signature validates (D-003).
- [ ] v4 vs Flash 2.5 latency measured and written to DECISIONS D-005.
- [ ] Stop cuts off speech (D-012).
- [ ] Voice IDs and samples picked (D-006).
- [ ] Gemini model IDs exist (`/api/health` → `gemini.model_ok`).
- [ ] Demo phone framing on the stand: hands, face and upper body in view.

## Limits
- Incoming calls only ring while the app is open (no lock-screen ringing).
- Single-user demo: every open copy of the app sees every call.
- English only. No emergency calls, no payment card handling.
- Sign recognition covers a small tested set of signs; typing and quick replies cover the rest.

## Why this, not existing tools
Rylo (formerly Nagish) gives Deaf users captioned phone calls, but replies are typed. Google's
SL2T brings sign-to-text to Pixel 11 apps, but as text, in person, on one phone. Sign2Speak
lets you sign during a real phone call, on any phone, with a natural voice and a
conversation-aware assistant that never agrees to anything without you.

## Repo
```
app/      signer PWA (React + Vite + TS); /#gallery shows all 22 frames
server/   FastAPI: Twilio webhooks, ConversationRelay, controller, guards, Gemini, tests
model/    sign recognition plan (M3), data card, checkpoints and ONNX exports go here
eval/     test bench (bench.py) and results.md
docs/     architecture
```
