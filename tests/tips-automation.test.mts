import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUTOMATION_NAME, EVENTS, automationGraph, durationMinutes, runTipsAutomation, sameGraph, subsetEqual } from '../netlify/lib/tips-automation.mts'
import { tip1, tip2 } from '../netlify/lib/tip-emails.mts'

const ADDRESS = '12 Example Street, Montego Bay, St. James, Jamaica'
const FROM = 'MAPL Tours Jamaica <contact@mapltours.com>'
const REPLY_TO = 'contact@mapltours.com'

type Call = { method: string; path: string; body?: Record<string, unknown> }
type Answer = { status: number; body?: unknown } | undefined

/** A fake Resend: `answer` may reply to any call; otherwise lookups are 404, lists empty, writes succeed with an id. */
function fakeResend(answer: (c: Call) => Answer = () => undefined) {
  const calls: Call[] = []
  let n = 0
  const f = (async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', path: String(url).replace('https://api.resend.com', ''), body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(c)
    const a = answer(c)
    if (a) return new Response(JSON.stringify(a.body ?? {}), { status: a.status })
    if (c.method === 'GET' && /^\/(templates|automations)\?limit=100/.test(c.path)) return new Response(JSON.stringify({ object: 'list', has_more: false, data: [] }), { status: 200 })
    if (c.method === 'GET') return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
    return new Response(JSON.stringify({ id: `id-${++n}` }), { status: 200 })
  }) as unknown as typeof fetch
  return { f, calls }
}
const quiet = () => {}
/** HubSpot's batch read: a POST, but only a read. */
const HUBSPOT_READ = 'https://api.hubapi.com/crm/v3/objects/contacts/batch/read'

test('the graph: trigger, wait 2 days, tip 1, wait 12 days, tip 2; a booking ends the run', () => {
  const g = automationGraph(['t1', 't2'])
  assert.deepEqual(g.steps, [
    { key: 'start', type: 'trigger', config: { event_name: 'tips.subscribed' } },
    { key: 'wait_booking_1', type: 'wait_for_event', config: { event_name: 'booking.paid', timeout: '2 days' } },
    { key: 'tip_1', type: 'send_email', config: { template: { id: 't1' }, from: FROM, reply_to: REPLY_TO } },
    { key: 'wait_booking_2', type: 'wait_for_event', config: { event_name: 'booking.paid', timeout: '12 days' } },
    { key: 'tip_2', type: 'send_email', config: { template: { id: 't2' }, from: FROM, reply_to: REPLY_TO } },
  ])
  assert.deepEqual(g.connections, [
    { from: 'start', to: 'wait_booking_1', type: 'default' },
    { from: 'wait_booking_1', to: 'tip_1', type: 'timeout' },
    { from: 'tip_1', to: 'wait_booking_2', type: 'default' },
    { from: 'wait_booking_2', to: 'tip_2', type: 'timeout' },
  ])
  assert.equal(g.connections.some((c) => c.type === 'event_received'), false, 'event_received goes nowhere')
  // REST is snake_case: no camelCase key anywhere in the graph.
  assert.doesNotMatch(JSON.stringify(g), /"(eventName|replyTo|filterRule|contactId)"/)
  assert.deepEqual(EVENTS.map((e) => [e.name, e.schema]), [['tips.subscribed', { source: 'string' }], ['booking.paid', { type: 'string' }]])
})

test('--enable is refused while there is no postal address: nothing is called', async () => {
  const { f, calls } = fakeResend()
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: true, postalAddress: null, f, log: quiet })
  assert.equal(r.ok, false)
  assert.equal(r.rows[0].state, 'refused')
  assert.equal(calls.length, 0)
  const dry = await runTipsAutomation({ key: 're_x', dry: true, enable: true, postalAddress: null, f, log: quiet })
  assert.equal(dry.rows[0].state, 'refused')
  assert.equal(calls.length, 0)
})

