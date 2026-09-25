import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@netlify/functions'
import { RELAY_HEADER, readLead, relayAuthorized, tipsSource } from '../netlify/lib/lead-input.mts'
import { countryCode } from '../netlify/lib/http.mts'
import lead from '../netlify/functions/lead.mts'
import geo from '../netlify/functions/geo.mts'
import { verifyTips } from '../netlify/lib/tips.mts'

const jsonReq = (body: unknown, headers: Record<string, string> = {}) => new Request('https://bio.mapltours.com/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const RELAY = 'relay-secret-not-real'
const relayed = (body: Record<string, unknown>, key = RELAY) => jsonReq({ channel: 'site', ...body }, { [RELAY_HEADER]: key })
const formReq = (fields: Record<string, string>) => new Request('https://bio.mapltours.com/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() })
const ctx = (code?: string) => ({ geo: code ? { country: { code } } : {} }) as unknown as Context

// ── Parsing ─────────────────────────────────────────────────────────────

test('JSON: optIn only when exactly true; optInDefault only unchecked when exactly "unchecked"', async () => {
  const r = await readLead(jsonReq({ email: 'a@b.co', optIn: true, optInDefault: 'unchecked', source: 'bio_hero' }), 'CA')
  assert.equal(r?.optIn, true)
  assert.equal(r?.optInDefault, 'unchecked')
  assert.equal(r?.country, 'CA')
  assert.equal(r?.place, 'bio_hero')
  for (const optIn of ['true', 1, 'yes', null, {}]) assert.equal((await readLead(jsonReq({ email: 'a@b.co', optIn }), 'US'))?.optIn, false, String(optIn))
  for (const d of ['UNCHECKED', 'checked', '', 7, null, undefined]) assert.equal((await readLead(jsonReq({ email: 'a@b.co', optIn: true, optInDefault: d }), 'US'))?.optInDefault, 'checked', String(d))
  // An older page (or the site before its relay change) sends neither: no tips.
  const old = await readLead(jsonReq({ email: 'a@b.co' }), 'US')
  assert.equal(old?.optIn, false)
})

test('country: Netlify geo for the bio page; the relay body for mapltours.com, strictly two A-Z letters', async () => {
  // A bio request cannot pick its own country.
  assert.equal((await readLead(jsonReq({ email: 'a@b.co', country: 'US' }), 'GB', RELAY))?.country, 'GB')
  assert.equal((await readLead(jsonReq({ email: 'a@b.co' }), undefined, RELAY))?.country, null)
  // The relay, proved by the shared secret: context.geo is the mapltours server, so it is ignored.
  const r = await readLead(relayed({ email: 'a@b.co', country: 'CA' }), 'US', RELAY)
  assert.equal(r?.channel, 'site')
  assert.equal(r?.country, 'CA')
  for (const c of ['us', 'USA', 'U1', '', ' US', 12, null, undefined]) assert.equal((await readLead(relayed({ email: 'a@b.co', country: c }), 'US', RELAY))?.country, null, String(c))
  assert.equal(countryCode('JM'), 'JM')
  assert.equal(countryCode('jm'), null)
})

test('relay claim without the secret: recorded as the bio page, with no country (neither the body nor the relay\'s geo)', async () => {
  const cases: Array<[Request, string | undefined]> = [
    [jsonReq({ email: 'a@b.co', channel: 'site', country: 'US' }), RELAY], // no header
    [relayed({ email: 'a@b.co', country: 'US' }, 'wrong'), RELAY], // wrong key
    [relayed({ email: 'a@b.co', country: 'US' }, RELAY.slice(0, -1)), RELAY], // a prefix of it
    [relayed({ email: 'a@b.co', country: 'US' }), undefined], // the secret is unset on this site
    [relayed({ email: 'a@b.co', country: 'US' }), ''],
  ]
  for (const [req, secret] of cases) {
    const r = await readLead(req, 'US', secret)
    assert.equal(r?.channel, 'bio')
    assert.equal(r?.country, null, 'geo here is the relay server, so no country at all')
  }
  assert.equal(relayAuthorized(relayed({}), RELAY), true)
  assert.equal(relayAuthorized(relayed({}, `${RELAY}x`), RELAY), false)
  assert.equal(relayAuthorized(jsonReq({}), undefined), false)
})

test('form post (no JavaScript): tips=yes is the tick, the default is always unchecked, place names the form', async () => {
  const on = await readLead(formReq({ email: 'a@b.co', website: '', tips: 'yes', place: 'bio_hero' }), 'GB')
  assert.deepEqual({ ...on, email: undefined }, { isForm: true, email: undefined, website: '', source: 'bio-nojs', page: '', eventId: null, channel: 'bio', optIn: true, optInDefault: 'unchecked', country: 'GB', place: 'bio_hero' })
  assert.equal((await readLead(formReq({ email: 'a@b.co' }), 'US'))?.optIn, false)
  assert.equal((await readLead(formReq({ email: 'a@b.co', tips: 'on' }), 'US'))?.optIn, false)
})

test('unreadable bodies are null (the function answers 400)', async () => {
  assert.equal(await readLead(new Request('https://x.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' }), null), null)
  assert.equal(await readLead(jsonReq(['a@b.co']), null), null)
  assert.equal(await readLead(jsonReq('a@b.co'), null), null)
})

test('tips source: site popup, bio hero, bio coupon', () => {
  assert.equal(tipsSource({ channel: 'site', place: 'bio_hero' }), 'site popup')
  assert.equal(tipsSource({ channel: 'bio', place: 'bio_hero' }), 'bio hero')
  assert.equal(tipsSource({ channel: 'bio', place: 'bio_coupon' }), 'bio coupon')
  assert.equal(tipsSource({ channel: 'bio', place: '' }), 'bio coupon')
})

// ── The function, end to end with every API faked ──────────────────────

type Call = { method: string; url: string; body: Record<string, unknown> | undefined }
type Reply = { status: number; body?: unknown } | undefined

/**
 * Runs the function with every API faked. By default HubSpot and Resend have
 * never seen the address (404 on lookups) and every write succeeds;
 * `answer` overrides any call (return undefined for the default).
 */
async function run(req: Request, c: Context, env: Record<string, string | undefined>, answer: (c: Call) => Reply = () => undefined) {
  const calls: Call[] = []
  const realFetch = globalThis.fetch
  const saved: Record<string, string | undefined> = {}
  const keys = ['RESEND_API_KEY', 'BIO_AUDIENCE_ID', 'TIPS_SEGMENT_ID', 'HUBSPOT_SERVICE_KEY', 'TIPS_SECRET', 'LEAD_RELAY_SECRET', 'META_PIXEL_ID', 'META_CAPI_TOKEN']
  for (const k of keys) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k] }
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const a = answer(call)
    if (a) return new Response(JSON.stringify(a.body ?? {}), { status: a.status })
    if (call.method === 'GET' && (call.url.includes('api.hubapi.com') || call.url.includes('api.resend.com/contacts/'))) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify({ id: 'x1' }), { status: 200 })
  }) as typeof fetch
  try {
    const res = await lead(req, c)
    return { res, calls }
  } finally {
    globalThis.fetch = realFetch
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

// BIO_AUDIENCE_ID is set on purpose: it holds every past code requester and must never be written.
const ENV = { RESEND_API_KEY: 're_test', BIO_AUDIENCE_ID: 'aud-legacy', TIPS_SEGMENT_ID: 'seg-1', HUBSPOT_SERVICE_KEY: 'pat-test', TIPS_SECRET: 'test-secret', LEAD_RELAY_SECRET: RELAY }
const EMAILS = 'https://api.resend.com/emails'
const sentEmail = (calls: Call[]) => calls.find((c) => c.url === EMAILS)!.body as { html: string; tags: Array<{ name: string; value: string }> }
/** Resend contact writes (anything but the lookup). */
const listWrites = (calls: Call[]) => calls.filter((c) => c.url.startsWith('https://api.resend.com/') && c.url !== EMAILS && c.method !== 'GET')
const hubCreated = (calls: Call[]) => calls.find((c) => c.url === 'https://api.hubapi.com/crm/v3/objects/contacts' && c.method === 'POST')!.body!.properties as Record<string, string>
const hubPatched = (calls: Call[]) => calls.find((c) => c.url.startsWith('https://api.hubapi.com/crm/v3/objects/contacts/') && c.method === 'PATCH')!.body!.properties as Record<string, string>
const TIPS_KEYS = ['mapl_tips', 'mapl_tips_at', 'mapl_tips_source', 'mapl_tips_text', 'mapl_tips_default']
const neverLegacy = (calls: Call[]) => assert.equal(calls.filter((c) => c.url.includes('/audiences/')).length, 0, 'BIO_AUDIENCE_ID is never touched')

test('US visitor, box left pre-ticked: consent; HubSpot yes first, then the email, then the tips segment (create-only)', async () => {
  const { res, calls } = await run(jsonReq({ email: 'Guest@Gmail.com', source: 'bio_hero', optIn: true, optInDefault: 'checked' }), ctx('US'), ENV)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('netlify-cdn-cache-control'), 'no-store')
  const j = await res.json()
  assert.equal(j.tips, true)
  const mail = sentEmail(calls)
  assert.deepEqual(mail.tags.find((t) => t.name === 'tips'), { name: 'tips', value: 'yes' })
  assert.match(mail.html, /You asked for this code and for trip tips at bio\.mapltours\.com\./)
  const stop = /href="(https:\/\/bio\.mapltours\.com\/tips\?[^"]+)"[^>]*>Stop trip tips</.exec(mail.html)?.[1].replace(/&amp;/g, '&')
  assert.ok(stop, 'stop link present')
  const u = new URL(stop!)
  assert.deepEqual(verifyTips(u.searchParams.get('a'), u.searchParams.get('e'), u.searchParams.get('t'), 'test-secret'), { action: 'stop', email: 'guest@gmail.com' })
  assert.doesNotMatch(mail.html, /Trip tips before you fly\?/)
  // The list: looked up, created because Resend had none, added to the segment. Never a PATCH.
  const list = calls.filter((c) => c.url.startsWith('https://api.resend.com/contacts'))
  assert.deepEqual(list.map((c) => `${c.method} ${c.url.slice('https://api.resend.com'.length)}`), ['GET /contacts/guest@gmail.com', 'POST /contacts', 'POST /contacts/guest@gmail.com/segments/seg-1'])
  assert.deepEqual(list[1].body, { email: 'guest@gmail.com' })
  neverLegacy(calls)
  // The record before the email, the email before the list.
  const at = (pred: (c: Call) => boolean) => calls.findIndex(pred)
  const hub = at((c) => c.url.startsWith('https://api.hubapi.com') && c.method === 'POST')
  const mailAt = at((c) => c.url === EMAILS)
  const seg = at((c) => c.url.includes('/segments/'))
  assert.ok(hub < mailAt && mailAt < seg, `order ${hub} ${mailAt} ${seg}`)
  const created = hubCreated(calls)
  assert.equal(created.mapl_tips, 'yes')
  assert.equal(created.mapl_tips_source, 'bio hero')
  assert.equal(created.mapl_tips_text, 'Send me Jamaica trip tips from MAPL Tours Jamaica, about twice a month. Unsubscribe anytime.')
  assert.equal(created.mapl_tips_default, 'checked')
  assert.equal(created.mapl_country, 'US')
  assert.match(created.mapl_tips_at, /^\d{13}$/)
})

