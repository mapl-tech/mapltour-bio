import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ANSWER_MAX_AGE_S, CONSENT_COOKIE, CONSENT_COUNTRIES, NA_MAX_AGE_S, REGION_ZONES_OUTSIDE_EUROPE, consentCookie, decide, inConsentRegion, knownCountry,
  readConsentCookie, trackerCookieExpiries, trackerCookieNames, type ConsentDecision, type StoredConsent,
} from '../lib/consent.mts'
import { GA_ID, LEADS_KEY, LIVE_HOST, reportLead, setTrackersRunning, startTrackers, trackingAllowed, type TrackerDocument, type TrackerWindow } from '../lib/trackers.mts'

/**
 * The cookie question for visitors in the UK, the EU and the EEA (owner,
 * Nov 14 2026: "Build a consent prompt"). Three parts: the rule
 * (lib/consent.mts), the half that touches the browser
 * (lib/consent-browser.mts, run here against a stand-in for one), and the
 * page around them, where a later edit could quietly undo it.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')

// ───────────────────────── The rule ─────────────────────────

test('the region is the EU, the rest of the EEA, the UK with its dependencies, and Switzerland; the same list mapltours.com asks', () => {
  // This exact string is also in the main site's tests/unit/consent.spec.ts: one answer serves both sites, so one list.
  assert.equal(CONSENT_COUNTRIES.join(','), 'AT,BE,BG,HR,CY,CZ,DK,EE,FI,FR,DE,GR,HU,IE,IT,LV,LT,LU,MT,NL,PL,PT,RO,SK,SI,ES,SE,AX,GF,GP,MQ,RE,YT,MF,IS,LI,NO,GB,JE,GG,IM,GI,CH')
  assert.equal(CONSENT_COUNTRIES.length, 43)
  assert.equal(new Set(CONSENT_COUNTRIES).size, 43)
  // Switzerland is asked because one of the tags is Google's, and Google's consent policy covers visitors there.
  for (const c of ['US', 'CA', 'JM', 'TR', 'AU', 'BR', 'MX', 'FO']) assert.equal(CONSENT_COUNTRIES.includes(c), false, c)
})

test('the clock rule covers every part of the list that keeps time outside "Europe/"', () => {
  // Without these, a visitor in Limassol or Saint-Denis whose lookup failed was placed outside the region.
  const where: Record<string, string> = {
    'Asia/Nicosia': 'CY', 'Asia/Famagusta': 'CY', 'Africa/Ceuta': 'ES', 'Atlantic/Canary': 'ES', 'Atlantic/Madeira': 'PT', 'Atlantic/Azores': 'PT',
    'Atlantic/Reykjavik': 'IS', 'America/Cayenne': 'GF', 'America/Guadeloupe': 'GP', 'America/Martinique': 'MQ', 'America/Marigot': 'MF', 'Indian/Reunion': 'RE', 'Indian/Mayotte': 'YT',
  }
  assert.deepEqual([...REGION_ZONES_OUTSIDE_EUROPE].sort(), Object.keys(where).sort())
  for (const [tz, country] of Object.entries(where)) {
    assert.equal(inConsentRegion(null, tz), true, tz)
    assert.ok(CONSENT_COUNTRIES.includes(country), tz)
  }
  for (const c of ['GF', 'GP', 'MQ', 'RE', 'YT', 'MF', 'CY', 'IS']) assert.ok(Object.values(where).includes(c), c)
  // Their neighbours are not swept in with them.
  for (const tz of ['Asia/Beirut', 'Africa/Casablanca', 'America/Paramaribo', 'America/St_Lucia', 'Indian/Mauritius', 'Atlantic/Faroe', 'Atlantic/Bermuda']) assert.equal(inConsentRegion(null, tz), false, tz)
})

test('a two-letter answer that is not a country: "UK" and "EU" mean the region, and the placeholders mean "not known"', () => {
  assert.equal(inConsentRegion('UK', 'America/Toronto'), true)
  assert.equal(inConsentRegion('EU', 'America/Toronto'), true)
  assert.equal(inConsentRegion('eu', null), true)
  for (const code of ['XX', 'ZZ', 'AP', 'A1', 'O1', 'T1']) {
    assert.equal(knownCountry(code), null, code)
    assert.equal(inConsentRegion(code, 'Europe/Berlin'), true, code) // the clock decides
    assert.equal(inConsentRegion(code, 'America/Toronto'), false, code)
  }
  assert.equal(knownCountry(' gb '), 'GB')
  assert.equal(knownCountry('US'), 'US')
  for (const bad of [null, undefined, '', 'GBR', '1', 12 as unknown as string]) assert.equal(knownCountry(bad), null, String(bad))
})

test('the country decides when it is known; the clock only when it is not; and nobody known to be nowhere is waved through', () => {
  // Known country: the clock is not asked.
  assert.equal(inConsentRegion('GB', 'America/New_York'), true)
  assert.equal(inConsentRegion('US', 'Europe/London'), false)
  assert.equal(inConsentRegion(' fr ', null), true)
  assert.equal(inConsentRegion('JM', 'Europe/Paris'), false)
  // Not known (the lookup failed, or answered something that is not a country code): the clock.
  for (const c of [null, undefined, '', 'XYZ', '1', 'G']) {
    assert.equal(inConsentRegion(c, 'Europe/Berlin'), true, String(c))
    assert.equal(inConsentRegion(c, 'Atlantic/Reykjavik'), true, String(c))
    assert.equal(inConsentRegion(c, 'Atlantic/Canary'), true, String(c))
    assert.equal(inConsentRegion(c, 'America/Toronto'), false, String(c))
    assert.equal(inConsentRegion(c, 'America/Jamaica'), false, String(c))
    assert.equal(inConsentRegion(c, 'Atlantic/Bermuda'), false, String(c))
  }
  // Neither known: asked. A clock that hides its place (UTC, as a private browser reports) is not a place.
  for (const tz of [null, undefined, '', '  ', 'UTC', 'Etc/UTC', 'GMT', 'Etc/GMT+5', 'utc']) assert.equal(inConsentRegion(null, tz), true, String(tz))
})

test('the one rule: the browser\'s own opt-out wins, then a stored answer, then where the visitor is', () => {
  const table: Array<[boolean, StoredConsent | null, boolean | null, ConsentDecision]> = [
    // Do Not Track or Global Privacy Control beats everything, a yes included.
    [true, 'yes', false, 'deny'], [true, 'na', false, 'deny'], [true, null, null, 'deny'], [true, null, true, 'deny'],
    // An answer stands wherever the visitor is now.
    [false, 'yes', true, 'allow'], [false, 'yes', null, 'allow'], [false, 'no', false, 'deny'], [false, 'no', null, 'deny'],
    // Placed outside the region within the last day.
    [false, 'na', null, 'allow'], [false, 'na', true, 'allow'],
    // No answer: nothing until placed, then asked inside the region and left alone outside it.
    [false, null, null, 'wait'], [false, null, true, 'ask'], [false, null, false, 'allow'],
  ]
  for (const [optedOut, stored, region, want] of table) assert.equal(decide({ optedOut, stored, region }), want, JSON.stringify({ optedOut, stored, region }))
})

test('the cookie: one name, an answer and when it was given, good for 180 days (a day for "outside the region")', () => {
  const now = Date.UTC(2026, 10, 14, 12)
  const stamp = Math.floor(now / 1000)
  assert.equal(CONSENT_COOKIE, 'mapl_consent')
  assert.equal(ANSWER_MAX_AGE_S, 15_552_000)
  assert.equal(NA_MAX_AGE_S, 86_400)
  for (const state of ['yes', 'no', 'na'] as const) {
    assert.equal(readConsentCookie(`mapl_consent=${state}.${stamp}`, now), state)
    assert.equal(readConsentCookie(`_ga=GA1.1.1.2; mapl_consent=${state}.${stamp}; other=1`, now), state)
  }
  // Age: an answer lasts 180 days and not a second more; "outside the region" one day.
  const day = 86_400_000
  assert.equal(readConsentCookie(`mapl_consent=yes.${stamp}`, now + 180 * day), 'yes')
  assert.equal(readConsentCookie(`mapl_consent=yes.${stamp}`, now + 180 * day + 1000), null)
  assert.equal(readConsentCookie(`mapl_consent=no.${stamp}`, now + 181 * day), null)
  assert.equal(readConsentCookie(`mapl_consent=na.${stamp}`, now + day), 'na')
  assert.equal(readConsentCookie(`mapl_consent=na.${stamp}`, now + day + 1000), null)
  // A stamp from the future is not one we wrote (five minutes of clock slack).
  assert.equal(readConsentCookie(`mapl_consent=yes.${stamp + 299}`, now), 'yes')
  assert.equal(readConsentCookie(`mapl_consent=yes.${stamp + 301}`, now), null)
  // Anything else is no answer, and nothing throws.
  for (const bad of [null, undefined, '', 'mapl_consent=', 'mapl_consent=yes', 'mapl_consent=maybe.1789000000', 'mapl_consent=yes.abc', 'xmapl_consent=yes.1789000000', 'mapl_consent=yes.1789000000x', 'mapl_consent=YES.1789000000', 42 as unknown as string, {} as unknown as string]) {
    assert.equal(readConsentCookie(bad, now), null, String(bad))
  }
})

test('the cookie is shared by mapltours.com and this page, and by nothing else', () => {
  const now = Date.UTC(2026, 10, 14, 12)
  const stamp = Math.floor(now / 1000)
  assert.equal(consentCookie('yes', 'bio.mapltours.com', true, now), `mapl_consent=yes.${stamp}; Path=/; Max-Age=15552000; SameSite=Lax; Secure; Domain=.mapltours.com`)
  assert.equal(consentCookie('no', 'mapltours.com', true, now), `mapl_consent=no.${stamp}; Path=/; Max-Age=15552000; SameSite=Lax; Secure; Domain=.mapltours.com`)
  assert.equal(consentCookie('na', 'bio.mapltours.com', true, now), `mapl_consent=na.${stamp}; Path=/; Max-Age=86400; SameSite=Lax; Secure; Domain=.mapltours.com`)
  // A local build or a deploy preview keeps its answer to itself, and plain http gets no Secure flag (the browser would drop the cookie).
  assert.equal(consentCookie('yes', 'localhost', false, now), `mapl_consent=yes.${stamp}; Path=/; Max-Age=15552000; SameSite=Lax`)
  for (const host of ['6ac5abc--mapltours-bio.netlify.app', 'notmapltours.com', 'mapltours.com.example', 'evil-mapltours.com', '']) {
    assert.doesNotMatch(consentCookie('yes', host, true, now), /Domain=/, host)
  }
  // What is written is what is read back.
  assert.equal(readConsentCookie(consentCookie('no', 'bio.mapltours.com', true, now).split(';')[0], now), 'no')
})

test('the tags\' own cookies are known by name, and a no expires each one here and on the shared domain', () => {
  const jar = '_ga=GA1.1.1.2; _ga_4H9FL0R9VM=GS2.1.s1; _gid=1; _gat_gtag_G_1=1; _gcl_au=1.1.1; _fbp=fb.1.2.3; _fbc=fb.1.2.x; _hjSessionUser_1=a; _hjSession_1=b; mapl_consent=yes.1789000000; mapl_trip=x; theme=dark; _gaX=1'
  assert.deepEqual(trackerCookieNames(jar), ['_ga', '_ga_4H9FL0R9VM', '_gid', '_gat_gtag_G_1', '_gcl_au', '_fbp', '_fbc', '_hjSessionUser_1', '_hjSession_1'])
  assert.deepEqual(trackerCookieNames(''), [])
  assert.deepEqual(trackerCookieNames(null), [])
  assert.deepEqual(trackerCookieExpiries('_ga=1; _fbp=2; keep=3', 'bio.mapltours.com'), [
    '_ga=; Path=/; Max-Age=0; Domain=.mapltours.com', '_ga=; Path=/; Max-Age=0',
    '_fbp=; Path=/; Max-Age=0; Domain=.mapltours.com', '_fbp=; Path=/; Max-Age=0',
  ])
  assert.deepEqual(trackerCookieExpiries('_ga=1', 'localhost'), ['_ga=; Path=/; Max-Age=0'])
})

test('the tracking gate: consent still owed, or refused, starts nothing, queues nothing and reports no lead', () => {
  const page = () => {
    const scripts: unknown[] = []
    const d: TrackerDocument = { createElement: () => ({ async: false, src: '' }), head: { appendChild: (el) => { scripts.push(el); return el } } }
    const w: TrackerWindow = { location: { hostname: LIVE_HOST } }
    return { w, d, scripts }
  }
  assert.equal(trackingAllowed({ doNotTrack: null, consentBlocks: true }, LIVE_HOST), false)
  assert.equal(trackingAllowed({ doNotTrack: null, consentBlocks: false }, LIVE_HOST), true)
  // Each of the three says no by itself: the browser's two signals, and the answer.
  assert.equal(trackingAllowed({ doNotTrack: '1', consentBlocks: false }, LIVE_HOST), false)
  assert.equal(trackingAllowed({ globalPrivacyControl: true, consentBlocks: false }, LIVE_HOST), false)
  const { w, d, scripts } = page()
  assert.equal(startTrackers(w, d, { doNotTrack: null, consentBlocks: true }), false)
  reportLead(w, d, { doNotTrack: null, consentBlocks: true }, 'bio_hero', 'evt-12345678')
  assert.deepEqual(w, { location: { hostname: LIVE_HOST } })
  assert.deepEqual(scripts, [])
  // And a yes starts them exactly as before.
  assert.equal(startTrackers(w, d, { doNotTrack: null, consentBlocks: false }), true)
  assert.equal(scripts.length, 2)
})

test('tags that are already on the page can be switched off and back on without loading it again', () => {
  const scripts: unknown[] = []
  const d: TrackerDocument = { createElement: () => ({ async: false, src: '' }), head: { appendChild: (el) => { scripts.push(el); return el } } }
  const w = { location: { hostname: LIVE_HOST } } as TrackerWindow & Record<string, unknown>
  // Nothing to switch before they have started: no flag is set and nothing is created.
  setTrackersRunning(w, false)
  assert.deepEqual({ ...w }, { location: { hostname: LIVE_HOST } }) // a copy: the assertion would otherwise narrow w's type
  startTrackers(w, d, { doNotTrack: null, consentBlocks: false })
  const ga = () => (w.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>))
  const before = ga().length
  setTrackersRunning(w, false)
  // Google's documented off switch for the measurement id, its consent signal, and the pixel's.
  assert.equal(w[`ga-disable-${GA_ID}`], true)
  assert.deepEqual(ga()[before], ['consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }])
  assert.deepEqual(w.fbq!.queue[w.fbq!.queue.length - 1], ['consent', 'revoke'])
  setTrackersRunning(w, true)
  assert.equal(w[`ga-disable-${GA_ID}`], false)
  assert.deepEqual(ga()[before + 1], ['consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' }])
  assert.deepEqual(w.fbq!.queue[w.fbq!.queue.length - 1], ['consent', 'grant'])
  assert.equal(scripts.length, 2, 'no script is added twice')
})

// ───────────────────────── In the browser ─────────────────────────

type Browser = {
  jar: Map<string, string>
  writes: string[]
  storage: Map<string, string>
  events: string[]
  /** Fire an event the page listens for on the document or the window (visibilitychange, pageshow). */
  fire: (type: string, event?: Record<string, unknown>) => void
  /** How many listeners are still attached for an event. */
  listening: (type: string) => number
  restore: () => void
}

