'use client'

import { useEffect, useRef, useState } from 'react'
import { CHEAPEST_ONE_WAY, DESTINATIONS, money, out } from '@/lib/data'
import { outbound } from '@/lib/analytics'

/**
 * Poster first, always. The clip starts after the load event on connections
 * that can carry it, on the phone or the desktop file, and can be stopped.
 */
export default function Hero() {
  const ref = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection
    if (c?.saveData || /2g|3g/.test(c?.effectiveType ?? '')) return
    const start = () => setTimeout(() => setSrc(window.matchMedia('(max-width: 767px)').matches ? '/media/hero-portrait.mp4' : '/media/hero-landscape.mp4'), 700)
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
    <header className="hero on-dark">
      <div className="hero-media" aria-hidden="true">
        <picture>
          <source media="(max-width: 767px)" srcSet="/media/hero-portrait.webp" type="image/webp" />
          <img src="/media/hero-landscape.webp" alt="" fetchPriority="high" decoding="async" width={1600} height={900} />
        </picture>
        {src && (
          <video ref={ref} className={playing && !paused ? 'is-playing' : ''} muted loop playsInline preload="none" src={src} />
        )}
      </div>
      <div className="hero-scrim" aria-hidden="true" />

      <div className="hero-top">
        <a href={out('/', 'hero_logo')} aria-label="MAPL Tours Jamaica, main site" onClick={() => outbound('hero_logo')}>
          <img src="/media/logo-dark.svg" alt="MAPL Tours Jamaica" className="hero-logo" width={112} height={40} />
        </a>
        <a className="btn btn-ghost" href="#guide">Free arrival guide</a>
      </div>

      <div className="hero-body">
        <h1 className="hero-title">Discover Jamaica <em>beyond the resort.</em></h1>
        <p className="hero-sub">
          Private airport transfers from Montego Bay to {DESTINATIONS.length} resorts, priced before you book, and tours run by locals. One flat price per car. No account, no haggling at arrivals.
        </p>
        <div className="hero-ctas">
          <a className="btn btn-gold" href="#price" onClick={() => outbound('hero_price')}>Price my airport ride</a>
          <a className="btn btn-ghost" href="#tours" onClick={() => outbound('hero_tours')}>See the tours</a>
        </div>
        <ul className="hero-facts" aria-label="What every ride includes">
          <li>From {money(CHEAPEST_ONE_WAY)} one way</li>
          <li>Met at arrivals with a name sign</li>
          <li>Flight tracked</li>
          <li>Card or Apple Pay</li>
        </ul>
      </div>

      {playing && (
        <button type="button" className="hero-pause" onClick={toggle} aria-label={paused ? 'Play background video' : 'Pause background video'} aria-pressed={paused}>
          {paused ? <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg> : <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="2.5" width="3.5" height="11" rx="1" /><rect x="9.5" y="2.5" width="3.5" height="11" rx="1" /></svg>}
        </button>
      )}
    </header>
  )
}