test('Canadian visitor with a box that arrived ticked: not consent; no list, HubSpot no, the yes card instead', async () => {
  const { res, calls } = await run(jsonReq({ email: 'guest@gmail.com', source: 'bio_coupon', optIn: true, optInDefault: 'checked' }), ctx('CA'), ENV)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).tips, false)
  assert.equal(listWrites(calls).length, 0, 'never added to the list')
  neverLegacy(calls)
  const mail = sentEmail(calls)
  assert.deepEqual(mail.tags.find((t) => t.name === 'tips'), { name: 'tips', value: 'no' })
  assert.match(mail.html, /Trip tips before you fly\?/)
  assert.match(mail.html, /Trip tips before you fly\?/)
  const created = hubCreated(calls)
  assert.equal(created.mapl_tips, 'no')
  assert.equal(created.mapl_tips_default, undefined)
  assert.equal(created.mapl_country, 'CA')
})

test('Canadian visitor who ticked the box themselves: consent', async () => {
  const { res, calls } = await run(jsonReq({ email: 'guest@gmail.com', source: 'bio_coupon', optIn: true, optInDefault: 'unchecked' }), ctx('CA'), ENV)
  assert.equal((await res.json()).tips, true)
  const created = hubCreated(calls)
  assert.equal(created.mapl_tips_default, 'unchecked')
  assert.equal(created.mapl_tips_source, 'bio coupon')
})

