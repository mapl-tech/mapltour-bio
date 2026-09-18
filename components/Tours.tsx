'use client'

import { useEffect, useRef, useState } from 'react'
import { money, out, TOURS, type Tour } from '@/lib/data'
import { event, outbound } from '@/lib/analytics'

const name = (v: string | null) => (v ? v.split('/').pop()!.replace(/\.mp4$/, '') : '')

function Card({ t, index }: { t: Tour; index: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const vref = useRef<HTMLVideoElement>(null)
  const [near, setNear] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [wanted, setWanted] = useState(false)
  const clip = t.mobileVideo ? `/media/tours/${name(t.mobileVideo)}.mp4` : null
  const poster = t.mobileVideo ? `/media/tours/${name(t.mobileVideo)}.webp` : t.image
  const blur = t.mobileVideo ? `/media/tours/${name(t.mobileVideo)}-blur.webp` : ''

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setNear(true); else if (wanted) { vref.current?.pause(); setPlaying(false); setWanted(false) } }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [wanted])

  useEffect(() => {
    const v = vref.current
    if (!v || !wanted) return
    const on = () => setPlaying(true)
    v.addEventListener('playing', on)
    v.play().catch(() => {})
    return () => v.removeEventListener('playing', on)
  }, [wanted])

  const toggle = () => {
    if (!clip) return
    if (wanted) { vref.current?.pause(); setPlaying(false); setWanted(false) }
    else { setWanted(true); event('bio_tour_play', { tour: t.slug }) }
  }

  return (
    <article className="tour on-dark" ref={ref} onMouseEnter={() => { if (clip && window.matchMedia('(hover: hover)').matches && !wanted) setWanted(true) }} onMouseLeave={() => { if (window.matchMedia('(hover: hover)').matches && wanted) { vref.current?.pause(); setPlaying(false); setWanted(false) } }}>
      <div className="tour-media" style={blur ? { backgroundImage: `url(${blur})` } : undefined} aria-hidden="true">
        {near && <img src={poster} alt="" loading={index < 2 ? 'eager' : 'lazy'} decoding="async" width={720} height={960} />}
        {wanted && clip && <video ref={vref} className={playing ? 'is-playing' : ''} muted loop playsInline preload="auto" src={clip} />}
      </div>
      {clip && (
        <button type="button" className="tour-play" onClick={toggle} aria-label={wanted ? `Pause ${t.title} clip` : `Play ${t.title} clip`} aria-pressed={wanted}>
          {wanted ? <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="2.5" width="3.5" height="11" rx="1" /><rect x="9.5" y="2.5" width="3.5" height="11" rx="1" /></svg> : <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>}
        </button>
      )}
      <div className="tour-body">
        <span className="tour-tag">{t.destination} · {t.duration}</span>
        <h3>{t.title}</h3>
        <p className="tour-meta">{t.description}</p>
        <div className="tour-foot">
          <div className="tour-price"><strong>{money(t.price)}</strong><span>per car, {t.unit}</span></div>
          <a className="btn btn-gold" href={out(`/experience/${t.slug}`, 'tour_book')} onClick={() => outbound('tour_book', { tour: t.slug })}>Book</a>
        </div>
      </div>
    </article>
  )
}

export default function Tours() {
  return (
    <section id="tours" className="tours section" aria-labelledby="tours-h">
      <div className="container">
        <p className="eyebrow">Tours run by locals</p>
        <h2 id="tours-h" className="h2">The Jamaica your cousin would show you.</h2>
        <p className="lead">Private tours with hotel pickup, priced per car so a couple and a family of three pay the same. Tap a card to see it move.</p>
        <div className="tour-track">
          {TOURS.map((t, i) => <Card key={t.slug} t={t} index={i} />)}
        </div>
        <div className="tours-more">
          <a className="btn btn-dark" href={out('/explore', 'tours_all')} onClick={() => outbound('tours_all')}>All tours and prices</a>
        </div>
      </div>
    </section>
  )
}
