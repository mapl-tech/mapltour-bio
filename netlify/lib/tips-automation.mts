/**
 * The "Trip tips welcome" automation in Resend, built and kept in step by
 * scripts/tips-automation.mts. Everything here goes through Resend's REST API
 * (snake_case bodies: event_name, reply_to...), never the Node SDK.
 *
 *   tips.subscribed (lead.mts / recordTips, a yes reaching the tips segment for the first time)
 *     -> wait for booking.paid, 2 days  --timeout--> tip 1 (the ride)
 *     -> wait for booking.paid, 12 days --timeout--> tip 2 (three tours)
 *
 * A booking.paid (mapltours.com's booking sync, only for an address that is
 * already a Resend contact) during either wait takes the event_received
 * branch, which has no outgoing connection, so the run ends there. Resend
 * skips the remaining send_email steps for a contact who unsubscribes.
 *
 * Idempotent: two events, two templates (found by alias, then by name;
 * written from tip-emails.mts and published when they differ, when they have
 * an unpublished draft, and always on --enable), one automation found by
 * name. A new automation is created disabled; only --enable turns it on, and
 * never while POSTAL_ADDRESS is null. The graph of an enabled automation
 * cannot be changed through the API, so a changed graph on an enabled
 * automation is reported as a failure, not forced.
 *
 * A disabled automation starts no runs, so a tips.subscribed sent while it
 * is off is dropped. The run of --enable that first switches it on (one that
 * has never had a run) therefore sends tips.subscribed to everyone on the
 * tips segment who has not unsubscribed, read just before the switch, except
 * test addresses and anyone HubSpot shows as having booked (their
 * booking.paid arrived while no run existed, so nothing would end theirs).
 */
import { FROM, REPLY_TO } from './emails.mts'
import { POSTAL_ADDRESS, TIP_TEMPLATES } from './tip-emails.mts'
import { BOOKING_PAID, TIPS_SUBSCRIBED } from './tips.mts'
import { TEST_EMAIL } from './report/util.mts'

export const AUTOMATION_NAME = 'Trip tips welcome'

/** Custom events and their payload schemas (flat key/type pairs). */
export const EVENTS = [
  { name: TIPS_SUBSCRIBED, schema: { source: 'string' } },
  { name: BOOKING_PAID, schema: { type: 'string' } },
] as const

type Step = { key: string; type: string; config: Record<string, unknown> }
type Connection = { from: string; to: string; type: 'default' | 'timeout' | 'event_received' }

/**
 * The graph. `templateIds` are the two templates' Resend ids, tip 1 first.
 * No event_received connection: a paid booking ends the run.
 */
export function automationGraph(templateIds: readonly [string, string]): { steps: Step[]; connections: Connection[] } {
  const send = (id: string) => ({ template: { id }, from: FROM, reply_to: REPLY_TO })
  return {
    steps: [
      { key: 'start', type: 'trigger', config: { event_name: TIPS_SUBSCRIBED } },
      { key: 'wait_booking_1', type: 'wait_for_event', config: { event_name: BOOKING_PAID, timeout: '2 days' } },
      { key: 'tip_1', type: 'send_email', config: send(templateIds[0]) },
      { key: 'wait_booking_2', type: 'wait_for_event', config: { event_name: BOOKING_PAID, timeout: '12 days' } },
      { key: 'tip_2', type: 'send_email', config: send(templateIds[1]) },
    ],
    connections: [
      { from: 'start', to: 'wait_booking_1', type: 'default' },
      { from: 'wait_booking_1', to: 'tip_1', type: 'timeout' },
      { from: 'tip_1', to: 'wait_booking_2', type: 'default' },
      { from: 'wait_booking_2', to: 'tip_2', type: 'timeout' },
    ],
  }
}

// ── The API, with every write behind one gate ────────────────────────────

type Fetch = typeof fetch
type J = Record<string, unknown>
export type ApiAnswer = { ok: boolean; status: number; j: J | null; planned?: boolean }
export type Api = (method: string, path: string, body?: unknown) => Promise<ApiAnswer>

const API = 'https://api.resend.com'

/**
 * `dry`: a write is never sent, only logged as "would ...", and answers as a
 * planned success. With no key at all (a dry run without RESEND_API_KEY)
 * reads answer 404, so the plan shows everything as to be created.
 */
/**
 * Resend allows 10 requests a second per team, shared with the live sites'
 * sends. A 429 means the request was not accepted, so it is always safe to
 * send again: up to two retries, after Retry-After when Resend gives one
 * (capped at 5 s), otherwise after 1 s and then 2 s.
 */
