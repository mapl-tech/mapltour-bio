'use client'

import { useEffect, useRef, useState } from 'react'
import { money, out, TOURS, type Tour } from '@/lib/data'
import { outbound } from '@/lib/analytics'

const name = (v: string | null) => (v ? v.split('/').pop()!.replace(/\.mp4$/, '') : '')
// The half-day combination is priced below either waterfall on its own in the
// catalogue; until that is explained on the main site it stays off this page.
const SHOWN = TOURS.filter((t) => t.slug !== 'dunns-river-blue-hole')

function Card({ t, index }: { t: Tour; index: number }) {
  const ref = useRef<HTMLElement>(null)
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

  // The card that fills the view plays by itself, one at a time, and stops
  // when it slides away. Not on save-data, slow links or reduced motion.
  useEffect(() => {
    const el = ref.current
    if (!el || !clip || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection
    if (c?.saveData || /2g|3g/.test(c?.effectiveType ?? '')) return
    const io = new IntersectionObserver(([e]) => {
      if (e.intersectionRatio >= 0.7) setWanted(true)
      else if (e.intersectionRatio < 0.3) { vref.current?.pause(); setPlaying(false); setWanted(false) }
    }, { threshold: [0.3, 0.7] })
    io.observe(el)
    return () => io.disconnect()
  }, [clip])

  useEffect(() => {
    const v = vref.current
    if (!v || !wanted) return
    const on = () => setPlaying(true)
    v.addEventListener('playing', on)
    v.play().catch(() => {})
    return () => v.removeEventListener('playing', on)
  }, [wanted])

  // Above the tier the catalogue prices the whole party per person, so a
  // fourth seat can cost far more than the car rate. Print the number when it
  // is close to the car price; otherwise send the family to the exact quote.
  const four = t.price4 && t.tierMax && t.tierMax < 4 ? t.price4 : null
  // One number to read: what a fourth person adds, when the catalogue prices it sanely.
  const fourLine = four ? (four <= t.price * 1.3 ? `. 4th person +${money(four - t.price)}` : '. 4 or more: see the tour page') : ''

  return (
    <article className="tour on-dark" ref={ref}>
      <div className="tour-media" style={blur ? { backgroundImage: `url(${blur})` } : undefined} aria-hidden="true">
        {near && <img src={poster} alt="" loading={index < 2 ? 'eager' : 'lazy'} decoding="async" width={720} height={960} />}
        {wanted && clip && <video ref={vref} className={playing ? 'is-playing' : ''} muted loop playsInline preload="auto" src={clip} aria-hidden="true" tabIndex={-1} />}
      </div>
      <div className="tour-body">
        <span className="tour-tag">{t.destination} · {t.duration}</span>
        <h3>{t.title}</h3>
        <p className="tour-meta">{t.description}</p>
        <div className="tour-foot">
          <div className="tour-price"><strong>{money(t.price)}</strong><span>{t.unit}{fourLine}</span></div>
          <a className="btn btn-gold" href={out(`/experience/${t.slug}`, 'tour_book')} aria-label={`Book ${t.title}`} onClick={(e) => { e.stopPropagation(); outbound('tour_book', { tour: t.slug }) }}>Book</a>
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
        <p className="lead">Private tours with hotel pickup, one price for your group. <span className="touch-only">Swipe through them; each one plays as it arrives.</span><span className="hover-only">Each one plays as it comes into view.</span></p>
        <div className="tour-track" tabIndex={0} aria-label="Tours">
          {SHOWN.map((t, i) => <Card key={t.slug} t={t} index={i} />)}
          <a className="tour tour-all on-dark" href={out('/explore', 'tours_all')} onClick={() => outbound('tours_all')}>
            <span className="tour-all-inner">
              <span className="tour-tag">All tours</span>
              <b>Every tour, every price</b>
              <span>Hotel pickup included, one price for your group, on mapltours.com.</span>
              <span className="tour-all-arrow" aria-hidden="true">&rarr;</span>
            </span>
          </a>
        </div>
      </div>
    </section>
  )
}
