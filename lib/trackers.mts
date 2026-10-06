/**
 * GA4 and the Meta pixel on this page, written as plain functions of the
 * window, document and navigator they touch, so the tests run them against
 * fakes (tests/trackers.test.mts) and lib/analytics.ts runs them against the
 * real ones.
 *
 * The pixel is the main site's dataset "MAPL Tours Jamaica" 1607953960710055,
 * the one the Meta ads are measured and optimised on (Oct 2026: the person
 * who runs the ads asked for one pixel, the one ending 0055). Nothing here
 * fires the page's old pixel (the bio dataset, id ending 4034) any more; a
 * test fails if its id appears in the page code. The server half of
 * the Lead is netlify/lib/meta-capi.mts, sent to this same PIXEL_ID with the
 * same event id.
 *
 * startTrackers runs once per page, whoever calls it first: Trackers after
 * the load event and an idle moment, or reportLead when a visitor gets the
 * code before then. So there is one GA config, one pixel init and one
 * PageView, and a lead is never lost for arriving early.
 *
 * The pixel stub is Meta's base code: it queues calls until fbevents.js has
 * loaded and from then on hands each call to the library's callMethod. The
 * library reads the queue once, when it loads, and never again, so the stub
 * this replaced (it only ever queued) kept every later call to itself: no
 * Lead from this page ever reached Meta from the browser.
 */
export const GA_ID = 'G-4H9FL0R9VM'
export const PIXEL_ID = '1607953960710055'
/**
 * The only host that loads tags. A local build, a deploy preview or any other
 * copy of the page stays out of the dataset the ads optimise on: test visits
 * and test sign-ups there would count as real ones (mapltours.com's dev
 * server sent that dataset 443 events in September 2026).
 */
export const LIVE_HOST = 'bio.mapltours.com'
export const GA_SRC = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
export const PIXEL_SRC = 'https://connect.facebook.net/en_US/fbevents.js'

export type Fbq = ((...args: unknown[]) => void) & {
  /** Set by fbevents.js when it loads. */
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  loaded: boolean
  version: string
  push: unknown
}

/** The parts of the browser these functions touch, so a test can fake them. */
export type TrackerWindow = {
  dataLayer?: unknown[]
  gtag?: (...args: unknown[]) => void
  fbq?: Fbq
  _fbq?: Fbq
  /** Set by the first startTrackers on the page. */
  __maplTrackers?: boolean
  location?: { hostname?: string }
}
export type TrackerDocument = {
  createElement(tag: 'script'): { async: boolean; src: string }
  head: { appendChild(el: unknown): unknown }
}
export type TrackerNavigator = { doNotTrack?: string | null; globalPrivacyControl?: boolean }

/**
 * No tracker for a visitor who asked not to be tracked (Do Not Track or
 * Global Privacy Control), and none anywhere but the live page.
 */
export function trackingAllowed(nav: TrackerNavigator | undefined, host: string | undefined): boolean {
  return !!nav && host === LIVE_HOST && nav.doNotTrack !== '1' && nav.globalPrivacyControl !== true
}

/** The parts of the window the start schedule touches, so a test can fake them. */
export type ScheduleWindow = {
  document: { readyState: string }
  addEventListener(type: 'load', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'load', listener: () => void): void
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => unknown
  setTimeout(callback: () => void, ms: number): unknown
}

/**
 * Runs `go` after the load event and then an idle moment (at most 4 s
 * later; 1.2 s where requestIdleCallback is missing, as on Safari), so on a
 * slow connection the page's own images and clips are never behind the tag
 * scripts. Returns the cleanup for a component that unmounts before load.
 */
export function afterLoadAndIdle(w: ScheduleWindow, go: () => void): () => void {
  const idle = () => {
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(go, { timeout: 4000 })
    else w.setTimeout(go, 1200)
  }
  if (w.document.readyState === 'complete') {
    idle()
    return () => {}
  }
  w.addEventListener('load', idle, { once: true })
  return () => w.removeEventListener('load', idle)
}

