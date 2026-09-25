import type { Context } from '@netlify/functions'
import { COUPON, FROM, GIVEAWAY, REPLY_TO, codeEmail, giveawayOpen } from '../lib/emails.mts'
import { upsertLead } from '../lib/hubspot.mts'
import { json, seeOther } from '../lib/http.mts'
import { EMAIL, readLead, tipsSource } from '../lib/lead-input.mts'
import { listJoin, listState, startsSeries, tipsSubscribed, tipsUrl } from '../lib/tips.mts'
import { TIPS_LABEL, tipsConsentValid } from '../../lib/tips.mts'

/**
 * POST /api/lead { email, website?, source?, page?, eventId?, optIn?,
 * optInDefault?, channel?, country? } as JSON, or a plain form post from the
 * no-JavaScript fallback (email, website, tips=yes, place).
 *
 * Sends the public code (JAMAICA5, from data/offer.json; the site's coupon
 * desk owns its rules: 5% off a tour or an airport ride, once per email
 * address) once, with no follow-ups: the owner dropped them on Sept 19 2026
 * because nothing could stop them once the code was used. Creates or
 * updates the HubSpot contact (when HUBSPOT_SERVICE_KEY is set), and reports
 * the lead to Meta's Conversions API with the same event id the browser
 * pixel used, so Meta counts it once. Honeypot field `website` must be
 * empty. Never throws to the client: errors are 4xx/5xx JSON.
 *
 * Trip tips, in this order:
 *  1. Where the address stands: Resend's global contact (an `off` there is
 *     a stop, ours or Resend's unsubscribe link) and, inside upsertLead,
 *     HubSpot's mapl_tips. A form never lifts a stop: /api/lead cannot tell
 *     who typed the address. Only the signed yes link in the email can.
 *  2. The consent record: HubSpot takes the yes (lib/tips.mts decides
 *     whether the tick is consent) with its wording, default and country.
 *  3. The code email, written from the real state: an address with a yes on
 *     record (now or earlier) gets the opted-in footer and the stop link;
 *     everyone else gets the "Yes, send me trip tips" card (when
 *     TIPS_SECRET is set).
 *  4. Only then the list: the TIPS_SEGMENT_ID segment, create-only, and only
 *     for an address with a yes on record. BIO_AUDIENCE_ID is never
 *     written: it holds every past code requester, none of whom asked.
 *  5. A yes that reaches the segment for the first time sends Resend's
 *     tips.subscribed event, which starts the welcome series
 *     (scripts/tips-automation.mts): a NEW yes (HubSpot wrote it now and it
 *     was not yes before), or a standing yes that was not on the segment
 *     yet, which is the retry after an earlier request recorded the yes and
 *     then failed at the email or the join. Never for a repeat request from
 *     someone already on the list, a stop, a pre-tick that is not consent, or
 *     without the segment; a refused event is logged and the request still
 *     succeeds.
 * So nobody is on the list without a record of when, where and in what
 * words they asked. HubSpot is written before the send, so an address
 * Resend then refuses is still a contact; that is the price of step 3.
 */
const ORIGINS = new Set(['https://bio.mapltours.com', 'http://localhost:3000', 'http://localhost:8888'])
const HOME = 'https://bio.mapltours.com'

