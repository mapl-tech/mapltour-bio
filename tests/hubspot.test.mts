import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LEAD_PROPERTIES, missingProperties, setTips, tipsStopped, upsertLead, leadProperties, utmFromPage } from '../netlify/lib/hubspot.mts'
import { TIPS_LABEL } from '../lib/tips.mts'

type Call = { method: string; url: string; body?: Record<string, unknown> }

/** A fetch that answers from a script and records what it was asked. */
function fakeFetch(script: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const next = script.shift() ?? { status: 500, body: { message: 'script exhausted' } }
    return new Response(JSON.stringify(next.body), { status: next.status })
  }) as unknown as typeof fetch
  return { f, calls }
}

const input = { email: 'Guest@Example.com', capture: 'hero', page: 'https://bio.mapltours.com/?utm_source=ig&utm_medium=bio&utm_campaign=cold', couponCode: 'JAMAICA5', at: 1_700_000_000_000 }

test('no token: skipped, nothing called', async () => {
  const { f, calls } = fakeFetch([])
  const r = await upsertLead(undefined, input, f)
  assert.deepEqual(r, { ok: true, status: 0, action: 'skipped' })
  assert.equal(calls.length, 0)
})

test('new contact: looked up by email, created as a lead with the capture details', async () => {
  const { f, calls } = fakeFetch([{ status: 404, body: { message: 'not found' } }, { status: 201, body: { id: '101' } }])
  const r = await upsertLead('pat-test', input, f)
  assert.deepEqual(r, { ok: true, status: 201, id: '101', action: 'created', tips: { before: null, stopped: false, written: false } })
  assert.equal(calls[0].method, 'GET')
  assert.match(calls[0].url, /contacts\/guest%40example\.com\?idProperty=email&properties=email,mapl_tips,mapl_tips_source$/)
  assert.equal(calls[1].method, 'POST')
  const props = calls[1].body!.properties as Record<string, string>
  assert.equal(props.email, 'guest@example.com')
  assert.equal(props.lifecyclestage, 'lead')
  assert.equal(props.hs_lead_status, 'NEW')
  assert.equal(props.mapl_coupon_code, 'JAMAICA5')
  assert.equal(props.mapl_utm_source, 'ig')
  assert.equal(props.mapl_utm_campaign, 'cold')
  assert.equal(props.mapl_lead_at, '1700000000000')
})

test('existing contact: patched with the capture details only, lifecycle untouched', async () => {
  const { f, calls } = fakeFetch([{ status: 200, body: { id: '7', properties: { email: 'guest@example.com' } } }, { status: 200, body: { id: '7' } }])
  const r = await upsertLead('pat-test', input, f)
  assert.deepEqual(r, { ok: true, status: 200, id: '7', action: 'updated', tips: { before: null, stopped: false, written: false } })
  assert.equal(calls[1].method, 'PATCH')
  assert.match(calls[1].url, /contacts\/7$/)
  const props = calls[1].body!.properties as Record<string, string>
  assert.equal(props.lifecyclestage, undefined)
  assert.equal(props.hs_lead_status, undefined)
  assert.equal(props.mapl_capture, 'hero')
})

test('custom properties missing on the portal: created with standard fields so the lead is not lost', async () => {
  const { f, calls } = fakeFetch([
    { status: 404, body: {} },
    { status: 400, body: { category: 'VALIDATION_ERROR', message: 'Property values were not valid', errors: [{ code: 'PROPERTY_DOESNT_EXIST' }] } },
    { status: 201, body: { id: '55' } },
  ])
  const r = await upsertLead('pat-test', input, f)
  assert.deepEqual(r, { ok: true, status: 201, id: '55', action: 'created', tips: { before: null, stopped: false, written: false } })
  const props = calls[2].body!.properties as Record<string, string>
  assert.deepEqual(Object.keys(props).sort(), ['email', 'hs_lead_status', 'lifecyclestage'])
})

test('a HubSpot outage is reported, never thrown', async () => {
  const f = (async () => { throw new Error('ECONNRESET') }) as unknown as typeof fetch
  const r = await upsertLead('pat-test', input, f)
  assert.equal(r.ok, false)
  assert.equal(r.error, 'ECONNRESET')
})

