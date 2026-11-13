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
