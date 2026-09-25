import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TIPS_LABEL, TIPS_ON, tipsConsentValid, tipsDefaultFor } from '../lib/tips.mts'
import { listJoin, listResubscribe, listState, listStop, recordTips, signTips, tipsSubscribed, tipsUrl, verifyTips } from '../netlify/lib/tips.mts'
import { BROKEN, RETRY, SORRY, esc, handleTips } from '../netlify/lib/tips-page.mts'

const SECRET = 'test-secret-not-real'
const EMAIL = 'guest@gmail.com'

type Call = { method: string; url: string; body?: Record<string, unknown> }

/** A fetch that answers by URL and method, and records what it was asked. */
function fakeFetch(answer: (c: Call) => { status: number; body?: unknown } = () => ({ status: 200, body: {} })) {
  const calls: Call[] = []
  const f = (async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(c)
    const a = answer(c)
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status })
  }) as unknown as typeof fetch
  return { f, calls }
}

const link = (action: 'yes' | 'stop', email = EMAIL) => new URL(tipsUrl(action, email, SECRET))
const parts = (u: URL) => ({ a: u.searchParams.get('a')!, e: u.searchParams.get('e')!, t: u.searchParams.get('t')! })
const post = (body: Record<string, string>) => new Request('https://bio.mapltours.com/tips', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() })
const env = { TIPS_SECRET: SECRET, RESEND_API_KEY: 're_test', TIPS_SEGMENT_ID: 'seg-1', HUBSPOT_SERVICE_KEY: 'pat-test' }

// ── The rules ───────────────────────────────────────────────────────────

test('default: ticked only for the US; every other country and unknown start unticked', () => {
  assert.equal(tipsDefaultFor('US'), true)
  assert.equal(tipsDefaultFor('us'), true, 'lower case is normalised on purpose')
  assert.equal(tipsDefaultFor(' US '), true)
  for (const c of ['CA', 'GB', 'JM', 'DE', 'UM', 'PR', 'USA', '', null, undefined]) assert.equal(tipsDefaultFor(c as string | null | undefined), false, String(c))
})

test('consent: a tick counts when the box started unticked, or anywhere it may start ticked (US only)', () => {
  assert.equal(tipsConsentValid({ optIn: true, defaultShown: 'unchecked', country: 'CA' }), true)
  assert.equal(tipsConsentValid({ optIn: true, defaultShown: 'unchecked', country: null }), true)
  assert.equal(tipsConsentValid({ optIn: true, defaultShown: 'checked', country: 'US' }), true)
  assert.equal(tipsConsentValid({ optIn: true, defaultShown: 'checked', country: 'us' }), true)
  // A pre-ticked box outside the US never counts, even arriving ticked.
  for (const c of ['CA', 'GB', 'JM', null, undefined, '']) assert.equal(tipsConsentValid({ optIn: true, defaultShown: 'checked', country: c }), false, String(c))
  // Only a real true is a tick.
  for (const o of [false, 'true', 1, 'yes', null, undefined]) assert.equal(tipsConsentValid({ optIn: o, defaultShown: 'unchecked', country: 'US' }), false, String(o))
  // A default that is not exactly 'unchecked' is read as pre-ticked.
  for (const d of ['Unchecked', '', null, undefined, 'no']) assert.equal(tipsConsentValid({ optIn: true, defaultShown: d, country: 'GB' }), false, String(d))
})

test('copy: exact wording, no em dashes, brand in mixed case', () => {
  assert.equal(TIPS_LABEL, 'Send me Jamaica trip tips from MAPL Tours Jamaica, about twice a month. Unsubscribe anytime.')
  assert.equal(TIPS_ON, 'Trip tips are on. The first one comes in a couple of weeks.')
  for (const s of [TIPS_LABEL, TIPS_ON, BROKEN, SORRY, RETRY]) { assert.doesNotMatch(s, /—/); assert.doesNotMatch(s, /MAPL TOURS/) }
})

// ── Signed links ────────────────────────────────────────────────────────

