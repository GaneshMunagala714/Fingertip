# Decisions

Short log of choices made when something was ambiguous. Newest last. "Verify" marks
things that could not be checked from the build environment and must be confirmed
against the live service in M0.

## D-001 · One service, in-memory sessions
FastAPI serves the Twilio webhooks, both WebSockets, the REST actions and the built app.
Call state lives in memory per call and is dropped 10 minutes after the call ends.
Nothing is written to disk except `logs/latency.jsonl` (numbers only, no text).

## D-002 · Single-user demo, every device sees every call
Every connected copy of the app gets every ring and call event. There's no account system.
`APP_ACCESS_KEY` (opened once as `/?key=...`) stops strangers from using the app.

## D-003 · ConversationRelay protocol lives in `server/app/relay.py` (verify)
The build environment couldn't reach twilio.com, so:
- **TwiML attribute names** come from the official `twilio` Python SDK 9.13, which generates
  them from Twilio's schema: `partialPrompts`, `interruptible`, `echoPromptFiltering`,
  `applicationReconnect`, `elevenlabsTextNormalization`, `ttsProvider`, `voice`.
- **WebSocket messages** in: `setup` (callSid), `prompt` (`voicePrompt`, `last`), `interrupt`
  (`utteranceUntilInterrupt`), `dtmf`, `error`. Out: `text` (`token`, `last`, `interruptible`,
  `preemptible`), `end` (`handoffData`). From memory plus Twilio search snippets.
- **Verify in M0:** each message shape above, and the exact URL Twilio signs on the
  WebSocket handshake. `relay_handshake_ok` accepts the `wss://` URL or its `https://` form.

## D-004 · Settings per the team's change list (Nov 13)
`partialPrompts="true"` (it defaults to false), `interruptible="any"` (set explicitly),
`echoPromptFiltering="true"`, `applicationReconnect="true"`. Our lines are sent
`preemptible: true`, which is safe because the controller only ever has one line playing.

## D-005 · Voice: Flash 2.5 by default, v4 is one env var away
`TTS_MODEL=flash_v2_5` is ConversationRelay's default ElevenLabs model. Set `TTS_MODEL=v4` for
the expressive model. The voice string then becomes `VOICE_ID-v4` with no speed or stability
settings, because v3/v4 don't support SSML or speed. With v3/v4, tone becomes a
natural-language audio tag at the start of the text token (`[warmly] Yeah! I'll be there
Sunday.`). The guards and the thread only ever see the untagged text.
**M0 task:** measure v4 against Flash 2.5 latency on a real call and record it here. Keep the
most human-sounding model that stays under about 1 s.

## D-006 · Voice IDs (verify)
The voice picker uses the design's names (Maya, Priya, Alex, Sam). Each maps to an ElevenLabs
voice ID in `app/src/data.ts`. These IDs were not verified, and "Priya" needs a real Indian
English voice. Pick the IDs in the ElevenLabs voice library, and put a sample at
`app/public/voices/<id>.mp3` for each one (the play button looks for it there).

## D-007 · Gemini: one fast model, and it never sits in the Send path
`gemini-3.5-flash-lite` with `thinking_level="minimal"` handles the turn analyzer, note parser
and reply writer. `GEMINI_REPLY_MODEL=gemini-3.8-flash` switches only the reply writer, and only
if reply-quality tests fail. The server checks both models exist at startup (`/api/health`).
Latency is logged per job (`gemini_<job>_ms`).
- Typed text, tapped chips, note facts, repeats, fillers and presence lines never call
  Gemini. They go straight through the guards (and approval, if needed) to speech.
- The signed draft is written as the signs arrive (`POST /signs`), so Send only checks a hash.
- Safety-relevant turn types (emergency, card number, hold, repeat, presence, robot) are
  decided by code, never by the model. Money and commitment flags are OR-ed with the code
  checks, so the model can't clear them.
- Every job has a deterministic fallback (`RulesBrain`), used on timeout or error. That keeps
  the call moving even when the model is slow, and it's what the offline test bench runs.

## D-008 · Approvals are bound to a hash
Every draft carries `hash = sha256(exact text + current terms)`. The terms are the amounts,
numbers, days and times in the draft and in the caller's latest line. Send (for a signed draft)
and "Yes, send it" (on the confirm sheet) must present that hash. If the signer edited the
text, or the caller has since named new terms ("actually it's $26.10"), the hash no longer
matches. The approval is then refused, and the sheet reopens showing the new terms.

## D-009 · Guards
Fact, negation, commitment and duplicate guards, plus a **hedge guard** ("might / maybe /
probably" in the sentence requires MAYBE in the signs, and vice versa). They live in
`server/app/guards.py` and run on every outgoing line. AI-written chips are filtered through
the fact guard before they're shown. Typed text skips the fact guard, because the signer wrote
it, but still goes through the commitment and duplicate guards.

## D-010 · Tone: from talk style for the MVP
Casual contacts get a warm delivery, polite ones neutral, or whatever the signer picks.
Automatic face-to-tone is off (`FACE_TONE=false`): a furrowed brow is also ASL grammar for
wh-questions, not only concern. `POST /signs` ignores `tone_source: "face"` unless the flag is on.

## D-011 · Fillers and playback timing
ConversationRelay doesn't report when playback ends, so the controller estimates it
(0.35 s + 2.8 words/s). Fillers come at 2 s and 8 s after the caller stops: at most 2 per turn,
never the same twice in a row, never while the caller is talking or on hold, and never after
a goodbye.

## D-012 · Stop button (verify)
Stop sends a near-silent `"..."` line. Our lines are `preemptible`, so it should cut off the
current line. **Verify on the M0 call.** If audio keeps playing, hide the Stop button and leave
interruption to the caller.

## D-013 · Interruptions keep the unsaid part
On `interrupt`, the line is marked "cut off". The part the caller heard
(`utteranceUntilInterrupt`) is shown solid and the rest faded. The unsaid rest becomes the
draft, so the signer can "Say the rest" or "Drop the rest".

## D-014 · Intro wording
Strangers and businesses get one honest line. With an order in the note: "Hey! Quick heads-up,
I'm deaf, so an app's voicing what I sign. I'd like to place a pickup order." Otherwise it ends
"Bear with me a sec." Contacts marked "Knows I sign" get no intro. On incoming calls from
those contacts, the app says "Hey!" when the signer answers, since the caller would otherwise
hear silence.

## D-015 · Scope of promises
Incoming calls only ring while the app is open. No lock-screen or closed-app ringing, and no
push. The demo phone sits on a stand. **Test the framing first:** the front camera must see
both hands, the face and the upper body.

## D-016 · Voice picker on first launch vs. "zero setup screens"
The design has a first-launch voice picker; the brief says zero setup screens before the first
call. Resolution: the picker opens on first launch with Maya preselected (one tap), and an
incoming call always takes over the screen. Set up the demo phone before judging.

## D-017 · Sign recognition plan replaced (see `model/PLAN.md`)
No more "80 signs" target. Test real checkpoints on the demo phone in hour one. Segment by
short pauses (one sign per segment). Start with the 15-25 signs that demonstrably work, and
report both single-sign accuracy and full-phrase success on a held-out signer.

## D-018 · Hold screen copy
The design's "Hold music is playing." line is left out: we can't detect music. "Leave a message
instead" opens the keyboard.

## D-019 · In-person name
The top half says "{name} is saying" using the name from the signer's first errand note
("name Shruti"). Until a name is known, it says "They're saying". No pronouns are guessed.
