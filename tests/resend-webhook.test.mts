import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { handleResendWebhook, verifyWebhook } from '../netlify/lib/resend-webhook.mts'

const KEY = randomBytes(24)
const SECRET = `whsec_${KEY.toString('base64')}`
const NOW = 1_800_000_000_000
const TS = String(Math.floor(NOW / 1000))

/** A request signed the way Resend (Svix) signs one. */
function signed(evt: unknown, opts: { id?: string; ts?: string; key?: Buffer; sig?: string } = {}) {
  const body = JSON.stringify(evt)
  const id = opts.id ?? 'msg_1'
  const ts = opts.ts ?? TS
  const sig = opts.sig ?? `v1,${createHmac('sha256', opts.key ?? KEY).update(`${id}.${ts}.${body}`).digest('base64')}`
  return new Request('https://bio.mapltours.com/api/resend-webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sig }, body })
}

const unsub = (email = 'Guest@Gmail.com', unsubscribed = true) => ({ type: 'contact.updated', created_at: '2026-09-24T12:00:00.000Z', data: { id: 'c1', email, unsubscribed, updated_at: '2026-09-24T12:00:00.000Z', segment_ids: ['seg-1'] } })

type Call = { method: string; url: string; body?: Record<string, unknown> }
function fakeFetch(mapl_tips: string | null) {
  const calls: Call[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ id: '7', properties: { mapl_tips } }), { status: 200 })
    return new Response(JSON.stringify({ id: '7' }), { status: 200 })
  }) as unknown as typeof fetch
  return { f, calls }
}
const env = { RESEND_WEBHOOK_SECRET: SECRET, HUBSPOT_SERVICE_KEY: 'pat-test' }

test('signature: Svix scheme, any v1 entry may match (key rotation), five-minute window', () => {
  const ok = signed(unsub())
  const body = JSON.stringify(unsub())
  assert.equal(verifyWebhook(ok.headers, body, SECRET, NOW), true)
  assert.equal(verifyWebhook(ok.headers, body.replace('true', 'false'), SECRET, NOW), false, 'body changed')
  assert.equal(verifyWebhook(ok.headers, body, `whsec_${randomBytes(24).toString('base64')}`, NOW), false, 'other secret')
  assert.equal(verifyWebhook(ok.headers, body, SECRET, NOW + 6 * 60_000), false, 'replayed later')
  assert.equal(verifyWebhook(ok.headers, body, SECRET, NOW - 6 * 60_000), false, 'from the future')
  const good = ok.headers.get('svix-signature')!
  const rotated = signed(unsub(), { sig: `v1,${randomBytes(32).toString('base64')} ${good}` })
  assert.equal(verifyWebhook(rotated.headers, body, SECRET, NOW), true)
  for (const sig of ['', 'v1,', 'v2,' + good.slice(3), good.slice(3), `v1,${randomBytes(32).toString('base64')}`]) {
    assert.equal(verifyWebhook(signed(unsub(), { sig }).headers, body, SECRET, NOW), false, sig)
  }
  assert.equal(verifyWebhook(signed(unsub(), { ts: 'soon' }).headers, body, SECRET, NOW), false)
})

test('an unsubscribe in Resend becomes mapl_tips "no" in HubSpot, source unsubscribe link, at Resend\'s time', async () => {
  const { f, calls } = fakeFetch('yes')
  const r = await handleResendWebhook(signed(unsub()), env, f, NOW)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('netlify-cdn-cache-control'), 'no-store')
  assert.match(calls[0].url, /contacts\/guest%40gmail\.com\?idProperty=email/)
  assert.deepEqual(calls[1].body, { properties: { mapl_tips: 'no', mapl_tips_at: String(Date.parse('2026-09-24T12:00:00.000Z')), mapl_tips_source: 'unsubscribe link' } })
})

test('only over a yes: a stop already on record keeps its own source', async () => {
  for (const state of ['no', null]) {
    const { f, calls } = fakeFetch(state)
    const r = await handleResendWebhook(signed(unsub()), env, f, NOW)
    assert.equal(r.status, 200)
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0, String(state))
  }
})

test('everything else is acknowledged and ignored: resubscribes, other events, no address', async () => {
  for (const evt of [unsub('guest@gmail.com', false), { type: 'email.delivered', data: { email: 'guest@gmail.com', unsubscribed: true } }, { type: 'contact.updated', data: { unsubscribed: true } }, { type: 'contact.updated' }]) {
    const { f, calls } = fakeFetch('yes')
    const r = await handleResendWebhook(signed(evt), env, f, NOW)
    assert.equal(r.status, 200)
    assert.equal(calls.length, 0)
  }
})

test('refusals: bad signature 401, missing secret 503, wrong method 405, HubSpot down 502 so Resend retries', async () => {
  const none = fakeFetch('yes')
  assert.equal((await handleResendWebhook(signed(unsub(), { key: randomBytes(24) }), env, none.f, NOW)).status, 401)
  assert.equal((await handleResendWebhook(signed(unsub()), { ...env, RESEND_WEBHOOK_SECRET: undefined }, none.f, NOW)).status, 503)
  assert.equal((await handleResendWebhook(new Request('https://bio.mapltours.com/api/resend-webhook'), env, none.f, NOW)).status, 405)
  assert.equal(none.calls.length, 0)
  const down = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
  assert.equal((await handleResendWebhook(signed(unsub()), env, down, NOW)).status, 502)
})
