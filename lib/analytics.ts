/**
 * The bio page's own GA4 property and Meta pixel, so its traffic and leads
 * are reported on their own and the UTM tags on every outbound link carry
 * the journey over to mapltours.com. The scripts load only when the visitor
 * has not asked not to be tracked (DNT or Global Privacy Control), and only
 * after the page is interactive, so they never compete with the hero.
 */
export const GA_ID = 'G-4H9FL0R9VM'
export const PIXEL_ID = '1060325803564034'

type Gtag = (...args: unknown[]) => void
type Fbq = (...args: unknown[]) => void

declare global {
  interface Window { gtag?: Gtag; fbq?: Fbq; dataLayer?: unknown[] }
}

export function trackingAllowed(): boolean {
  if (typeof navigator === 'undefined') return false
  const n = navigator as Navigator & { globalPrivacyControl?: boolean }
  return navigator.doNotTrack !== '1' && n.globalPrivacyControl !== true
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

export function lead(source: string, eventId?: string): void {
  event('generate_lead', { lead_source: source })
  try { window.fbq?.('track', 'Lead', { content_name: source }, eventId ? { eventID: eventId } : undefined) } catch { /* no-op */ }
}

export function outbound(content: string, extra: Record<string, unknown> = {}): void {
  event('bio_click', { content, ...extra })
}
