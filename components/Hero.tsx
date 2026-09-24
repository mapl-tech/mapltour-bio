'use client'

import { useEffect, useRef, useState } from 'react'
import { CHEAPEST_ONE_WAY, COUPON, money, offerLabel, out } from '@/lib/data'
import { outbound } from '@/lib/analytics'
import { useLead } from '@/lib/useLead'
import { TIPS_ON } from '@/lib/tips.mts'
import CodeCopy from './CodeCopy'
import { TipsRow } from './Capture'

/**
 * Four things and nothing else: the headline, one line that carries the
 * offer, the email field and the Redeem button. The header holds the
 * "Price my ride" pill; everything else lives further down the page.
 *
 * The picture is a montage: four shots, the coast then guests on tours,
 * cut together with dissolves into one clip (ffmpeg xfade), full-bleed on
 * desktop with the text over it, in the top half on phones with the dark
 * panel below. Poster first, always; the clip starts after the load event
 * on connections that can carry it, and can be stopped.
 */
export default function Hero() {
  const hero = useRef<HTMLElement>(null)
  const ref = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const L = useLead('bio_hero')
  const off = offerLabel()

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection
    if (c?.saveData || /2g|3g/.test(c?.effectiveType ?? '')) return
    const start = () => setTimeout(() => setSrc(window.matchMedia('(min-width: 900px)').matches ? '/media/hero-montage.mp4' : '/media/hero-montage-phone.mp4'), 700)
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    return () => window.removeEventListener('load', start)
  }, [])

  // The hero is a sticky curtain: the next section slides over it. On a short
  // phone (or with the error line showing) it is taller than the screen, and
  // pinned by its top its last lines would never be seen. CSS pins it by its
  // bottom edge instead when it does not fit; it needs the height for that.
  useEffect(() => {
    const el = hero.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => el.style.setProperty('--hero-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const v = ref.current
    if (!v || !src) return
    const on = () => setPlaying(true)
    v.addEventListener('playing', on)
    v.play().catch(() => {})
    return () => v.removeEventListener('playing', on)
  }, [src])


  return (
    <header ref={hero} className={`hero on-dark${L.state === 'done' ? ' is-done' : ''}`} id="top">
      <a className="skip" href="#price">Skip to the price finder</a>
      <div className="hero-media" aria-hidden="true">
        <picture>
          <source media="(min-width: 900px)" srcSet="/media/hero-montage.webp" type="image/webp" />
          <img src="/media/hero-montage-phone.webp" alt="" fetchPriority="high" decoding="async" width={720} height={540} />
        </picture>
        {src && (
          <video ref={ref} className={playing ? 'is-playing' : ''} muted loop playsInline preload="none" src={src} aria-hidden="true" tabIndex={-1} />
        )}
        <div className="hero-scrim" />
      </div>

      <div className="hero-top">
        <a className="hero-logo-link" href={out('/', 'hero_logo')} aria-label="MAPL Tours Jamaica, main site" onClick={() => outbound('hero_logo')}>
          <img src="/media/logo-dark.svg" alt="MAPL Tours Jamaica" className="hero-logo" width={112} height={40} />
        </a>
        <a className="btn btn-ghost" href="#price" onClick={() => outbound('hero_top_price')}>Price my ride</a>
      </div>

      <div className="hero-body">
        <div className="hero-panel">
          <h1 className="hero-title">Discover Jamaica <em>beyond the resort.</em></h1>
          <p className="hero-sub">
            Airport rides from {money(CHEAPEST_ONE_WAY)} and tours run by locals. <b>Save {off} on your first tour or ride.</b>
          </p>

          {L.state === 'done' ? (
            <div className="hero-done" role="status">
              <b>Here is your {off} code. It is on its way to {L.sentTo} too.</b>
              <CodeCopy code={COUPON.code} place="hero" />
              <span>Paste it in the discount code box at checkout on mapltours.com and {off} comes off before you pay.</span>
              {L.tips && <span className="tips-on">{TIPS_ON}</span>}
              <div className="hero-ctas">
                <a className="btn btn-gold" href="#tours" onClick={() => outbound('hero_done_tours')}>Choose a tour</a>
                <a className="btn btn-ghost" href="#price" onClick={() => outbound('hero_done_price')}>Price my airport ride</a>
              </div>
            </div>
          ) : (
            <form className="hero-form" onSubmit={L.submit} noValidate action="/api/lead" method="post">
              {/* A floating label: it sits in the field like a placeholder, then
                  moves to the top edge on focus or once there is text, so the
                  field keeps its name while the visitor types. The one-space
                  placeholder is only there for :placeholder-shown. */}
              <div className="hero-field">
                <input id="hero-email" ref={L.inputRef} name="email" className="hero-input" type="email" inputMode="email" autoComplete="email" placeholder=" " value={L.email} onChange={(e) => { L.setEmail(e.target.value); if (L.state === 'error') L.setState('idle') }} aria-invalid={L.state === 'error'} aria-describedby={L.state === 'error' ? 'hero-err' : 'hero-fine'} required />
                <label className="hero-label" htmlFor="hero-email">Email address</label>
              </div>
              {L.state === 'error' && <p id="hero-err" className="hero-err" role="alert">{L.msg}</p>}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={L.hp} onChange={(e) => L.setHp(e.target.value)} className="visually-hidden" aria-hidden="true" />
              {/* Before the button, in the markup and on a phone: the box is seen and reached before the tap that sends it. */}
              <TipsRow id="hero-tips" className="hero-tips" checked={L.optIn} onChange={L.setOptIn} />
              <button type="submit" className="btn btn-gold" disabled={L.state === 'busy'}>{L.state === 'busy' ? 'Sending…' : <>Redeem {off} OFF <span aria-hidden="true">&rarr;</span></>}</button>
              <input type="hidden" name="place" value="bio_hero" />
              <p id="hero-fine" className="hero-fine">{off} off a tour or an airport ride, one use per email address. Your code arrives by email in a minute.</p>
            </form>
          )}
        </div>
      </div>
    </header>
  )
}
