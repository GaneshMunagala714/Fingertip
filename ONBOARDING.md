# Fingertip: teammate onboarding

You're taking over Fingertip. The goal now is to make it **feel great**: polished UI, smooth
interactions, a backend that never stutters, and fast load and response times, with every
feature still working. This page is enough to start. Go deeper with `docs/FEATURES.md` (what each
feature is for), `docs/STATUS.md` (what's verified), `MISSION.md` (rules) and `DECISIONS.md` (why).

Repo: `github.com/Shrutibrahma/HackUMass-26`, branch `main`.

## 1. What Fingertip is (60 seconds)

Fingertip lets people who are Deaf, hard of hearing or nonspeaking hold real conversations:

- **Phone calls.** Fingertip places or answers a real call (Twilio ConversationRelay). The caller's
  words appear as live captions, and you reply by typing, tapping a quick reply, or signing to the
  camera. Each reply is approved, then spoken. Safety guards stop the voice from inventing facts,
  dropping a "no", or agreeing to money it wasn't told to. Calls also work in Spanish, French and
  Portuguese.
- **Show it.** Film a problem (a leaking machine, an error screen). Gemini watches it and returns
  sections, a full transcript, key facts pinned to a time and a spot in the frame, and "ask the
  video" answers. It plays back with on-screen boxes and tooltips, can feed a call, and can be
  shared as a printable report.
- **Meetings.** A Meet extension and a desktop bridge give you a voice in Meet, Zoom and Teams.
- **Gesture Synth.** Make music with your hands (camera) and see it as the "Living Aurora".

## 2. Run it in 10 minutes

```bash
# server (Python 3.11+)
cd server
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: . .venv/bin/activate
pip install -r requirements.txt

# app (Node 20+)
cd ../app
npm ci
npm run build          # the server serves app/dist at http://localhost:8000
```

```bash
cp .env.example .env   # ask Shruti for keys; never paste keys in chat or commit .env
cd server && uvicorn app.main:app --port 8000 --env-file ../.env
```

For UI work, run the app with hot reload. `npm run dev` in `app/` proxies `/api` and `/ws` to :8000.

- Without keys, everything still runs. The server uses a fake phone line and built-in rules instead
  of Gemini, and says so in its log and on `/api/health`. Show it reports that it needs Gemini.
- `http://localhost:8000/#gallery` shows every screen with sample data (27 frames). It's the
  fastest way to review UI without a call.

## 3. Checks before every push

```bash
cd server && python -m pytest -q tests      # 40 pass, 1 skipped
python eval/bench.py                        # 40/40 cases, 36/36 guard units (from repo root)
cd app && npx vitest run && npm run build   # 12 pass, 1 skipped; build must succeed
```

The bench is the safety net for the call guards. If a UI change makes it fail, the change is wrong.

## 4. Map of the code

| Area | Files | Notes |
|---|---|---|
| Call screen | `app/src/screens/Call.tsx` (512 lines) | Captions, quick replies, drafts, confirm sheet, video card |
| Home, contacts, settings | `app/src/screens/Setup.tsx` | Settings saved to localStorage in `App.tsx` |
| Show it studio | `app/src/screens/Show.tsx` | Player with AR boxes, section rail, transcript, ask, report |
| Meetings, in person, synth | `screens/Meet.tsx`, `InPerson.tsx`, `Playground.tsx`, `synth/aurora.ts` | |
| Signing | `app/src/sign/` | MediaPipe in a Web Worker, SignBart ONNX model |
| State and server link | `app/src/store.ts`, `api.ts`, `contract.ts`, `types.ts` | `contract.ts` is the typed event list |
| Styles | `app/src/index.css` (one file) | Caption size is the `--cap` variable |
| Server routes | `server/app/main.py` | REST + WebSocket `/ws/app` + Twilio webhooks |
| Call brain | `server/app/controller.py`, `guards.py`, `ai.py`, `translate.py` | State machine + guards; don't loosen guards |
| Show it engine | `server/app/show.py` | Multi-pass Gemini video jobs |

The app-to-server contract is written up in `docs/CONTRACT.md`. If you rename an event, change
`contract.ts`, the server and the doc together.

## 5. Rules that don't bend

These protect real people on real calls. Polishing must not break them.

1. **Nothing is spoken without the user's OK.** Every reply is approved first. Money or booking
   lines need a second confirmation tied to the exact words. (A UI may make approving one tap, but
   it can't skip it. See §7.)
2. **Never show fake as real.** No pretend "connected" states, no simulated captions in the product.
   If something isn't ready, say so plainly.
3. **The camera stays on the device.** Sign video never leaves the browser. Show it clips go to
   Gemini only when the user films one, are kept 24 h, and can be deleted.
4. **No keys in git or chat.** `.env` is gitignored.
5. **Don't rewrite git history** (`MISSION.md` §0). Use new commits, not force pushes.

## 6. Workstreams

Pick one per person so you don't edit the same files at once.

### A. UI polish (owner: ____)
- Pass over every frame in `/#gallery`: spacing, type scale and color tokens all live in
  `index.css`. Aim for one consistent visual system across Call, Show it, Meetings and Synth.
- The Show it studio is the demo's "wow". Make the boxes and tooltips animate in, add pin hover
  previews, and polish the rail.
- Check phone width (375 px), dark mode, and the largest caption size on every screen.

### B. Interaction and UX (owner: ____)
- The call loop is the product: caller talks → captions → you reply → approved → spoken. Count taps
  and seconds for each step and remove friction. Examples: send the top quick reply on Enter,
  keyboard shortcuts, clearer "your turn" moments, haptics on mobile.
- Every button must show what happened (sending → sent, or why not). Commands answer
  `{ok, reason}`; surface `reason` in plain words.
- Show it: make the upload → progress → result path feel quick (show the clip right away and let
  facts stream in as passes finish).

### C. Backend smoothness (owner: ____)
- Reconnects: kill the WebSocket mid-call and check the app recovers from the `snapshot` with no
  duplicate or missing lines.
- Show it jobs run in a thread pool. Check two or three jobs at once don't slow a live call
  (calls must always win).
- Put timings on the Gemini jobs (`/api/health` already reports per-job latency) and set
  timeouts so a slow model never freezes a call. The rules fallback should kick in instead.

### D. Speed (owner: ____)
Baseline measured on 2026-11-14 (local server, Windows laptop):

| What | Now | Easy win |
|---|---|---|
| Main JS bundle | **588 kB (171 kB gzip), one chunk** | Code-split with `React.lazy`: Show it studio, Playground (Tone.js), Gallery, Signs lab. Calls should load first and alone |
| Sign tracker worker | 132 kB + MediaPipe WASM/model (`app/public` is ~47 MB in total) | Load only when the camera is turned on; preload while the user is on Home |
| Fonts | woff and woff2 both emitted, Latin-ext included | Ship woff2 only and subset to Latin |
| `/assets/*` caching | No `Cache-Control` header | Hashed files: `public, max-age=31536000, immutable` |
| Compression | None from FastAPI; Caddy gzips in production | Fine for prod; add `GZipMiddleware` only if serving without Caddy |
| `/api/health` | 1.8 ms median | Fine |
| Gemini reply / Show it latency | **Unknown, never run live** | Measure as soon as the key is in. This is likely the real bottleneck |

Measure before and after each change and put the numbers in your PR.

## 7. Decisions the team needs to make

- **Which actions can skip the extra confirm?** Today every spoken line needs approval, and
  money/booking needs a second confirm. If you want faster flows (for example, quick replies like
  "One moment please" spoken in one tap), decide it together, write it in `DECISIONS.md`, and keep
  the guards running on them.
- **HackUMass rules on pre-existing work.** Check them and disclose as needed.

## 8. Still needs real-world testing

None of this has run live yet (see `WHAT_I_NEED.md`): a real Twilio call, real Gemini (calls and
Show it), a real Google Meet, the desktop bridge's audio, and a signer who wasn't in the training
data. Whoever has the keys: start with `scripts/live_check.py` (see `HANDOFF.md` §2).

## 9. Working with Claude Code

`.claude/settings.json` in this repo pre-approves routine safe commands (tests, builds, the bench,
git status/diff/log, and adding/committing), so Claude doesn't ask every time. It still asks before
pushing, deleting files, or anything else. Personal overrides go in `.claude/settings.local.json`
(gitignored).