/**
 * A stand-in for the browser: a cookie jar that keeps and expires cookies as
 * a real one does (Max-Age=0 removes), localStorage, window events, the
 * clock's time zone and the page's address.
 */
function browser(opts: { hostname?: string; protocol?: string; timeZone?: string | null; cookies?: Record<string, string>; refuseCookies?: boolean; leads?: string } = {}): Browser {
  const jar = new Map(Object.entries(opts.cookies ?? {}))
  const writes: string[] = []
  const storage = new Map<string, string>(opts.leads ? [[LEADS_KEY, opts.leads]] : [])
  const events: string[] = []
  const listeners = new Map<string, Set<(e?: unknown) => void>>()
  const docListeners = new Map<string, Set<(e?: unknown) => void>>()
  const document = {
    visibilityState: 'visible',
    addEventListener: (type: string, l: (e?: unknown) => void) => { if (!docListeners.has(type)) docListeners.set(type, new Set()); docListeners.get(type)!.add(l) },
    removeEventListener: (type: string, l: (e?: unknown) => void) => { docListeners.get(type)?.delete(l) },
    get cookie() {
      if (opts.refuseCookies) throw new Error('SecurityError')
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    set cookie(text: string) {
      if (opts.refuseCookies) throw new Error('SecurityError')
      writes.push(text)
      const [pair, ...attrs] = text.split(';').map((x) => x.trim())
      const i = pair.indexOf('=')
      const name = pair.slice(0, i)
      const maxAge = attrs.find((a) => /^max-age=/i.test(a))
      if (maxAge && Number(maxAge.split('=')[1]) <= 0) jar.delete(name)
      else jar.set(name, pair.slice(i + 1))
    },
  }
  const window = {
    addEventListener: (type: string, l: (e?: unknown) => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(l) },
    removeEventListener: (type: string, l: (e?: unknown) => void) => { listeners.get(type)?.delete(l) },
    dispatchEvent: (e: { type: string }) => { events.push(e.type); for (const l of [...(listeners.get(e.type) ?? [])]) l(e); return true },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v) }, removeItem: (k: string) => { storage.delete(k) } },
  }
  const saved = new Map<string, PropertyDescriptor | undefined>()
  const put = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  put('window', window)
  put('document', document)
  put('location', { hostname: opts.hostname ?? 'bio.mapltours.com', protocol: opts.protocol ?? 'https:' })
  put('navigator', { doNotTrack: null })
  const RealDateTimeFormat = Intl.DateTimeFormat
  const timeZone = opts.timeZone === undefined ? 'America/Toronto' : opts.timeZone
  ;(Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = function () {
    if (timeZone === null) throw new Error('no Intl')
    return { resolvedOptions: () => ({ timeZone }) }
  }
  const restore = () => {
    ;(Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = RealDateTimeFormat
    for (const [name, d] of saved) {
      if (d) Object.defineProperty(globalThis, name, d)
      else delete (globalThis as Record<string, unknown>)[name]
    }
  }
  const fire = (type: string, event: Record<string, unknown> = {}) => {
    for (const l of [...(docListeners.get(type) ?? []), ...(listeners.get(type) ?? [])]) l({ type, ...event })
  }
  const listening = (type: string) => (docListeners.get(type)?.size ?? 0) + (listeners.get(type)?.size ?? 0)
  return { jar, writes, storage, events, fire, listening, restore }
}

type BrowserHalf = typeof import('../lib/consent-browser.mts')
let copy = 0
/** A fresh copy of the browser half, as a new page load would have: nothing placed, nothing answered. */
const freshPage = async (): Promise<BrowserHalf> => (await import(`../lib/consent-browser.mts?page=${++copy}`)) as BrowserHalf

const country = (code: string | null) => async () => code

test('a visitor outside the region is never asked: placed once, remembered for a day, tracked as before', async () => {
  const b = browser()
  try {
    const c = await freshPage()
    assert.equal(c.consentDecision(false), 'wait')
    assert.equal(c.consentBlocksTracking(), true, 'nothing is guessed before the visitor is placed')
    let lookups = 0
    const us = async () => { lookups++; return 'US' }
    assert.equal(await c.resolveRegion(us), false)
    assert.equal(await c.resolveRegion(us), false)
    assert.equal(lookups, 1, 'one lookup for the page')
    assert.equal(c.consentDecision(false), 'allow')
    assert.equal(c.consentBlocksTracking(), false)
    assert.equal(b.writes.length, 1)
    assert.match(b.writes[0], /^mapl_consent=na\.\d{10}; Path=\/; Max-Age=86400; SameSite=Lax; Secure; Domain=\.mapltours\.com$/)
    // The next page that day reads the cookie and looks nothing up.
    const next = await freshPage()
    assert.equal(next.consentDecision(false), 'allow')
    assert.equal(next.consentBlocksTracking(), false)
    await next.settleConsent()
    assert.equal(lookups, 1)
  } finally { b.restore() }
})

test('a visitor in the region is asked, and until they say yes nothing is stored and nothing may track', async () => {
  for (const code of ['GB', 'IE', 'FR', 'DE', 'NO', 'IS', 'JE']) {
    const b = browser()
    try {
      const c = await freshPage()
      assert.equal(await c.resolveRegion(country(code)), true, code)
      assert.equal(c.consentDecision(false), 'ask', code)
      assert.equal(c.consentBlocksTracking(), true, code)
      assert.deepEqual(b.writes, [], `${code}: no cookie before an answer`)
      assert.equal(b.jar.size, 0)
      // Do Not Track on top of it: no question, no tracking.
      assert.equal(c.consentDecision(true), 'deny', code)
    } finally { b.restore() }
  }
})

test('yes turns tracking on and is kept for 180 days; everything listening is told', async () => {
  const b = browser()
  try {
    const c = await freshPage()
    await c.resolveRegion(country('GB'))
    let told = 0
    const off = c.onConsentChange(() => { told++ })
    c.setConsent('yes')
    assert.equal(told, 1)
    assert.equal(c.consentDecision(false), 'allow')
    assert.equal(c.consentBlocksTracking(), false)
    assert.match(b.writes[0], /^mapl_consent=yes\.\d{10}; Path=\/; Max-Age=15552000; SameSite=Lax; Secure; Domain=\.mapltours\.com$/)
    off()
    c.setConsent('yes')
    assert.equal(told, 1, 'a listener that left is not called')
    // The next page reads the yes and looks nothing up.
    const next = await freshPage()
    assert.equal(next.consentDecision(false), 'allow')
    // Do Not Track switched on later still wins over the stored yes.
    assert.equal(next.consentDecision(true), 'deny')
  } finally { b.restore() }
})

test('no keeps tracking off, removes the tags\' cookies and this page\'s memory of reported leads, and leaves everything else', async () => {
  const b = browser({ cookies: { _ga: 'GA1.1.1.2', _ga_4H9FL0R9VM: 'GS2.1.s1', _fbp: 'fb.1.2.3', _gcl_au: '1.1.1', mapl_trip: 'proof', theme: 'dark' }, leads: '["2740b72f246529ea"]' })
  try {
    const c = await freshPage()
    await c.resolveRegion(country('US'))
    assert.equal(c.consentBlocksTracking(), false)
    c.setConsent('no')
    assert.equal(c.consentDecision(false), 'deny')
    assert.equal(c.consentBlocksTracking(), true)
    assert.deepEqual([...b.jar.keys()].sort(), ['mapl_consent', 'mapl_trip', 'theme'])
    assert.match(b.jar.get('mapl_consent')!, /^no\.\d{10}$/)
    assert.equal(b.storage.has(LEADS_KEY), false)
    // Each of the four was expired on the shared domain and on this host.
    for (const name of ['_ga', '_ga_4H9FL0R9VM', '_fbp', '_gcl_au']) {
      assert.ok(b.writes.includes(`${name}=; Path=/; Max-Age=0; Domain=.mapltours.com`), name)
      assert.ok(b.writes.includes(`${name}=; Path=/; Max-Age=0`), name)
    }
    // And yes again turns it back on: the answer can always be changed.
    c.setConsent('yes')
    assert.equal(c.consentBlocksTracking(), false)
  } finally { b.restore() }
})

test('a code asked for in the page\'s first moments waits for the lookup, and then follows the real answer', async () => {
  for (const [code, blocked] of [['GB', true], ['US', false]] as const) {
    const b = browser()
    const realFetch = globalThis.fetch
    let release: (() => void) | undefined
    let calls = 0
    globalThis.fetch = (async (url: unknown, init?: { cache?: string }) => {
      calls++
      assert.equal(url, '/api/geo')
      assert.equal(init?.cache, 'no-store')
      await new Promise<void>((r) => { release = r })
      return { ok: true, json: async () => ({ country: code }) }
    }) as unknown as typeof fetch
    try {
      const c = await freshPage()
      let settled = false
      const waiting = c.settleConsent().then(() => { settled = true })
      await new Promise((r) => setTimeout(r, 5))
      assert.equal(settled, false, 'still waiting for the lookup')
      assert.equal(c.consentBlocksTracking(), true)
      release!()
      await waiting
      assert.equal(c.consentBlocksTracking(), blocked, code)
      assert.equal(calls, 1)
      // Asked again, it answers at once and looks nothing up.
      await c.settleConsent()
      assert.equal(calls, 1)
    } finally { globalThis.fetch = realFetch; b.restore() }
  }
})

test('a lookup that fails falls back to the clock: a European one is asked, any other is not, and a clock that hides its place is asked', async () => {
  const failures: Array<() => Promise<Response>> = [
    async () => { throw new Error('offline') },
    async () => ({ ok: false, json: async () => ({}) }) as unknown as Response,
    async () => ({ ok: true, json: async () => { throw new Error('not json') } }) as unknown as Response,
    async () => ({ ok: true, json: async () => ({ country: null }) }) as unknown as Response,
    async () => ({ ok: true, json: async () => ({ country: 12 }) }) as unknown as Response,
  ]
  for (const [timeZone, region] of [['Europe/London', true], ['Europe/Zurich', true], ['Asia/Nicosia', true], ['Indian/Reunion', true], ['America/Toronto', false], ['America/Jamaica', false], ['UTC', true], [null, true]] as const) {
    for (const fail of failures) {
      const b = browser({ timeZone })
      const realFetch = globalThis.fetch
      globalThis.fetch = fail as unknown as typeof fetch
      try {
        const c = await freshPage()
        assert.equal(await c.resolveRegion(), region, String(timeZone))
        assert.equal(c.consentDecision(false), region ? 'ask' : 'allow', String(timeZone))
        // Placed by the clock alone, the visitor is not remembered: the next page looks them up again.
        assert.deepEqual(b.writes, [], String(timeZone))
      } finally { globalThis.fetch = realFetch; b.restore() }
    }
  }
})

test('a lookup that hangs is cut off, and the clock decides instead', async () => {
  const b = browser({ timeZone: 'Europe/Madrid' })
  const realFetch = globalThis.fetch
  const seen: Array<{ url: unknown; cache?: string; signal: boolean }> = []
  // A lookup that never answers by itself: it ends only when its signal says stop.
  globalThis.fetch = ((url: unknown, init?: { signal?: AbortSignal; cache?: string }) => new Promise((_resolve, reject) => {
    seen.push({ url, cache: init?.cache, signal: init?.signal instanceof AbortSignal })
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
  })) as unknown as typeof fetch
  try {
    const c = await freshPage()
    assert.equal(c.GEO_TIMEOUT_MS, 3000)
    const started = Date.now()
    // Raced against a timer of its own, so that a lookup nobody cuts off fails this test instead of hanging the run.
    const placed = await Promise.race([
      c.resolveRegion(() => c.countryFromGeoFunction(40)),
      new Promise<never>((_resolve, reject) => { setTimeout(() => reject(new Error('the lookup was never cut off')), 1500).unref() }),
    ])
    assert.equal(placed, true) // Madrid's clock
    assert.ok(Date.now() - started < 1500, 'cut off at the limit it was given')
    assert.deepEqual(seen, [{ url: '/api/geo', cache: 'no-store', signal: true }])
    assert.equal(c.consentDecision(false), 'ask')
  } finally { globalThis.fetch = realFetch; b.restore() }
})

test('the day-long "outside the region" cookie lapsing while the page is open changes nothing on that page', async () => {
  const realNow = Date.now
  const t0 = realNow()
  const b = browser({ timeZone: 'Europe/Istanbul', cookies: { mapl_consent: `na.${Math.floor(t0 / 1000) - 86_000}` } })
  try {
    const c = await freshPage()
    assert.equal(c.consentDecision(false), 'allow')
    assert.equal(c.consentBlocksTracking(), false)
    Date.now = () => t0 + 10 * 60_000 // ten minutes on: the cookie is past its day
    assert.equal(c.storedConsent(), null)
    assert.equal(c.consentDecision(false), 'allow')
    assert.equal(c.consentBlocksTracking(), false)
    await c.settleConsent()
    assert.equal(c.consentBlocksTracking(), false)
  } finally { Date.now = realNow; b.restore() }
})

test('a browser that sends Do Not Track or Global Privacy Control is not kept waiting for a lookup that cannot matter', async () => {
  for (const nav of [{ doNotTrack: '1' }, { globalPrivacyControl: true }]) {
    const b = browser()
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (() => { calls++; return new Promise(() => {}) }) as unknown as typeof fetch
    try {
      Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true })
      const c = await freshPage()
      let settled = false
      void c.settleConsent().then(() => { settled = true })
      await new Promise((r) => setTimeout(r, 5))
      assert.equal(settled, true, JSON.stringify(nav))
      assert.equal(calls, 0, JSON.stringify(nav))
    } finally { globalThis.fetch = realFetch; b.restore() }
  }
})