test('site relay with the shared secret: country from the body, source site popup, footer names mapltours.com', async () => {
  const { res, calls } = await run(relayed({ email: 'guest@gmail.com', source: 'site_popup', country: 'US', optIn: true, optInDefault: 'checked' }), ctx('JM'), ENV)
  assert.equal((await res.json()).tips, true)
  assert.match(sentEmail(calls).html, /for trip tips at mapltours\.com\./)
  const created = hubCreated(calls)
  assert.equal(created.mapl_country, 'US')
  assert.equal(created.mapl_tips_source, 'site popup')
  assert.equal(created.mapl_source, 'site popup')
})

test('a forged relay (no secret) cannot claim a US pre-tick: bio source, no country, not consent', async () => {
  // A direct POST from a server Netlify places in the US, claiming to be the site's popup.
  for (const req of [jsonReq({ email: 'guest@gmail.com', channel: 'site', country: 'US', optIn: true, optInDefault: 'checked' }), relayed({ email: 'guest@gmail.com', country: 'US', optIn: true, optInDefault: 'checked' }, 'guess')]) {
    const { res, calls } = await run(req, ctx('US'), ENV)
    assert.equal((await res.json()).tips, false)
    assert.equal(listWrites(calls).length, 0)
    const created = hubCreated(calls)
    assert.equal(created.mapl_source, 'bio coupon')
    assert.equal(created.mapl_country, undefined)
    assert.equal(created.mapl_tips, 'no')
    assert.match(sentEmail(calls).html, /You asked for this code at bio\.mapltours\.com\. To hear nothing more/)
  }
})

