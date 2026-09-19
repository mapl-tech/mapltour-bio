'use client'

import { useEffect, useRef, useState } from 'react'
import { CHEAPEST_ONE_WAY, money, out } from '@/lib/data'
import { event, outbound } from '@/lib/analytics'

/**
 * The ride, scrubbed by scroll. A pinned stage holds a 20 second aerial of
 * the road out of Montego Bay; the section is several screens tall and the
 * video's time follows how far the visitor has scrolled through it. Four
 * chapters change the caption. The clip is fetched whole once the section
 * is near, then played from memory so seeking is instant. Save-data, slow
 * links and reduced motion get the poster with the same captions.
 *
 * iOS is its own case. Safari there does not preload a video's data and
 * never fires loadeddata for a clip that has not played, and a seek on a
 * never-played video draws nothing. So on iOS the clip is the file itself
 * (byte ranges, no blob), the section is ready on metadata, and a muted
 * play-then-pause wakes the decoder; Low Power Mode refuses that without a
 * gesture, so the first touch tries again. If seeks still do not move the
 * frame, the section drops to the poster chapters rather than a blank box.
 */
const isIOS = () => typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
const CHAPTERS = [
  { at: 0.0, eyebrow: 'Out of the arrivals hall', h: 'Your name on a sign.', p: 'The driver is waiting where you walk out, flight tracked, so a late landing is still met.' },
  { at: 0.26, eyebrow: 'One flat price', h: `From ${money(CHEAPEST_ONE_WAY)} to your resort.`, p: 'Locked at checkout, nothing added at the airport. Up to 4 people ride for the same fare.' },
  { at: 0.52, eyebrow: 'The north coast road', h: 'Twenty minutes to two hours of sea.', p: 'Montego Bay, Falmouth, Lucea, Negril or Ocho Rios. The drive time and the fare are set by the zone.' },
  { at: 0.78, eyebrow: 'Straight to the door', h: 'No stops. No problem.', p: 'A private car, never shared, straight to your resort. Then the island is yours.' },
]

