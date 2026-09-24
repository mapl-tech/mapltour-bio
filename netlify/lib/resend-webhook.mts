import { createHmac, timingSafeEqual } from 'node:crypto'
import { setTips } from './hubspot.mts'
import { json } from './http.mts'
import { EMAIL } from './lead-input.mts'

/**
 * POST /api/resend-webhook: Resend's contact events, so HubSpot's mapl_tips
 * follows Resend's `unsubscribed` flag. Every trip tips broadcast carries
 * Resend's own one-tap unsubscribe, and that flips only the Resend contact;
 * without this, HubSpot (and the weekly report's opt-in count) would keep
 * saying "yes" for people who left. Only contact.updated with
 * unsubscribed: true does anything, and only to a contact HubSpot has as
 * "yes" (setTips onlyIfYes), so a stop already on record keeps its source.
 *
 * Needs RESEND_WEBHOOK_SECRET (the endpoint's "whsec_..." signing secret
 * from the Resend dashboard) and HUBSPOT_SERVICE_KEY.
 */

/** Svix's replay window. */
const TOLERANCE_S = 5 * 60

/**
 * Resend signs webhooks the Svix way: HMAC-SHA256 with the base64 key after
 * "whsec_", over `${svix-id}.${svix-timestamp}.${raw body}`, sent as
 * space-separated "v1,<base64>" entries in svix-signature (more than one
 * while a secret is being rotated). A timestamp more than five minutes from
 * now is refused, so a captured request cannot be replayed later.
 */
export function verifyWebhook(headers: Headers, body: string, secret: string, nowMs = Date.now()): boolean {
  const id = headers.get('svix-id')
  const ts = headers.get('svix-timestamp')
  const sig = headers.get('svix-signature')
  if (!id || !ts || !sig || !/^\d{1,12}$/.test(ts)) return false
  if (Math.abs(nowMs / 1000 - Number(ts)) > TOLERANCE_S) return false
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
  if (!key.length) return false
  const want = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest()
  return sig.split(' ').some((entry) => {
    const comma = entry.indexOf(',')
    if (comma < 0 || entry.slice(0, comma) !== 'v1') return false
    const got = Buffer.from(entry.slice(comma + 1), 'base64')
    return got.length === want.length && timingSafeEqual(got, want)
  })
}

type Env = { RESEND_WEBHOOK_SECRET?: string; HUBSPOT_SERVICE_KEY?: string }

export async function handleResendWebhook(req: Request, env: Env = process.env, f: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' })
  const secret = env.RESEND_WEBHOOK_SECRET
  if (!secret) return json(503, { error: 'Not configured' })
  const body = await req.text()
  if (!verifyWebhook(req.headers, body, secret, now)) return json(401, { error: 'Invalid signature' })

  let evt: { type?: unknown; data?: Record<string, unknown> } | null = null
  try { evt = JSON.parse(body) } catch { return json(400, { error: 'Invalid body' }) }
  const d = evt?.data
  if (evt?.type !== 'contact.updated' || !d || d.unsubscribed !== true) return json(200, { ok: true, ignored: true })
  const email = typeof d.email === 'string' ? d.email.trim().toLowerCase() : ''
  if (!EMAIL.test(email)) return json(200, { ok: true, ignored: true })

  const changed = typeof d.updated_at === 'string' ? Date.parse(d.updated_at) : NaN
  const r = await setTips(env.HUBSPOT_SERVICE_KEY, email, { action: 'stop', at: Number.isFinite(changed) ? changed : now, source: 'unsubscribe link', onlyIfYes: true }, f)
  // Non-2xx makes Resend retry, which is what a HubSpot outage wants.
  if (!r.ok) {
    console.warn('[resend-webhook] hubspot refused', r.status, r.error)
    return json(502, { error: 'Not recorded' })
  }
  return json(200, { ok: true, action: r.action ?? null })
}