test('an address that stopped in Resend: no form lifts it, pre-ticked or self-ticked; the yes card instead', async () => {
  for (const optInDefault of ['checked', 'unchecked']) {
    const { res, calls } = await run(jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault }), ctx('US'), ENV, (c) =>
      c.method === 'GET' && c.url === 'https://api.resend.com/contacts/guest@gmail.com' ? { status: 200, body: { email: 'guest@gmail.com', unsubscribed: true } } : undefined)
    assert.equal((await res.json()).tips, false, optInDefault)
    assert.equal(listWrites(calls).length, 0, 'no PATCH, no create, no segment')
    assert.notEqual(hubCreated(calls).mapl_tips, 'yes')
    const mail = sentEmail(calls)
    assert.match(mail.html, /Trip tips before you fly\?/)
    assert.deepEqual(mail.tags.find((t) => t.name === 'tips'), { name: 'tips', value: 'no' })
  }
})

test('an address that stopped via the email link (HubSpot): a later tick does not write yes or join the list', async () => {
  const { res, calls } = await run(jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' }), ctx('CA'), ENV, (c) => {
    if (c.method === 'GET' && c.url.includes('api.hubapi.com')) return { status: 200, body: { id: '7', properties: { mapl_tips: 'no', mapl_tips_source: 'code email stop' } } }
    if (c.method === 'GET' && c.url.includes('api.resend.com/contacts/')) return { status: 200, body: { unsubscribed: false } }
    return undefined
  })
  assert.equal((await res.json()).tips, false)
  assert.equal(listWrites(calls).length, 0)
  const patched = hubPatched(calls)
  for (const k of TIPS_KEYS) assert.equal(patched[k], undefined, k)
  assert.match(sentEmail(calls).html, /Trip tips before you fly\?/)
})

test('already on the list, no tick this time: the opted-in email with the stop link, no card; the yes is kept', async () => {
  const { res, calls } = await run(jsonReq({ email: 'guest@gmail.com', optIn: false, optInDefault: 'unchecked' }), ctx('GB'), ENV, (c) => {
    if (c.method === 'GET' && c.url.includes('api.hubapi.com')) return { status: 200, body: { id: '7', properties: { mapl_tips: 'yes', mapl_tips_source: 'bio hero' } } }
    if (c.method === 'GET' && c.url.includes('api.resend.com/contacts/')) return { status: 200, body: { unsubscribed: false } }
    return undefined
  })
  assert.equal((await res.json()).tips, true)
  const mail = sentEmail(calls)
  assert.match(mail.html, /You asked for this code and for trip tips at/)
  assert.match(mail.html, />Stop trip tips</)
  assert.doesNotMatch(mail.html, /Trip tips before you fly\?/)
  assert.deepEqual(mail.tags.find((t) => t.name === 'tips'), { name: 'tips', value: 'yes' })
  for (const k of TIPS_KEYS) assert.equal(hubPatched(calls)[k], undefined, k)
  // Re-added to the segment (heals a failed join), never created, never PATCHed.
  assert.deepEqual(listWrites(calls).map((c) => `${c.method} ${c.url}`), ['POST https://api.resend.com/contacts/guest@gmail.com/segments/seg-1'])
})

