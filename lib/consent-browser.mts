import {
  consentCookie, decide, inConsentRegion, knownCountry, readConsentCookie, trackerCookieExpiries,
  type ConsentAnswer, type ConsentDecision, type StoredConsent,
} from './consent.mts'
import { LEADS_KEY } from './trackers.mts'

/**
 * The half of the consent rule that touches the page (lib/consent.mts is the
 * rule itself). Relative imports and no JSX, so tests/consent.test.mts runs
 * this file as it is against a stand-in for the browser.
 *
 * One cookie, shared with mapltours.com. Nothing is stored for a visitor in
 * the UK, the EU or the EEA until they answer. The visitor's country is asked
 * of this site's own /api/geo, once per page load, and only when no answer
 * is on record.
 *
 * Everything on this page that measures or advertises asks one question,
 * lib/analytics `trackingAllowed`, and that asks `consentBlocksTracking`
 * here: the tags, every event, a lead's event id, and through that id the
 * server's Lead and the memory of which addresses were reported. A new path
 * must ask too.
 */
const CHANGE_EVENT = 'mapl:consent'
const OPEN_EVENT = 'mapl:consent-open'

/** Whether this page load has placed the visitor: true in the region, false outside it, null not yet. */
let regionNow: boolean | null = null
let lookup: Promise<boolean> | null = null
/**
 * The answer given on this page, kept only when the browser did not keep the
 * cookie (cookies refused, or the write did not take): it then stands for the
 * page, ahead of whatever older cookie can still be read, and the question is
 * put again on the next. Null whenever the cookie holds the answer, so that
 * an answer given later in another tab is the one that counts.
 */
let answerNow: ConsentAnswer | null = null
/** The button a visitor opened the question from, handed to whoever shows it so the keyboard can go back there. */
let opener: HTMLElement | null = null

const inBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined'