test('link shape: bio host, action, base64url of the lower-cased address, 43-char token', () => {
  const u = link('yes', '  Guest@Gmail.com ')
  assert.equal(u.origin + u.pathname, 'https://bio.mapltours.com/tips')
  const { a, e, t } = parts(u)
  assert.equal(a, 'yes')
  assert.equal(Buffer.from(e, 'base64url').toString(), EMAIL)
  assert.match(t, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(t, signTips('yes', EMAIL, SECRET))
  assert.deepEqual(verifyTips(a, e, t, SECRET), { action: 'yes', email: EMAIL })
})

test('verify: a stop link works as a stop only', () => {
  const s = parts(link('stop'))
  assert.deepEqual(verifyTips(s.a, s.e, s.t, SECRET), { action: 'stop', email: EMAIL })
})

test('verify refuses: tampered token, wrong action, wrong address, other secret, bad base64, junk', () => {
  const { a, e, t } = parts(link('yes'))
  const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1)
  assert.equal(verifyTips(a, e, flip(t, 0), SECRET), null, 'tampered token')
  assert.equal(verifyTips(a, e, flip(t, 42), SECRET), null, 'tampered last char')
  assert.equal(verifyTips('stop', e, t, SECRET), null, 'a yes token is not a stop token')
  assert.equal(verifyTips('yes', parts(link('stop')).e, parts(link('stop')).t, SECRET), null, 'a stop token is not a yes token')
  const other = Buffer.from('other@gmail.com').toString('base64url')
  assert.equal(verifyTips(a, other, t, SECRET), null, 'token bound to the address')
  assert.equal(verifyTips(a, e, t, 'another-secret'), null, 'signed with another secret')
  assert.equal(verifyTips(a, e + '!', t, SECRET), null, 'not base64url')
  assert.equal(verifyTips(a, e + 'A', t, SECRET), null, 'non-canonical base64 (Node would decode it anyway)')
  assert.equal(verifyTips(a, `${e.slice(0, 4)}+${e.slice(5)}`, t, SECRET), null, 'standard base64 alphabet')
  assert.equal(verifyTips(a, Buffer.from('Guest@Gmail.com').toString('base64url'), signTips('yes', 'Guest@Gmail.com', SECRET), SECRET), null, 'upper case address is not a link we make')
  assert.equal(verifyTips(a, Buffer.from('not-an-email').toString('base64url'), signTips('yes', 'not-an-email', SECRET), SECRET), null)
  assert.equal(verifyTips(a, e, t.slice(0, 42), SECRET), null, 'short token')
  assert.equal(verifyTips(a, e, t + 'A', SECRET), null, 'long token')
  assert.equal(verifyTips('maybe', e, t, SECRET), null)
  assert.equal(verifyTips(null, null, null, SECRET), null)
  assert.equal(verifyTips(a, '', t, SECRET), null)
})

// ── The page ────────────────────────────────────────────────────────────

