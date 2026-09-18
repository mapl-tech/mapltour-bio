'use client'

import { useEffect, useState } from 'react'
import { outbound } from '@/lib/analytics'

/**
 * Phone only, one button. Hidden while the hero, the finder or the capture
 * form is on screen. It sits left so the bottom-right corner stays free.
 * On tap it scrolls to the finder and focuses the field, so the keyboard
 * opens on the same gesture.
 */
export default function StickyBar() {
  const [hidden, setHidden] = useState(true)
  useEffect(() => {
    const targets = ['top', 'price', 'guide'].map((id) => document.getElementById(id)).filter(Boolean) as Element[]
    if (!targets.length || typeof IntersectionObserver === 'undefined') { setHidden(false); return }
    const seen = new Map<Element, boolean>()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target, e.isIntersecting)
      setHidden([...seen.values()].some(Boolean))
    }, { threshold: 0.15 })
    targets.forEach((t) => io.observe(t))
    return () => io.disconnect()
  }, [])
  const go = (e: React.MouseEvent) => {
    e.preventDefault()
    outbound('sticky_price')
    const input = document.getElementById('finder-input') as HTMLInputElement | null
    document.getElementById('price')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => input?.focus({ preventScroll: true }), 450)
  }
  return (
    <div className="stickybar" data-hidden={hidden} aria-hidden={hidden}>
      <a className="btn btn-gold" href="#price" tabIndex={hidden ? -1 : 0} onClick={go}>Price my ride</a>
    </div>
  )
}