test('--dry: only reads, every write becomes a plan line', async () => {
  const { f, calls } = fakeResend()
  const lines: string[] = []
  const r = await runTipsAutomation({ key: 're_x', dry: true, enable: false, postalAddress: null, f, log: (s) => lines.push(s) })
  assert.equal(r.ok, true)
  assert.ok(calls.length > 0)
  assert.deepEqual([...new Set(calls.map((c) => c.method))], ['GET'])
  assert.ok(r.rows.every((x) => x.state === 'planned'), JSON.stringify(r.rows))
  assert.ok(lines.some((l) => l.includes('would POST /events {"name":"tips.subscribed","schema":{"source":"string"}}')))
  assert.ok(lines.some((l) => l.includes('would POST /templates/<id of trip-tips-1-ride>/publish')))
  assert.ok(lines.some((l) => l.startsWith('  would POST /automations') && l.includes('"status":"disabled"')))
})

test('--dry without a key: the full plan, no network at all', async () => {
  const { f, calls } = fakeResend()
  const r = await runTipsAutomation({ key: undefined, dry: true, enable: false, postalAddress: null, f, log: quiet })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 0)
  assert.equal(r.rows.length, 5)
})

test('first real run: events, templates (created, then published), automation created disabled; REST bodies in snake_case', async () => {
  const { f, calls } = fakeResend()
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: false, postalAddress: ADDRESS, f, log: quiet })
  assert.equal(r.ok, true, JSON.stringify(r.rows))
  const writes = calls.filter((c) => c.method !== 'GET' && c.path !== HUBSPOT_READ)
  assert.deepEqual(writes.map((c) => `${c.method} ${c.path}`), [
    'POST /events', 'POST /events',
    'POST /templates', 'POST /templates/id-3/publish',
    'POST /templates', 'POST /templates/id-5/publish',
    'POST /automations',
  ])
  assert.deepEqual(writes[0].body, { name: 'tips.subscribed', schema: { source: 'string' } })
  assert.deepEqual(writes[1].body, { name: 'booking.paid', schema: { type: 'string' } })
  const t1 = tip1({ postalAddress: ADDRESS })
  assert.deepEqual(writes[2].body, { name: 'Trip tips 1: the ride from MBJ', alias: 'trip-tips-1-ride', subject: t1.subject, html: t1.html, from: FROM, reply_to: REPLY_TO })
  assert.equal(writes[4].body!.html, tip2({ postalAddress: ADDRESS }).html)
  const auto = writes[6].body!
  assert.equal(auto.name, AUTOMATION_NAME)
  assert.equal(auto.status, 'disabled')
  assert.deepEqual({ steps: auto.steps, connections: auto.connections }, automationGraph(['id-3', 'id-5']))
})

/** Resend with everything already in place and matching. */
function inPlace(status: 'enabled' | 'disabled', graph = automationGraph(['tpl-1', 'tpl-2']), html1 = tip1({ postalAddress: ADDRESS }).html) {
  const tpl = (id: string, alias: string, name: string, subject: string, html: string) => ({ object: 'template', id, alias, name, subject, html, from: FROM, reply_to: REPLY_TO, status: 'published', has_unpublished_versions: false })
  return (c: Call): Answer => {
    if (c.method !== 'GET') return undefined
    if (c.path === '/events/tips.subscribed') return { status: 200, body: { name: 'tips.subscribed', schema: { source: 'string' } } }
    if (c.path === '/events/booking.paid') return { status: 200, body: { name: 'booking.paid', schema: { type: 'string' } } }
    if (c.path === '/templates/trip-tips-1-ride') return { status: 200, body: tpl('tpl-1', 'trip-tips-1-ride', 'Trip tips 1: the ride from MBJ', tip1().subject, html1) }
    if (c.path === '/templates/trip-tips-2-tours') return { status: 200, body: tpl('tpl-2', 'trip-tips-2-tours', 'Trip tips 2: a day out', tip2().subject, tip2({ postalAddress: ADDRESS }).html) }
    if (c.path.startsWith('/automations?')) return { status: 200, body: { object: 'list', has_more: false, data: [{ id: 'auto-1', name: AUTOMATION_NAME, status }] } }
    // What Resend sends back may carry more than we set (extra config keys); that is still the same graph.
    if (c.path === '/automations/auto-1') return { status: 200, body: { id: 'auto-1', name: AUTOMATION_NAME, status, steps: graph.steps.map((s) => ({ ...s, config: { ...s.config, extra: null } })), connections: graph.connections } }
    return undefined
  }
}