test('GET shows the button and records nothing (scanners prefetch links)', async () => {
  for (const action of ['yes', 'stop'] as const) {
    const { f, calls } = fakeFetch()
    const r = await handleTips(new Request(link(action)), env, f)
    assert.equal(r.status, 200)
    assert.equal(calls.length, 0, 'no call to Resend or HubSpot on GET')
    const html = await r.text()
    assert.match(html, /<html lang="en">/)
    assert.match(html, /<title>Trip tips from MAPL Tours Jamaica<\/title>/)
    assert.match(html, /<form method="post" action="\/tips">/)
    assert.match(html, /:focus-visible\{outline:3px solid/)
    assert.match(html, /max-width:480px/)
    assert.match(html, /background:#A58326;color:#FFFFFF;.*font-size:19px;font-weight:700/)
    assert.match(html, /min-height:56px/)
    if (action === 'yes') {
      assert.match(html, /<h1>One tap to turn on trip tips<\/h1>/)
      assert.match(html, /Tap the button to get Jamaica trip tips about twice a month\. Unsubscribe anytime\./)
      assert.match(html, /Sending to <strong>guest@gmail\.com<\/strong>/)
      assert.match(html, /<button type="submit">Yes, send me trip tips<\/button>/)
    } else {
      assert.match(html, /<h1>One tap to stop trip tips<\/h1>/)
      assert.match(html, /Tap the button to stop trip tips to this address:<\/p><p[^>]*><strong>guest@gmail\.com<\/strong>/)
      assert.match(html, /<button type="submit">Stop trip tips<\/button>/)
    }
    assert.doesNotMatch(html, /<script/i)
  }
  // HEAD is a GET without the body, and no side effects either.
  const { f, calls } = fakeFetch()
  const h = await handleTips(new Request(link('stop'), { method: 'HEAD' }), env, f)
  assert.equal(h.status, 200)
  assert.equal(calls.length, 0)
})

test('never cached, never framed, never leaks the link as a referrer', async () => {
  const cases = [
    await handleTips(new Request(link('yes')), env, fakeFetch().f),
    await handleTips(new Request('https://bio.mapltours.com/tips?a=yes&e=x&t=y'), env, fakeFetch().f),
    await handleTips(new Request(link('yes')), { ...env, TIPS_SECRET: undefined }, fakeFetch().f),
    await handleTips(post(parts(link('yes'))), env, fakeFetch().f),
  ]
  for (const r of cases) {
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.equal(r.headers.get('netlify-cdn-cache-control'), 'no-store')
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer')
    assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
    assert.match(r.headers.get('content-type') ?? '', /text\/html; charset=utf-8/)
  }
})

test('the address on the page is HTML-escaped (it comes from the URL)', async () => {
  const evil = `a"'<b>x</b>&@gmail.com`.toLowerCase()
  const { f } = fakeFetch()
  const r = await handleTips(new Request(link('yes', evil)), env, f)
  assert.equal(r.status, 200)
  const html = await r.text()
  assert.doesNotMatch(html, /<b>x<\/b>/)
  assert.ok(html.includes(esc(evil)), 'shown escaped')
  assert.ok(html.includes('a&quot;&#39;&lt;b&gt;x&lt;/b&gt;&amp;@gmail.com'))
})

test('invalid or tampered link: 400 with the way back, nothing recorded', async () => {
  const { a, e, t } = parts(link('yes'))
  for (const u of [
    `https://bio.mapltours.com/tips?a=stop&e=${e}&t=${t}`,
    `https://bio.mapltours.com/tips?a=${a}&e=${e}&t=${t.slice(1)}A`,
    'https://bio.mapltours.com/tips',
    'https://bio.mapltours.com/tips?a=yes&e=%%%&t=zzz',
  ]) {
    const { f, calls } = fakeFetch()
    const r = await handleTips(new Request(u), env, f)
    assert.equal(r.status, 400, u)
    // The domain is a link to the form, not text to retype on a phone.
    assert.match(await r.text(), /<p>That link did not work\. Ask for your code again at <a href="https:\/\/bio\.mapltours\.com\/#coupon">bio\.mapltours\.com<\/a> and tick the trip tips box\.<\/p>/)
    assert.equal(calls.length, 0)
  }
  const { f, calls } = fakeFetch()
  const r = await handleTips(post({ a: 'stop', e, t }), env, f)
  assert.equal(r.status, 400, 'a yes token posted as a stop')
  assert.equal(calls.length, 0)
})

test('missing secret: 503 with a plain apology, for GET and POST', async () => {
  const noSecret = { ...env, TIPS_SECRET: '' }
  const g = await handleTips(new Request(link('yes')), noSecret, fakeFetch().f)
  assert.equal(g.status, 503)
  assert.match(await g.text(), /Sorry, trip tips cannot be changed from this page right now\./)
  const { f, calls } = fakeFetch()
  const p = await handleTips(post(parts(link('yes'))), noSecret, f)
  assert.equal(p.status, 503)
  assert.equal(calls.length, 0)
})

test('other methods: 405', async () => {
  const r = await handleTips(new Request(link('yes'), { method: 'PUT' }), env, fakeFetch().f)
  assert.equal(r.status, 405)
  assert.equal(r.headers.get('allow'), 'GET, HEAD, POST')
})

test('POST yes: HubSpot yes first (the record), then the Resend contact switched on (created on 404) and added to the tips segment', async () => {
  const { f, calls } = fakeFetch((c) => {
    if (c.url.includes('api.resend.com') && c.method === 'PATCH') return { status: 404, body: { name: 'not_found' } }
    if (c.url.includes('api.resend.com')) return { status: 201, body: { id: 'c1' } }
    return { status: 200, body: { id: '77' } }
  })
  const r = await handleTips(post(parts(link('yes'))), env, f, 1_800_000_000_000)
  assert.equal(r.status, 200)
  const html = await r.text()
  assert.match(html, /You are in\. Your first trip tip comes in a couple of weeks\./)
  assert.match(html, /href="https:\/\/mapltours\.com\/\?utm_source=bio&amp;utm_medium=bio&amp;utm_campaign=trip_tips&amp;utm_content=tips_yes"/)

  const firstResend = calls.findIndex((c) => c.url.startsWith('https://api.resend.com'))
  const lastHub = calls.map((c) => c.url.startsWith('https://api.hubapi.com')).lastIndexOf(true)
  assert.ok(lastHub < firstResend, 'the consent record lands before the list')

  const hs = calls.filter((c) => c.url.startsWith('https://api.hubapi.com'))
  assert.equal(hs[0].method, 'GET')
  assert.equal(hs[1].method, 'PATCH')
  assert.deepEqual(hs[1].body, { properties: { mapl_tips: 'yes', mapl_tips_at: '1800000000000', mapl_tips_source: 'code email', mapl_tips_text: 'Yes, send me trip tips', mapl_tips_default: 'unchecked' } })

  // The signed link proves the mailbox, so this path may lift a stop: the global flag goes off.
  // HubSpot had no yes before (a new yes), so once on the list the welcome series starts.
  const rs = calls.filter((c) => c.url.startsWith('https://api.resend.com'))
  assert.deepEqual(rs.map((c) => `${c.method} ${c.url}`), [
    'PATCH https://api.resend.com/contacts/guest@gmail.com',
    'POST https://api.resend.com/contacts',
    'POST https://api.resend.com/contacts/guest@gmail.com/segments/seg-1',
    'POST https://api.resend.com/events/send',
  ])
  assert.deepEqual(rs[0].body, { unsubscribed: false })
  assert.deepEqual(rs[1].body, { email: EMAIL, unsubscribed: false })
  assert.deepEqual(rs[3].body, { event: 'tips.subscribed', email: EMAIL, payload: { source: 'code email' } })
  assert.equal(calls.some((c) => c.url.includes('/audiences/')), false, 'never the legacy audience')
})

test('POST yes without a consent record: no HubSpot is 503, a HubSpot refusal is 502, and the list is never touched', async () => {
  const none = fakeFetch()
  const a = await handleTips(post(parts(link('yes'))), { ...env, HUBSPOT_SERVICE_KEY: undefined }, none.f)
  assert.equal(a.status, 503)
  assert.equal(none.calls.length, 0)
  const down = fakeFetch((c) => (c.url.includes('api.hubapi.com') && c.method !== 'GET' ? { status: 500 } : { status: 200, body: { id: '1' } }))
  const b = await handleTips(post(parts(link('yes'))), env, down.f)
  assert.equal(b.status, 502)
  assert.match(await b.text(), /<button type="submit">Yes, send me trip tips<\/button>/)
  assert.equal(down.calls.filter((c) => c.url.includes('api.resend.com')).length, 0)
})

test('POST yes with no TIPS_SEGMENT_ID: recorded in HubSpot, no list writes', async () => {
  const { f, calls } = fakeFetch(() => ({ status: 200, body: { id: '5' } }))
  const r = await handleTips(post(parts(link('yes'))), { ...env, TIPS_SEGMENT_ID: undefined }, f)
  assert.equal(r.status, 200)
  assert.equal(calls.filter((c) => c.url.includes('api.resend.com')).length, 0)
  assert.ok(calls.some((c) => c.url.includes('api.hubapi.com') && c.method === 'PATCH'))
})

test('POST stop: the global Resend flag set, HubSpot no with the stop source (with or without the segment)', async () => {
  for (const e of [env, { ...env, TIPS_SEGMENT_ID: undefined }]) {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { id: '9' } }))
    const r = await handleTips(post(parts(link('stop'))), e, f, 1_800_000_000_000)
    assert.equal(r.status, 200)
    assert.match(await r.text(), /Done\. No more trip tips\./)
    const rs = calls.filter((c) => c.url.startsWith('https://api.resend.com'))
    assert.deepEqual(rs.map((c) => `${c.method} ${c.url}`), ['PATCH https://api.resend.com/contacts/guest@gmail.com'])
    assert.deepEqual(rs[0].body, { unsubscribed: true })
    const patch = calls.find((c) => c.url.startsWith('https://api.hubapi.com') && c.method === 'PATCH')!
    assert.deepEqual(patch.body, { properties: { mapl_tips: 'no', mapl_tips_at: '1800000000000', mapl_tips_source: 'code email stop' } })
  }
})