async function resend(path: string, body: unknown, key: string) {
  const r = await fetch(`https://api.resend.com${path}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j }
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

export default async (req: Request, ctx: Context) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const origin = req.headers.get('origin') || ''
  if (origin && !ORIGINS.has(origin) && !origin.endsWith('.netlify.app')) return json(403, { error: 'Forbidden' })

  const key = process.env.RESEND_API_KEY
  // The trip tips list. Unset: nobody is put on any list (the yes is still recorded).
  const segment = process.env.TIPS_SEGMENT_ID
  if (!key) return json(500, { error: 'Email is not configured yet. Please try again later.' })

  // For the relay (proved by LEAD_RELAY_SECRET), the country comes from the
  // body, since context.geo is the mapltours server there; for the bio page,
  // from Netlify's geo.
  const body = await readLead(req, ctx?.geo?.country?.code, process.env.LEAD_RELAY_SECRET)
  if (!body) return json(400, { error: 'Invalid request' })
  const isForm = body.isForm

  // Honeypot: bots fill every field. Say yes, do nothing.
  if (body.website.trim()) return isForm ? seeOther(`${HOME}/#coupon`) : json(200, { ok: true, coupon: true })

  const email = body.email.trim().toLowerCase().slice(0, 200)
  if (!EMAIL.test(email)) return isForm ? seeOther(`${HOME}/#coupon`) : json(400, { error: 'Please enter a valid email address.' })
  const source = body.source
  // 'site' when mapltours.com's popup relays the address (app/api/lead there);
  // it changes the footer, the HubSpot source and the Resend tag, nothing else.
  const channel = body.channel
  const site = channel === 'site' ? 'mapltours.com' : 'bio.mapltours.com'
  const page = body.page

  const coupon = COUPON

  const headers = { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=stop>` }
  // One clock for the whole request: the email, the Resend tag and the
  // HubSpot entry all agree on whether this address is in the raft draw.
  const now = Date.now()
  const giveaway = giveawayOpen(now) ? GIVEAWAY.id : undefined
  const asked = tipsConsentValid({ optIn: body.optIn, defaultShown: body.optInDefault, country: body.country })

  const list = await listState(email, key)
  const crm = await upsertLead(process.env.HUBSPOT_SERVICE_KEY, {
    email, capture: source, page, couponCode: coupon.code, source: channel === 'site' ? 'site popup' : 'bio coupon', at: now, giveaway,
    tips: asked && list !== 'off' ? { at: now, source: tipsSource(body), text: TIPS_LABEL, defaultShown: body.optInDefault } : undefined,
    country: body.country,
  })
  if (!crm.ok) console.warn('[lead] hubspot refused', crm.status, crm.error)
  const stopped = list === 'off' || !!crm.tips?.stopped
  // On: a yes is on record, written just now or standing from before. No
  // HubSpot (unset, down, or a portal without the tips properties) means no
  // record, so the tick waits for the email's yes link instead.
  const tips = !stopped && (!!crm.tips?.written || crm.tips?.before === 'yes')
  // A yes recorded by this request, not one standing from before.
  const newYes = !stopped && !!crm.tips?.written && crm.tips?.before !== 'yes'
  if (asked && !tips) console.warn('[lead] trip tips yes not recorded:', stopped ? 'stopped earlier' : `hubspot ${crm.status}`)
  const tags = [{ name: 'source', value: channel }, { name: 'flow', value: 'coupon' }, { name: 'coupon', value: coupon.code.toLowerCase() }, ...(giveaway ? [{ name: 'giveaway', value: giveaway }] : []), { name: 'tips', value: tips ? 'yes' : 'no' }]

  // Without the secret there are no links; the email then leaves out the card
  // and the stop line rather than carry a link that fails.
  const secret = process.env.TIPS_SECRET
  const links = secret ? (tips ? { stopUrl: tipsUrl('stop', email, secret) } : { yesUrl: tipsUrl('yes', email, secret) }) : {}
  const first = codeEmail(coupon, site, now, { on: tips, ...links })
  const sent = await resend('/emails', { from: FROM, to: [email], reply_to: REPLY_TO, subject: first.subject, html: first.html, headers, tags: [...tags, { name: 'step', value: '1' }] }, key)
  if (!sent.ok) {
    const msg = sent.status === 422 ? 'That address was refused by our email provider. Try another one.' : 'We could not send it right now. Please try again in a moment.'
    return isForm ? seeOther(`${HOME}/#coupon`) : json(502, { error: msg })
  }

  const eventId = body.eventId
  await Promise.allSettled([
    // An earlier yes is re-added too: segment membership never changes the
    // unsubscribed flag, and it heals a join that failed last time.
    // Whether the series starts is read before the join (startsSeries).
    tips && segment
      ? (async () => {
        const starts = await startsSeries({ newYes, email, key, segment })
        const r = await listJoin(email, key, segment, list)
        if (!r.ok) { console.warn('[lead] tips segment refused', r.status); return }
        if (starts) await tipsSubscribed(email, key, tipsSource(body))
      })()
      : Promise.resolve(),
    eventId ? capiLead(req, email, eventId, source, page) : Promise.resolve(),
  ])
  if (isForm) return seeOther(`${HOME}/?sent=1#coupon`)
  return json(200, { ok: true, id: sent.j?.id ?? null, coupon: true, code: coupon.code, tips })
}