test('watching the decision: read at once, a lookup started whenever it is "wait", read again on an answer and when the tab is looked at again', async () => {
  const b = browser()
  try {
    const c = await freshPage()
    const seen: ConsentDecision[] = []
    let lookups = 0
    const watch = c.watchConsent((d) => { seen.push(d) }, () => false, async () => { lookups++; return 'GB' })
    assert.deepEqual(seen, ['wait'])
    await c.resolveRegion()
    await Promise.resolve()
    assert.equal(lookups, 1)
    assert.equal(seen.at(-1), 'ask')
    c.setConsent('yes')
    assert.equal(seen.at(-1), 'allow')
    // mapltours.com, or another tab, says no: nothing tells this page until it is looked at again.
    b.jar.set('mapl_consent', `no.${Math.floor(Date.now() / 1000)}`)
    assert.equal(seen.at(-1), 'allow')
    b.fire('visibilitychange')
    assert.equal(seen.at(-1), 'deny')
    // Back from the back/forward cache with a yes given elsewhere meanwhile.
    b.jar.set('mapl_consent', `yes.${Math.floor(Date.now() / 1000)}`)
    b.fire('pageshow', { persisted: false })
    assert.equal(seen.at(-1), 'deny', 'an ordinary load is not a return from the cache')
    b.fire('pageshow', { persisted: true })
    assert.equal(seen.at(-1), 'allow')
    watch.read()
    assert.equal(seen.at(-1), 'allow')
    // Stopped, it hears nothing more and leaves no listener behind.
    const n = seen.length
    watch.stop()
    c.setConsent('no')
    b.fire('visibilitychange')
    watch.read()
    assert.equal(seen.length, n)
    assert.equal(b.listening('visibilitychange') + b.listening('pageshow') + b.listening('mapl:consent'), 0)
  } finally { b.restore() }
})