test('no consent record, no list: HubSpot unset, refusing, or missing the tips properties', async () => {
  const req = () => jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' })
  const unset = await run(req(), ctx('CA'), { ...ENV, HUBSPOT_SERVICE_KEY: undefined })
  const refusing = await run(req(), ctx('CA'), ENV, (c) => (c.url.includes('api.hubapi.com') && c.method === 'POST' ? { status: 500, body: { message: 'down' } } : undefined))
  let first = true
  const missing = await run(req(), ctx('CA'), ENV, (c) => {
    if (!(c.url.includes('api.hubapi.com') && c.method === 'POST')) return undefined
    if (first) { first = false; return { status: 400, body: { message: 'Property "mapl_tips" does not exist', category: 'VALIDATION_ERROR' } } }
    return { status: 201, body: { id: '3' } }
  })
  for (const [name, r] of [['unset', unset], ['refusing', refusing], ['missing', missing]] as const) {
    assert.equal(r.res.status, 200, name)
    assert.equal((await r.res.json()).tips, false, name)
    assert.equal(listWrites(r.calls).length, 0, name)
    assert.match(sentEmail(r.calls).html, /Trip tips before you fly\?/, name)
  }
})

test('no TIPS_SEGMENT_ID: the yes is recorded, nobody is put on any list', async () => {
  const { res, calls } = await run(jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' }), ctx('GB'), { ...ENV, TIPS_SEGMENT_ID: undefined })
  assert.equal((await res.json()).tips, true)
  assert.equal(hubCreated(calls).mapl_tips, 'yes')
  assert.equal(listWrites(calls).length, 0)
  neverLegacy(calls)
})

test('no TIPS_SECRET: no card, no stop link, no /tips link at all; consent still recorded', async () => {
  const no = await run(jsonReq({ email: 'guest@gmail.com', optIn: false }), ctx('GB'), { ...ENV, TIPS_SECRET: undefined })
  assert.doesNotMatch(sentEmail(no.calls).html, /\/tips\?|Trip tips before you fly/)
  const yes = await run(jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' }), ctx('GB'), { ...ENV, TIPS_SECRET: undefined })
  assert.doesNotMatch(sentEmail(yes.calls).html, /\/tips\?|Stop trip tips/)
  assert.equal((await yes.res.json()).tips, true)
})

test('no-JS form post: redirect with no-store, the tick is consent (the box renders unticked)', async () => {
  const { res, calls } = await run(formReq({ email: 'guest@gmail.com', website: '', tips: 'yes', place: 'bio_hero' }), ctx('GB'), ENV)
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), 'https://bio.mapltours.com/?sent=1#coupon')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('netlify-cdn-cache-control'), 'no-store')
  const created = hubCreated(calls)
  assert.equal(created.mapl_tips, 'yes')
  assert.equal(created.mapl_tips_default, 'unchecked')
  assert.equal(created.mapl_tips_source, 'bio hero')
  assert.equal(created.mapl_capture, 'bio-nojs')
})