test('POST stop for an address neither store has: still done, nothing created', async () => {
  const { f, calls } = fakeFetch(() => ({ status: 404, body: { message: 'not found' } }))
  const r = await handleTips(post(parts(link('stop'))), env, f)
  assert.equal(r.status, 200)
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0)
})

test('POST when a store refuses: 502, the button again, never "done"', async () => {
  const { f } = fakeFetch((c) => (c.url.includes('resend') ? { status: 500 } : { status: 200, body: { id: '1' } }))
  const r = await handleTips(post(parts(link('stop'))), env, f)
  assert.equal(r.status, 502)
  const html = await r.text()
  assert.match(html, /That did not go through\. Please tap the button again in a moment\./)
  assert.match(html, /<button type="submit">Stop trip tips<\/button>/)
  assert.doesNotMatch(html, /No more trip tips\./)
})

test('recordTips: a stop with no store configured is 503; only the configured store is called', async () => {
  assert.deepEqual(await recordTips('stop', EMAIL, {}, fakeFetch().f), { ok: false, status: 503 })
  assert.deepEqual(await recordTips('yes', EMAIL, { RESEND_API_KEY: 're_x', TIPS_SEGMENT_ID: 's' }, fakeFetch().f), { ok: false, status: 503 }, 'a yes needs its record')
  const { f, calls } = fakeFetch()
  const r = await recordTips('stop', EMAIL, { RESEND_API_KEY: 're_x' }, f)
  assert.equal(r.ok, true)
  assert.ok(calls.length > 0 && calls.every((c) => c.url.startsWith('https://api.resend.com')))
})