test('watching the decision: with an answer on record nothing is looked up, and one that lapses on the open page starts the lookup then', async () => {
  const realNow = Date.now
  const t0 = realNow()
  const b = browser({ timeZone: 'Europe/Dublin', cookies: { mapl_consent: `yes.${Math.floor(t0 / 1000) - 179 * 86_400}` } })
  try {
    const c = await freshPage()
    const seen: ConsentDecision[] = []
    let lookups = 0
    const watch = c.watchConsent((d) => { seen.push(d) }, () => false, async () => { lookups++; return 'IE' })
    assert.deepEqual(seen, ['allow'])
    assert.equal(lookups, 0)
    Date.now = () => t0 + 2 * 86_400_000 // the 180 days are up
    watch.read()
    assert.equal(seen.at(-1), 'wait')
    assert.equal(lookups, 1, '"wait" is never left standing')
    await c.resolveRegion()
    await Promise.resolve()
    assert.equal(seen.at(-1), 'ask')
    watch.stop()
  } finally { Date.now = realNow; b.restore() }
})

test('a visitor who arrives having said no elsewhere has the tags\' cookies and the lead memory cleared once, as the page starts watching', async () => {
  const stamp = Math.floor(Date.now() / 1000)
  const b = browser({ cookies: { mapl_consent: `no.${stamp}`, _ga: 'GA1.1.1.2', _ga_4H9FL0R9VM: 'GS2.1.s1', _gac_UA1: '1.2.3', _fbp: 'fb.1.2.3', theme: 'dark' }, leads: '["2740b72f246529ea"]' })
  try {
    const c = await freshPage()
    const seen: ConsentDecision[] = []
    c.watchConsent((d) => { seen.push(d) }, () => false, country('GB')).stop()
    assert.deepEqual(seen, ['deny'])
    assert.deepEqual([...b.jar.keys()].sort(), ['mapl_consent', 'theme'])
    assert.equal(b.storage.has(LEADS_KEY), false)
  } finally { b.restore() }
  // A yes, or no answer at all, clears nothing.
  const b2 = browser({ cookies: { mapl_consent: `yes.${stamp}`, _ga: 'GA1.1.1.2' }, leads: '["2740b72f246529ea"]' })
  try {
    const c = await freshPage()
    c.watchConsent(() => {}, () => false, country('GB')).stop()
    assert.equal(b2.jar.has('_ga'), true)
    assert.equal(b2.storage.has(LEADS_KEY), true)
  } finally { b2.restore() }
})