test('second run with everything in place: reads only, nothing written (idempotent)', async () => {
  const { f, calls } = fakeResend(inPlace('disabled'))
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: false, postalAddress: ADDRESS, f, log: quiet })
  assert.equal(r.ok, true, JSON.stringify(r.rows))
  assert.deepEqual(calls.filter((c) => c.method !== 'GET'), [])
  assert.ok(r.rows.every((x) => x.state === 'exists'))
})

test('a changed template is updated and republished; a disabled automation with an old graph is updated', async () => {
  const { f, calls } = fakeResend(inPlace('disabled', automationGraph(['old-1', 'tpl-2']), '<p>old</p>'))
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: false, postalAddress: ADDRESS, f, log: quiet })
  assert.equal(r.ok, true, JSON.stringify(r.rows))
  const writes = calls.filter((c) => c.method !== 'GET' && c.path !== HUBSPOT_READ).map((c) => `${c.method} ${c.path}`)
  assert.deepEqual(writes, ['PATCH /templates/tpl-1', 'POST /templates/tpl-1/publish', 'PATCH /automations/auto-1'])
  const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/automations/auto-1')!
  assert.deepEqual(patch.body, automationGraph(['tpl-1', 'tpl-2']))
  assert.equal('status' in patch.body!, false, 'status untouched without --enable')
})

test('an enabled automation whose graph differs is reported, never forced', async () => {
  const { f, calls } = fakeResend(inPlace('enabled', automationGraph(['old-1', 'tpl-2'])))
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: false, postalAddress: ADDRESS, f, log: quiet })
  assert.equal(r.ok, false)
  assert.match(r.rows.at(-1)!.detail ?? '', /enabled automation cannot be changed/)
  assert.equal(calls.some((c) => c.path.startsWith('/automations/') && c.method !== 'GET'), false)
})

/**
 * The automation's runs, the tips segment's contacts and HubSpot's batch read, on top of `base`.
 * `runs` null: that lookup fails; `contacts` null: the segment is not found; `booked` null: HubSpot fails.
 */
function withList(base: (c: Call) => Answer, runs: unknown[] | null, contacts: Array<{ email: string; unsubscribed: boolean }> | null, booked: string[] | null = []) {
  return (c: Call): Answer => {
    if (c.method === 'POST' && c.path === HUBSPOT_READ) {
      if (!booked) return { status: 502, body: { message: 'down' } }
      const inputs = (c.body!.inputs as Array<{ id: string }>).map((x) => x.id)
      return { status: 207, body: { status: 'COMPLETE', results: inputs.filter((e) => booked.includes(e)).map((e, i) => ({ id: `h${i}`, properties: { email: e, mapl_last_booking_at: '2026-09-20T12:00:00Z', lifecyclestage: 'customer' } })) } }
    }
    if (c.method === 'GET' && c.path.startsWith('/automations/auto-1/runs')) return runs ? { status: 200, body: { object: 'list', has_more: false, data: runs } } : { status: 500, body: { message: 'down' } }
    if (c.method === 'GET' && c.path.startsWith('/segments/seg-1/contacts')) return contacts ? { status: 200, body: { object: 'list', has_more: false, data: contacts.map((x, i) => ({ id: `c${i}`, ...x })) } } : { status: 404, body: { message: 'Segment not found' } }
    return base(c)
  }
}
const LIST = [
  { email: 'Guest@Gmail.com', unsubscribed: false },
  { email: 'gone@yahoo.com', unsubscribed: true },
  { email: 'pat@hotmail.com', unsubscribed: false },
]
const noWait = async () => {}
const sentEvents = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === '/events/send')

