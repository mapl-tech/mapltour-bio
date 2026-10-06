import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { GA_ID, GA_SRC, LEADS_KEY, LIVE_HOST, afterLoadAndIdle, type ScheduleWindow, PIXEL_ID, PIXEL_SRC, leadKey, leadSeen, rememberLead, reportLead, startTrackers, trackingAllowed, type Fbq, type TrackerDocument, type TrackerNavigator, type TrackerWindow } from '../lib/trackers.mts'

type Script = { async: boolean; src: string }

/** A fake page: the window the trackers leave things on, and the scripts they add. */
function page() {
  const scripts: Script[] = []
  const d: TrackerDocument = { createElement: () => ({ async: false, src: '' }), head: { appendChild: (el) => { scripts.push(el as Script); return el } } }
  const w: TrackerWindow = { location: { hostname: LIVE_HOST } }
  return { w, d, scripts }
}
const ALLOWED: TrackerNavigator = { doNotTrack: null }

/**
 * What fbevents.js does when it arrives: it puts callMethod on the stub that
 * is already there, then reads the queue, once (it never reads it again).
 */
function libraryLoads(f: Fbq) {
  const sent: unknown[][] = []
  const self: unknown[] = []
  f.callMethod = function (this: unknown, ...args: unknown[]) { sent.push(args); self.push(this) }
  while (f.queue.length) f.callMethod.apply(f, f.queue.shift() as unknown[])
  return { sent, self }
}

/** GA commands in the dataLayer, as arrays (gtag pushes arguments objects). */
const gaCommands = (w: TrackerWindow) => (w.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>))

const LEAD = (source: string, eventID: string) => ['track', 'Lead', { content_name: source }, { eventID }]
/** What every page sends first, in this order: automatic events and matching off (before init, as Meta requires), init, PageView. */
const BOOT = [['set', 'autoConfig', false, PIXEL_ID], ['init', PIXEL_ID], ['track', 'PageView']]

test('the page fires the ads dataset 1607953960710055; no page code names the old bio pixel', () => {
  assert.equal(PIXEL_ID, '1607953960710055')
  assert.equal(PIXEL_SRC, 'https://connect.facebook.net/en_US/fbevents.js')
  assert.equal(GA_ID, 'G-4H9FL0R9VM')
  const root = new URL('..', import.meta.url).pathname
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(m?ts|tsx|js)$/.test(e.name)) files.push(p)
    }
  }
  for (const dir of ['app', 'components', 'lib', 'netlify']) walk(join(root, dir))
  assert.ok(files.length > 20, 'the walk found the page code')
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /1060325803564034/, f)
})

test('starts once, whoever calls first: one GA config, one pixel init, one PageView, each script once', () => {
  const { w, d, scripts } = page()
  assert.equal(startTrackers(w, d, ALLOWED), true)
  assert.equal(startTrackers(w, d, ALLOWED), true)
  assert.deepEqual(scripts, [{ async: true, src: GA_SRC }, { async: true, src: PIXEL_SRC }])
  const ga = gaCommands(w)
  assert.equal(ga.length, 2)
  assert.equal(ga[0][0], 'js')
  assert.deepEqual(ga[1], ['config', GA_ID, { send_page_view: true }])
  const f = w.fbq!
  assert.equal(w._fbq, f)
  assert.equal(f.push, f)
  assert.equal(f.loaded, true)
  assert.equal(f.version, '2.0')
  assert.deepEqual(f.queue, BOOT)
})

test('a lead before the trackers started starts them: the Lead follows the one init and PageView, with the page\'s event id', () => {
  const { w, d, scripts } = page()
  reportLead(w, d, ALLOWED, 'bio_hero', 'evt-12345678')
  // Trackers' own start, after the load event and an idle moment, adds nothing.
  assert.equal(startTrackers(w, d, ALLOWED), true)
  assert.equal(scripts.length, 2)
  const ga = gaCommands(w)
  assert.deepEqual(ga.slice(1), [['config', GA_ID, { send_page_view: true }], ['event', 'generate_lead', { lead_source: 'bio_hero' }]])
  const { sent } = libraryLoads(w.fbq!)
  assert.deepEqual(sent, [...BOOT, LEAD('bio_hero', 'evt-12345678')])
})

