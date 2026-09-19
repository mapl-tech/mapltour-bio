import { test } from 'node:test'
import assert from 'node:assert/strict'
import { upsertLead, leadProperties, utmFromPage } from '../netlify/lib/hubspot.mts'

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
  assert.deepEqual(r, { ok: true, status: 201, id: '101', action: 'created' })
  assert.equal(calls[0].method, 'GET')
  assert.match(calls[0].url, /contacts\/guest%40example\.com\?idProperty=email/)
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
  assert.deepEqual(r, { ok: true, status: 200, id: '7', action: 'updated' })
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
  assert.deepEqual(r, { ok: true, status: 201, id: '55', action: 'created' })
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