test('--enable, first switch-on: templates republished from the code, the list read, switched on, then the series started for everyone on it', async () => {
  const { f, calls } = fakeResend(withList(inPlace('disabled'), [], LIST))
  const lines: string[] = []
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: true, postalAddress: ADDRESS, segment: 'seg-1', hubspotKey: 'pat-x', f, log: (x) => lines.push(x), pause: noWait })
  assert.equal(r.ok, true, JSON.stringify(r.rows))
  const writes = calls.filter((c) => c.method !== 'GET' && c.path !== HUBSPOT_READ)
  assert.deepEqual(writes.map((c) => `${c.method} ${c.path}`), [
    'PATCH /templates/tpl-1', 'POST /templates/tpl-1/publish',
    'PATCH /templates/tpl-2', 'POST /templates/tpl-2/publish',
    'PATCH /automations/auto-1',
    'POST /events/send', 'POST /events/send',
  ])
  assert.equal(writes[0].body!.html, tip1({ postalAddress: ADDRESS }).html, 'the version with the address')
  assert.deepEqual(writes[4].body, { status: 'enabled' })
  // The list is read before the switch, the events go after it, unsubscribed contacts are left out.
  const read = calls.findIndex((c) => c.path.startsWith('/segments/seg-1/contacts'))
  const on = calls.indexOf(writes[4])
  assert.ok(read < on && on < calls.indexOf(writes[5]))
  assert.deepEqual(sentEvents(calls).map((c) => c.body), [
    { event: 'tips.subscribed', email: 'guest@gmail.com', payload: { source: 'tips list' } },
    { event: 'tips.subscribed', email: 'pat@hotmail.com', payload: { source: 'tips list' } },
  ])
  assert.deepEqual(r.rows.at(-1), { part: 'backfill', name: 'tips list', state: 'created', detail: 'series started for 2 of 2 on the tips list' })
  assert.equal(JSON.stringify(r.rows).includes('@gmail.com') || lines.join('\n').includes('guest@'), false, 'no address in the output')
})

test('--enable on a fresh account: created disabled, the list read, switched on, then the series started', async () => {
  const { f, calls } = fakeResend(withList(() => undefined, null, LIST))
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: true, postalAddress: ADDRESS, segment: 'seg-1', hubspotKey: 'pat-x', f, log: quiet, pause: noWait })
  assert.equal(r.ok, true, JSON.stringify(r.rows))
  const writes = calls.filter((c) => c.method !== 'GET' && c.path !== HUBSPOT_READ).map((c) => `${c.method} ${c.path}`)
  assert.deepEqual(writes.slice(-4), ['POST /automations', 'PATCH /automations/id-7', 'POST /events/send', 'POST /events/send'])
  assert.equal(calls.some((c) => c.path.includes('/runs')), false, 'a new automation has no runs to read')
  assert.ok(calls.findIndex((c) => c.path.startsWith('/segments/seg-1/contacts')) < calls.findIndex((c) => c.path === '/automations/id-7'))
})

test('--enable over an automation that has had runs: switched on, nobody started again', async () => {
  const { f, calls } = fakeResend(withList(inPlace('disabled'), [{ id: 'run-1', status: 'completed' }], LIST))
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: true, postalAddress: ADDRESS, segment: 'seg-1', hubspotKey: 'pat-x', f, log: quiet, pause: noWait })
  assert.equal(r.ok, true, JSON.stringify(r.rows))
  assert.ok(calls.some((c) => c.method === 'PATCH' && c.path === '/automations/auto-1'))
  assert.equal(sentEvents(calls).length, 0)
  assert.equal(calls.some((c) => c.path.startsWith('/segments/')), false, 'the list is not even read')
})

test('--enable stays off when its runs or the tips list cannot be read', async () => {
  for (const [name, answer] of [['runs', withList(inPlace('disabled'), null, LIST)], ['list', withList(inPlace('disabled'), [], null)]] as const) {
    const { f, calls } = fakeResend(answer)
    const r = await runTipsAutomation({ key: 're_x', dry: false, enable: true, postalAddress: ADDRESS, segment: 'seg-1', hubspotKey: 'pat-x', f, log: quiet, pause: noWait })
    assert.equal(r.ok, false, name)
    assert.match(r.rows.at(-1)!.detail ?? '', /not enabled/, name)
    assert.equal(calls.some((c) => c.method === 'PATCH' && c.path === '/automations/auto-1'), false, name)
    assert.equal(sentEvents(calls).length, 0, name)
  }
})