const MAX_429_RETRIES = 2

export function resendApi(key: string | undefined, dry: boolean, log: (s: string) => void, f: Fetch = fetch, pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Api {
  return async (method, path, body) => {
    if (method !== 'GET') {
      if (dry) { log(`  would ${method} ${decodeURIComponent(path)}${body === undefined ? '' : ` ${brief(body)}`}`); return { ok: true, status: 0, j: null, planned: true } }
      if (!key) return { ok: false, status: 0, j: null }
    }
    if (!key) return { ok: false, status: 404, j: null }
    try {
      let r = await f(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      for (let retry = 1; r.status === 429 && retry <= MAX_429_RETRIES; retry++) {
        const after = Number(r.headers.get('retry-after'))
        await pause(after > 0 ? Math.min(after, 5) * 1000 : retry * 1000)
        r = await f(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      }
      const text = await r.text().catch(() => '')
      let j: J | null = null
      try { j = text ? (JSON.parse(text) as J) : null } catch { j = { raw: text.slice(0, 200) } }
      return { ok: r.ok, status: r.status, j }
    } catch (e) {
      return { ok: false, status: 0, j: { message: e instanceof Error ? e.message : String(e) } }
    }
  }
}

/** A body in one line for the plan: long strings (template HTML) shortened to their length. */
function brief(body: unknown): string {
  return JSON.stringify(body, (_k, v) => (typeof v === 'string' && v.length > 120 ? `<${v.length} chars>` : v))
}

const why = (a: ApiAnswer) => `${a.status}${a.j && typeof a.j.message === 'string' ? ` ${a.j.message.slice(0, 160)}` : ''}`

/** Every page of a list endpoint (limit 100, `after` = the last id). */
async function listAll(api: Api, path: string): Promise<{ ok: boolean; rows: J[]; answer: ApiAnswer; truncated?: boolean }> {
  const rows: J[] = []
  let after = ''
  for (let page = 0; page < 20; page++) {
    const a = await api('GET', `${path}?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`)
    if (!a.ok || !a.j) return { ok: a.status === 404 && page === 0, rows, answer: a }
    const data = Array.isArray(a.j.data) ? (a.j.data as J[]) : []
    rows.push(...data)
    if (a.j.has_more !== true || !data.length) return { ok: true, rows, answer: a }
    after = String(data[data.length - 1].id ?? '')
  }
  return { ok: true, rows, answer: { ok: true, status: 200, j: null }, truncated: true }
}

// ── Comparisons ──────────────────────────────────────────────────────────

/** Every key of `want` is in `got` with the same value, recursively; extra keys in `got` are fine. */
/**
 * A Resend duration ("2 days", "12 days", "1 hour") in minutes, or null when
 * it is not one. Resend stores durations in its own words: "12 days" comes
 * back as "1 week 5 days", so two spellings of the same wait must compare
 * equal or every run would rewrite the graph, and an enabled automation
 * would be reported as changed when it is not.
 */
const UNIT_MINUTES: Record<string, number> = { minute: 1, hour: 60, day: 1440, week: 10080 }
export function durationMinutes(s: string): number | null {
  const parts = [...s.trim().toLowerCase().matchAll(/(\d+)\s*(minute|hour|day|week)s?\b/g)]
  if (!parts.length || parts.map((m) => m[0]).join(' ').replace(/\s+/g, ' ') !== s.trim().toLowerCase().replace(/\s+/g, ' ')) return null
  return parts.reduce((n, m) => n + Number(m[1]) * UNIT_MINUTES[m[2]], 0)
}

export function subsetEqual(want: unknown, got: unknown): boolean {
  if (typeof want === 'string' && typeof got === 'string' && want !== got) {
    const a = durationMinutes(want)
    return a !== null && a === durationMinutes(got)
  }
  if (want === null || typeof want !== 'object') return want === got
  if (got === null || typeof got !== 'object') return false
  if (Array.isArray(want)) return Array.isArray(got) && want.length === got.length && want.every((w, i) => subsetEqual(w, got[i]))
  return Object.entries(want as J).every(([k, v]) => subsetEqual(v, (got as J)[k]))
}

/** Whether a live automation has exactly this graph: the same step keys, each with our type and config, and the same connections. */
export function sameGraph(want: { steps: Step[]; connections: Connection[] }, live: J): boolean {
  const steps = Array.isArray(live.steps) ? (live.steps as J[]) : []
  const conns = Array.isArray(live.connections) ? (live.connections as J[]) : []
  if (steps.length !== want.steps.length || conns.length !== want.connections.length) return false
  const byKey = new Map(steps.map((s) => [String(s.key), s]))
  const stepsMatch = want.steps.every((w) => { const s = byKey.get(w.key); return !!s && s.type === w.type && subsetEqual(w.config, s.config) })
  const edge = (c: J) => `${String(c.from)}>${String(c.to)}:${String(c.type ?? 'default')}`
  const have = new Set(conns.map(edge))
  return stepsMatch && want.connections.every((c) => have.has(edge(c)))
}

const replyList = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [])

// ── The three parts ──────────────────────────────────────────────────────

export type Row = { part: 'event' | 'template' | 'automation' | 'backfill'; name: string; state: 'exists' | 'created' | 'updated' | 'planned' | 'failed' | 'refused'; detail?: string }

export async function ensureEvent(api: Api, name: string, schema: Record<string, string>): Promise<Row> {
  const got = await api('GET', `/events/${encodeURIComponent(name)}`)
  if (got.ok && got.j) {
    const live = (got.j.schema ?? null) as J | null
    const same = !!live && Object.keys(live).length === Object.keys(schema).length && subsetEqual(schema, live)
    if (same) return { part: 'event', name, state: 'exists' }
    const up = await api('PATCH', `/events/${encodeURIComponent(name)}`, { schema })
    return up.ok ? { part: 'event', name, state: up.planned ? 'planned' : 'updated', detail: 'schema' } : { part: 'event', name, state: 'failed', detail: `update ${why(up)}` }
  }
  if (got.status !== 404) return { part: 'event', name, state: 'failed', detail: `lookup ${why(got)}` }
  const made = await api('POST', '/events', { name, schema })
  return made.ok ? { part: 'event', name, state: made.planned ? 'planned' : 'created' } : { part: 'event', name, state: 'failed', detail: `create ${why(made)}` }
}

type TemplateSpec = { alias: string; name: string; subject: string; html: string }

/**
 * A template, created or brought up to date, and published. `id` is its
 * Resend id (a placeholder in a dry run when it does not exist yet).
 * `republish` (--enable) writes the code's version and publishes it even
 * when nothing looks different, so an automation is never switched on over
 * an older published version.
 */
export async function ensureTemplate(api: Api, t: TemplateSpec, republish = false): Promise<{ row: Row; id: string | null }> {
  const body = { name: t.name, alias: t.alias, subject: t.subject, html: t.html, from: FROM, reply_to: REPLY_TO }
  const fail = (detail: string) => ({ row: { part: 'template' as const, name: t.alias, state: 'failed' as const, detail }, id: null })
  const publish = async (id: string, state: Row['state'], detail?: string) => {
    const pub = await api('POST', `/templates/${encodeURIComponent(id)}/publish`)
    if (!pub.ok) return fail(`publish ${why(pub)}`)
    return { row: { part: 'template' as const, name: t.alias, state: pub.planned ? ('planned' as const) : state, ...(detail ? { detail } : {}) }, id }
  }

  let live: J | null = null
  const byAlias = await api('GET', `/templates/${encodeURIComponent(t.alias)}`)
  if (byAlias.ok && byAlias.j) live = byAlias.j
  else if (byAlias.status !== 404) return fail(`lookup ${why(byAlias)}`)
  else {
    // Made by hand without the alias? Adopt the one with our name rather than add a second.
    const list = await listAll(api, '/templates')
    if (!list.ok) return fail(`list ${why(list.answer)}`)
    const named = list.rows.filter((r) => r.name === t.name)
    if (named.length > 1) return fail(`${named.length} templates are named "${t.name}"; keep one`)
    if (named.length === 1) {
      const full = await api('GET', `/templates/${encodeURIComponent(String(named[0].id))}`)
      if (!full.ok || !full.j) return fail(`lookup ${why(full)}`)
      live = full.j
    }
  }

  if (!live) {
    const made = await api('POST', '/templates', body)
    if (!made.ok) return fail(`create ${why(made)}`)
    const id = made.planned ? `<id of ${t.alias}>` : String(made.j?.id ?? '')
    if (!id) return fail('create answered without an id')
    return publish(id, 'created')
  }

  const cur: J = live
  const id = String(cur.id ?? '')
  const differs: string[] = (['name', 'alias', 'subject', 'html', 'from'] as const).filter((k) => cur[k] !== body[k])
  if (JSON.stringify(replyList(cur.reply_to)) !== JSON.stringify([REPLY_TO])) differs.push('reply_to')
  if (differs.length) {
    const up = await api('PATCH', `/templates/${encodeURIComponent(id)}`, body)
    if (!up.ok) return fail(`update ${why(up)}`)
    return publish(id, 'updated', differs.join(', '))
  }
  // Same content, but the published version may not be: API updates change
  // the draft only, so a publish that failed on an earlier run leaves the
  // code's version (say, the one with the postal address) as a draft behind
  // an older published one. The draft is written from the code first, since
  // what a lookup returns may be the published version and the draft may be
  // someone's dashboard edit; the code is the source of these emails.
  const draft = cur.has_unpublished_versions === true
  if (republish || draft) {
    const up = await api('PATCH', `/templates/${encodeURIComponent(id)}`, body)
    if (!up.ok) return fail(`update ${why(up)}`)
    return publish(id, 'updated', draft ? 'unpublished draft: rewritten from the code and published' : 'republished before enabling')
  }
  if (cur.status !== 'published') return publish(id, 'updated', 'was not published')
  return { row: { part: 'template', name: t.alias, state: 'exists' }, id }
}

/** An address for a log line: first character, then the domain. */
export const maskEmail = (e: string) => `${e.slice(0, 1)}***@${e.split('@')[1] ?? ''}`

/** Whether the automation has ever had a run; null when that cannot be read. */
async function hadRuns(api: Api, id: string): Promise<boolean | null> {
  const a = await api('GET', `/automations/${encodeURIComponent(id)}/runs?limit=1`)
  if (!a.ok || !a.j || !Array.isArray(a.j.data)) return null
  return a.j.data.length > 0
}

/**
 * Everyone on the tips segment who has not unsubscribed, lower-cased, once
 * each, without test addresses. A list too long to read in full is a
 * failure, never a silent cut.
 */
async function tipsList(api: Api, segment: string): Promise<{ ok: true; emails: string[]; tests: number } | { ok: false; detail: string }> {
  const list = await listAll(api, `/segments/${encodeURIComponent(segment)}/contacts`)
  if (!list.ok || list.answer.status === 404) return { ok: false, detail: `tips segment ${why(list.answer)}` }
  if (list.truncated) return { ok: false, detail: `tips segment has more than ${list.rows.length} contacts, more than this script reads` }
  const all = [...new Set(list.rows.filter((r) => r.unsubscribed !== true && typeof r.email === 'string' && r.email.includes('@')).map((r) => String(r.email).trim().toLowerCase()))]
  const emails = all.filter((e) => !TEST_EMAIL.test(e))
  return { ok: true, emails, tests: all.length - emails.length }
}

/**
 * The addresses HubSpot shows as having booked (mapl_last_booking_at set, or
 * lifecycle stage customer; mapltours.com's booking sync writes both), or
 * null when that cannot be read. Read-only: HubSpot's batch read is a POST.
 */
export function hubspotBooked(key: string, f: Fetch = fetch): (emails: string[]) => Promise<Set<string> | null> {
  return async (emails) => {
    const booked = new Set<string>()
    for (let i = 0; i < emails.length; i += 100) {
      const r = await f('https://api.hubapi.com/crm/v3/objects/contacts/batch/read', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ idProperty: 'email', properties: ['email', 'mapl_last_booking_at', 'lifecyclestage'], inputs: emails.slice(i, i + 100).map((id) => ({ id })) }),
      }).catch(() => null)
      if (!r || (r.status !== 200 && r.status !== 207)) return null
      const j = (await r.json().catch(() => null)) as { results?: Array<{ properties?: Record<string, string | null> }> } | null
      if (!j || !Array.isArray(j.results)) return null
      for (const c of j.results) {
        const p = c.properties ?? {}
        if (p.email && (p.mapl_last_booking_at || p.lifecyclestage === 'customer')) booked.add(p.email.trim().toLowerCase())
      }
    }
    return booked
  }
}

