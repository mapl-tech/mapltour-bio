'use client'

import { useEffect, useState } from 'react'
import { outbound } from '@/lib/analytics'

/** Phone only. Hidden while the hero, the finder or the capture form is on screen. */
export default function StickyBar() {
  const [hidden, setHidden] = useState(true)
  useEffect(() => {
    const targets = ['hero', 'price', 'guide'].map((id) => document.getElementById(id) || document.querySelector(`.${id}`)).filter(Boolean) as Element[]
    if (!targets.length || typeof IntersectionObserver === 'undefined') { setHidden(false); return }
    const seen = new Map<Element, boolean>()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target, e.isIntersecting)
      setHidden([...seen.values()].some(Boolean))
    }, { threshold: 0.15 })
    targets.forEach((t) => io.observe(t))
    return () => io.disconnect()
  }, [])
  return (
    <div className="stickybar" data-hidden={hidden} aria-hidden={hidden}>
      <a className="btn btn-gold" href="#price" tabIndex={hidden ? -1 : 0} onClick={() => outbound('sticky_price')}>Price my ride</a>
      <a className="btn btn-light" href="#guide" tabIndex={hidden ? -1 : 0} onClick={() => outbound('sticky_guide')}>Free guide</a>
    </div>
  )
}