export default function Ride() {
  const wrap = useRef<HTMLElement>(null)
  const vref = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const [chapter, setChapter] = useState(0)
  const [staticMode, setStaticMode] = useState(false)

  // Fetch the clip once the section is within a screen, as a blob so
  // seeking never waits on the network.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean; downlink?: number } }).connection
    // Under about 1.5 Mbps the phone clip would take 25 s to arrive; give
    // those visitors the poster and captions instead of a stalled fetch.
    if (reduced || c?.saveData || /2g|3g/.test(c?.effectiveType ?? '') || (typeof c?.downlink === 'number' && c.downlink < 1.5)) { setStaticMode(true); return }
    let done = false
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || done) return
      done = true; io.disconnect()
      const file = window.innerWidth >= 900 ? '/media/ride/ride-desktop.mp4' : '/media/ride/ride-phone.mp4'
      if (isIOS()) { setSrc(file); return }
      fetch(file).then((r) => r.blob()).then((b) => setSrc(URL.createObjectURL(b))).catch(() => setStaticMode(true))
    }, { rootMargin: '50% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Wake the decoder once the clip has metadata: a muted inline play that is
  // paused at once. Allowed without a gesture everywhere but iOS Low Power
  // Mode, where the first touch on the page retries it. Then watch the first
  // seeks: if the frame never moves, fall back to the poster chapters.
  useEffect(() => {
    const v = vref.current
    if (!v || !src) return
    let woken = false
    const wake = () => {
      if (woken) return
      const p = v.play()
      if (p && typeof p.then === 'function') p.then(() => { woken = true; v.pause() }).catch(() => {})
      else { woken = true; v.pause() }
    }
    const onMeta = () => { setReady(true); wake() }
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('loadeddata', onMeta)
    if (v.readyState >= 1) onMeta()
    const onTouch = () => { if (!woken) wake() }
    window.addEventListener('touchend', onTouch, { passive: true })
    window.addEventListener('pointerup', onTouch, { passive: true })
    // Nothing arrived at all: the poster chapters tell the story instead.
    const stall = window.setTimeout(() => { if (v.readyState < 1) setStaticMode(true) }, 12000)
    return () => {
      v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('loadeddata', onMeta)
      window.removeEventListener('touchend', onTouch); window.removeEventListener('pointerup', onTouch)
      window.clearTimeout(stall)
    }
  }, [src])

  // Scroll drives time. A small lerp keeps the seek smooth on trackpads.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    let target = 0, current = 0, raf = 0
    // Seeks that never land (a decoder that stays asleep) are counted; a
    // handful in a row past the first second means the video is not going
    // to draw, and the poster chapters take over.
    let missed = 0
    const tick = () => {
      const v = vref.current
      current += (target - current) * 0.18
      if (v && ready && v.duration) {
        const t = current * v.duration
        if (Math.abs(v.currentTime - t) > 0.02) {
          if (t > 1 && v.currentTime < 0.05) { missed++; if (missed > 90) setStaticMode(true) } else missed = 0
          v.currentTime = t
        }
      }
      if (Math.abs(target - current) > 0.001) raf = requestAnimationFrame(tick)
      else raf = 0
    }
    const onScroll = () => {
      const r = el.getBoundingClientRect()
      const total = r.height - window.innerHeight
      const p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0
      target = p
      setProgress(p)
      let ch = 0
      for (let i = 0; i < CHAPTERS.length; i++) if (p >= CHAPTERS[i].at) ch = i
      setChapter(ch)
      if (!raf) raf = requestAnimationFrame(tick)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [ready])

  useEffect(() => { if (chapter > 0) event('bio_ride_chapter', { chapter }) }, [chapter])

  const posterAt = Math.min(18, Math.floor(progress * 4) * 6)

  return (
    <section id="ride" className={`ride${staticMode ? ' is-static' : ''}${chapter === CHAPTERS.length - 1 ? ' is-last' : ''}`} ref={wrap} aria-labelledby="ride-h">
      <div className="ride-stage">
        <div className="ride-media" aria-hidden="true">
          <img src={`/media/ride/poster-${staticMode ? posterAt : 0}.webp`} alt="" width={1280} height={720} decoding="async" loading="lazy" />
          {src && !staticMode && (
            <video ref={vref} className={ready ? 'is-ready' : ''} src={src} muted playsInline preload="auto" tabIndex={-1} aria-hidden="true" />
          )}
        </div>
        <div className="ride-panel">
          <p className={`ride-scroll${chapter > 0 ? ' is-off' : ''}`} aria-hidden="true">Scroll <span>&darr;</span></p>
          <h2 id="ride-h" className="visually-hidden">The ride from the airport</h2>
          <div className="ride-captions">
            {CHAPTERS.map((c, i) => (
              <div className={`ride-cap${i === chapter ? ' is-on' : ''}`} key={c.eyebrow} aria-hidden={i !== chapter}>
                <span className="ride-eyebrow">{c.eyebrow}</span>
                <p className="ride-h">{c.h}</p>
                <p className="ride-p">{c.p}</p>
              </div>
            ))}
          </div>
          <a className="btn btn-gold ride-cta" href="#price" onClick={() => outbound('ride_price')}>Price my airport ride</a>
          <a className="ride-alt" href={out('/transfers', 'ride_all')} onClick={() => outbound('ride_all')}>See every fare on mapltours.com</a>
        </div>
        <div className="ride-progress" aria-hidden="true">
          <div className="ride-bar" style={{ width: `${progress * 100}%` }} />
          {CHAPTERS.map((c, i) => <span key={c.eyebrow} className={`ride-dot${i <= chapter ? ' is-on' : ''}`} style={{ left: `${c.at * 100}%` }} />)}
        </div>
      </div>
    </section>
  )
}