test('a lead after the library has loaded reaches it at once (the old stub kept it in the queue for good)', () => {
  const { w, d } = page()
  startTrackers(w, d, ALLOWED)
  const f = w.fbq!
  const { sent, self } = libraryLoads(f)
  reportLead(w, d, ALLOWED, 'bio_coupon', 'evt-87654321')
  assert.deepEqual(sent, [...BOOT, LEAD('bio_coupon', 'evt-87654321')])
  assert.equal(f.queue.length, 0)
  // The stub hands itself over as `this`, exactly like Meta's snippet.
  assert.ok(self.every((s) => s === f))
})

test('Do Not Track or Global Privacy Control: nothing starts, nothing is queued, no script, for a lead too', () => {
  for (const nav of [{ doNotTrack: '1' }, { globalPrivacyControl: true }, { doNotTrack: '1', globalPrivacyControl: true }] as TrackerNavigator[]) {
    const { w, d, scripts } = page()
    assert.equal(trackingAllowed(nav, LIVE_HOST), false)
    assert.equal(startTrackers(w, d, nav), false)
    reportLead(w, d, nav, 'bio_hero', 'evt-12345678')
    assert.deepEqual(w, { location: { hostname: LIVE_HOST } }, JSON.stringify(nav))
    assert.deepEqual(scripts, [])
  }
  // No navigator (the server render) is never allowed; anything short of a clear "no" is.
  assert.equal(trackingAllowed(undefined, LIVE_HOST), false)
  for (const nav of [{}, { doNotTrack: null }, { doNotTrack: '0' }, { doNotTrack: 'unspecified' }, { globalPrivacyControl: false }] as TrackerNavigator[]) assert.equal(trackingAllowed(nav, LIVE_HOST), true, JSON.stringify(nav))
})

test('an fbq already on the page is used, not replaced: no second pixel library, one init, one PageView', () => {
  const { w, d, scripts } = page()
  const seen: unknown[][] = []
  const existing = Object.assign((...a: unknown[]) => { seen.push(a) }, { queue: [], loaded: true, version: '2.0', push: null }) as unknown as Fbq
  w.fbq = existing
  startTrackers(w, d, ALLOWED)
  reportLead(w, d, ALLOWED, 'bio_hero', 'evt-12345678')
  assert.equal(w.fbq, existing)
  assert.deepEqual(scripts.map((s) => s.src), [GA_SRC])
  assert.deepEqual(seen, [...BOOT, LEAD('bio_hero', 'evt-12345678')])
})

test('only the live page tracks: a local build, a deploy preview or any other host starts nothing, for a lead too', () => {
  assert.equal(LIVE_HOST, 'bio.mapltours.com')
  const elsewhere = ['localhost', '127.0.0.1', 'deploy-preview-12--mapltours-bio.netlify.app', '6ac5abc--mapltours-bio.netlify.app', 'mapltours.com', 'www.bio.mapltours.com', 'bio.mapltours.com.example', 'BIO.MAPLTOURS.COM.', '']
  for (const hostname of elsewhere) {
    const { w, d, scripts } = page()
    w.location = { hostname }
    assert.equal(trackingAllowed(ALLOWED, hostname), false, hostname)
    assert.equal(startTrackers(w, d, ALLOWED), false, hostname)
    reportLead(w, d, ALLOWED, 'bio_hero', 'evt-12345678')
    assert.deepEqual(w, { location: { hostname } }, hostname)
    assert.deepEqual(scripts, [], hostname)
  }
  // No location at all (a server render, an odd embed): nothing either.
  const { w, d, scripts } = page()
  delete w.location
  assert.equal(startTrackers(w, d, ALLOWED), false)
  reportLead(w, d, ALLOWED, 'bio_hero', 'evt-12345678')
  assert.deepEqual(w, {})
  assert.deepEqual(scripts, [])
})

/** A localStorage stand-in. */
function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
}