test('listState: none on 404, off when unsubscribed, on when not, unknown when the lookup fails', async () => {
  const at = (status: number, body?: unknown) => fakeFetch(() => ({ status, body })).f
  assert.equal(await listState(EMAIL, 're_x', at(404)), 'none')
  assert.equal(await listState(EMAIL, 're_x', at(200, { unsubscribed: true })), 'off')
  assert.equal(await listState(EMAIL, 're_x', at(200, { unsubscribed: false })), 'on')
  assert.equal(await listState(EMAIL, 're_x', at(200, {})), 'unknown')
  assert.equal(await listState(EMAIL, 're_x', at(500)), 'unknown')
  const down = (async () => { throw new Error('ECONNRESET') }) as unknown as typeof fetch
  assert.equal(await listState(EMAIL, 're_x', down), 'unknown')
  const probe = fakeFetch(() => ({ status: 404 }))
  await listState('a+b/c?d@gmail.com', 're_x', probe.f)
  assert.equal(probe.calls[0].url, 'https://api.resend.com/contacts/a%2Bb%2Fc%3Fd@gmail.com', 'odd characters stay inside the path')
})

test('listJoin (a form tick) is create-only: never PATCHes the flag, creates only when Resend has none, never for off', async () => {
  const none = fakeFetch()
  assert.equal((await listJoin(EMAIL, 're_x', 'seg', 'none', none.f)).ok, true)
  assert.deepEqual(none.calls.map((c) => `${c.method} ${c.url}`), ['POST https://api.resend.com/contacts', 'POST https://api.resend.com/contacts/guest@gmail.com/segments/seg'])
  assert.deepEqual(none.calls[0].body, { email: EMAIL }, 'no unsubscribed field at all')
  for (const state of ['on', 'unknown'] as const) {
    const x = fakeFetch()
    await listJoin(EMAIL, 're_x', 'seg', state, x.f)
    assert.deepEqual(x.calls.map((c) => c.method + ' ' + c.url), ['POST https://api.resend.com/contacts/guest@gmail.com/segments/seg'], state)
  }
  const off = fakeFetch()
  assert.deepEqual(await listJoin(EMAIL, 're_x', 'seg', 'off', off.f), { ok: false, status: 409 })
  assert.equal(off.calls.length, 0)
  const refused = fakeFetch(() => ({ status: 422 }))
  assert.equal((await listJoin(EMAIL, 're_x', 'seg', 'on', refused.f)).ok, false)
})

