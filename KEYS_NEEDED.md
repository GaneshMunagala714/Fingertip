# What the team needs to bring

Everything that can run without accounts is built and tested offline. The items below can only
come from you. Put the values in `.env` on the server (copy `.env.example`); never commit `.env`.

## Must have (nothing live works without these)

| # | What | Where to get it | Goes in `.env` as |
|---|---|---|---|
| 1 | **Server** with Docker (Ubuntu, 2 vCPU / 4 GB is plenty) | Vultr dashboard → Deploy → Cloud Compute | (not a variable) |
| 2 | **Domain name** with an A record pointing at the server's IP (Caddy gets the HTTPS certificate itself) | Any registrar | `DOMAIN`, `PUBLIC_URL=https://<domain>` |
| 3 | **Twilio account, upgraded** (trial accounts only call verified numbers and play a trial notice first; `MISSION.md` asks for an upgraded account) | console.twilio.com → Account → Upgrade | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| 4 | **Twilio voice number** | Console → Phone Numbers → Buy (any US number with Voice) | `TWILIO_NUMBER=+1...` |
| 5 | **Accept the AI/ML addendum** (needed for ConversationRelay) | Console → Voice → Settings → "Predictive and Generative AI/ML Features Addendum" | (one click) |
| 6 | **Gemini API key** (smart replies, recaps, the meeting voice, and calls in other languages) | aistudio.google.com → Get API key | `GEMINI_API_KEY` |
| 7 | **Phone numbers of teammates who agreed to be called** | The team | Typed into the app |

After deploying, set the Twilio number's voice webhook to `POST https://<domain>/twilio/voice` and
the status callback to `POST https://<domain>/twilio/status`. Then follow `HANDOFF.md` §2.

## Nice to have

| What | Why | Goes in `.env` as |
|---|---|---|
| An app access key (any long random string) | Stops strangers who find the URL from using your Twilio number | `APP_ACCESS_KEY` |
| ElevenLabs API key | Meeting voice from ElevenLabs instead of Gemini speech. Phone calls already use ElevenLabs through Twilio and need no key | `ELEVENLABS_API_KEY` |
| A Windows laptop with VB-CABLE installed | Zoom and Teams voice through `bridge/` | (not a variable) |
| Chrome with the `extension/` folder loaded unpacked, plus a second person on Google Meet | Testing the Meet scene for real | (not a variable) |
| A teammate who signs, for 15 minutes in `/#signs-lab` | Measuring real sign accuracy on someone the model has never seen | (not a variable) |

## Already decided, no action needed

- The voice model (`TTS_MODEL=flash_v2_5`) and default voice are set. Change only after hearing a real call.
- Signature checking stays on (`VALIDATE_TWILIO_SIGNATURE=true`). Do not turn it off on the server.