/**
 * What the first switch-on owes the people already on the list. `segment` is
 * TIPS_SEGMENT_ID; `haveKey` false (a dry run without a key) plans it without
 * reading the list.
 */
export type CatchUp = { segment: string; haveKey: boolean; dry: boolean; pause?: (ms: number) => Promise<void>; booked?: (emails: string[]) => Promise<Set<string> | null> }

/**
 * tips.subscribed for each address, one at a time (about four a second, well
 * under Resend's ten per team, which the live site shares), a 429 retried
 * once. Addresses are never logged, only counted (failures masked). A dry run
 * sends nothing and prints no address.
 */
async function sendCatchUp(api: Api, emails: string[] | null, c: CatchUp): Promise<Row> {
  const name = 'tips list'
  if (c.dry) return { part: 'backfill', name, state: 'planned', detail: emails ? `would start the series for ${emails.length} on the tips list` : 'would start the series for everyone on the tips list (not read without a key)' }
  const pause = c.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let sent = 0
  const failed: string[] = []
  for (const [i, email] of (emails ?? []).entries()) {
    if (i) await pause(250)
    const body = { event: TIPS_SUBSCRIBED, email, payload: { source: 'tips list' } }
    let a = await api('POST', '/events/send', body)
    if (a.status === 429) { await pause(1000); a = await api('POST', '/events/send', body) }
    if (a.ok) sent++
    else failed.push(`${maskEmail(email)} (${a.status})`)
  }
  const detail = `series started for ${sent} of ${(emails ?? []).length} on the tips list`
  return failed.length ? { part: 'backfill', name, state: 'failed', detail: `${detail}; not started: ${failed.join(', ')}` } : { part: 'backfill', name, state: sent ? 'created' : 'exists', detail }
}

