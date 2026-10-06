import { reportLead, startTrackers as start, trackingAllowed as allowed, type TrackerDocument, type TrackerWindow } from '@/lib/trackers.mts'

/**
 * The bio page's own GA4 property, and the Meta pixel the ads are measured
 * on (the main site's dataset; lib/trackers.mts says why), so the page's
 * leads land where the campaigns optimise and the UTM tags on every outbound
 * link carry the journey over to mapltours.com. The scripts load only on the
 * live page (lib/trackers.mts LIVE_HOST), only when the visitor has not asked
 * not to be tracked (DNT or Global Privacy Control), and only after the page
 * is interactive, so they never compete with the hero, unless a visitor asks
 * for the code before then (lead()).
 */
export { GA_ID, PIXEL_ID } from '@/lib/trackers.mts'

type Gtag = (...args: unknown[]) => void
type Fbq = (...args: unknown[]) => void

declare global {
  interface Window { gtag?: Gtag; fbq?: Fbq; dataLayer?: unknown[] }
}

export function trackingAllowed(): boolean {
  if (typeof navigator === 'undefined' || typeof location === 'undefined') return false
  return allowed(navigator, location.hostname)
}

/** GA4 and the pixel, once per page (lib/trackers.mts). */
export function startTrackers(): void {
  if (typeof window === 'undefined') return
  start(window as unknown as TrackerWindow, document as unknown as TrackerDocument, navigator)
}

export function event(name: string, params: Record<string, unknown> = {}): void {
  try { window.gtag?.('event', name, params) } catch { /* no-op */ }
}

/**
 * One id per lead, shared by the browser pixel and the server's Conversions
 * API call so Meta counts the lead once. Undefined when tracking is off,
 * which also tells the server not to report it.
 */
export function newEventId(): string | undefined {
  if (!trackingAllowed()) return undefined
  try { return crypto.randomUUID() } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
}

/**
 * The visitor got the code (lib/useLead.ts, only after /api/lead answered
 * ok): generate_lead and the pixel's Lead with `eventId`, the id the page
 * sent to /api/lead. Starts the trackers itself when the visitor was quicker
 * than the idle start in Trackers, so an early lead is never lost.
 */
export function lead(source: string, eventId?: string): void {
  if (typeof window === 'undefined') return
  reportLead(window as unknown as TrackerWindow, document as unknown as TrackerDocument, navigator, source, eventId)
}

export function outbound(content: string, extra: Record<string, unknown> = {}): void {
  event('bio_click', { content, ...extra })
}
