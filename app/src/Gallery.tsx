/**
 * Design gallery (open /#gallery): all 22 frames from the screen-design canvas,
 * rendered by the real app components with fixture data. No camera, no network.
 * Use it to check the UI against the designs and for the demo slide.
 */
import type { ReactNode } from 'react'
import { INTRO } from './data'
import { AfterCall, Calling, InCall, Incoming } from './screens/Call'
import { InPerson } from './screens/InPerson'
import { MeetPanel } from './screens/Meet'
import { ContactPage, ErrandNote, Home, VoicePicker } from './screens/Setup'
import type { Analysis, CallView, Contact, Draft, Line } from './types'

const MOM: Contact = { id: 'mom', name: 'Mom', number: '4135550177', knows_sign: true, kind: 'person', style: 'casual', fav: true }
const TONY: Contact = { id: 'tonys', name: "Tony's Pizza", number: '4135550142', knows_sign: false, kind: 'business', style: 'polite',
  note: 'Garlic bread and Honey BBQ wings. Name is Shruti. Tell me the total before ordering.' }
const DRLEE: Contact = { id: 'drlee', name: "Dr. Lee's office", number: '4135550190', knows_sign: false, kind: 'business', style: 'polite' }
const TAQUERIA: Contact = { id: 'taq', name: 'Taquería Lupita', number: '4135550106', knows_sign: false, kind: 'business', style: 'polite', language: 'es-US' }
const CONTACTS: Contact[] = [MOM,
  { id: 'jordan', name: 'Jordan', number: '4135550111', knows_sign: true, kind: 'person', fav: true },
  { id: 'grandpa', name: 'Grandpa', number: '4135550122', knows_sign: false, kind: 'person', fav: true },
  { id: 'drlee', name: 'Dr. Lee', number: '4135550190', knows_sign: false, kind: 'business', fav: true }, TONY]

let n = 0
const L = (who: 'caller' | 'me', text: string, o: Partial<Line> = {}): Line =>
  ({ id: `g${n++}`, who, text, status: who === 'me' ? 'spoken' : 'final', level: '', kind: who === 'me' ? 'reply' : '', unclear: false, heard: '', ts: 0, ...o })
const D = (text: string, o: Partial<Draft> = {}): Draft =>
  ({ id: `d${n++}`, text, source: 'signs', signs: [], level: 'quick', confirm_summary: '', problems: [], blocked: false, tone: 'warm', hash: 'h', ...o })
const A = (chips: string[], o: Partial<Analysis> = {}): Analysis =>
  ({ question_type: 'yes_no', options: [], chips, note_fact_key: null, involves_money: false, involves_commitment: false, unclear: false, ...o })
const ago = (mmss: string) => { const [m, s] = mmss.split(':').map(Number); return Date.now() - (m * 60 + s) * 1000 }

function call(contact: Contact, at: string, o: Partial<CallView> = {}): CallView {
  return { sid: `s${n++}`, state: 'LISTENING', direction: 'incoming', contact, startedAt: ago(at), lines: [], caption: null, draft: null,
    analysis: null, confirm: null, recap: [], endedReason: '', notice: null, editDraft: false, ...o }
}

const DINNER = "That's great. Are you still coming for dinner on Sunday? Grandpa will be there."
const noop = () => {}
const live = (c: CallView, extra: Record<string, unknown> = {}) => <InCall call={c} online dispatch={noop} preview {...extra} />

