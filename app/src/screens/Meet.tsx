import { useState } from 'react'
import { post } from '../api'
import { useSigning } from '../sign/useSigning'
import { SelfView } from './Call'

/**
 * Google Meet (stretch, M6): the signer-only Chrome extension panel.
 * Display-only view for now; the extension itself is built only after M0-M5 are solid.
 */
export function MeetPanel({ preview = true }: { preview?: boolean }) {
  const people = [
    { n: 'Priya', c: 'var(--amber)' }, { n: 'Marcus', c: '#4d5765' },
    { n: 'Lena', c: '#4d5765' }, { n: 'You (Shruti)', c: 'var(--blue)' },
  ]
  return (
    <div className="meet">
      <div className="tiles">
        {people.map((p) => (
          <div key={p.n} className="tile">
            <div className="av lg" style={{ background: p.c, color: '#fff' }}>{p.n[0]}</div>
            <span>{p.n}</span>
          </div>
        ))}
        <div className="cc"><b>Marcus:</b> So can we commit to shipping Friday, or do we need more time?</div>
        <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#aeb6c2', fontSize: 14 }}>Team sync · Video call</div>
      </div>
      <div className="panel">
        <h3>Sign2Speak</h3>
        <div className="fine">In this meeting</div>
        <SelfView signing camera={!preview} />
        <div className="draft-wrap" style={{ alignSelf: 'stretch', maxWidth: 'none' }}>
          <span className="lab" style={{ alignSelf: 'flex-start' }}>Ready to send</span>
          <div className="draftbub">I think Friday works. I'll finish testing by Thursday.</div>
        </div>
        <div className="fine">Everyone hears it in your voice and sees it in chat.</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost">Edit</button>
          <button className="btn btn-blue grow" style={{ fontSize: 16 }}>Send to meeting</button>
        </div>
      </div>
    </div>
  )
}

/**
 * The live panel the Meet extension opens in a small window (/#meet).
 * Signs (or typing) -> one sentence -> "Send to meeting": the extension posts it to Meet chat and,
 * if voice is set up on the server, plays it into the Meet mic.
 */
export function MeetLive() {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [sent, setSent] = useState<string[]>([])
  const [err, setErr] = useState('')
  const opener = typeof window !== 'undefined' ? window.opener : null
  const sign = useSigning({
    onPhrase: (s) => {
      post<{ text: string }>('/api/signs/sentence', { signs: s, style: 'polite' })
        .then((r) => { setDraft(r.text); setEditing(false) }).catch(() => {})
    },
  })

  function send() {
    const text = draft.trim()
    if (!text) return
    if (!opener) { setErr('Open this from the Sign2Speak button inside Google Meet.'); return }
    opener.postMessage({ source: 'sign2speak', type: 'send', text }, 'https://meet.google.com')
    setSent((s) => [...s, text])
    setDraft('')
    setEditing(false)
  }

  return (
    <div className="screen">
      <div className="pad16" style={{ flex: 1, overflow: 'auto' }}>
        <h3 style={{ fontSize: 20 }}>Sign2Speak</h3>
        <div className="fine">In this meeting</div>
        <div style={{ position: 'relative', height: 200 }}>
          <SelfView signing={!!sign.signs} onVideo={sign.onVideo} className="selfview meet-self" />
        </div>
        {sent.map((t, i) => <div key={i} className="bub me" style={{ fontSize: 16 }}>{t}</div>)}
        {sign.signs && !draft && (
          <div className="draft-wrap" style={{ alignSelf: 'stretch', maxWidth: 'none' }}>
            <span className="lab">Reading your signs...</span>
            <div className="draftbub signing-box"><div className="signtags" style={{ marginTop: 0 }}>{sign.signs.map((s, i) => <span key={i}>{s}</span>)}<span>...</span></div></div>
          </div>
        )}
        {(draft || editing) && (
          <div className="draft-wrap" style={{ alignSelf: 'stretch', maxWidth: 'none' }}>
            <span className="lab" style={{ alignSelf: 'flex-start' }}>{editing ? 'Editing' : 'Ready to send'}</span>
            {editing
              ? <textarea className="editbox" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label="Your message" />
              : <button className="draftbub" onClick={() => setEditing(true)}>{draft}</button>}
          </div>
        )}
        <div className="fine">Everyone hears it in your voice and sees it in chat.</div>
        {err && <div className="err" role="alert">{err}</div>}
      </div>
      <div className="foot">
        <button className="btn btn-ghost" onClick={() => setEditing(true)}>{draft ? 'Edit' : 'Type'}</button>
        <button className="btn btn-blue grow" style={{ fontSize: 16 }} disabled={!draft.trim()} onClick={send}>Send to meeting</button>
      </div>
    </div>
  )
}
