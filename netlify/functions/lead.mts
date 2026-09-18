import type { Context } from '@netlify/functions'
import { guide, followup1, followup2 } from '../lib/emails.mts'

/**
 * POST /api/lead { email, website?, source?, page? } as JSON, or a plain form
 * post from the no-JavaScript fallback.
 * Sends the arrival guide now and two follow-ups on a schedule (Resend
 * scheduled_at), and adds the address to the bio audience. Honeypot field
 * `website` must be empty. Never throws to the client: errors are 4xx/5xx JSON.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const FROM = 'MAPL Tours Jamaica <contact@mapltours.com>'
const REPLY_TO = 'contact@mapltours.com'
const ORIGINS = new Set(['https://bio.mapltours.com', 'http://localhost:3000', 'http://localhost:8888'])

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString()

async function resend(path: string, body: unknown, key: string) {
  const r = await fetch(`https://api.resend.com${path}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j }
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const origin = req.headers.get('origin') || ''
  if (origin && !ORIGINS.has(origin) && !origin.endsWith('.netlify.app')) return json(403, { error: 'Forbidden' })

  const key = process.env.RESEND_API_KEY
  const audience = process.env.BIO_AUDIENCE_ID
  if (!key) return json(500, { error: 'Email is not configured yet. Please try again later.' })

  const isForm = (req.headers.get('content-type') || '').includes('application/x-www-form-urlencoded')
  let body: { email?: string; website?: string; source?: string; page?: string } = {}
  try {
    if (isForm) { const f = await req.formData(); body = { email: String(f.get('email') ?? ''), website: String(f.get('website') ?? ''), source: 'bio-nojs' } }
    else body = await req.json()
  } catch { return json(400, { error: 'Invalid request' }) }

  // Honeypot: bots fill every field. Say yes, do nothing.
  if (body.website && body.website.trim()) return isForm ? Response.redirect('https://bio.mapltours.com/#guide', 303) : json(200, { ok: true })

  const email = (body.email ?? '').trim().toLowerCase().slice(0, 200)
  if (!EMAIL.test(email)) return isForm ? Response.redirect('https://bio.mapltours.com/#guide', 303) : json(400, { error: 'Please enter a valid email address.' })

  const headers = { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=stop>` }
  const tags = [{ name: 'source', value: 'bio' }, { name: 'flow', value: 'arrival_guide' }]

  const first = await resend('/emails', { from: FROM, to: [email], reply_to: REPLY_TO, subject: guide.subject, html: guide.html, headers, tags: [...tags, { name: 'step', value: '1' }] }, key)
  if (!first.ok) {
    const msg = first.status === 422 ? 'That address was refused by our email provider. Try another one.' : 'We could not send the guide right now. Please try again in a moment.'
    return isForm ? Response.redirect('https://bio.mapltours.com/#guide', 303) : json(502, { error: msg })
  }

  // Follow-ups are scheduled at capture time, so there is no cron to run or
  // forget. Resend accepts scheduled_at up to 30 days out.
  const later = await Promise.allSettled([
    resend('/emails', { from: FROM, to: [email], reply_to: REPLY_TO, subject: followup1.subject, html: followup1.html, headers, scheduled_at: plusDays(5), tags: [...tags, { name: 'step', value: '2' }] }, key),
    resend('/emails', { from: FROM, to: [email], reply_to: REPLY_TO, subject: followup2.subject, html: followup2.html, headers, scheduled_at: plusDays(12), tags: [...tags, { name: 'step', value: '3' }] }, key),
    audience ? resend(`/audiences/${audience}/contacts`, { email, unsubscribed: false }, key) : Promise.resolve({ ok: true }),
  ])
  const scheduled = later.slice(0, 2).filter((r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok).length

  if (isForm) return Response.redirect('https://bio.mapltours.com/?sent=1#guide', 303)
  return json(200, { ok: true, id: first.j?.id ?? null, scheduled })
}