test('listResubscribe and listStop: the signed-link paths', async () => {
  const on = fakeFetch()
  assert.equal((await listResubscribe(EMAIL, 're_x', 'seg', on.f)).ok, true)
  assert.deepEqual(on.calls.map((c) => c.method), ['PATCH', 'POST'], 'existing contact: switched on, then the segment')
  const refused = fakeFetch(() => ({ status: 500 }))
  assert.deepEqual(await listResubscribe(EMAIL, 're_x', 'seg', refused.f), { ok: false, status: 500 })
  assert.equal(refused.calls.length, 1, 'no segment add after a failed switch')
  const gone = fakeFetch(() => ({ status: 404 }))
  assert.deepEqual(await listStop(EMAIL, 're_x', gone.f), { ok: true, status: 404 })
  const down = (async () => { throw new Error('ECONNRESET') }) as unknown as typeof fetch
  assert.deepEqual(await listStop(EMAIL, 're_x', down), { ok: false, status: 0 })
})

// ── The welcome series event (tips.subscribed) from the yes link ───────

const EVENTS = 'https://api.resend.com/events/send'
const events = (calls: Call[]) => calls.filter((c) => c.url === EVENTS)
/** HubSpot's lookup answers with this mapl_tips (absent = a contact without it), everything else succeeds. */
const hubspotHad = (mapl_tips?: string, over: (c: Call) => { status: number; body?: unknown } | undefined = () => undefined) => fakeFetch((c) => {
  const o = over(c)
  if (o) return o
  if (c.url.includes('api.hubapi.com') && c.method === 'GET') return { status: 200, body: { id: '7', properties: mapl_tips === undefined ? {} : { mapl_tips } } }
  return { status: 200, body: { id: '7' } }
})

test('yes link, a NEW yes (HubSpot was not yes): tips.subscribed once, after the segment add, source code email', async () => {
  for (const before of [undefined, 'no', '']) {
    const { f, calls } = hubspotHad(before)
    const r = await handleTips(post(parts(link('yes'))), env, f)
    assert.equal(r.status, 200, String(before))
    const ev = events(calls)
    assert.equal(ev.length, 1, String(before))
    assert.deepEqual(ev[0].body, { event: 'tips.subscribed', email: EMAIL, payload: { source: 'code email' } })
    assert.ok(calls.findIndex((c) => c.url.includes('/segments/')) < calls.indexOf(ev[0]), 'on the list first')
  }
  // A contact HubSpot never had is created with the yes: also new.
  const made = fakeFetch((c) => (c.url.includes('api.hubapi.com') && c.method === 'GET' ? { status: 404 } : { status: 200, body: { id: '8' } }))
  assert.equal((await handleTips(post(parts(link('yes'))), env, made.f)).status, 200)
  assert.equal(events(made.calls).length, 1)
})

/** The contact's segment list, as Resend answers it. */
const SEGMENTS = /^https:\/\/api\.resend\.com\/contacts\/[^/]+\/segments$/
const segmentsAre = (ids: string[]) => (c: Call) => (c.method === 'GET' && SEGMENTS.test(c.url) ? { status: 200, body: { object: 'list', has_more: false, data: ids.map((id) => ({ id, name: id })) } } : undefined)

test('yes link over a yes already on record and on the list: no event (the series is not restarted)', async () => {
  const { f, calls } = hubspotHad('yes', segmentsAre(['seg-1']))
  const r = await handleTips(post(parts(link('yes'))), env, f)
  assert.equal(r.status, 200)
  assert.ok(calls.some((c) => c.url.includes('/segments/')), 'still re-added to the list')
  const lookup = calls.findIndex((c) => c.method === 'GET' && SEGMENTS.test(c.url))
  assert.ok(lookup >= 0 && lookup < calls.findIndex((c) => c.method === 'POST' && c.url.includes('/segments/seg-1')), 'membership read before the join')
  assert.equal(events(calls).length, 0)
})

test('yes link over a yes whose membership lookup fails: no event', async () => {
  const { f, calls } = hubspotHad('yes', (c) => (c.method === 'GET' && SEGMENTS.test(c.url) ? { status: 500 } : undefined))
  assert.equal((await handleTips(post(parts(link('yes'))), env, f)).status, 200)
  assert.equal(events(calls).length, 0)
})