test('utm parsing tolerates a bare path and clips', () => {
  assert.deepEqual(utmFromPage('/not-a-url'), {})
  assert.deepEqual(utmFromPage('https://bio.mapltours.com/?utm_medium=email'), { mapl_utm_medium: 'email' })
  assert.equal(leadProperties({ ...input, page: 'x'.repeat(400) }).mapl_landing_page.length, 300)
})

test('a popup lead on mapltours.com carries its own source', () => {
  assert.equal(leadProperties({ ...input, source: 'site popup' }).mapl_source, 'site popup')
  assert.equal(leadProperties(input).mapl_source, 'bio coupon')
})

test('a request during the draw is tagged with the giveaway; outside it, no tag at all', () => {
  assert.equal(leadProperties({ ...input, giveaway: 'martha-brae-2026' }).mapl_giveaway, 'martha-brae-2026')
  assert.equal('mapl_giveaway' in leadProperties(input), false)
})

// ── Trip tips ───────────────────────────────────────────────────────────

const yes = { at: 1_750_000_000_000, source: 'bio hero', text: TIPS_LABEL, defaultShown: 'checked' as const }
const TIPS_KEYS = ['mapl_tips', 'mapl_tips_at', 'mapl_tips_source', 'mapl_tips_text', 'mapl_tips_default']

test('the setup script creates every trip tips property, in the mapl group, datetime for the time', () => {
  const byName = new Map<string, { type: string; fieldType: string }>(LEAD_PROPERTIES.map((p) => [p.name, p]))
  for (const n of [...TIPS_KEYS, 'mapl_country']) assert.ok(byName.has(n), n)
  assert.equal(byName.get('mapl_tips_at')!.type, 'datetime')
  assert.equal(byName.get('mapl_tips')!.fieldType, 'text')
})

test('new contact without consent: mapl_tips "no", none of the yes details; country when known', async () => {
  const { f, calls } = fakeFetch([{ status: 404, body: {} }, { status: 201, body: { id: '1' } }])
  await upsertLead('pat-test', { ...input, country: 'CA' }, f)
  const props = calls[1].body!.properties as Record<string, string>
  assert.equal(props.mapl_tips, 'no')
  for (const k of TIPS_KEYS.slice(1)) assert.equal(props[k], undefined, k)
  assert.equal(props.mapl_country, 'CA')
})

test('existing contact without consent: mapl_tips untouched, so an earlier yes is never downgraded', async () => {
  const { f, calls } = fakeFetch([{ status: 200, body: { id: '7' } }, { status: 200, body: { id: '7' } }])
  await upsertLead('pat-test', { ...input, country: null }, f)
  const props = calls[1].body!.properties as Record<string, string>
  for (const k of TIPS_KEYS) assert.equal(props[k], undefined, k)
  assert.equal('mapl_country' in props, false, 'unknown country is not written')
})

test('valid consent: yes with when, where, the exact words and the default, on create AND on update', async () => {
  const created = fakeFetch([{ status: 404, body: {} }, { status: 201, body: { id: '1' } }])
  await upsertLead('pat-test', { ...input, tips: yes, country: 'US' }, created.f)
  const updated = fakeFetch([{ status: 200, body: { id: '7' } }, { status: 200, body: { id: '7' } }])
  await upsertLead('pat-test', { ...input, tips: yes, country: 'US' }, updated.f)
  for (const props of [created.calls[1].body!.properties, updated.calls[1].body!.properties] as Array<Record<string, string>>) {
    assert.equal(props.mapl_tips, 'yes')
    assert.equal(props.mapl_tips_at, '1750000000000')
    assert.equal(props.mapl_tips_source, 'bio hero')
    assert.equal(props.mapl_tips_text, TIPS_LABEL)
    assert.equal(props.mapl_tips_default, 'checked')
    assert.equal(props.mapl_country, 'US')
  }
})