test('--enable, first switch-on: test addresses and people HubSpot shows as booked are left out', async () => {
  const list = [...LIST, { email: 'drill-1@example.com', unsubscribed: false }, { email: 'booked@gmail.com', unsubscribed: false }]
  const { f, calls } = fakeResend(withList(inPlace('disabled'), [], list, ['booked@gmail.com']))
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: true, postalAddress: ADDRESS, segment: 'seg-1', hubspotKey: 'pat-x', f, log: quiet, pause: noWait })
  assert.equal(r.ok, true, JSON.stringify(r.rows))
  assert.deepEqual(sentEvents(calls).map((c) => c.body!.email), ['guest@gmail.com', 'pat@hotmail.com'])
  const read = calls.find((c) => c.path === HUBSPOT_READ)!
  assert.deepEqual((read.body!.inputs as Array<{ id: string }>).map((x) => x.id), ['guest@gmail.com', 'pat@hotmail.com', 'booked@gmail.com'], 'test addresses are never even sent to HubSpot')
  assert.match(r.rows.at(-2)!.detail ?? '', /left out 1 test address and 1 who booked/)
  assert.deepEqual(r.rows.at(-1), { part: 'backfill', name: 'tips list', state: 'created', detail: 'series started for 2 of 2 on the tips list' })
})

test('--enable, first switch-on, stays off without a HubSpot key or when HubSpot cannot be read', async () => {
  for (const [name, hubspotKey, booked] of [['no key', undefined, []], ['HubSpot down', 'pat-x', null]] as const) {
    const { f, calls } = fakeResend(withList(inPlace('disabled'), [], LIST, booked as string[] | null))
    const r = await runTipsAutomation({ key: 're_x', dry: false, enable: true, postalAddress: ADDRESS, segment: 'seg-1', hubspotKey, f, log: quiet, pause: noWait })
    assert.equal(r.ok, false, name)
    assert.match(r.rows.at(-1)!.detail ?? '', /not enabled/, name)
    assert.equal(calls.some((c) => c.method === 'PATCH' && c.path === '/automations/auto-1'), false, name)
    assert.equal(sentEvents(calls).length, 0, name)
  }
})

test('--enable, first switch-on, stays off when the tips list is longer than the script reads', async () => {
  const { f, calls } = fakeResend((c) => {
    if (c.method === 'GET' && c.path.startsWith('/segments/seg-1/contacts')) {
      const page = Number((c.path.match(/after=c(\d+)/) ?? [])[1] ?? -1) + 1
      return { status: 200, body: { object: 'list', has_more: true, data: [{ id: `c${page}`, email: `g${page}@gmail.com`, unsubscribed: false }] } }
    }
    return withList(inPlace('disabled'), [], LIST)(c)
  })
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: true, postalAddress: ADDRESS, segment: 'seg-1', hubspotKey: 'pat-x', f, log: quiet, pause: noWait })
  assert.equal(r.ok, false)
  assert.match(r.rows.at(-1)!.detail ?? '', /more than .* contacts.*not enabled/)
  assert.equal(calls.some((c) => c.method === 'PATCH' && c.path === '/automations/auto-1'), false)
  assert.equal(sentEvents(calls).length, 0)
})

test('Resend rate limits (429) are waited out and retried: a busy second does not fail the run', async () => {
  const limited = new Map<string, number>()
  const waits: number[] = []
  const { f, calls } = fakeResend((c) => {
    const k = `${c.method} ${c.path}`
    if (/^GET \/automations\?limit=100/.test(k) && (limited.get(k) ?? 0) < 2) { limited.set(k, (limited.get(k) ?? 0) + 1); return { status: 429, body: { message: 'Too many requests' } } }
    return undefined
  })
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: false, postalAddress: ADDRESS, f, log: quiet, pause: async (ms) => { waits.push(ms) } })
  assert.equal(r.ok, true, JSON.stringify(r.rows))
  assert.equal(calls.filter((c) => c.method === 'GET' && c.path.startsWith('/automations?limit=100')).length, 3, 'two 429s, then the answer')
  assert.deepEqual(waits, [1000, 2000])
  assert.equal(r.rows.at(-1)!.state, 'created')
})