test('yes link tapped again after the list refused the first tap: the second tap starts the series, once', async () => {
  // HubSpot keeps what the first tap wrote; Resend refuses the segment add the first time only.
  let hub: string | undefined = 'no'
  let segmentDown = true
  let member = false
  const { f, calls } = fakeFetch((c) => {
    if (c.url.includes('api.hubapi.com')) {
      if (c.method === 'GET') return { status: 200, body: { id: '7', properties: hub === undefined ? {} : { mapl_tips: hub } } }
      hub = String((c.body?.properties as Record<string, unknown>)?.mapl_tips ?? hub)
      return { status: 200, body: { id: '7' } }
    }
    if (c.method === 'GET' && SEGMENTS.test(c.url)) return { status: 200, body: { object: 'list', has_more: false, data: member ? [{ id: 'seg-1' }] : [] } }
    if (c.method === 'POST' && c.url.endsWith('/segments/seg-1')) { if (segmentDown) return { status: 500 }; member = true }
    return { status: 200, body: { id: '7' } }
  })
  const first = await handleTips(post(parts(link('yes'))), env, f)
  assert.equal(first.status, 502, 'the page offers the button again')
  assert.equal(hub, 'yes')
  assert.equal(events(calls).length, 0)
  segmentDown = false
  assert.equal((await handleTips(post(parts(link('yes'))), env, f)).status, 200)
  assert.equal(events(calls).length, 1, 'the series starts on the second tap')
  assert.equal((await handleTips(post(parts(link('yes'))), env, f)).status, 200)
  assert.equal(events(calls).length, 1, 'and never again once on the list')
})

test('yes link: no event without TIPS_SEGMENT_ID, or when the list refuses', async () => {
  const noSeg = hubspotHad('no')
  assert.equal((await handleTips(post(parts(link('yes'))), { ...env, TIPS_SEGMENT_ID: undefined }, noSeg.f)).status, 200)
  assert.equal(events(noSeg.calls).length, 0)
  const refused = hubspotHad('no', (c) => (c.url.includes('/segments/') ? { status: 500 } : undefined))
  assert.equal((await handleTips(post(parts(link('yes'))), env, refused.f)).status, 502)
  assert.equal(events(refused.calls).length, 0)
})

test('stop link: never an event', async () => {
  const { f, calls } = hubspotHad('yes')
  assert.equal((await handleTips(post(parts(link('stop'))), env, f)).status, 200)
  assert.equal(events(calls).length, 0)
})

test('yes link: a refused or failing event is logged and the page still says done', async () => {
  for (const fail of [{ status: 422, body: { message: 'nope' } }, { status: 500 }]) {
    const { f, calls } = hubspotHad('no', (c) => (c.url === EVENTS ? fail : undefined))
    const r = await handleTips(post(parts(link('yes'))), env, f)
    assert.equal(r.status, 200)
    assert.match(await r.text(), /You are in\./)
    assert.equal(events(calls).length, 1)
  }
  // A network error on the event is swallowed too.
  const base = hubspotHad('no').f
  const throwing = (async (url: string, init?: RequestInit) => { if (url === EVENTS) throw new Error('ECONNRESET'); return base(url, init) }) as unknown as typeof fetch
  assert.equal((await handleTips(post(parts(link('yes'))), env, throwing)).status, 200)
})

test('tipsSubscribed: the REST body, snake_case event send, address lower-cased; never throws', async () => {
  const { f, calls } = fakeFetch(() => ({ status: 200, body: { object: 'event', event: 'tips.subscribed' } }))
  assert.deepEqual(await tipsSubscribed(' Guest@Gmail.com ', 're_x', 'bio hero', f), { ok: true, status: 200 })
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].url, EVENTS)
  assert.deepEqual(calls[0].body, { event: 'tips.subscribed', email: EMAIL, payload: { source: 'bio hero' } })
  const down = (async () => { throw new Error('ECONNRESET') }) as unknown as typeof fetch
  assert.deepEqual(await tipsSubscribed(EMAIL, 're_x', 'bio hero', down), { ok: false, status: 0 })
})