test('a portal without the new properties still saves the rest (named in HubSpot\'s error)', async () => {
  const refusal = { status: 'error', category: 'VALIDATION_ERROR', message: 'Property values were not valid: [{"isValid":false,"message":"Property \\"mapl_tips\\" does not exist","error":"PROPERTY_DOESNT_EXIST","name":"mapl_tips"},{"isValid":false,"message":"Property \\"mapl_country\\" does not exist","error":"PROPERTY_DOESNT_EXIST","name":"mapl_country"}]' }
  const { f, calls } = fakeFetch([{ status: 404, body: {} }, { status: 400, body: refusal }, { status: 201, body: { id: '3' } }])
  const r = await upsertLead('pat-test', { ...input, country: 'CA' }, f)
  assert.deepEqual(r, { ok: true, status: 201, id: '3', action: 'created', tips: { before: null, stopped: false, written: false } })
  const props = calls[2].body!.properties as Record<string, string>
  assert.equal(props.mapl_tips, undefined)
  assert.equal(props.mapl_country, undefined)
  assert.equal(props.mapl_source, 'bio coupon', 'the working fields survive')
  assert.equal(props.mapl_coupon_code, 'JAMAICA5')

  const upd = fakeFetch([{ status: 200, body: { id: '7' } }, { status: 400, body: refusal }, { status: 200, body: { id: '7' } }])
  const u = await upsertLead('pat-test', { ...input, tips: yes, country: 'CA' }, upd.f)
  assert.equal(u.ok, true)
  const p2 = upd.calls[2].body!.properties as Record<string, string>
  assert.equal(p2.mapl_tips, undefined)
  assert.equal(p2.mapl_tips_at, '1750000000000', 'mapl_tips_at was not named, so it stays')
  // The contact saved, but the consent record did not: lead.mts must not list them.
  assert.equal(u.tips?.written, false)
  const whole = fakeFetch([{ status: 404, body: {} }, { status: 201, body: { id: '4' } }])
  assert.equal((await upsertLead('pat-test', { ...input, tips: yes }, whole.f)).tips?.written, true)
})

test('a form never lifts a stop: a contact that asked to stop keeps "no", the capture details still save', async () => {
  for (const source of ['code email stop', 'unsubscribe link']) {
    const { f, calls } = fakeFetch([{ status: 200, body: { id: '7', properties: { mapl_tips: 'no', mapl_tips_source: source } } }, { status: 200, body: { id: '7' } }])
    const r = await upsertLead('pat-test', { ...input, tips: { ...yes, defaultShown: 'unchecked' }, country: 'US' }, f)
    assert.deepEqual(r.tips, { before: 'no', stopped: true, written: false }, source)
    const props = calls[1].body!.properties as Record<string, string>
    for (const k of TIPS_KEYS) assert.equal(props[k], undefined, k)
    assert.equal(props.mapl_capture, 'hero')
    assert.equal(props.mapl_country, 'US')
  }
  // A "no" from creation (never asked) is not a stop: a tick now is a yes.
  const fresh = fakeFetch([{ status: 200, body: { id: '7', properties: { mapl_tips: 'no', mapl_tips_source: null } } }, { status: 200, body: { id: '7' } }])
  const r = await upsertLead('pat-test', { ...input, tips: yes }, fresh.f)
  assert.deepEqual(r.tips, { before: 'no', stopped: false, written: true })
  assert.equal((fresh.calls[1].body!.properties as Record<string, string>).mapl_tips, 'yes')
  assert.equal(tipsStopped({ mapl_tips: 'no', mapl_tips_source: 'bio hero' }), false)
  assert.equal(tipsStopped({ mapl_tips: 'yes', mapl_tips_source: 'code email stop' }), false)
})

test('an earlier yes is kept as recorded, not rewritten by a later tick', async () => {
  const { f, calls } = fakeFetch([{ status: 200, body: { id: '7', properties: { mapl_tips: 'yes', mapl_tips_source: 'code email' } } }, { status: 200, body: { id: '7' } }])
  const r = await upsertLead('pat-test', { ...input, tips: yes }, f)
  assert.deepEqual(r.tips, { before: 'yes', stopped: false, written: false })
  const props = calls[1].body!.properties as Record<string, string>
  for (const k of TIPS_KEYS) assert.equal(props[k], undefined, k)
})