test('honeypot and bad bodies: nothing sent, no-store answers', async () => {
  const hp = await run(jsonReq({ email: 'guest@gmail.com', website: 'x', optIn: true, optInDefault: 'unchecked' }), ctx('US'), ENV)
  assert.equal(hp.res.status, 200)
  assert.equal(hp.calls.length, 0)
  const bad = await run(new Request('https://bio.mapltours.com/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'nope' }), ctx('US'), ENV)
  assert.equal(bad.res.status, 400)
  assert.equal(bad.res.headers.get('netlify-cdn-cache-control'), 'no-store')
  const get = await run(new Request('https://bio.mapltours.com/api/lead'), ctx('US'), ENV)
  assert.equal(get.res.status, 405)
  assert.equal(get.res.headers.get('netlify-cdn-cache-control'), 'no-store')
})

test('/api/geo: the visitor country or null, never cached', async () => {
  for (const [code, want] of [['US', 'US'], ['CA', 'CA'], [undefined, null], ['us', null], ['XYZ', null]] as const) {
    const r = await geo(new Request('https://bio.mapltours.com/api/geo'), ctx(code))
    assert.deepEqual(await r.json(), { country: want })
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.equal(r.headers.get('netlify-cdn-cache-control'), 'no-store')
  }
  const bare = await geo(new Request('https://bio.mapltours.com/api/geo'), {} as Context)
  assert.deepEqual(await bare.json(), { country: null })
})

// ── The welcome series event (tips.subscribed) ─────────────────────────

const EVENTS = 'https://api.resend.com/events/send'
const events = (calls: Call[]) => calls.filter((c) => c.url === EVENTS)
/**
 * HubSpot's lookup answers with these properties, Resend's with this contact
 * state, and the contact's segment list with these segment ids (none by
 * default; `null` makes that lookup fail).
 */
const had = (props: Record<string, string> | null, resend: { unsubscribed: boolean } | null = null, segments: string[] | null = []) => (c: Call): Reply => {
  if (c.method === 'GET' && c.url.includes('api.hubapi.com')) return props ? { status: 200, body: { id: '7', properties: props } } : undefined
  if (c.method === 'GET' && /api\.resend\.com\/contacts\/[^/]+\/segments$/.test(c.url)) {
    if (!resend) return undefined
    return segments ? { status: 200, body: { object: 'list', has_more: false, data: segments.map((id) => ({ id, name: id })) } } : { status: 500, body: { message: 'down' } }
  }
  if (c.method === 'GET' && c.url.includes('api.resend.com/contacts/')) return resend ? { status: 200, body: resend } : undefined
  return undefined
}
const segmentLookups = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.url.endsWith('/segments'))

test('a NEW yes that joins the segment: tips.subscribed once, after the segment add, with the capture as the source', async () => {
  const cases: Array<[Request, Context, string]> = [
    [jsonReq({ email: 'Guest@Gmail.com', source: 'bio_hero', optIn: true, optInDefault: 'checked' }), ctx('US'), 'bio hero'],
    [jsonReq({ email: 'guest@gmail.com', source: 'bio_coupon', optIn: true, optInDefault: 'unchecked' }), ctx('CA'), 'bio coupon'],
    [relayed({ email: 'guest@gmail.com', source: 'site_popup', country: 'US', optIn: true, optInDefault: 'checked' }), ctx('JM'), 'site popup'],
    [formReq({ email: 'guest@gmail.com', website: '', tips: 'yes', place: 'bio_hero' }), ctx('GB'), 'bio hero'],
  ]
  for (const [req, c, source] of cases) {
    const { calls } = await run(req, c, ENV)
    const ev = events(calls)
    assert.equal(ev.length, 1, source)
    assert.deepEqual(ev[0].body, { event: 'tips.subscribed', email: 'guest@gmail.com', payload: { source } })
    assert.ok(calls.findIndex((x) => x.url.includes('/segments/seg-1')) < calls.indexOf(ev[0]), 'on the list before the event')
  }
})

test('a yes over a HubSpot "no" that was not a stop (asked for the code before without the box): new, so the event fires', async () => {
  const { res, calls } = await run(jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' }), ctx('CA'), ENV, had({ mapl_tips: 'no', mapl_tips_source: '' }, { unsubscribed: false }))
  assert.equal((await res.json()).tips, true)
  assert.equal(hubPatched(calls).mapl_tips, 'yes')
  assert.equal(events(calls).length, 1)
})

test('repeat code request from someone already on the list: no event, ticked or not', async () => {
  for (const optIn of [true, false]) {
    const { res, calls } = await run(jsonReq({ email: 'guest@gmail.com', optIn, optInDefault: 'unchecked' }), ctx('GB'), ENV, had({ mapl_tips: 'yes', mapl_tips_source: 'bio hero' }, { unsubscribed: false }, ['seg-other', 'seg-1']))
    assert.equal((await res.json()).tips, true, String(optIn))
    assert.ok(calls.some((c) => c.url.includes('/segments/seg-1')), 'the segment join still heals')
    assert.equal(segmentLookups(calls).length, 1, 'membership read once, before the join')
    assert.ok(calls.indexOf(segmentLookups(calls)[0]) < calls.findIndex((c) => c.method === 'POST' && c.url.includes('/segments/seg-1')))
    assert.equal(events(calls).length, 0, String(optIn))
  }
})

test('double submit, the second request: its contact lookup said none, but the first request has since joined the segment, so no second event', async () => {
  // Request B read Resend before request A created the contact (404), and by
  // the time B checks the series A has recorded the yes and joined seg-1.
  const answer = (c: Call): Reply => {
    if (c.method === 'GET' && c.url.includes('api.hubapi.com')) return { status: 200, body: { id: '7', properties: { mapl_tips: 'yes', mapl_tips_source: 'bio hero' } } }
    if (c.method === 'GET' && /api\.resend\.com\/contacts\/[^/]+\/segments$/.test(c.url)) return { status: 200, body: { object: 'list', has_more: false, data: [{ id: 'seg-1', name: 'Trip tips' }] } }
    if (c.method === 'GET' && c.url.includes('api.resend.com/contacts/')) return { status: 404, body: { message: 'not found' } }
    return undefined
  }
  const { res, calls } = await run(formReq({ email: 'guest@gmail.com', tips: 'yes' }), ctx('GB'), ENV, answer)
  assert.equal(res.status, 303)
  assert.equal(segmentLookups(calls).length, 1, 'membership is read live, not taken from the earlier contact lookup')
  assert.equal(events(calls).length, 0, 'the series was started by the first request')
})

test('a standing yes whose membership lookup fails starts nothing (a second run would mail every tip twice)', async () => {
  const { res, calls } = await run(jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' }), ctx('GB'), ENV, had({ mapl_tips: 'yes', mapl_tips_source: 'bio hero' }, { unsubscribed: false }, null))
  assert.equal(res.status, 200)
  assert.ok(calls.some((c) => c.method === 'POST' && c.url.includes('/segments/seg-1')), 'still joins')
  assert.equal(events(calls).length, 0)
})

/**
 * A fake HubSpot and Resend that remember what earlier requests wrote, so a
 * retry sees the state the failed request left behind.
 */
function world() {
  const s = { hub: null as Record<string, unknown> | null, contact: false, onSegment: false, emailFails: false, segmentFails: false }
  const answer = (c: Call): Reply => {
    if (c.url.includes('api.hubapi.com')) {
      if (c.method === 'GET') return s.hub ? { status: 200, body: { id: '7', properties: s.hub } } : { status: 404, body: {} }
      if (c.method === 'POST' && c.url.endsWith('/crm/v3/objects/contacts')) { s.hub = { ...(c.body?.properties as object) }; return { status: 201, body: { id: '7' } } }
      if (c.method === 'PATCH') { s.hub = { ...s.hub, ...(c.body?.properties as object) }; return { status: 200, body: { id: '7' } } }
      return undefined
    }
    if (c.url === EMAILS) return s.emailFails ? { status: 500, body: { message: 'down' } } : undefined
    if (c.method === 'GET' && c.url.endsWith('/segments')) return s.contact ? { status: 200, body: { object: 'list', has_more: false, data: s.onSegment ? [{ id: 'seg-1' }] : [] } } : { status: 404, body: {} }
    if (c.method === 'GET' && c.url.startsWith('https://api.resend.com/contacts/')) return s.contact ? { status: 200, body: { unsubscribed: false } } : { status: 404, body: {} }
    if (c.method === 'POST' && c.url === 'https://api.resend.com/contacts') { s.contact = true; return { status: 201, body: { id: 'c1' } } }
    if (c.method === 'POST' && c.url.endsWith('/segments/seg-1')) {
      if (s.segmentFails) return { status: 500, body: { message: 'down' } }
      s.onSegment = true
      return undefined
    }
    return undefined
  }
  return { s, answer }
}

test('the retry after a failed code email starts the series: HubSpot took the yes on the first try, the list did not', async () => {
  const w = world()
  const req = () => jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' })
  w.s.emailFails = true
  const first = await run(req(), ctx('GB'), ENV, w.answer)
  assert.equal(first.res.status, 502, 'the page asks them to try again')
  assert.equal(w.s.hub?.mapl_tips, 'yes', 'the consent record was written before the send')
  assert.equal(events(first.calls).length, 0)
  w.s.emailFails = false
  const retry = await run(req(), ctx('GB'), ENV, w.answer)
  assert.equal(retry.res.status, 200)
  assert.equal((await retry.res.json()).tips, true)
  assert.equal(events(retry.calls).length, 1, 'the series starts on the retry')
  // Once on the list, a later request starts nothing.
  const again = await run(req(), ctx('GB'), ENV, w.answer)
  assert.equal(events(again.calls).length, 0)
  assert.equal([first, retry, again].reduce((n, r) => n + events(r.calls).length, 0), 1, 'exactly one tips.subscribed')
})

test('the retry after a refused segment add starts the series (the contact exists, the segment does not have it)', async () => {
  const w = world()
  const req = () => jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' })
  w.s.segmentFails = true
  const first = await run(req(), ctx('GB'), ENV, w.answer)
  assert.equal(first.res.status, 200)
  assert.equal(events(first.calls).length, 0, 'not on the list, so no series yet')
  assert.equal(w.s.contact, true)
  w.s.segmentFails = false
  const retry = await run(jsonReq({ email: 'guest@gmail.com', optIn: false, optInDefault: 'unchecked' }), ctx('GB'), ENV, w.answer)
  assert.equal(segmentLookups(retry.calls).length, 1)
  assert.equal(events(retry.calls).length, 1)
})

test('tips.subscribed: a 429 is retried once; any other refusal is not (a 5xx may have started a run)', async () => {
  const { tipsSubscribed } = await import('../netlify/lib/tips.mts')
  const answers = [429, 200]
  const seen: number[] = []
  const f = (async () => { const status = answers.shift() ?? 500; seen.push(status); return new Response('{}', { status }) }) as unknown as typeof fetch
  assert.deepEqual(await tipsSubscribed('guest@gmail.com', 're_x', 'bio hero', f, async () => {}), { ok: true, status: 200 })
  assert.deepEqual(seen, [429, 200])
  for (const status of [500, 422, 404]) {
    let n = 0
    const g = (async () => { n++; return new Response('{}', { status }) }) as unknown as typeof fetch
    assert.equal((await tipsSubscribed('guest@gmail.com', 're_x', 'bio hero', g, async () => {})).ok, false)
    assert.equal(n, 1, String(status))
  }
})

test('no event for a stop, or for a pre-ticked box that is not consent', async () => {
  const resendOff = await run(jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' }), ctx('US'), ENV, had(null, { unsubscribed: true }))
  const hubspotStop = await run(jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' }), ctx('CA'), ENV, had({ mapl_tips: 'no', mapl_tips_source: 'unsubscribe link' }, { unsubscribed: false }))
  const preTickedCA = await run(jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'checked' }), ctx('CA'), ENV)
  const noTick = await run(jsonReq({ email: 'guest@gmail.com', optIn: false, optInDefault: 'unchecked' }), ctx('US'), ENV)
  for (const [name, r] of [['resend off', resendOff], ['hubspot stop', hubspotStop], ['pre-ticked CA', preTickedCA], ['no tick', noTick]] as const) {
    assert.equal(r.res.status, 200, name)
    assert.equal(events(r.calls).length, 0, name)
  }
})

test('no event without TIPS_SEGMENT_ID, when the segment add is refused, or when the yes was not recorded', async () => {
  const req = () => jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' })
  const noSegment = await run(req(), ctx('GB'), { ...ENV, TIPS_SEGMENT_ID: undefined })
  const refused = await run(req(), ctx('GB'), ENV, (c) => (c.url.includes('/segments/') ? { status: 422, body: { message: 'no' } } : undefined))
  const noHubspot = await run(req(), ctx('GB'), { ...ENV, HUBSPOT_SERVICE_KEY: undefined })
  let first = true
  const missingProps = await run(req(), ctx('GB'), ENV, (c) => {
    if (!(c.url.includes('api.hubapi.com') && c.method === 'POST')) return undefined
    if (first) { first = false; return { status: 400, body: { message: 'Property "mapl_tips" does not exist' } } }
    return { status: 201, body: { id: '3' } }
  })
  for (const [name, r] of [['no segment', noSegment], ['segment refused', refused], ['no hubspot', noHubspot], ['portal without tips properties', missingProps]] as const) {
    assert.equal(r.res.status, 200, name)
    assert.equal(events(r.calls).length, 0, name)
  }
})

test('a refused or failing event never fails the request', async () => {
  for (const answer of [{ status: 500, body: { message: 'down' } }, { status: 404, body: { message: 'event not found' } }]) {
    const { res, calls } = await run(jsonReq({ email: 'guest@gmail.com', optIn: true, optInDefault: 'unchecked' }), ctx('GB'), ENV, (c) => (c.url === EVENTS ? answer : undefined))
    assert.equal(res.status, 200)
    const j = await res.json()
    assert.equal(j.tips, true)
    assert.equal(j.coupon, true)
    assert.equal(events(calls).length, 1)
  }
})