test('a rate limit that does not clear after two retries is reported, not looped on', async () => {
  const { f, calls } = fakeResend((c) => (c.method === 'GET' && c.path.startsWith('/automations?limit=100') ? { status: 429, body: { message: 'Too many requests' } } : undefined))
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: false, postalAddress: ADDRESS, f, log: quiet, pause: async () => {} })
  assert.equal(r.ok, false)
  assert.equal(calls.filter((c) => c.path.startsWith('/automations?limit=100')).length, 3)
  assert.match(r.rows.at(-1)!.detail ?? '', /429/)
})

test('--enable without TIPS_SEGMENT_ID is refused: nothing is called', async () => {
  const { f, calls } = fakeResend(inPlace('disabled'))
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: true, postalAddress: ADDRESS, f, log: quiet })
  assert.equal(r.ok, false)
  assert.equal(r.rows[0].state, 'refused')
  assert.match(r.rows[0].detail ?? '', /TIPS_SEGMENT_ID/)
  assert.equal(calls.length, 0)
})

test('--enable: a start that fails is reported with the address masked; a 429 is retried once', async () => {
  let limited = true
  const { f, calls } = fakeResend(withList((c) => {
    if (c.method === 'POST' && c.path === '/events/send') {
      if (c.body!.email === 'guest@gmail.com' && limited) { limited = false; return { status: 429, body: { message: 'slow down' } } }
      if (c.body!.email === 'pat@hotmail.com') return { status: 500, body: { message: 'down' } }
    }
    return inPlace('disabled')(c)
  }, [], LIST))
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: true, postalAddress: ADDRESS, segment: 'seg-1', hubspotKey: 'pat-x', f, log: quiet, pause: noWait })
  assert.equal(r.ok, false)
  assert.equal(sentEvents(calls).length, 3, 'guest twice (429, then ok), pat once')
  assert.deepEqual(r.rows.at(-1), { part: 'backfill', name: 'tips list', state: 'failed', detail: 'series started for 1 of 2 on the tips list; not started: p***@hotmail.com (500)' })
})

test('--dry --enable: the plan counts the list and sends nothing, with no address in any line', async () => {
  const { f, calls } = fakeResend(withList(inPlace('disabled'), [], LIST))
  const lines: string[] = []
  const r = await runTipsAutomation({ key: 're_x', dry: true, enable: true, postalAddress: ADDRESS, segment: 'seg-1', hubspotKey: 'pat-x', f, log: (x) => lines.push(x), pause: noWait })
  assert.equal(r.ok, true, JSON.stringify(r.rows))
  assert.deepEqual([...new Set(calls.filter((c) => c.path !== HUBSPOT_READ).map((c) => c.method))], ['GET'], 'Resend is only read')
  assert.ok(lines.some((l) => l.includes('would PATCH /automations/auto-1 {"status":"enabled"}')))
  assert.ok(lines.some((l) => l.includes('would POST /templates/tpl-1/publish')), 'the templates would be republished')
  assert.deepEqual(r.rows.at(-1), { part: 'backfill', name: 'tips list', state: 'planned', detail: 'would start the series for 2 on the tips list' })
  assert.doesNotMatch(lines.join('\n') + JSON.stringify(r.rows), /guest@|pat@|gone@/)
})

test('a draft that already matches the code is published: an earlier publish that failed is not left behind an old version', async () => {
  // Resend's lookup shows the code's content, published, with a newer unpublished version: the publish after the last update failed.
  const draftOver = (c: Call): Answer => {
    const a = inPlace('disabled')(c)
    if (a && c.path === '/templates/trip-tips-1-ride') return { status: 200, body: { ...(a.body as object), has_unpublished_versions: true } }
    return a
  }
  const { f, calls } = fakeResend(draftOver)
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: false, postalAddress: ADDRESS, f, log: quiet })
  assert.equal(r.ok, true, JSON.stringify(r.rows))
  const writes = calls.filter((c) => c.method !== 'GET' && c.path !== HUBSPOT_READ)
  assert.deepEqual(writes.map((c) => `${c.method} ${c.path}`), ['PATCH /templates/tpl-1', 'POST /templates/tpl-1/publish'])
  assert.equal(writes[0].body!.html, tip1({ postalAddress: ADDRESS }).html)
  assert.equal(r.rows.find((x) => x.name === 'trip-tips-1-ride')!.state, 'updated')
})