/**
 * The automation, created (disabled) or brought in step. With `enable`, it is
 * switched on; with `catchUp` too, a switch-on of an automation that has
 * never had a run first reads the tips list, then, once it is on, starts the
 * series for everyone on it: they said yes while it was off, and Resend
 * dropped those events. An automation that has had runs was on before, so
 * nobody is started twice; yeses from a later pause are not recovered. When
 * the runs or the list cannot be read, it stays off.
 */
export async function ensureAutomation(api: Api, graph: { steps: Step[]; connections: Connection[] }, enable: boolean, catchUp?: CatchUp): Promise<Row[]> {
  const name = AUTOMATION_NAME
  const row = (state: Row['state'], detail?: string): Row => ({ part: 'automation', name, state, ...(detail ? { detail } : {}) })

  /** Read what a first switch-on owes, then switch on, then send it. */
  const switchOn = async (id: string, isNew: boolean, before: string[]): Promise<Row[]> => {
    let owed: string[] | null | undefined
    if (catchUp) {
      const ran = isNew ? false : await hadRuns(api, id)
      if (ran === null) return [row('failed', [...before, 'its runs could not be read, so it was not enabled: run this again'].join(', '))]
      if (!ran) {
        if (!catchUp.haveKey) owed = null
        else {
          const l = await tipsList(api, catchUp.segment)
          if (!l.ok) return [row('failed', [...before, `${l.detail}, so it was not enabled`].join(', '))]
          // Someone who booked while the series was off would get tips about
          // a trip they already have: leave them out, and stay off when that
          // cannot be read.
          if (!catchUp.booked) return [row('failed', [...before, 'HUBSPOT_SERVICE_KEY is not set, so people who have booked cannot be left out; it was not enabled'].join(', '))]
          const b = l.emails.length ? await catchUp.booked(l.emails) : new Set<string>()
          if (!b) return [row('failed', [...before, 'HubSpot could not say who has booked, so it was not enabled'].join(', '))]
          owed = l.emails.filter((e) => !b.has(e))
          const left = [l.tests ? `${l.tests} test address${l.tests === 1 ? '' : 'es'}` : '', b.size ? `${b.size} who booked` : ''].filter(Boolean)
          if (left.length) before = [...before, `left out ${left.join(' and ')}`]
        }
      }
    }
    const on = await api('PATCH', `/automations/${encodeURIComponent(id)}`, { status: 'enabled' })
    if (!on.ok) return [row('failed', [...before, `enable ${why(on)}`].join(', '))]
    const done = row(on.planned ? 'planned' : isNew ? 'created' : 'updated', [...before, on.planned ? 'would enable' : 'enabled'].join(', '))
    if (!catchUp || owed === undefined) return [done, ...(catchUp ? [{ part: 'backfill' as const, name: 'tips list', state: 'exists' as const, detail: 'it has had runs before, so nobody is started again' }] : [])]
    return [done, await sendCatchUp(api, owed, catchUp)]
  }

  const list = await listAll(api, '/automations')
  if (!list.ok) return [row('failed', `list ${why(list.answer)}`)]
  const named = list.rows.filter((r) => r.name === name)
  if (named.length > 1) return [row('failed', `${named.length} automations are named "${name}"; keep one`)]

  if (!named.length) {
    const made = await api('POST', '/automations', { name, status: 'disabled', ...graph })
    if (!made.ok) return [row('failed', `create ${why(made)}`)]
    if (!enable) return [row(made.planned ? 'planned' : 'created', 'disabled')]
    const id = made.planned ? '<new automation id>' : String(made.j?.id ?? '')
    return switchOn(id, true, ['created disabled'])
  }

  const id = String(named[0].id ?? '')
  const got = await api('GET', `/automations/${encodeURIComponent(id)}`)
  if (!got.ok || !got.j) return [row('failed', `lookup ${why(got)}`)]
  const status = String(got.j.status ?? '')
  const done: string[] = [`${status || 'unknown'} (${id})`]
  if (!sameGraph(graph, got.j)) {
    if (status === 'enabled') return [row('failed', 'the steps differ, and an enabled automation cannot be changed: disable it in the Resend dashboard (or duplicate it), then run this again')]
    const up = await api('PATCH', `/automations/${encodeURIComponent(id)}`, graph)
    if (!up.ok) return [row('failed', `update ${why(up)}`)]
    done.push(up.planned ? 'would update steps' : 'steps updated')
  }
  if (enable && status !== 'enabled') return switchOn(id, false, done)
  const planned = done.some((d) => d.startsWith('would'))
  return [row(planned ? 'planned' : done.length > 1 ? 'updated' : 'exists', done.join(', '))]
}

