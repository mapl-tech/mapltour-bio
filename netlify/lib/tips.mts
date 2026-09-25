import { createHmac, timingSafeEqual } from 'node:crypto'
import { EMAIL } from './lead-input.mts'
import { setTips } from './hubspot.mts'

/**
 * Signed trip tips links for the code email, and what a confirmed tap
 * records.
 *
 *   https://bio.mapltours.com/tips?a=yes|stop&e=<base64url(email)>&t=<token>
 *   token = base64url(HMAC-SHA256(TIPS_SECRET, "tips:v1:" + action + ":" + email))
 *
 * The token is bound to the action AND the address, so a yes link never
 * works as a stop, and one person's link never works for another address.
 * The version prefix lets a future format change retire old links.
 */
export type TipsAction = 'yes' | 'stop'

const BIO = 'https://bio.mapltours.com'

export function signTips(action: TipsAction, email: string, secret: string): string {
  return createHmac('sha256', secret).update(`tips:v1:${action}:${email.trim().toLowerCase()}`).digest('base64url')
}

export function tipsUrl(action: TipsAction, email: string, secret: string): string {
  const addr = email.trim().toLowerCase()
  return `${BIO}/tips?a=${action}&e=${Buffer.from(addr, 'utf8').toString('base64url')}&t=${signTips(action, addr, secret)}`
}

/**
 * The action and address a link carries, or null for anything that is not
 * exactly a link we signed: unknown action, non-canonical base64 (Node's
 * decoder skips junk characters, so the round trip is checked), an address
 * that is not lower case or not an address, or a token that does not match.
 */
export function verifyTips(a: unknown, e: unknown, t: unknown, secret: string): { action: TipsAction; email: string } | null {
  if (a !== 'yes' && a !== 'stop') return null
  if (typeof e !== 'string' || !/^[A-Za-z0-9_-]{4,440}$/.test(e)) return null
  if (typeof t !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(t)) return null
  const raw = Buffer.from(e, 'base64url')
  if (raw.toString('base64url') !== e) return null
  const email = raw.toString('utf8')
  if (email.length > 320 || email !== email.trim().toLowerCase() || !EMAIL.test(email)) return null
  const want = Buffer.from(signTips(a, email, secret))
  const got = Buffer.from(t)
  return want.length === got.length && timingSafeEqual(want, got) ? { action: a, email } : null
}

type Fetch = typeof fetch
type Answer = { ok: boolean; status: number }

/**
 * The trip tips list is a Resend SEGMENT of its own (TIPS_SEGMENT_ID), never
 * BIO_AUDIENCE_ID: until Sept 24 2026 every code requester was added to that
 * audience as subscribed, none of them asked for tips, and it must never be
 * broadcast to.
 *
 * Resend contacts are global (one per address across the account) and
 * `unsubscribed` is their global flag: true stops every broadcast, whether
 * our stop link or Resend's own unsubscribe link set it. Segment membership
 * is a separate call. So joining the list is "the contact exists" plus "add
 * it to the segment", and a stop is the global flag.
 */
const API = 'https://api.resend.com'

/** Resend's contact path takes the address itself; keep the @ readable, encode the rest. */
const contactPath = (email: string) => `/contacts/${encodeURIComponent(email).replace(/%40/g, '@')}`