test('a browser that refuses cookies can still answer: the answer lasts for the page, and nothing throws', async () => {
  const b = browser({ refuseCookies: true, timeZone: 'Europe/Dublin' })
  try {
    const c = await freshPage()
    assert.equal(await c.resolveRegion(country('IE')), true)
    assert.equal(c.consentDecision(false), 'ask')
    assert.doesNotThrow(() => c.setConsent('no'))
    assert.equal(c.consentDecision(false), 'deny', 'the card can be answered and goes away')
    assert.doesNotThrow(() => c.setConsent('yes'))
    assert.equal(c.consentDecision(false), 'allow')
    assert.equal(c.consentBlocksTracking(), false)
    // Outside the region with cookies refused: placed in memory, never asked.
    const d = await freshPage()
    assert.equal(await d.resolveRegion(country('CA')), false)
    assert.equal(d.consentDecision(false), 'allow')
  } finally { b.restore() }
})

test('a cookie that will not take the new answer does not outvote the visitor, and once the cookie holds the answer the cookie is what counts', async () => {
  // An older "outside the region" cookie can still be read, but writes are dropped (a full jar, a blocking extension).
  const b = browser({ cookies: { mapl_consent: `na.${Math.floor(Date.now() / 1000)}` } })
  const real = Object.getOwnPropertyDescriptor(globalThis, 'document')!
  try {
    const frozen = { get cookie() { return (real.value as { cookie: string }).cookie }, set cookie(_v: string) { /* dropped */ } }
    Object.defineProperty(globalThis, 'document', { value: frozen, configurable: true, writable: true })
    const c = await freshPage()
    assert.equal(c.consentDecision(false), 'allow')
    c.setConsent('no')
    assert.equal(c.storedConsent(), 'no')
    assert.equal(c.consentBlocksTracking(), true)
    c.setConsent('yes')
    assert.equal(c.consentBlocksTracking(), false)
  } finally { Object.defineProperty(globalThis, 'document', real); b.restore() }
  // The ordinary browser: the cookie holds the yes, so a no written by another tab is read at once.
  const b2 = browser()
  try {
    const c = await freshPage()
    await c.resolveRegion(country('GB'))
    c.setConsent('yes')
    assert.equal(c.consentBlocksTracking(), false)
    b2.jar.set('mapl_consent', `no.${Math.floor(Date.now() / 1000)}`)
    assert.equal(c.storedConsent(), 'no')
    assert.equal(c.consentBlocksTracking(), true)
  } finally { b2.restore() }
})