test('a publish that fails stops before the automation, so --enable never switches on over the old version', async () => {
  const { f, calls } = fakeResend(withList((c) => (c.method === 'POST' && c.path === '/templates/tpl-1/publish' ? { status: 500, body: { message: 'down' } } : inPlace('disabled')(c)), [], LIST))
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: true, postalAddress: ADDRESS, segment: 'seg-1', hubspotKey: 'pat-x', f, log: quiet, pause: noWait })
  assert.equal(r.ok, false)
  assert.equal(calls.some((c) => c.path.startsWith('/automations')), false)
  assert.equal(sentEvents(calls).length, 0)
})

test('a template made by hand without the alias is adopted by name, not duplicated', async () => {
  const { f, calls } = fakeResend((c) => {
    if (c.method === 'GET' && c.path.startsWith('/templates?limit=100')) return { status: 200, body: { object: 'list', has_more: false, data: [{ id: 'hand-1', name: 'Trip tips 1: the ride from MBJ', status: 'draft' }] } }
    if (c.method === 'GET' && c.path === '/templates/hand-1') return { status: 200, body: { id: 'hand-1', name: 'Trip tips 1: the ride from MBJ', alias: null, html: '<p>draft</p>', status: 'draft' } }
    return undefined
  })
  await runTipsAutomation({ key: 're_x', dry: false, enable: false, postalAddress: ADDRESS, f, log: quiet })
  const writes = calls.filter((c) => c.method !== 'GET' && c.path !== HUBSPOT_READ).map((c) => `${c.method} ${c.path}`)
  assert.ok(writes.includes('PATCH /templates/hand-1'))
  assert.ok(writes.includes('POST /templates/hand-1/publish'))
  assert.equal(writes.filter((w) => w === 'POST /templates').length, 1, 'only tip 2 is created')
})

test('a failing lookup stops before the automation is touched', async () => {
  const { f, calls } = fakeResend((c) => (c.path.startsWith('/templates') ? { status: 401, body: { message: 'restricted key' } } : undefined))
  const r = await runTipsAutomation({ key: 're_x', dry: false, enable: false, postalAddress: ADDRESS, f, log: quiet })
  assert.equal(r.ok, false)
  assert.equal(calls.some((c) => c.path.startsWith('/automations')), false)
})

test('graph comparison helpers', () => {
  assert.equal(subsetEqual({ a: { b: 1 } }, { a: { b: 1, c: 2 }, d: 3 }), true)
  assert.equal(subsetEqual({ a: { b: 1 } }, { a: { b: 2 } }), false)
  const g = automationGraph(['a', 'b'])
  assert.equal(sameGraph(g, { steps: g.steps, connections: g.connections.map(({ from, to, type }) => ({ from, to, type })) }), true)
  assert.equal(sameGraph(g, { steps: g.steps, connections: [...g.connections, { from: 'wait_booking_1', to: 'tip_1', type: 'event_received' }] }), false)
  assert.equal(sameGraph(g, { steps: g.steps.slice(1), connections: g.connections }), false)
})

test('durations compare by length, the way Resend rewrites them ("12 days" comes back as "1 week 5 days")', () => {
  assert.equal(durationMinutes('12 days'), 12 * 1440)
  assert.equal(durationMinutes('1 week 5 days'), 12 * 1440)
  assert.equal(durationMinutes('2 days'), 2880)
  assert.equal(durationMinutes('1 hour'), 60)
  assert.equal(durationMinutes('soon'), null)
  assert.equal(durationMinutes('2 days please'), null)
  assert.equal(subsetEqual({ timeout: '12 days' }, { timeout: '1 week 5 days' }), true)
  assert.equal(subsetEqual({ timeout: '12 days' }, { timeout: '1 week 4 days' }), false)
  assert.equal(subsetEqual({ name: 'a' }, { name: 'b' }), false, 'other strings still compare exactly')
  const g = automationGraph(['a', 'b'])
  const live = JSON.parse(JSON.stringify(g).replace('"12 days"', '"1 week 5 days"'))
  assert.equal(sameGraph(g, live), true, 'the graph Resend returns matches the code')
})
