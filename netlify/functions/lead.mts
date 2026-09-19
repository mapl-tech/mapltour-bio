import type { Context } from '@netlify/functions'
import { codeEmail, followup1, followup2, type CouponView } from '../lib/emails.mts'
import offer from '../../data/offer.json' with { type: 'json' }

/**
 * POST /api/lead { email, website?, source?, page?, eventId? } as JSON, or a
 * plain form post from the no-JavaScript fallback.
 *
 * Asks mapltours.com to issue the person's coupon (the site owns the coupon
 * table and every rule; this function only carries the email across with a
 * shared key), sends the code now and two follow-ups on a schedule (Resend
 * scheduled_at), adds the address to the bio audience, and reports the lead
 * to Meta's Conversions API with the same event id the browser pixel used,
 * so Meta counts it once. Honeypot field `website` must be empty. Never
 * throws to the client: errors are 4xx/5xx JSON. The code itself only ever
 * travels by email.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const FROM = 'MAPL Tours Jamaica <contact@mapltours.com>'
const REPLY_TO = 'contact@mapltours.com'
const ORIGINS = new Set(['https://bio.mapltours.com', 'http://localhost:3000', 'http://localhost:8888'])
const ISSUE_URL = process.env.COUPON_ISSUE_URL || 'https://mapltours.com/api/coupons/issue'
const HOME = 'https://bio.mapltours.com'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString()
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Jamaica' })
const label = (kind: string, value: number) => (kind === 'percent' ? `${value}%` : `$${value}`)

async function resend(path: string, body: unknown, key: string) {
  const r = await fetch(`https://api.resend.com${path}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j }
}

/** One call to the site. Any failure leaves `coupon` null and the email says so. */
async function issueCoupon(email: string): Promise<CouponView | null> {
  const key = process.env.COUPON_ISSUE_KEY
  if (!key) { console.warn('[lead] COUPON_ISSUE_KEY not set'); return null }
  const r = await fetch(ISSUE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-coupon-issue-key': key },
    body: JSON.stringify({ email, source: 'bio', kind: offer.kind, value: offer.value, days: offer.days }),
  })
  const j = (await r.json().catch(() => ({}))) as { code?: string; kind?: string; value?: number; expiresAt?: string | null; spent?: boolean; error?: string }
  if (!r.ok || !j.code) { console.warn('[lead] coupon not issued:', r.status, j.error ?? ''); return null }
  return { code: j.code, label: label(j.kind ?? offer.kind, Number(j.value ?? offer.value)), until: j.expiresAt ? longDate(j.expiresAt) : 'further notice', spent: !!j.spent }
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Meta Conversions API. Only when the browser sent an event id, which it
 * does only when the visitor has not asked not to be tracked, so the server
 * never reports what the pixel would not have. Best effort.
 */
async function capiLead(req: Request, email: string, eventId: string, source: string, page: string) {
  const pixel = process.env.META_PIXEL_ID
  const token = process.env.META_CAPI_TOKEN
  if (!pixel || !token) return
  const cookies = Object.fromEntries((req.headers.get('cookie') ?? '').split(';').map((c) => c.trim().split('=') as [string, string]).filter(([k]) => k))
  const ip = req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ua = req.headers.get('user-agent')
  const body = {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      event_source_url: page || `${HOME}/`,
      action_source: 'website',
      user_data: {
        em: [await sha256(email)],
        ...(ip ? { client_ip_address: ip } : {}),
        ...(ua ? { client_user_agent: ua } : {}),
        ...(cookies._fbp ? { fbp: cookies._fbp } : {}),
        ...(cookies._fbc ? { fbc: cookies._fbc } : {}),
      },
      custom_data: { content_name: source },
    }],
  }
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pixel}/events?access_token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) console.warn('[lead] capi refused', r.status, (await r.text()).slice(0, 200))
  } catch (e) {
    console.warn('[lead] capi failed', e instanceof Error ? e.message : e)
  }
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const origin = req.headers.get('origin') || ''
  if (origin && !ORIGINS.has(origin) && !origin.endsWith('.netlify.app')) return json(403, { error: 'Forbidden' })

  const key = process.env.RESEND_API_KEY
  const audience = process.env.BIO_AUDIENCE_ID
  if (!key) return json(500, { error: 'Email is not configured yet. Please try again later.' })

  const isForm = (req.headers.get('content-type') || '').includes('application/x-www-form-urlencoded')
  let body: { email?: string; website?: string; source?: string; page?: string; eventId?: string } = {}
  try {
    if (isForm) { const f = await req.formData(); body = { email: String(f.get('email') ?? ''), website: String(f.get('website') ?? ''), source: 'bio-nojs' } }
    else body = await req.json()
  } catch { return json(400, { error: 'Invalid request' }) }

  // Honeypot: bots fill every field. Say yes, do nothing.
  if (body.website && body.website.trim()) return isForm ? Response.redirect(`${HOME}/#coupon`, 303) : json(200, { ok: true, coupon: true })

  const email = (body.email ?? '').trim().toLowerCase().slice(0, 200)
  if (!EMAIL.test(email)) return isForm ? Response.redirect(`${HOME}/#coupon`, 303) : json(400, { error: 'Please enter a valid email address.' })
  const source = String(body.source ?? 'bio').slice(0, 40)

  let coupon: CouponView | null = null
  try { coupon = await issueCoupon(email) } catch (e) { console.error('[lead] issue threw', e instanceof Error ? e.message : e) }

  const headers = { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=stop>` }
  const tags = [{ name: 'source', value: 'bio' }, { name: 'flow', value: 'coupon' }, { name: 'coupon', value: coupon ? (coupon.spent ? 'spent' : 'sent') : 'none' }]

  const first = codeEmail(coupon)
  const sent = await resend('/emails', { from: FROM, to: [email], reply_to: REPLY_TO, subject: first.subject, html: first.html, headers, tags: [...tags, { name: 'step', value: '1' }] }, key)
  if (!sent.ok) {
    const msg = sent.status === 422 ? 'That address was refused by our email provider. Try another one.' : 'We could not send it right now. Please try again in a moment.'
    return isForm ? Response.redirect(`${HOME}/#coupon`, 303) : json(502, { error: msg })
  }

  // Follow-ups are scheduled at capture time, so there is no cron to run or
  // forget. Resend accepts scheduled_at up to 30 days out.
  const f1 = followup1(coupon)
  const f2 = followup2(coupon)
  const eventId = typeof body.eventId === 'string' && /^[\w-]{8,64}$/.test(body.eventId) ? body.eventId : null
  const later = await Promise.allSettled([
    resend('/emails', { from: FROM, to: [email], reply_to: REPLY_TO, subject: f1.subject, html: f1.html, headers, scheduled_at: plusDays(5), tags: [...tags, { name: 'step', value: '2' }] }, key),
    resend('/emails', { from: FROM, to: [email], reply_to: REPLY_TO, subject: f2.subject, html: f2.html, headers, scheduled_at: plusDays(12), tags: [...tags, { name: 'step', value: '3' }] }, key),
    audience ? resend(`/audiences/${audience}/contacts`, { email, unsubscribed: false }, key) : Promise.resolve({ ok: true }),
    eventId ? capiLead(req, email, eventId, source, String(body.page ?? '').slice(0, 300)) : Promise.resolve(),
  ])
  const scheduled = later.slice(0, 2).filter((r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok).length

  if (isForm) return Response.redirect(`${HOME}/?sent=1#coupon`, 303)
  return json(200, { ok: true, id: sent.j?.id ?? null, scheduled, coupon: !!coupon && !coupon.spent })
}