test('the footer\'s "Cookie preferences" reaches whoever shows the question, and off the page nothing runs', async () => {
  const b = browser()
  let c: BrowserHalf
  try {
    c = await freshPage()
    // The button hands itself over, so the keyboard can go back to it: Safari gives a clicked button no focus to find it by.
    const button = { tagName: 'BUTTON' } as unknown as HTMLElement
    const got: Array<HTMLElement | null> = []
    const off = c.onConsentPromptRequest((from) => { got.push(from) })
    c.requestConsentPrompt(button)
    assert.deepEqual(got, [button])
    assert.deepEqual(b.events, ['mapl:consent-open'])
    c.requestConsentPrompt()
    assert.deepEqual(got, [button, null], 'one press does not lend its button to the next')
    off()
    c.requestConsentPrompt(button)
    assert.equal(got.length, 2)
    assert.equal(c.browserOptedOut(), false)
    Object.defineProperty(globalThis, 'navigator', { value: { doNotTrack: '1' }, configurable: true, writable: true })
    assert.equal(c.browserOptedOut(), true)
    Object.defineProperty(globalThis, 'navigator', { value: { globalPrivacyControl: true }, configurable: true, writable: true })
    assert.equal(c.browserOptedOut(), true)
  } finally { b.restore() }
  // No window (the build's render): nothing is read, written or tracked.
  const s = await freshPage()
  assert.equal(s.storedConsent(), null)
  assert.equal(s.consentBlocksTracking(), true)
  assert.doesNotThrow(() => { s.setConsent('yes'); s.requestConsentPrompt() })
  await s.settleConsent()
  assert.equal(s.onConsentChange(() => {})(), undefined)
})