function addScript(d: TrackerDocument, src: string): void {
  const s = d.createElement('script')
  s.async = true
  s.src = src
  d.head.appendChild(s)
}

/**
 * GA4 and the pixel, once per page. False when tracking is not allowed
 * (nothing is created at all), true once they are running.
 */
export function startTrackers(w: TrackerWindow, d: TrackerDocument, nav: TrackerNavigator | undefined): boolean {
  if (!trackingAllowed(nav, w.location?.hostname)) return false
  if (w.__maplTrackers) return true
  w.__maplTrackers = true

  w.dataLayer = w.dataLayer || []
  // gtag.js wants the arguments object itself, not an array.
  // eslint-disable-next-line prefer-rest-params
  w.gtag = w.gtag || function gtag() { (w.dataLayer = w.dataLayer || []).push(arguments) }
  w.gtag('js', new Date())
  w.gtag('config', GA_ID, { send_page_view: true })
  addScript(d, GA_SRC)

  if (!w.fbq) {
    const f = function (...args: unknown[]) {
      if (f.callMethod) f.callMethod.apply(f, args)
      else f.queue.push(args)
    } as Fbq
    f.queue = []
    f.loaded = true
    f.version = '2.0'
    f.push = f
    w.fbq = f
    if (!w._fbq) w._fbq = f
    addScript(d, PIXEL_SRC)
  }
  // No automatic events or automatic matching here, before init as Meta
  // requires. The dataset's settings turn both on, and with them a button
  // tap after typing into the code form, without sending it, posted the
  // hashed address on to the dataset's server-side relay. The page promises
  // the hashed email only for a code request, and the server's Lead carries
  // it then.
  w.fbq('set', 'autoConfig', false, PIXEL_ID)
  w.fbq('init', PIXEL_ID)
  w.fbq('track', 'PageView')
  return true
}

/**
 * Which addresses this browser has already reported as a lead, so asking
 * again (a reload brings the form back) sends the code again but is not a
 * second lead: the ads optimise on Leads, and 16 server Leads in September
 * were 14 people. Kept as SHA-256 prefixes of the trimmed, lowercased
 * address, never the address, in localStorage under LEADS_KEY.
 */
export const LEADS_KEY = 'mapl-bio-leads'
export type LeadStore = { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** The address's key (16 hex characters of its SHA-256), or null where hashing is unavailable. */
export async function leadKey(email: string, subtle: SubtleCrypto | null = globalThis.crypto?.subtle ?? null): Promise<string | null> {
  try {
    if (!subtle) return null
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
    return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

function readKeys(store: LeadStore): string[] {
  const list: unknown = JSON.parse(store.getItem(LEADS_KEY) || '[]')
  return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []
}

/** This browser already reported this address. False whenever it cannot tell. */
export function leadSeen(store: LeadStore | undefined, key: string | null): boolean {
  if (!store || !key) return false
  try { return readKeys(store).includes(key) } catch { return false }
}

/** Remember a reported address (the last 20). Storage off or full: the next request may count again, nothing worse. */
export function rememberLead(store: LeadStore | undefined, key: string | null): void {
  if (!store || !key) return
  let keys: string[] = []
  try { keys = readKeys(store) } catch { /* unreadable: start the list again */ }
  try { store.setItem(LEADS_KEY, JSON.stringify([...keys.filter((k) => k !== key), key].slice(-20))) } catch { /* no-op */ }
}

/**
 * A visitor got the code: GA4's generate_lead and the pixel's Lead, with the
 * event id the page also sent to /api/lead, so Meta counts the browser's
 * Lead and the server's as one. Starts the trackers first if they have not
 * started yet. Nothing at all when tracking is not allowed.
 */
export function reportLead(w: TrackerWindow, d: TrackerDocument, nav: TrackerNavigator | undefined, source: string, eventId?: string): void {
  if (!startTrackers(w, d, nav)) return
  try { w.gtag?.('event', 'generate_lead', { lead_source: source }) } catch { /* no-op */ }
  try { w.fbq?.('track', 'Lead', { content_name: source }, eventId ? { eventID: eventId } : undefined) } catch { /* no-op */ }
}
