'use client'

import { useEffect, useRef, useState } from 'react'
import { CHEAPEST_ONE_WAY, COUPON, money, out } from '@/lib/data'
import { outbound } from '@/lib/analytics'
import { useLead } from '@/lib/useLead'

/**
 * Four things and nothing else: the headline, one line that carries the
 * offer, the email field and the Redeem button. The header holds the
 * "Price my ride" pill; everything else lives further down the page.
 *
 * The picture is a collage: four tour reels composed into one square clip
 * (scripts: ffmpeg xstack), so a phone decodes one small video instead of
 * four. On phones it sits on top with the dark panel below; on desktop it
 * is a card beside the text over a dimmed still. Poster first, always; the
 * clip starts after the load event on connections that can carry it.
 */
export default function Hero() {
  const ref = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const L = useLead('bio_hero')
  const off = money(COUPON.value)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection
    if (c?.saveData || /2g|3g/.test(c?.effectiveType ?? '')) return
    const start = () => setTimeout(() => setSrc(window.matchMedia('(min-width: 900px)').matches ? '/media/hero-collage-desktop.mp4' : '/media/hero-collage-portrait.mp4'), 700)
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    return () => window.removeEventListener('load', start)
  }, [])

  useEffect(() => {
    const v = ref.current
    if (!v || !src) return
    const on = () => setPlaying(true)
    v.addEventListener('playing', on)
    v.play().catch(() => {})
    return () => v.removeEventListener('playing', on)
  }, [src])

  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (paused) { v.play().catch(() => {}); setPaused(false) } else { v.pause(); setPaused(true) }
  }

  return (
    <header className="hero on-dark" id="top">
      <a className="skip" href="#price">Skip to the price finder</a>
      <div className="hero-bg" aria-hidden="true">
        <img src="/media/hero-landscape.webp" alt="" decoding="async" loading="lazy" width={1600} height={900} />
      </div>

      <div className="hero-top">
        <a className="hero-logo-link" href={out('/', 'hero_logo')} aria-label="MAPL Tours Jamaica, main site" onClick={() => outbound('hero_logo')}>
          <img src="/media/logo-dark.svg" alt="MAPL Tours Jamaica" className="hero-logo" width={112} height={40} />
        </a>
        <a className="btn btn-ghost" href="#price" onClick={() => outbound('hero_top_price')}>Price my ride</a>
      </div>

      <div className="hero-body">
        <div className="hero-collage" aria-hidden="true">
          <picture>
            <source media="(min-width: 900px)" srcSet="/media/hero-collage-desktop.webp" type="image/webp" />
            <img src="/media/hero-collage-portrait.webp" alt="" fetchPriority="high" decoding="async" width={724} height={724} />
          </picture>
          {src && (
            <video ref={ref} className={playing && !paused ? 'is-playing' : ''} muted loop playsInline preload="none" src={src} aria-hidden="true" tabIndex={-1} />
          )}
          {playing && (
            <button type="button" className="hero-pause" onClick={toggle} aria-label={paused ? 'Play the tour clips' : 'Pause the tour clips'}>
              {paused ? <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg> : <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="2.5" width="3.5" height="11" rx="1" /><rect x="9.5" y="2.5" width="3.5" height="11" rx="1" /></svg>}
            </button>
          )}
        </div>

        <div className="hero-panel">
          <h1 className="hero-title">Discover Jamaica <em>beyond the resort.</em></h1>
          <p className="hero-sub">
            Airport rides from {money(CHEAPEST_ONE_WAY)} per car and tours run by locals. <b>Save {off} on your first tour.</b>
          </p>

          {L.state === 'done' ? (
            <div className="hero-done" role="status">
              <b>{L.coupon ? `Your ${off} code is on its way to ${L.sentTo}.` : `The guide is on its way to ${L.sentTo}.`}</b>
              <span>{L.coupon ? 'Paste it under "Have a gift card?" at checkout. Not there in a minute? Look in Promotions or Spam.' : 'Your code did not generate just now. Reply to the email and we send it by hand.'}</span>
              <div className="hero-ctas">
                <a className="btn btn-gold" href="#tours" onClick={() => outbound('hero_done_tours')}>Choose a tour</a>
                <a className="btn btn-ghost" href="#price" onClick={() => outbound('hero_done_price')}>Price my airport ride</a>
              </div>
            </div>
          ) : (
            <form className="hero-form" onSubmit={L.submit} noValidate action="/api/lead" method="post">
              <label className="visually-hidden" htmlFor="hero-email">Email address</label>
              <input id="hero-email" ref={L.inputRef} name="email" className="hero-input" type="email" inputMode="email" autoComplete="email" placeholder="Enter your email" value={L.email} onChange={(e) => { L.setEmail(e.target.value); if (L.state === 'error') L.setState('idle') }} aria-invalid={L.state === 'error'} aria-describedby={L.state === 'error' ? 'hero-err' : 'hero-fine'} required />
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={L.hp} onChange={(e) => L.setHp(e.target.value)} className="visually-hidden" aria-hidden="true" />
              <button type="submit" className="btn btn-gold" disabled={L.state === 'busy'}>{L.state === 'busy' ? 'Sending…' : <>Redeem {off} OFF <span aria-hidden="true">&rarr;</span></>}</button>
              {L.state === 'error' && <p id="hero-err" className="hero-err" role="alert">{L.msg}</p>}
              <p id="hero-fine" className="hero-fine">One code per person, valid {Math.round(COUPON.days / 30)} months. It arrives by email in a minute, with the free Montego Bay arrival guide.</p>
            </form>
          )}
        </div>
      </div>
    </header>
  )
}
