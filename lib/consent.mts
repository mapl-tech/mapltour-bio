/**
 * Consent for measurement and advertising, for visitors in the UK, the EU and
 * the EEA (owner, Nov 14 2026: "Build a consent prompt").
 *
 * This is the bio page's copy of the rule the main site keeps in its
 * lib/consent.ts. The two sites share one answer: the cookie `mapl_consent`
 * is written for .mapltours.com, so a visitor who answers here is not asked
 * again on mapltours.com, and the other way round. Keep the cookie's name and
 * format, the country list and `decide` identical in both repos;
 * tests/consent.test.mts pins them to the same table the main site's
 * tests/unit/consent.spec.ts uses.
 *
 * Pure: no window, document or navigator here, so the tests run it as it is
 * (lib/consent-browser.mts is the half that touches the page).
 */
export const CONSENT_COOKIE = 'mapl_consent'

/** Where consent is asked for first. ISO 3166-1 alpha-2, as the geo function gives them. */
export const CONSENT_COUNTRIES: readonly string[] = [
  // The 27 member states of the European Union.
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // Parts of member states that have a code of their own and are inside the EU.
  'AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF',
  // The rest of the European Economic Area, where the same rules apply.
  'IS', 'LI', 'NO',
  // The United Kingdom, its Crown dependencies and Gibraltar.
  'GB', 'JE', 'GG', 'IM', 'GI',
  // Switzerland: outside the EEA, but Google's EU user consent policy has
  // covered visitors there since July 2024, and two of the tags are Google's.
  'CH',
]

/**
 * Time zones outside "Europe/" that belong to the region, for when the
 * country is not known: Iceland; Spain's Canaries, Ceuta and Melilla;
 * Portugal's Madeira and Azores; Cyprus (whose zone is filed under Asia);
 * and the French territories in the list above (French Guiana, Guadeloupe,
 * Martinique, Saint-Martin, Reunion, Mayotte).
 */
export const REGION_ZONES_OUTSIDE_EUROPE: readonly string[] = [
  'Atlantic/Reykjavik', 'Atlantic/Canary', 'Africa/Ceuta', 'Atlantic/Madeira', 'Atlantic/Azores',
  'Asia/Nicosia', 'Asia/Famagusta',
  'America/Cayenne', 'America/Guadeloupe', 'America/Martinique', 'America/Marigot', 'Indian/Reunion', 'Indian/Mayotte',
]
/**
 * Clocks that say nothing about where the visitor is: a browser set to hide
 * its time zone reports UTC wherever it is (Firefox's fingerprinting
 * protection, Tor Browser). They count as "not known".
 */
const PLACELESS_ZONE = /^(UTC|GMT|Etc\/.*)$/i
/**
 * Two-letter answers a lookup can give that are not countries. "UK" and "EU"
 * are not ISO codes but mean the region ("the United Kingdom", "somewhere in
 * the EU"). The others say the place is not known.
 */
const REGION_ALIASES = ['UK', 'EU']
const PLACELESS_CODES = ['XX', 'ZZ', 'AP']

/** The lookup's answer as a country code we can go by, or null when it names no country. */
export function knownCountry(country: string | null | undefined): string | null {
  const c = typeof country === 'string' ? country.trim().toUpperCase() : ''
  return /^[A-Z]{2}$/.test(c) && !PLACELESS_CODES.includes(c) ? c : null
}

export type ConsentAnswer = 'yes' | 'no'
/** What the cookie can hold: an answer, or "na" for a visitor outside the region. */
export type StoredConsent = ConsentAnswer | 'na'
export type ConsentDecision = 'allow' | 'deny' | 'ask' | 'wait'

/** An answer is asked for again after this long. */
export const ANSWER_MAX_AGE_S = 180 * 86_400
/** "Outside the region" is looked up again after this long. */
export const NA_MAX_AGE_S = 86_400