const FRAMES: [string, ReactNode, boolean?][] = [
  ['1 · First launch: pick your voice', <VoicePicker current={null} onDone={noop} />],
  ['2 · Home: favorites, recents, talk in person', <Home contacts={CONTACTS} online onOpen={noop} onDial={noop} onInPerson={noop} onSettings={noop}
    recents={[
      { id: 'r1', name: 'Mom', number: '', direction: 'incoming', at: Date.now() - 864e5, seconds: 360 },
      { id: 'r2', name: "Tony's Pizza", number: '', direction: 'outgoing', at: Date.now() - 3 * 864e5, seconds: 240 },
      { id: 'r3', name: "Dr. Lee's office", number: '', direction: 'outgoing', at: Date.now() - 4 * 864e5, seconds: 180 },
    ]} />],
  ['3 · Contact: "Knows I sign" skips the intro', <ContactPage contact={MOM} voiceName="Maya" onChange={noop} onBack={noop} onCall={noop} onVoice={noop} />],
  ['4 · Errand call: optional note', <ErrandNote contact={TONY} busy={false} error="" onBack={noop} onCall={noop}
    preview={{ auto_facts: [{ key: 'order', value: 'garlic bread and Honey BBQ wings' }, { key: 'name', value: 'Shruti' }], needs_confirmation: ['tell me the total before ordering'] }} />],
  ['5 · Calling: what they will hear first', <Calling call={call(TONY, '0:00', { state: 'RINGING', direction: 'outgoing' })} voiceId="XrExE9yKIg1WjnnlVkGX"
    firstWords={INTRO.replace('Bear with me a sec.', "I'd like to place a pickup order.")} onCancel={noop} />],
  ['6 · Incoming call: answer like normal', <Incoming call={call(MOM, '0:00', { state: 'RINGING' })} onAnswer={noop} onDecline={noop} />],
  ['7 · Caller talking: live captions', live(call(MOM, '02:14', {
    state: 'CALLER_TALKING',
    lines: [L('me', "Hey Mom! How's it going?"), L('caller', 'Oh hi, sweetheart! How was your week?'), L('me', 'Good! Busy with work, but good.')],
    caption: L('caller', "That's great. Are you still coming for dinner on Sun", { status: 'partial' }),
  }))],
  ['8 · You are signing (filler covers the pause)', live(call(MOM, '02:18', {
    state: 'YOUR_TURN',
    lines: [L('me', 'Good! Busy with work, but good.'), L('caller', DINNER), L('me', 'Mm, one sec...', { kind: 'filler' })],
  }), { signing: ['YES', 'SUNDAY'] })],
  ['9 · Reply ready: tap Send', live(call(MOM, '02:21', {
    state: 'DRAFT_READY', lines: [L('me', 'Good! Busy with work, but good.'), L('caller', DINNER)],
    draft: D("Yes, I'll be there on Sunday!"), analysis: A(['Yes', 'No', 'What time?', 'Hold on']),
  }))],
  ['10 · Unsure sign: you pick', live(call(TONY, '01:05', {
    state: 'YOUR_TURN', lines: [L('caller', 'Sure. Six wings or twelve?')],
  }), { unsure: { options: ['Ten', 'Twelve'] } })],
  ['11 · Edit the reply', live(call(MOM, '02:24', {
    state: 'DRAFT_READY', lines: [L('caller', DINNER)],
    draft: D("Yeah! I'll be there Sunday. Want me to bring anything?"), editDraft: true,
  }))],
  ['12 · Type instead', <TypeFrame />],
  ['13 · Speaking for you', live(call(MOM, '02:26', {
    state: 'SPEAKING', lines: [L('caller', DINNER), L('me', "Yeah! I'll be there Sunday.", { status: 'speaking' })],
  }))],
  ['14 · They talked over you: we stop', live(call(MOM, '02:27', {
    state: 'CALLER_TALKING',
    lines: [L('caller', DINNER), L('me', "Yeah! I'll be there Sunday. What should I bring?", { status: 'interrupted', heard: "Yeah! I'll be there" })],
    caption: L('caller', 'Oh wait, sorry. Is it Saturday or Sunday for you?', { status: 'partial' }),
    draft: D('Sunday. What should I bring?', { source: 'rest' }), analysis: A(['Sunday', 'Saturday'], { question_type: 'options' }),
  }))],
  ['15 · Answered from your note', live(call(TONY, '01:40', {
    direction: 'outgoing', state: 'CALLER_TALKING',
    lines: [L('me', "Let's do twelve Honey BBQ wings and the garlic bread. For pickup."), L('caller', 'Got it. And what name is that under?'),
      L('me', "It's under Shruti.", { kind: 'fact', level: 'auto' })],
    caption: L('caller', 'Perfect. Give me one sec to ring it up.', { status: 'partial' }),
  }))],
  ['16 · Money: you confirm first', live(call(TONY, '02:58', {
    direction: 'outgoing', state: 'CONFIRMING',
    lines: [L('me', "Let's do twelve Honey BBQ wings and the garlic bread. Pickup, under Shruti."),
      L('caller', 'Okay, that comes to $23.40 with tax. Should I place it?'), L('me', 'Mm, one sec...', { kind: 'filler' })],
    draft: D('Yes, please go ahead and place the order.', { level: 'confirm', confirm_summary: 'This agrees to pay $23.40 and places the order' }),
    confirm: { summary: 'This agrees to pay $23.40 and places the order', sentence: 'Yes, please go ahead and place the order.', hash: 'h' },
  }))],
  ['17 · Unclear audio: we don\'t guess', live(call(TONY, '02:40', {
    direction: 'outgoing', state: 'YOUR_TURN',
    lines: [L('caller', 'Okay, so your total comes to twenty with tax.', { unclear: true })],
    analysis: A(['Could you say that again?', 'One sec'], { unclear: true, question_type: 'statement' }),
  }))],
  ['18 · On hold: flash + buzz when a person returns', live(call(DRLEE, '04:12', {
    direction: 'outgoing', state: 'ON_HOLD', lines: [L('caller', "Please hold, I'll be right with you.")],
  }))],
  ['19 · Connection blip: call keeps going', <InCall preview dispatch={noop} online={false} call={call(MOM, '03:02', {
    state: 'LISTENING', lines: [L('caller', 'Wonderful. Around 6. Could you bring dessert?'), L('me', 'Yeah, of course!')],
  })} />],
  ['20 · After the call', <AfterCall onDone={noop} onCallBack={noop} onSave={noop} call={call(MOM, '06:00', {
    state: 'ENDED', recap: ["Dinner Sunday at 6. You said you'll be there.", 'Bring dessert. Grandpa is coming.'],
    lines: [L('caller', 'Are you still coming for dinner on Sunday?'), L('me', "Yes, I'll be there on Sunday!"),
      L('caller', 'Wonderful. Around 6. Could you bring dessert?'), L('me', "Sure, I'll bring the chocolate cake."), L('caller', 'Love you!'), L('me', 'Love you too!')],
  })} />],
  ['21 · In person: flip the phone', <InPerson onDone={noop} myName="Shruti" preview={{
    shown: "Yes, I'm picking up a prescription. The name is Shruti.", label: 'Pharmacist said',
    said: "Got it. It'll be ready in about ten minutes. Any questions for the pharmacist?" }} />],
  ['22 · Google Meet (stretch): signer-only extension', <MeetPanel />, true],
  ['23 · Call in Spanish: you read English, they hear Spanish', live(call(TAQUERIA, '01:12', {
    direction: 'outgoing', state: 'DRAFT_READY',
    lines: [
      L('me', "Hey! Quick heads-up, I'm deaf, so an app's voicing what I sign. Bear with me a sec.", { kind: 'intro', level: 'auto',
        spoken: '¡Hola! Un aviso rápido: soy una persona sorda y una app dice en voz alta lo que escribo en señas. Dame un momento, por favor.' }),
      L('caller', 'Hi, what can I get you?', { original: 'Hola, ¿qué le puedo servir?' }),
      L('me', 'Two tacos al pastor, please.', { spoken: '2 tacos al pastor, por favor.' }),
      L('caller', 'What time do you want them for?', { original: '¿Para qué hora los quiere?' }),
    ],
    draft: D('For 7:30, please.', { source: 'typed' }), analysis: A(['Let me check.', 'Could you say that again?'], { question_type: 'time' }),
  }))],
]

function TypeFrame() {
  // Frame 12 opens with the keyboard up; InCall shows it after one tap, so render it in that state.
  const c = call(MOM, '03:40', {
    state: 'YOUR_TURN', lines: [L('caller', 'Wonderful. Around 6. Could you bring dessert?'), L('me', 'Yeah, of course!')],
    analysis: A(['Sure', 'What kind?', 'Hold on']),
  })
  return <InCall call={c} online dispatch={noop} preview key="type" startTyping="I'll bring the chocolate cake you like." />
}

export default function Gallery() {
  return (
    <div className="gallery">
      <h1>Sign2Speak · all screens</h1>
      {FRAMES.map(([label, node, wide]) => (
        <div key={label} className={`gframe ${wide ? 'wide' : ''}`} data-frame={label.split(' ')[0]}>
          <div className="glabel">{label}</div>
          <div className="phone">{node}</div>
        </div>
      ))}
    </div>
  )
}