export type RunOptions = { key?: string; dry: boolean; enable: boolean; postalAddress?: string | null; segment?: string; hubspotKey?: string; log?: (s: string) => void; f?: Fetch; pause?: (ms: number) => Promise<void> }

/**
 * The whole setup, in order: events, templates (the automation can only use
 * published ones; on --enable both are rewritten from the code and
 * republished), then the automation. Stops before the automation when a
 * template failed, so a graph never points at a template that is not there.
 * `--enable` is refused outright while there is no postal address, and
 * without `segment` (TIPS_SEGMENT_ID): the first switch-on starts the series
 * for everyone already on that list.
 */
export async function runTipsAutomation(o: RunOptions): Promise<{ ok: boolean; rows: Row[] }> {
  const log = o.log ?? console.log
  const address = o.postalAddress === undefined ? POSTAL_ADDRESS : o.postalAddress
  if (o.enable && !address) {
    const rows: Row[] = [{ part: 'automation', name: AUTOMATION_NAME, state: 'refused', detail: 'POSTAL_ADDRESS in netlify/lib/tip-emails.mts is null. Every trip tips email must carry the postal address, so the automation stays disabled until it is set.' }]
    return { ok: false, rows }
  }
  if (o.enable && !o.segment) {
    const rows: Row[] = [{ part: 'automation', name: AUTOMATION_NAME, state: 'refused', detail: 'TIPS_SEGMENT_ID is not set. Switching the automation on for the first time also starts the series for everyone who said yes while it was off, so it needs the tips segment id (the value on Netlify).' }]
    return { ok: false, rows }
  }
  const api = resendApi(o.key, o.dry, log, o.f, o.pause)
  const rows: Row[] = []
  for (const e of EVENTS) rows.push(await ensureEvent(api, e.name, e.schema))
  const ids: string[] = []
  for (const t of TIP_TEMPLATES) {
    const email = t.build({ postalAddress: address })
    const r = await ensureTemplate(api, { alias: t.alias, name: t.name, subject: email.subject, html: email.html }, o.enable)
    rows.push(r.row)
    if (r.id) ids.push(r.id)
  }
  if (ids.length !== TIP_TEMPLATES.length) {
    rows.push({ part: 'automation', name: AUTOMATION_NAME, state: 'failed', detail: 'skipped: a template is missing' })
    return { ok: false, rows }
  }
  const catchUp = o.enable && o.segment ? { segment: o.segment, haveKey: !!o.key, dry: o.dry, pause: o.pause, booked: o.hubspotKey ? hubspotBooked(o.hubspotKey, o.f) : undefined } : undefined
  rows.push(...(await ensureAutomation(api, automationGraph([ids[0], ids[1]]), o.enable, catchUp)))
  return { ok: rows.every((r) => r.state !== 'failed' && r.state !== 'refused'), rows }
}
