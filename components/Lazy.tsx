'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Renders children once the box is within `margin` of the viewport. Chrome's
 * native lazy loading prefetches several screens ahead on slow links, which
 * is exactly where every below-fold image competes with the hero; an
 * observer with a fixed margin does not. Without IntersectionObserver the
 * children render at once. The wrapper fills its positioned parent.
 */
export default function Lazy({ children, margin = '400px 0px', className, fill = true }: { children: ReactNode; margin?: string; className?: string; fill?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (seen) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [seen, margin])
  return <div ref={ref} className={className} style={fill ? { position: 'absolute', inset: 0 } : undefined}>{seen ? children : null}</div>
}
