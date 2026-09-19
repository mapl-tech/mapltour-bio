'use client'

import { useEffect, useState } from 'react'
import { offerLabel } from '@/lib/data'
import { outbound } from '@/lib/analytics'
import { useLead } from '@/lib/useLead'

/**
 * The offer, pinned to the bottom once the hero has scrolled away. Hidden
 * while the hero, the finder, the ride story, the tours row (it would sit on
 * a card's Book button) or the capture form is on screen, and gone for good
 * once the visitor has redeemed. It sits left so the bottom-right
 * corner stays free. On tap it scrolls to the capture form and focuses the
 * field, so the keyboard opens on the same gesture.
 */
export default function StickyBar() {
  const [hidden, setHidden] = useState(true)
  const L = useLead('bio_sticky')
  useEffect(() => {
    // The hero (#top) is position: sticky and the next section slides over it,
    // so geometrically it never leaves the viewport and an observer would keep
    // the bar hidden for the whole page. Judge the hero by how much of it the
    // curtain has covered instead: it counts as on screen until 85% is gone.
    const hero = document.getElementById('top')
    const targets = ['price', 'ride', 'tours', 'coupon'].map((id) => document.getElementById(id)).filter(Boolean) as Element[]
    if (typeof IntersectionObserver === 'undefined') { setHidden(false); return }
    const seen = new Map<Element, boolean>()
    let heroOnScreen = true
    const update = () => setHidden(heroOnScreen || [...seen.values()].some(Boolean))
    const onScroll = () => {
      heroOnScreen = !!hero && window.scrollY < hero.offsetHeight * 0.85
      update()
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target, e.isIntersecting)
      update()
    }, { threshold: 0.15 })
    targets.forEach((t) => io.observe(t))
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll) }
  }, [])
  const gone = hidden || L.state === 'done'
  const go = (e: React.MouseEvent) => {
    e.preventDefault()
    outbound('sticky_redeem')
    const input = document.getElementById('capture-email') as HTMLInputElement | null
    document.getElementById('coupon')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => input?.focus({ preventScroll: true }), 450)
  }
  return (
    <div className="stickybar" data-hidden={gone} aria-hidden={gone}>
      <span className="stickybar-text">{offerLabel()} off your first Jamaica tour</span>
      <a className="btn btn-gold" href="#coupon" tabIndex={gone ? -1 : 0} onClick={go}>Redeem {offerLabel()} OFF <span aria-hidden="true">&rarr;</span></a>
    </div>
  )
}
