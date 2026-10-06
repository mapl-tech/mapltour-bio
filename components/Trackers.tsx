'use client'

import { useEffect } from 'react'
import { startTrackers, trackingAllowed } from '@/lib/analytics'
import { afterLoadAndIdle, type ScheduleWindow } from '@/lib/trackers.mts'

/**
 * GA4 + Meta pixel (lib/trackers.mts), started only when tracking is
 * allowed, after the load event and once the main thread is idle
 * (afterLoadAndIdle), so on a slow connection the page's own images and
 * clips are never behind 240 KB of tag scripts. A visitor who asks for the
 * code before then starts them from lead() instead; they start once either
 * way (one init, one PageView).
 */
export default function Trackers() {
  useEffect(() => {
    if (!trackingAllowed()) return
    return afterLoadAndIdle(window as unknown as ScheduleWindow, () => startTrackers())
  }, [])
  return null
}