// ───────────────────────── The page around it ─────────────────────────

test('every path that measures asks the one gate, and the gate asks consent', () => {
  const analytics = read('lib/analytics.ts')
  assert.match(analytics, /consentBlocks: consentBlocksTracking\(\),/)
  // The three ways in all read the same signals; none reads navigator by itself any more.
  assert.match(analytics, /return allowed\(signals\(\), location\.hostname\)/)
  assert.match(analytics, /start\(window as unknown as TrackerWindow, document as unknown as TrackerDocument, signals\(\)\)/)
  assert.match(analytics, /reportLead\(window as unknown as TrackerWindow, document as unknown as TrackerDocument, signals\(\), source, eventId\)/)
  assert.doesNotMatch(analytics, /TrackerDocument, navigator[,)]/)
  // The lead: placed first, then the event id (no id, so no server Lead either), and no lead memory read without leave.
  const lead = read('lib/useLead.ts')
  const settle = lead.indexOf('await settleConsent()')
  assert.ok(settle > 0)
  assert.ok(settle < lead.indexOf('const store = trackingAllowed() ? leadStore() : undefined'))
  assert.ok(lead.indexOf('const store = trackingAllowed() ? leadStore() : undefined') < lead.indexOf('const eventId = repeat ? undefined : newEventId()'))
  assert.match(read('lib/analytics.ts'), /export function newEventId\(\): string \| undefined \{\n  if \(!trackingAllowed\(\)\) return undefined/)
  // And the lead memory is written only if the visitor may still be measured when the request comes back.
  assert.ok(lead.includes('if (eventId && trackingAllowed()) rememberLead(store, key)'))
  // Every event asks first: a tag that is on the page is not leave to use it once the visitor has said no.
  assert.match(analytics, /export function event\(name: string, params: Record<string, unknown> = \{\}\): void \{\n  if \(!trackingAllowed\(\)\) return\n/)
  assert.match(analytics, /export function outbound\(content: string, extra: Record<string, unknown> = \{\}\): void \{\n  event\('bio_click'/)
  assert.equal((analytics.match(/window\.gtag\?\.\(/g) ?? []).length, 1, 'one place sends an event, and it is the guarded one')
  // That the server sends no Lead without the page's event id is proved in tests/meta-capi.test.mts.
})

test('the tags wait for the answer, and a no switches them off where they stand', () => {
  // What the watcher does (read at once, look the country up, read again on an answer and when the tab is looked
  // at again) is tested above, where it lives. Here: that the component uses it and nothing else.
  const t = read('components/Trackers.tsx')
  assert.match(t, /useState<ConsentDecision>\('wait'\)/)
  assert.ok(t.includes('const watch = watchConsent(setDecision)'))
  assert.ok(t.includes('return () => { watch.stop(); offOpen() }'))
  assert.doesNotMatch(t, /consentDecision\(|resolveRegion\(|onConsentChange\(|visibilitychange/)
  // One place starts the tags, only on 'allow', and it asks the gate again first.
  assert.equal((t.match(/startTrackers\(\)/g) ?? []).length, 1, 'one place starts the tags')
  assert.match(t, /setTagsRunning\(true\)\n[\s\S]{0,400}if \(!trackingAllowed\(\)\) return\n    return afterLoadAndIdle\(/)
  // An answer that stops being yes switches the tags off; 'wait' touches nothing. No reload: this page has no tag
  // that cannot be stopped, so the visitor keeps the address they were typing and the code they were given.
  assert.match(t, /if \(decision !== 'allow'\) \{\n      if \(decision !== 'wait'\) setTagsRunning\(false\)\n      return\n    \}/)
  assert.doesNotMatch(t, /location\.reload/)
  // On a no the tags are stopped before the answer is recorded, because recording it clears their cookies.
  const answer = t.slice(t.indexOf('const answer = (a: ConsentAnswer) => {'))
  assert.ok(answer.indexOf("if (a === 'no') setTagsRunning(false)") > 0)
  assert.ok(answer.indexOf("if (a === 'no') setTagsRunning(false)") < answer.indexOf('setConsent(a)'))
  // Asked only when the rule says ask, or when the visitor opens it from the footer.
  assert.match(t, /: decision === 'ask' \? 'ask' : null/)
})

test('the question is an honest one: two equal answers, "No thanks" first, who and why, and nothing chosen for the visitor', () => {
  const p = read('components/ConsentPrompt.tsx')
  const buttons = Array.from(p.matchAll(/<button type="button" className="([a-z-]+)" onClick=\{[^\n]*?\}>([^<]+)<\/button>/g)).map((m) => [m[1], m[2]])
  assert.deepEqual(buttons, [['consent-btn', 'Close'], ['consent-btn', 'No thanks'], ['consent-btn', 'Yes, that’s fine']])
  assert.ok(p.indexOf("onAnswer('no')") < p.indexOf("onAnswer('yes')"))
  // The one other control, a Close in the corner, exists only on a card the visitor opened: when the page asks
  // there is no third way out, and looking at a card you opened is not answering it.
  assert.ok(p.includes(`{requested > 0 && mode !== 'browser' && (
        <button type="button" className="consent-close" aria-label="Close" onClick={onClose}>`))
  assert.equal((p.match(/<button /g) ?? []).length, 4)
  assert.match(p, /export const CONSENT_QUESTION = 'Can we use cookies from Google, Meta and Hotjar to see how people use the site, measure our ads, and show our ads to people who have visited\? You get your code either way\.'/)
  assert.match(p, /<a href=\{out\('\/privacy', 'cookie_privacy'\)\}>Privacy Policy<\/a>/)
  assert.doesNotMatch(p, /defaultChecked|checked=|autoFocus|setTimeout|setInterval|role="dialog"|aria-modal|—/)
  assert.match(p, /<section\s+ref=\{card\}\s+className="consent"\s+data-consent-prompt=""\s+data-requested=\{requested > 0 \? 'true' : undefined\}\s+aria-label="Cookie choice"/)
  // One rule styles both answers; nothing styles one of them alone.
  const css = read('app/globals.css')
  const block = css.slice(css.indexOf('/* ── The cookie question'))
  assert.ok(block.length > 200)
  assert.equal((block.match(/\.consent-btn[^{]*\{/g) ?? []).length, 5) // the button, its hover, its size on a narrow phone and on the narrowest, and its width in the strip: each for both
  assert.doesNotMatch(block, /consent-btn--|consent-yes|consent-no|consent-primary/)
  assert.match(block, /min-height: 48px/)
  assert.match(block, /\.consent-text \{ margin: 0; font-size: 16px;/)
})

test('it is a card at the top of the page that scrolls away with it, first in the document, with a way back to it in the footer', () => {
  const css = read('app/globals.css')
  const block = css.slice(css.indexOf('/* ── The cookie question'))
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '')
  // Absolute, not fixed: it belongs to the top of the page, so a visitor who reads on without answering never has
  // it over the price finder they are typing in or the code they were just given.
  assert.match(block, /\.consent \{\s*--consent-top: 76px;\s*position: absolute; z-index: 40;\s*top: calc\(var\(--consent-top\) \+ env\(safe-area-inset-top, 0px\)\); left: 12px; right: 12px;/)
  assert.equal((rules.match(/position: fixed/g) ?? []).length, 1) // only the card a visitor opened
  // That one is pinned where they are, and never taller than the screen: pinned, it could not be scrolled to, so it scrolls inside itself.
  assert.match(block, /\.consent\[data-requested="true"\] \{\s*position: fixed;\s*max-height: calc\(100vh - var\(--consent-top\) - env\(safe-area-inset-top, 0px\) - 12px\);\s*max-height: calc\(100dvh - var\(--consent-top\) - env\(safe-area-inset-top, 0px\) - 12px\);\s*overflow-y: auto;/)
  // No declaration places it from the bottom, where the offer bar is (its own comment is free to say why).
  assert.doesNotMatch(rules, /\bbottom\s*:/)
  // On a narrow phone the two answers still share a row; on a short one the card moves up over the logo row, clear of the email field.
  assert.match(block, /@media \(max-width: 359px\) \{\s*\.consent \{ left: 8px; right: 8px; padding: 12px; \}\s*\.consent-btn \{ padding: 6px 8px; font-size: 15px; \}\s*\}/)
  assert.match(block, /@media \(max-width: 299px\) \{ \.consent-btn \{ padding: 6px; font-size: 14px; \} \}/)
  assert.match(block, /@media \(max-height: 540px\) and \(max-width: 899px\), \(max-height: 570px\) and \(max-width: 319px\) \{\s*\.consent \{ --consent-top: 8px; \}/)
  // A wide, short window: the card lies down as a strip across the top, and both answers keep one width.
  assert.match(block, /@media \(min-width: 900px\) and \(max-width: 1095px\) and \(max-height: 599px\) \{\s*\.consent \{ --consent-top: 8px; left: 24px; right: 24px; width: auto; max-width: none; display: flex;/)
  assert.match(block, /\.consent-btn \{ flex: 0 0 150px; min-width: 0; \}/)
  // There it is where the skip link shows when it takes the keyboard (the link lives inside the hero, under the
  // card): while the link has the focus the card steps down out of its way.
  assert.equal((block.match(/body:has\(\.skip:focus\) \.consent \{ --consent-top: 64px; \}/g) ?? []).length, 2) // wherever the card sits over the logo row
  assert.match(css, /\.skip \{ position: absolute; left: 16px; top: -100px; z-index: 50;/)
  assert.match(css, /\.skip:focus \{ top: 12px; \}/)
  // Above the offer bar; and under the hero's 72px top row.
  assert.match(css, /\.stickybar \{ position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;/)
  assert.match(css, /\.hero-top \{[^}]*height: 72px;/)
  const layout = read('app/layout.tsx')
  assert.ok(layout.indexOf('<div id="consent-root" />') > 0)
  assert.ok(layout.indexOf('<div id="consent-root" />') < layout.indexOf('{children}'))
  assert.match(read('components/ConsentPrompt.tsx'), /document\.getElementById\('consent-root'\)/)
  // The footer's button hands itself over as the place for the keyboard to return to.
  const footer = read('components/Footer.tsx')
  assert.match(footer, /<button type="button" className="footer-cookies" onClick=\{\(e\) => requestConsentPrompt\(e\.currentTarget\)\}>Cookie preferences<\/button>/)
  assert.match(css, /\.footer-cookies \{[^}]*min-height: 44px;/)
})

test('opened from the footer it takes the keyboard, has a Close, Escape puts it away, and the keyboard goes back to the button', () => {
  // The card is first in the document and the footer is last: without this a keyboard user who opens it is a whole page of links away from it.
  const p = read('components/ConsentPrompt.tsx')
  assert.ok(p.includes('useEffect(() => { if (requested > 0 && root) card.current?.focus() }, [requested, root])'))
  assert.ok(p.includes('tabIndex={-1}'))
  assert.ok(p.includes("onKeyDown={requested > 0 ? (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } } : undefined}"))
  const t = read('components/Trackers.tsx')
  // Each press counts, so a second press brings the keyboard to the card again; the button is the one handed over.
  assert.match(t, /onConsentPromptRequest\(\(from\) => \{\s*opener\.current = from\s*setRequest\(\(n\) => n \+ 1\)\s*\}\)/)
  assert.ok(t.includes('if (back && document.contains(back)) back.focus({ preventScroll: true })'))
  assert.ok(t.includes('requested={request} onAnswer={answer} onClose={close}'))
  // When the page asks by itself nothing takes the focus: `requested` is only ever the visitor's own doing.
  assert.doesNotMatch(p, /autoFocus/)
  // The card's own ring is drawn inside its edge, on its own dark ground: outside, it would be white on a white page.
  assert.match(read('app/globals.css'), /\.consent:focus-visible \{ outline: 3px solid #fff; outline-offset: -6px;/)
})