/** Do Not Track or Global Privacy Control: nothing here overrides either. */
export function browserOptedOut(): boolean {
  try {
    if (typeof navigator === 'undefined') return true
    return navigator.doNotTrack === '1' || (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  } catch {
    return false
  }
}

/** What the cookie says, or null. Never throws (a sandboxed frame refuses document.cookie). */
function cookieSays(): StoredConsent | null {
  try {
    return readConsentCookie(document.cookie)
  } catch {
    return null
  }
}

/** The visitor's answer: the cookie's, or, where the browser did not keep the cookie, the one given on this page; or null. Never throws. */
export function storedConsent(): StoredConsent | null {
  if (!inBrowser()) return null
  return answerNow ?? cookieSays()
}

/**
 * The visitor's answer, with one thing remembered: a visitor read as "outside
 * the region" is placed there for the rest of the page. That cookie lasts a
 * day and can lapse while the page is open; without this the page would fall
 * back to "not placed" in the middle of a visit.
 */
function answerAndPlace(): StoredConsent | null {
  const stored = storedConsent()
  if (stored === 'na' && regionNow === null) regionNow = false
  return stored
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/** What to do right now, without waiting for anything. The tags wait on 'wait'. */
export function consentDecision(optedOut: boolean): ConsentDecision {
  return decide({ optedOut, stored: answerAndPlace(), region: regionNow })
}

/**
 * True while measurement and advertising must stay off for want of a yes.
 * Until the visitor has been placed that is everybody: nothing here guesses.
 * The one path that could come before the answer, a code asked for in the
 * page's first moments, waits for it instead (`settleConsent`).
 */
export function consentBlocksTracking(): boolean {
  if (!inBrowser()) return true
  try {
    return decide({ optedOut: false, stored: answerAndPlace(), region: regionNow }) !== 'allow'
  } catch {
    return true
  }
}

/**
 * Resolves once the visitor has been placed, so what follows can ask
 * `consentBlocksTracking` and get the real answer. At once when an answer on
 * record already decides it, and at once for a browser that sends Do Not
 * Track or Global Privacy Control, which is never tracked wherever it is;
 * otherwise when the country lookup comes back, GEO_TIMEOUT_MS at most.
 * Never rejects.
 */
export function settleConsent(): Promise<void> {
  if (!inBrowser() || browserOptedOut()) return Promise.resolve()
  if (decide({ optedOut: false, stored: answerAndPlace(), region: regionNow }) !== 'wait') return Promise.resolve()
  return resolveRegion().then(() => {}, () => {})
}

function writeCookie(state: StoredConsent): void {
  try {
    document.cookie = consentCookie(state, location.hostname, location.protocol === 'https:')
  } catch {
    // Cookies refused: an answer lasts for this page (answerNow), and is asked for again on the next.
  }
}

/** How long the country lookup may take before the clock decides instead. A code request waits this long at most. */
export const GEO_TIMEOUT_MS = 3000

/** This site's geo function (netlify/functions/geo.mts): Netlify's country for the visitor, or null. */
export async function countryFromGeoFunction(timeoutMs: number = GEO_TIMEOUT_MS): Promise<string | null> {
  const res = await fetch('/api/geo', { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  if (!res.ok) return null
  const j = (await res.json()) as { country?: unknown }
  return typeof j.country === 'string' && j.country ? j.country : null
}

/**
 * Works out, once per page load, whether the visitor is in the region. A
 * visitor the lookup places outside it gets the one-day "na" cookie. A
 * visitor inside it, or placed by the clock alone because the lookup failed,
 * gets nothing stored, and is looked up again on the next page.
 */
export function resolveRegion(countryOf: () => Promise<string | null> = countryFromGeoFunction): Promise<boolean> {
  if (regionNow !== null) return Promise.resolve(regionNow)
  if (!lookup) {
    lookup = (async () => {
      let country: string | null = null
      try {
        country = await countryOf()
      } catch {
        country = null
      }
      const region = inConsentRegion(country, browserTimeZone())
      regionNow = region
      if (!region && knownCountry(country) !== null && storedConsent() === null) writeCookie('na')
      return region
    })()
  }
  return lookup
}

/**
 * Takes out what measurement left on the device: the tags' own cookies, and
 * this page's memory of which addresses it reported (LEADS_KEY). On a no,
 * and on arriving with a no already given (on mapltours.com, say, where this
 * page's storage could not be reached).
 */
export function clearMeasurementStorage(): void {
  if (!inBrowser()) return
  try {
    for (const expiry of trackerCookieExpiries(document.cookie, location.hostname)) document.cookie = expiry
  } catch {
    // Nothing to clear, or cookies refused.
  }
  try {
    window.localStorage.removeItem(LEADS_KEY)
  } catch {
    // Storage refused: there was nothing kept.
  }
}

/** Records the visitor's answer and tells everything that is listening. A no also clears what measurement left on the device. */
export function setConsent(answer: ConsentAnswer): void {
  if (!inBrowser()) return
  writeCookie(answer)
  answerNow = cookieSays() === answer ? null : answer
  if (answer === 'no') clearMeasurementStorage()
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // An old browser without Event(): the next page load reads the cookie.
  }
}

export function onConsentChange(listener: () => void): () => void {
  if (!inBrowser()) return () => {}
  window.addEventListener(CHANGE_EVENT, listener)
  return () => window.removeEventListener(CHANGE_EVENT, listener)
}

/**
 * The footer's "Cookie preferences": asks the page to show the question now.
 * `from` is the button itself. Safari does not give a button the focus when
 * it is clicked or tapped, so "whatever has the focus" would be nothing
 * there.
 */
export function requestConsentPrompt(from?: HTMLElement | null): void {
  if (!inBrowser()) return
  opener = from ?? null
  try {
    window.dispatchEvent(new Event(OPEN_EVENT))
  } catch {
    // No Event(): nothing opens.
  }
}

export function onConsentPromptRequest(listener: (from: HTMLElement | null) => void): () => void {
  if (!inBrowser()) return () => {}
  const heard = () => {
    const from = opener
    opener = null
    listener(from)
  }
  window.addEventListener(OPEN_EVENT, heard)
  return () => window.removeEventListener(OPEN_EVENT, heard)
}

/**
 * Keeps a listener told of the decision for as long as the page is open, and
 * is the one place that decides when to look the visitor's country up.
 *
 *  - It reads the decision at once, and whenever it reads "wait" it makes
 *    sure a lookup is running: at load, and again if an answer on record
 *    lapses while the page is open. "Wait" is never left standing.
 *  - It reads again on an answer, when the tab is looked at again and when
 *    the page comes back from the back/forward cache, because the answer is
 *    a cookie and another tab (or mapltours.com) can change it.
 *  - A visitor who arrives having already said no has what measurement left
 *    on the device cleared once, here.
 *
 * Returns `read`, to read on demand, and `stop`.
 */
export function watchConsent(
  onDecision: (decision: ConsentDecision) => void,
  optedOut: () => boolean = browserOptedOut,
  countryOf: () => Promise<string | null> = countryFromGeoFunction,
): { read: () => void; stop: () => void } {
  if (!inBrowser()) return { read: () => {}, stop: () => {} }
  let gone = false
  const read = () => {
    if (gone) return
    const decision = consentDecision(optedOut())
    if (decision === 'wait') void resolveRegion(countryOf).then(read, read)
    onDecision(decision)
  }
  if (storedConsent() === 'no') clearMeasurementStorage()
  read()
  const offChange = onConsentChange(read)
  const onVisible = () => { if ((document as Document).visibilityState === 'visible') read() }
  const onShow = (e: Event) => { if ((e as PageTransitionEvent).persisted) read() }
  try {
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onShow)
  } catch {
    // No such events here: the decision is still read at load, on an answer and on demand.
  }
  return {
    read,
    stop: () => {
      gone = true
      offChange()
      try {
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('pageshow', onShow)
      } catch {
        // Nothing was listening.
      }
    },
  }
}
