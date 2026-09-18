'use client'

import { useEffect, useState } from 'react'
import { COUPON, money } from '@/lib/data'
import { outbound } from '@/lib/analytics'
import { useLead } from '@/lib/useLead'

/**
 * The offer, pinned to the bottom once the hero has scrolled away. Hidden
 * while the hero, the finder or the capture form is on screen, and gone for
 * good once the visitor has redeemed. It sits left so the bottom-right
 * corner stays free. On tap it scrolls to the capture form and focuses the
 * field, so the keyboard opens on the same gesture.
 */
export default function StickyBar() {
  const [hidden, setHidden] = useState(true)
  const L = useLead('bio_sticky')
  useEffect(() => {
    const targets = ['top', 'price', 'ride', 'guide'].map((id) => document.getElementById(id)).filter(Boolean) as Element[]
    if (!targets.length || typeof IntersectionObserver === 'undefined') { setHidden(false); return }
    const seen = new Map<Element, boolean>()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target, e.isIntersecting)
      setHidden([...seen.values()].some(Boolean))
    }, { threshold: 0.15 })
    targets.forEach((t) => io.observe(t))
    return () => io.disconnect()
  }, [])
  const gone = hidden || L.state === 'done'
  const go = (e: React.MouseEvent) => {
    e.preventDefault()
    outbound('sticky_redeem')
    const input = document.getElementById('capture-email') as HTMLInputElement | null
    document.getElementById('guide')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => input?.focus({ preventScroll: true }), 450)
  }
  return (
    <div className="stickybar" data-hidden={gone} aria-hidden={gone}>
      <span className="stickybar-text">{money(COUPON.value)} off your first Jamaica tour</span>
      <a className="btn btn-gold" href="#guide" tabIndex={gone ? -1 : 0} onClick={go}>Redeem {money(COUPON.value)} OFF <span aria-hidden="true">&rarr;</span></a>
    </div>
  )
}