async function resend(f: Fetch, key: string, method: string, path: string, body?: unknown): Promise<Answer & { j: Record<string, unknown> | null }> {
  try {
    const r = await f(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await r.text().catch(() => '')
    let j: Record<string, unknown> | null = null
    try { j = text ? (JSON.parse(text) as Record<string, unknown>) : null } catch { /* not JSON */ }
    return { ok: r.ok, status: r.status, j }
  } catch {
    return { ok: false, status: 0, j: null }
  }
}

/**
 * Where an address stands in Resend: `none` (Resend has never seen it),
 * `on`, `off` (unsubscribed: our stop link, Resend's unsubscribe link or the
 * owner by hand) or `unknown` (the lookup failed).
 */
export type ListState = 'none' | 'on' | 'off' | 'unknown'

export async function listState(email: string, key: string, f: Fetch = fetch): Promise<ListState> {
  const r = await resend(f, key, 'GET', contactPath(email))
  if (r.status === 404) return 'none'
  if (!r.ok || !r.j) return 'unknown'
  return r.j.unsubscribed === true ? 'off' : r.j.unsubscribed === false ? 'on' : 'unknown'
}

const addToSegment = (f: Fetch, key: string, email: string, segment: string) =>
  resend(f, key, 'POST', `${contactPath(email)}/segments/${encodeURIComponent(segment)}`)

/**
 * Whether the address is on the tips segment already: false when Resend has
 * no contact for it or the contact is in other segments only, null when the
 * lookup failed. Read BEFORE a join, so the caller can tell the first time a
 * yes reaches the list from a repeat.
 */
export async function onSegment(email: string, key: string, segment: string, f: Fetch = fetch): Promise<boolean | null> {
  const r = await resend(f, key, 'GET', `${contactPath(email)}/segments`)
  if (r.status === 404) return false
  if (!r.ok || !r.j || !Array.isArray(r.j.data)) return null
  return (r.j.data as Array<Record<string, unknown>>).some((s) => s?.id === segment)
}

/**
 * A tick on a form (lead.mts). Create-only: /api/lead proves nothing about
 * who owns the mailbox, so it never touches `unsubscribed` on a contact that
 * exists; a stopped address stays stopped (the caller does not even get
 * here for `off`). Creates the contact only when Resend said it has none,
 * then adds it to the segment, which never changes the flag either.
 */
export async function listJoin(email: string, key: string, segment: string, state: ListState, f: Fetch = fetch): Promise<Answer> {
  if (state === 'off') return { ok: false, status: 409 }
  if (state === 'none') {
    const made = await resend(f, key, 'POST', '/contacts', { email })
    if (!made.ok) console.warn('[tips] resend create refused', made.status)
  }
  const { ok, status } = await addToSegment(f, key, email, segment)
  return { ok, status }
}

/**
 * The code email's yes link (POST /tips). The signed link proves the person
 * reads this mailbox, so this is the one path allowed to lift an earlier
 * stop: switch the contact on (create it on 404), then add it to the segment.
 */
export async function listResubscribe(email: string, key: string, segment: string, f: Fetch = fetch): Promise<Answer> {
  const on = await resend(f, key, 'PATCH', contactPath(email), { unsubscribed: false })
  if (!on.ok) {
    if (on.status !== 404) return { ok: false, status: on.status }
    const made = await resend(f, key, 'POST', '/contacts', { email, unsubscribed: false })
    if (!made.ok) return { ok: false, status: made.status }
  }
  const { ok, status } = await addToSegment(f, key, email, segment)
  return { ok, status }
}

/**
 * Tips off: the global flag, so no broadcast reaches them from any segment.
 * On the global path a 404 means Resend has no contact for the address at
 * all, so there is nothing to stop.
 */
export async function listStop(email: string, key: string, f: Fetch = fetch): Promise<Answer> {
  const r = await resend(f, key, 'PATCH', contactPath(email), { unsubscribed: true })
  return r.status === 404 ? { ok: true, status: 404 } : { ok: r.ok, status: r.status }
}

/**
 * Resend custom events for the "Trip tips welcome" automation
 * (scripts/tips-automation.mts). tips.subscribed starts it; booking.paid,
 * sent by mapltours.com's booking sync for an address that is already a
 * Resend contact, ends a run that is still waiting.
 */
export const TIPS_SUBSCRIBED = 'tips.subscribed'
export const BOOKING_PAID = 'booking.paid'

/**
 * Whether this yes starts the welcome series, decided BEFORE the segment add:
 * a yes HubSpot did not have before this request, or a standing yes that has
 * not reached the tips segment yet. The second case is the retry after an
 * earlier request recorded the yes in HubSpot and then failed (the code
 * email, or the segment add, or the /tips resubscribe), so its series never
 * started. A standing yes already on the segment starts nothing, and neither
 * does one whose lookup failed: a second run would mail every tip twice.
 * The lookup is live, never a reading taken earlier in the request: a double
 * submit's second request must see the segment add the first one made.
 */
export async function startsSeries(o: { newYes: boolean; email: string; key: string; segment: string }, f: Fetch = fetch): Promise<boolean> {
  if (o.newYes) return true
  const on = await onSegment(o.email, o.key, o.segment, f)
  if (on === null) console.warn('[tips] segment lookup failed; the series is not started')
  return on === false
}

/**
 * Send tips.subscribed for an address whose yes just reached the tips
 * segment for the first time (startsSeries). The callers send it only after
 * the segment add succeeded. Best effort: a refusal is logged and returned,
 * never thrown, so it never fails the request that recorded the yes. A 429
 * (Resend's per-team rate limit, shared with the site's sends) is retried
 * once, since a rate-limited event was never accepted; nothing else is
 * retried, because a 5xx or a dropped connection may have started a run.
 * `source` is mapl_tips_source (bio hero, bio coupon, site popup, code email).
 */
export async function tipsSubscribed(email: string, key: string, source: string, f: Fetch = fetch, pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<Answer> {
  const body = { event: TIPS_SUBSCRIBED, email: email.trim().toLowerCase(), payload: { source: source.slice(0, 40) } }
  let r = await resend(f, key, 'POST', '/events/send', body)
  if (r.status === 429) { await pause(1000); r = await resend(f, key, 'POST', '/events/send', body) }
  if (!r.ok) console.warn('[tips] tips.subscribed event refused', r.status)
  return { ok: r.ok, status: r.status }
}

export type TipsEnv = { TIPS_SECRET?: string; RESEND_API_KEY?: string; TIPS_SEGMENT_ID?: string; HUBSPOT_SERVICE_KEY?: string }

/**
 * What a confirmed tap (POST /tips) records.
 *
 * Yes: the consent record comes first. HubSpot must take mapl_tips "yes"
 * before the address goes on the list, so nobody is mailed without a record
 * of when and in what words they asked; without HUBSPOT_SERVICE_KEY a yes
 * cannot be recorded at all (503). With no TIPS_SEGMENT_ID the record is
 * all there is (no list writes, no event). Once the address is on the list,
 * a yes that moved HubSpot from not-yes, or a standing yes that was not on
 * the segment before this tap (an earlier tap failed after HubSpot took the
 * yes), sends tips.subscribed (the welcome series); a yes already on record
 * and on the list does not, and a refused event never turns the page's
 * "done" into a failure.
 *
 * Stop: every store that is configured, together; the global Resend flag
 * needs only RESEND_API_KEY. 503 when neither store is configured.
 *
 * ok only when every step that ran succeeded, so the page never says "done"
 * while a stop has not reached the list.
 */
export async function recordTips(action: TipsAction, email: string, env: TipsEnv, f: Fetch = fetch, now = Date.now()): Promise<{ ok: boolean; status: number }> {
  const key = env.RESEND_API_KEY
  const segment = env.TIPS_SEGMENT_ID
  const hub = env.HUBSPOT_SERVICE_KEY
  if (action === 'yes') {
    if (!hub) return { ok: false, status: 503 }
    const crm = await setTips(hub, email, { action, at: now }, f)
    if (!crm.ok) { console.warn('[tips] hubspot refused', action, crm.status, crm.error); return { ok: false, status: 502 } }
    if (!(key && segment)) return { ok: true, status: 200 }
    const starts = await startsSeries({ newYes: crm.before !== 'yes', email, key, segment }, f)
    const list = await listResubscribe(email, key, segment, f)
    if (!list.ok) { console.warn('[tips] resend refused', action, list.status); return { ok: false, status: 502 } }
    if (starts) await tipsSubscribed(email, key, 'code email', f)
    return { ok: true, status: 200 }
  }
  if (!key && !hub) return { ok: false, status: 503 }
  const [list, crm] = await Promise.all([
    key ? listStop(email, key, f) : Promise.resolve(null),
    hub ? setTips(hub, email, { action, at: now }, f) : Promise.resolve(null),
  ])
  if (list && !list.ok) console.warn('[tips] resend refused', action, list.status)
  if (crm && !crm.ok) console.warn('[tips] hubspot refused', action, crm.status, crm.error)
  const ok = (list?.ok ?? true) && (crm?.ok ?? true)
  return { ok, status: ok ? 200 : 502 }
}
