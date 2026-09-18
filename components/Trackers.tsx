'use client'

import { useEffect, useState } from 'react'
import { GA_ID, PIXEL_ID, trackingAllowed } from '@/lib/analytics'

/**
 * GA4 + Meta pixel, injected only when tracking is allowed, after the load
 * event and once the main thread is idle, so on a slow connection the
 * page's own images and clips are never behind 240 KB of tag scripts.
 */
export default function Trackers() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!trackingAllowed()) return
    const idle = () => { if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback(() => setOn(true), { timeout: 4000 }); else setTimeout(() => setOn(true), 1200) }
    if (document.readyState === 'complete') idle()
    else window.addEventListener('load', idle, { once: true })
    return () => window.removeEventListener('load', idle)
  }, [])
  useEffect(() => {
    if (!on) return
    window.dataLayer = window.dataLayer || []
    // eslint-disable-next-line prefer-rest-params
    window.gtag = window.gtag || function gtag() { window.dataLayer!.push(arguments) }
    window.gtag('js', new Date())
    window.gtag('config', GA_ID, { send_page_view: true })
    const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`; document.head.appendChild(s)

    const w = window as unknown as { fbq?: (...a: unknown[]) => void; _fbq?: unknown }
    if (!w.fbq) {
      const q: unknown[][] = []
      const f = ((...args: unknown[]) => { q.push(args) }) as ((...a: unknown[]) => void) & { queue?: unknown[][]; loaded?: boolean; version?: string; callMethod?: unknown; push?: unknown }
      f.queue = q; f.loaded = true; f.version = '2.0'; f.push = f
      w.fbq = f; w._fbq = f
      const p = document.createElement('script'); p.async = true; p.src = 'https://connect.facebook.net/en_US/fbevents.js'; document.head.appendChild(p)
    }
    w.fbq!('init', PIXEL_ID)
    w.fbq!('track', 'PageView')
  }, [on])
  return null
}
