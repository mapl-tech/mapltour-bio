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

export type TipsEnv = { TIPS_SECRET?: string; RESEND_API_KEY?: string; TIPS_SEGMENT_ID?: string; HUBSPOT_SERVICE_KEY?: string }

/**
 * What a confirmed tap (POST /tips) records.
 *
 * Yes: the consent record comes first. HubSpot must take mapl_tips "yes"
 * before the address goes on the list, so nobody is mailed without a record
 * of when and in what words they asked; without HUBSPOT_SERVICE_KEY a yes
 * cannot be recorded at all (503). With no TIPS_SEGMENT_ID the record is
 * all there is (no list writes).
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
    const list = await listResubscribe(email, key, segment, f)
    if (!list.ok) console.warn('[tips] resend refused', action, list.status)
    return { ok: list.ok, status: list.ok ? 200 : 502 }
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
