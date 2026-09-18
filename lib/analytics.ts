/**
 * Same GA4 property and Meta pixel as mapltours.com, so a visit that starts
 * here and books there is one journey. The scripts load only when the visitor
 * has not asked not to be tracked (DNT or Global Privacy Control), and only
 * after the page is interactive, so they never compete with the hero.
 */
export const GA_ID = 'G-2JVWPL4GBE'
export const PIXEL_ID = '1607953960710055'

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

export function lead(source: string): void {
  event('generate_lead', { lead_source: source })
  try { window.fbq?.('track', 'Lead', { content_name: source }) } catch { /* no-op */ }
}

export function outbound(content: string, extra: Record<string, unknown> = {}): void {
  event('bio_click', { content, ...extra })
}
