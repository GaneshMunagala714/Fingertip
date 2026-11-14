/**
 * Show it: film something instead of describing it.
 *
 * Gemini watches the clip (server/app/show.py) and returns facts, each tied to WHEN it's visible
 * and WHERE in the frame. The player draws those as boxes with tooltips on top of the video, so
 * every fact can be checked against the moment the camera saw it before anything is said.
 * The same annotated clip can be used in a call, shared as a link (opt-in), or shown in person.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { post, postForm, withKey } from '../api'
import { Video as VideoIcon } from '../icons'
import type { ShowRecord, VideoFact } from '../types'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const KIND: Record<VideoFact['kind'], string> = {
  problem: 'Problem', reading: 'Reading', label: 'Label', object: 'Object', action: 'Action', other: 'Seen',
}

/* ---------------------------------------------------------------- the overlay player */

export function ShowPlayer({ src, facts, duration = 0, onSay, compact = false, previewTime }: {
  src: string | null; facts: VideoFact[]; duration?: number; onSay?: (f: VideoFact) => void; compact?: boolean
  /** Gallery / no video: freeze the overlays at this time. */
  previewTime?: number
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [now, setNow] = useState(previewTime ?? 0)
  const [dur, setDur] = useState(duration)
  const [focus, setFocus] = useState<string | null>(null)

  useEffect(() => {
    const v = video.current
    if (!v) return
    let raf = 0
    const tick = () => { setNow(v.currentTime); if (!v.paused) raf = requestAnimationFrame(tick) }
    const play = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick) }
    const meta = () => { if (Number.isFinite(v.duration)) setDur(v.duration) }
    v.addEventListener('play', play)
    v.addEventListener('seeked', tick)
    v.addEventListener('timeupdate', tick)
    v.addEventListener('loadedmetadata', meta)
    return () => { cancelAnimationFrame(raf); v.removeEventListener('play', play); v.removeEventListener('seeked', tick)
      v.removeEventListener('timeupdate', tick); v.removeEventListener('loadedmetadata', meta) }
  }, [src])

  const t = previewTime ?? now
  const visible = facts.filter((f) => t >= f.t - 0.05 && t <= f.t_end + 0.3)
  const total = Math.max(dur || duration, ...facts.map((f) => f.t_end), 1)
  const num = useMemo(() => Object.fromEntries(facts.map((f, i) => [f.id, i + 1])), [facts])

  function jump(f: VideoFact) {
    setFocus(f.id)
    const v = video.current
    if (v) { v.currentTime = f.t; v.pause() } else setNow(f.t)
  }

  return (
    <div className={`sp ${compact ? 'compact' : ''}`}>
      <div className="sp-stagewrap">
        <div className="sp-stage">
          {src ? <video ref={video} src={src} controls playsInline preload="metadata" />
            : <div className="sp-ph" aria-hidden />}
          <div className="sp-ov" aria-hidden>
            {visible.filter((f) => f.box).map((f) => {
              const [y0, x0, y1, x1] = f.box!
              const below = y0 < 140
              return (
                <div key={f.id} className={`sp-box ${f.sure ? '' : 'unsure'} ${focus === f.id ? 'focus' : ''}`}
                     style={{ left: `${x0 / 10}%`, top: `${y0 / 10}%`, width: `${(x1 - x0) / 10}%`, height: `${(y1 - y0) / 10}%` }}>
                  <span className={`sp-tip ${below ? 'below' : ''}`}><b>{num[f.id]}</b>{f.label}{f.sure ? '' : ' ?'}</span>
                </div>
              )
            })}
            {visible.filter((f) => !f.box).map((f, i) => (
              <span key={f.id} className="sp-float" style={{ bottom: `${12 + i * 34}px` }}><b>{num[f.id]}</b>{f.label}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="sp-line" role="group" aria-label="Moments in the video">
        <div className="sp-track"><div className="sp-head" style={{ left: `${Math.min(100, (t / total) * 100)}%` }} /></div>
        {facts.map((f) => (
          <button key={f.id} className={`sp-mark ${focus === f.id ? 'on' : ''}`} style={{ left: `${Math.min(100, (f.t / total) * 100)}%` }}
                  onClick={() => jump(f)} aria-label={`Go to ${mmss(f.t)}: ${f.label}`}>{num[f.id]}</button>
        ))}
      </div>
      <ol className="sp-facts">
        {facts.map((f) => {
          const live = t >= f.t - 0.05 && t <= f.t_end + 0.3
          return (
            <li key={f.id} className={`${live ? 'live' : ''} ${focus === f.id ? 'on' : ''}`}>
              <button className="sp-fact" onClick={() => jump(f)} aria-label={`Show ${mmss(f.t)} in the video`}>
                <span className="sp-n">{num[f.id]}</span>
                <span className="sp-body">
                  <span className="sp-meta">{mmss(f.t)} · {KIND[f.kind] ?? 'Seen'}{!f.sure && <em> · not sure, check it</em>}{!f.box && ' · no single spot'}</span>
                  <span className="sp-say">{f.say}</span>
                </span>
              </button>
              {onSay && <button className="btn btn-ghost sp-saybtn" onClick={() => onSay(f)}>Say this</button>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/* ---------------------------------------------------------------- capture -> analyze -> use */

type Avail = { available: boolean } | null

export function ShowFlow({ callSid, onClose, onDone }: { callSid?: string; onClose: () => void; onDone?: (r: ShowRecord) => void }) {
  const [avail, setAvail] = useState<Avail>(null)
  const [context, setContext] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [err, setErr] = useState('')
  const [rec, setRec] = useState<ShowRecord | null>(null)
  const [shared, setShared] = useState(false)
  const [copied, setCopied] = useState(false)
  const pick = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((h) => setAvail(h.show ?? { available: false })).catch(() => setAvail({ available: false }))
  }, [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  useEffect(() => {
    if (!busy) return
    const t0 = Date.now()
    const i = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(i)
  }, [busy])

  function choose(f: File | null) {
    setErr('')
    if (!f) return
    if (!f.type.startsWith('video/')) { setErr("That isn't a video. Film one, or pick a video file."); return }
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  async function analyze() {
    if (!file) return
    setBusy(true)
    setErr('')
    try {
      const duration = await new Promise<number>((res) => {
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.onloadedmetadata = () => res(Number.isFinite(v.duration) ? v.duration : 0)
        v.onerror = () => res(0)
        v.src = preview!
      })
      const form = new FormData()
      form.append('file', file)
      form.append('duration', String(duration))
      form.append('context', context)
      form.append('title', context.slice(0, 80))
      const r = await postForm<ShowRecord>('/api/show', form)
      setRec(r)
      onDone?.(r)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function useInCall() {
    if (!rec || !callSid) return
    try {
      await post(`/api/calls/${callSid}/show/${rec.id}`)
      onClose()
    } catch (e: any) { setErr(e.message) }
  }

  async function toggleShare() {
    if (!rec) return
    try {
      const r = await post<{ share: boolean; share_token: string | null }>(`/api/show/${rec.id}/share`, { share: !shared })
      setShared(r.share)
      if (r.share_token) setRec({ ...rec, share_token: r.share_token })
    } catch (e: any) { setErr(e.message) }
  }

  async function remove() {
    if (!rec) return
    await fetch(withKey(`/api/show/${rec.id}`), { method: 'DELETE' }).catch(() => {})
    onClose()
  }

  const link = rec?.share_token ? `${location.origin}/#s/${rec.share_token}` : ''

  return (
    <div className="screen show">
      <div className="head-white">
        <div className="title-row">
          <div><h1 style={{ fontSize: 26 }}>Show it</h1>
            <p className="fine" style={{ margin: 0 }}>Film it instead of describing it.</p></div>
          <button className="link" onClick={onClose}>{rec ? 'Done' : 'Cancel'}</button>
        </div>
      </div>
      <div className="scroll pad16" style={{ gap: 14 }}>
        {avail && !avail.available && (
          <div className="cardbox boxpad" role="status">Show it needs the Gemini key on the server. Everything else still works.</div>
        )}

        {!rec && (
          <>
            <div className="cardbox boxpad" style={{ gap: 10 }}>
              <div className="label">1 · Film it (10 to 60 seconds)</div>
              <input ref={pick} type="file" accept="video/*" capture="environment" hidden
                     onChange={(e) => choose(e.target.files?.[0] ?? null)} aria-label="Film or choose a video" />
              {preview ? <video src={preview} controls playsInline className="show-preview" />
                : <button className="show-drop" onClick={() => pick.current?.click()}>
                    <VideoIcon size={36} /><b>Film it now</b><small>or pick a video you already have</small>
                  </button>}
              {preview && <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => pick.current?.click()}>Use a different video</button>}
              <small className="fine">Get close to the problem, hold steady, and show any labels or screens for a couple of seconds.</small>
            </div>
            <div className="cardbox boxpad" style={{ gap: 8 }}>
              <div className="label">2 · What's it about? (optional)</div>
              <input className="num-input" value={context} onChange={(e) => setContext(e.target.value)} maxLength={300}
                     placeholder="Dishwasher leaking, calling the landlord" aria-label="What the video is about" />
            </div>
            <p className="fine">Your video is sent to Google Gemini to be analyzed. It's kept on this server for 24 hours so you can replay or share it, then deleted.</p>
          </>
        )}

        {busy && (
          <div className="cardbox boxpad show-busy" role="status" aria-live="polite">
            <span className="dots"><i /><i /><i /></span>
            <span>Gemini is watching your video... {elapsed}s</span>
          </div>
        )}
        {err && <div className="err" role="alert">{err}</div>}

        {rec && (
          <>
            <div className="cardbox boxpad">
              <div className="label">What the video shows</div>
              {rec.facts.length === 0 && <p>Nothing clear enough to describe. Try filming closer and steadier.</p>}
              <ShowPlayer src={withKey(`/api/show/${rec.id}/video`)} facts={rec.facts} duration={rec.duration} />
              {rec.notes && <p className="fine" style={{ marginTop: 8 }}>Couldn't see clearly: {rec.notes}</p>}
            </div>
            {rec.summary_say && (
              <div className="cardbox boxpad">
                <div className="label">Ready to say</div>
                <p style={{ fontSize: 19, margin: 0 }}>"{rec.summary_say}"</p>
                <small className="fine">Nothing is said until you send it in a call. Check each point against the video first.</small>
              </div>
            )}
            <div className="cardbox setting">
              <div className="txt"><b>Share a link</b>
                <small>{shared ? 'Anyone with the link can watch this clip and its notes.' : 'Off. Turn on to send the annotated clip to the other person.'}</small></div>
              <button className={`toggle ${shared ? 'on' : ''}`} role="switch" aria-checked={shared} aria-label="Share a link" onClick={toggleShare} />
            </div>
            {shared && link && (
              <div className="cardbox boxpad" style={{ gap: 8 }}>
                <code className="mcode" style={{ wordBreak: 'break-all' }}>{link}</code>
                <button className="btn btn-ghost" onClick={() => { navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {}) }}>
                  {copied ? 'Copied' : 'Copy link'}</button>
              </div>
            )}
            <button className="link" style={{ alignSelf: 'flex-start', color: 'var(--red)' }} onClick={remove}>Delete this video now</button>
          </>
        )}
      </div>
      <div className="foot">
        {!rec ? (
          <button className="btn btn-blue grow" disabled={!file || busy || (avail !== null && !avail.available)} onClick={analyze}>
            {busy ? 'Watching...' : 'Show Gemini'}</button>
        ) : callSid ? (
          <button className="btn btn-blue grow" onClick={useInCall} disabled={rec.facts.length === 0}>Use in this call</button>
        ) : (
          <button className="btn btn-blue grow" onClick={onClose}>Done</button>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- what the other person opens */

export function SharedShow({ token }: { token: string }) {
  const [rec, setRec] = useState<ShowRecord | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch(`/api/shared/${encodeURIComponent(token)}`).then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.detail ?? 'This link has expired.')
      setRec(j)
    }).catch((e) => setErr(e.message))
  }, [token])
  return (
    <div className="screen show">
      <div className="head-white">
        <h1 style={{ fontSize: 24 }}>{rec?.title || 'A video for you'}</h1>
        <p className="fine" style={{ margin: 0 }}>Shared with Fingertip. Tap a point to see that moment in the video.</p>
      </div>
      <div className="scroll pad16" style={{ gap: 14 }}>
        {err && <div className="err" role="alert">{err}</div>}
        {rec && <>
          {rec.summary_say && <div className="cardbox boxpad"><p style={{ fontSize: 19, margin: 0 }}>{rec.summary_say}</p></div>}
          <div className="cardbox boxpad">
            <ShowPlayer src={`/api/shared/${encodeURIComponent(token)}/video`} facts={rec.facts} duration={rec.duration} />
          </div>
          <p className="fine">The points and boxes were found by AI (Google Gemini), and the sender chose to share them. AI can misread things, so check against the video. The link expires within 24 hours.</p>
        </>}
      </div>
    </div>
  )
}