test('missingProperties matches whole names only, and only for a missing-property error', () => {
  const props = { mapl_tips: 'yes', mapl_tips_at: '1', mapl_country: 'US' }
  assert.deepEqual(missingProperties({ message: 'Property "mapl_tips_at" does not exist' }, props), ['mapl_tips_at'])
  assert.deepEqual(missingProperties({ message: 'rate limited mapl_tips' }, props), [])
  assert.deepEqual(missingProperties(undefined, props), [])
})

test('email link yes: updates an existing contact, creates a missing one, as code email / unchecked', async () => {
  const upd = fakeFetch([{ status: 200, body: { id: '7' } }, { status: 200, body: { id: '7' } }])
  assert.deepEqual(await setTips('pat-test', 'Guest@Example.com', { action: 'yes', at: 5 }, upd.f), { ok: true, status: 200, id: '7', action: 'updated' })
  assert.match(upd.calls[0].url, /contacts\/guest%40example\.com\?idProperty=email/)
  assert.deepEqual(upd.calls[1].body, { properties: { mapl_tips: 'yes', mapl_tips_at: '5', mapl_tips_source: 'code email', mapl_tips_text: 'Yes, send me trip tips', mapl_tips_default: 'unchecked' } })

  const add = fakeFetch([{ status: 404, body: {} }, { status: 201, body: { id: '8' } }])
  assert.equal((await setTips('pat-test', 'guest@example.com', { action: 'yes', at: 5 }, add.f)).action, 'created')
  const props = add.calls[1].body!.properties as Record<string, string>
  assert.equal(props.email, 'guest@example.com')
  assert.equal(props.lifecyclestage, 'lead')
  assert.equal(props.mapl_tips, 'yes')
})

test('email link stop: no on an existing contact; a missing one is skipped, never created', async () => {
  const upd = fakeFetch([{ status: 200, body: { id: '7' } }, { status: 200, body: { id: '7' } }])
  await setTips('pat-test', 'guest@example.com', { action: 'stop', at: 9 }, upd.f)
  assert.deepEqual(upd.calls[1].body, { properties: { mapl_tips: 'no', mapl_tips_at: '9', mapl_tips_source: 'code email stop' } })
  const none = fakeFetch([{ status: 404, body: {} }])
  assert.deepEqual(await setTips('pat-test', 'guest@example.com', { action: 'stop', at: 9 }, none.f), { ok: true, status: 404, action: 'skipped' })
  assert.equal(none.calls.length, 1)
  assert.deepEqual(await setTips(undefined, 'guest@example.com', { action: 'stop', at: 9 }), { ok: true, status: 0, action: 'skipped' })
  const refused = fakeFetch([{ status: 200, body: { id: '7' } }, { status: 400, body: { message: 'Property "mapl_tips" does not exist' } }])
  assert.equal((await setTips('pat-test', 'guest@example.com', { action: 'stop', at: 9 }, refused.f)).ok, false, 'the link page must not say done')
})

test('webhook stop: its own source, and only over a yes (a stop on record keeps its source)', async () => {
  const on = fakeFetch([{ status: 200, body: { id: '7', properties: { mapl_tips: 'yes' } } }, { status: 200, body: { id: '7' } }])
  await setTips('pat-test', 'guest@example.com', { action: 'stop', at: 9, source: 'unsubscribe link', onlyIfYes: true }, on.f)
  assert.match(on.calls[0].url, /properties=email,mapl_tips$/)
  assert.deepEqual(on.calls[1].body, { properties: { mapl_tips: 'no', mapl_tips_at: '9', mapl_tips_source: 'unsubscribe link' } })
  for (const mapl_tips of ['no', null]) {
    const off = fakeFetch([{ status: 200, body: { id: '7', properties: { mapl_tips } } }])
    assert.deepEqual(await setTips('pat-test', 'guest@example.com', { action: 'stop', at: 9, source: 'unsubscribe link', onlyIfYes: true }, off.f), { ok: true, status: 200, id: '7', action: 'skipped' })
    assert.equal(off.calls.length, 1, 'no write')
  }
})