/**
 * Is this visitor in the region? The country when it is known; the browser's
 * time zone when it is not; and yes when neither is known, because asking
 * somebody who did not need to be asked costs a tap, and not asking somebody
 * who did is the thing this exists to stop.
 */
export function inConsentRegion(country: string | null | undefined, timeZone: string | null | undefined): boolean {
  const c = knownCountry(country)
  if (c) return REGION_ALIASES.includes(c) || CONSENT_COUNTRIES.includes(c)
  const tz = typeof timeZone === 'string' ? timeZone.trim() : ''
  if (!tz || PLACELESS_ZONE.test(tz)) return true
  return tz.startsWith('Europe/') || REGION_ZONES_OUTSIDE_EUROPE.includes(tz)
}

/** The cookie's value while it is still good, or null. Never throws. */
export function readConsentCookie(cookie: string | null | undefined, nowMs: number = Date.now()): StoredConsent | null {
  const m = /(?:^|;\s*)mapl_consent=(yes|no|na)\.(\d{9,11})(?=;|$)/.exec(typeof cookie === 'string' ? cookie : '')
  if (!m) return null
  const state = m[1] as StoredConsent
  const ageMs = nowMs - Number(m[2]) * 1000
  // Five minutes of clock slack; a stamp further in the future is not one we wrote.
  if (!(ageMs >= -300_000)) return null
  const maxMs = (state === 'na' ? NA_MAX_AGE_S : ANSWER_MAX_AGE_S) * 1000
  return ageMs <= maxMs ? state : null
}

/** The Set-Cookie text for document.cookie. Shared across mapltours.com and its subdomains; host-only anywhere else. */
export function consentCookie(state: StoredConsent, hostname: string, secure: boolean, nowMs: number = Date.now()): string {
  const maxAge = state === 'na' ? NA_MAX_AGE_S : ANSWER_MAX_AGE_S
  const domain = /(^|\.)mapltours\.com$/i.test(String(hostname ?? '')) ? '; Domain=.mapltours.com' : ''
  return `${CONSENT_COOKIE}=${state}.${Math.floor(nowMs / 1000)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}${domain}`
}

/**
 * The one rule. `optedOut` is Do Not Track or Global Privacy Control, which
 * wins over everything, a "yes" included. `region` is null until it has been
 * worked out for this page.
 */
export function decide(input: { optedOut: boolean; stored: StoredConsent | null; region: boolean | null }): ConsentDecision {
  if (input.optedOut) return 'deny'
  if (input.stored === 'yes') return 'allow'
  if (input.stored === 'no') return 'deny'
  if (input.stored === 'na') return 'allow'
  if (input.region === null) return 'wait'
  return input.region ? 'ask' : 'allow'
}

/** First-party cookies the tags leave behind, removed when a visitor who had said yes says no. */
export const TRACKER_COOKIE_PATTERNS: readonly RegExp[] = [/^_ga($|_)/, /^_gid$/, /^_gat($|_)/, /^_gac_/, /^_gcl_/, /^_fbp$/, /^_fbc$/, /^_hj/]

/** The names in a cookie string that belong to the tags. */
export function trackerCookieNames(cookie: string | null | undefined): string[] {
  return String(cookie ?? '')
    .split(';')
    .map((part) => part.split('=')[0].trim())
    .filter((name) => name && TRACKER_COOKIE_PATTERNS.some((re) => re.test(name)))
}

/** What to assign to document.cookie, one at a time, to expire the tags' cookies on this host and on the shared domain. */
export function trackerCookieExpiries(cookie: string | null | undefined, hostname: string): string[] {
  const domains = /(^|\.)mapltours\.com$/i.test(String(hostname ?? '')) ? ['; Domain=.mapltours.com', ''] : ['']
  return trackerCookieNames(cookie).flatMap((name) => domains.map((d) => `${name}=; Path=/; Max-Age=0${d}`))
}