test('lead memory: the same address asked again from this browser is known, as a hash prefix, never the address', async () => {
  // SHA-256 of "guest@gmail.com" starts 2740b72f246529ea (shasum -a 256).
  assert.equal(await leadKey('guest@gmail.com'), '2740b72f246529ea')
  assert.equal(await leadKey('  Guest@Gmail.COM '), '2740b72f246529ea')
  // No Web Crypto (an insecure page, an old browser): no key, so nothing is remembered or skipped.
  assert.equal(await leadKey('guest@gmail.com', null), null)
  const store = memoryStore()
  const key = await leadKey('guest@gmail.com')
  assert.equal(leadSeen(store, key), false)
  rememberLead(store, key)
  assert.equal(leadSeen(store, key), true)
  assert.equal(leadSeen(store, await leadKey('other@gmail.com')), false)
  assert.doesNotMatch(store.data.get(LEADS_KEY) ?? '', /@|guest/)
  // Remembering again keeps one entry; the list keeps the last 20.
  rememberLead(store, key)
  assert.deepEqual(JSON.parse(store.data.get(LEADS_KEY)!), [key])
  for (let i = 0; i < 25; i++) rememberLead(store, `k${String(i).padStart(14, '0')}`)
  const kept = JSON.parse(store.data.get(LEADS_KEY)!) as string[]
  assert.equal(kept.length, 20)
  assert.equal(kept.at(-1), 'k00000000000024')
  assert.equal(leadSeen(store, key), false, 'the oldest fell off')
})

test('lead memory never throws and never blocks a lead: no storage, refused storage, a corrupt list, no key', () => {
  assert.equal(leadSeen(undefined, 'abc'), false)
  assert.doesNotThrow(() => rememberLead(undefined, 'abc'))
  const refusing = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('QuotaExceededError') } }
  assert.equal(leadSeen(refusing, 'abc'), false)
  assert.doesNotThrow(() => rememberLead(refusing, 'abc'))
  const corrupt = memoryStore({ [LEADS_KEY]: '{not json' })
  assert.equal(leadSeen(corrupt, 'abc'), false)
  rememberLead(corrupt, 'abc')
  assert.equal(leadSeen(corrupt, 'abc'), true, 'a corrupt list is started again')
  const store = memoryStore()
  rememberLead(store, null)
  assert.equal(store.data.size, 0)
  assert.equal(leadSeen(store, null), false)
})

/** A window whose load event, idle callbacks and timers the test fires by hand. */
function scheduleWindow(readyState: string, idleCallback = true) {
  const loads: Array<() => void> = []
  const idles: Array<{ cb: () => void; timeout?: number }> = []
  const timers: Array<{ cb: () => void; ms: number }> = []
  const w: ScheduleWindow = {
    document: { readyState },
    addEventListener: (_t, l) => { loads.push(l) },
    removeEventListener: (_t, l) => { const i = loads.indexOf(l); if (i >= 0) loads.splice(i, 1) },
    setTimeout: (cb, ms) => { timers.push({ cb, ms }); return timers.length },
    ...(idleCallback ? { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => { idles.push({ cb, timeout: o?.timeout }); return idles.length } } : {}),
  }
  return { w, loads, idles, timers }
}

test('the trackers wait for the load event and an idle moment, so the tag scripts never come before the page', () => {
  let started = 0
  const { w, loads, idles, timers } = scheduleWindow('interactive')
  afterLoadAndIdle(w, () => { started++ })
  assert.equal(started, 0, 'nothing before load')
  assert.equal(idles.length + timers.length, 0)
  assert.equal(loads.length, 1)
  loads[0]()
  assert.equal(started, 0, 'not at load itself either: an idle moment first')
  assert.deepEqual(idles.map((i) => i.timeout), [4000])
  idles[0].cb()
  assert.equal(started, 1)
})

test('already loaded: the idle wait starts at once; no requestIdleCallback (Safari): a 1.2 s timer instead', () => {
  let started = 0
  const done = scheduleWindow('complete')
  afterLoadAndIdle(done.w, () => { started++ })
  assert.equal(done.loads.length, 0)
  assert.equal(done.idles.length, 1)
  done.idles[0].cb()
  assert.equal(started, 1)

  const safari = scheduleWindow('loading', false)
  afterLoadAndIdle(safari.w, () => { started++ })
  safari.loads[0]()
  assert.deepEqual(safari.timers.map((t) => t.ms), [1200])
  safari.timers[0].cb()
  assert.equal(started, 2)
})

test('unmounted before load: the cleanup removes the load listener, so nothing starts later', () => {
  let started = 0
  const { w, loads } = scheduleWindow('loading')
  const cleanup = afterLoadAndIdle(w, () => { started++ })
  assert.equal(loads.length, 1)
  cleanup()
  assert.equal(loads.length, 0)
  assert.equal(started, 0)
})

