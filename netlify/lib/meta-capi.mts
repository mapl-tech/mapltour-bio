import { createHash } from 'node:crypto'
import { PIXEL_ID } from '../../lib/trackers.mts'
import { EMAIL, PAGE_MAX } from './lead-input.mts'

/**
 * The Conversions API half of a lead from this page (netlify/functions/lead.mts):
 * the server's copy of the Lead the pixel sends from the browser
 * (lib/trackers.mts), with the same event id, so Meta counts the two as one
 * lead and still hears of it when an ad blocker stops the pixel.
 *
 * It goes to the page pixel's own dataset (PIXEL_ID in lib/trackers.mts, the
 * main site's 1607953960710055), never to one a setting names, so the
 * browser's Lead and this copy cannot land in different datasets. Only the
 * token is a setting: META_CAPI_TOKEN, read on every request (unset, nothing
 * is sent), which must be that dataset's token, the one mapltours.com
 * reports its own leads and purchases with. META_PIXEL_ID is not read.
 *
 * A lead is reported only when all of these hold (capiLeadEvent):
 *  - the browser sent an event id. The page makes one only for a visitor who
 *    has not asked not to be tracked (DNT or Global Privacy Control), so the
 *    server never reports what the pixel would have withheld;
 *  - the request itself carries neither `DNT: 1` nor `Sec-GPC: 1`: the same
 *    wish, read again here, where the page cannot vouch for it;
 *  - it is the page's own lead, not mapltours.com's popup relay. That site
 *    reports its popup leads to the same dataset itself, with its own
 *    browser's event id, so a report from here would count each one twice;
 *  - it came from the live page (https://bio.mapltours.com/...), so a local
 *    or preview copy never writes to the dataset the ads optimise on;
 *  - the request carries the live page's own Origin. The page's fetch always
 *    does; a form or script on another site, or a bare request, does not, so
 *    a forged sign-up never becomes a Lead the campaigns learn from. (A server
 *    can still set the header: this raises the bar, it does not close it.)
 *
 * Hashing follows Meta's rules for customer information: the email trimmed
 * and lowercased, the country as its two lowercase ISO letters, each SHA-256
 * in hex. The browser and click ids (fbp, fbc), the IP address and the user
 * agent go as they are, never hashed.
 */
export const GRAPH_URL = 'https://graph.facebook.com/v21.0'
/** Never more than this of the visitor's wait: the reply waits for the report. */
export const CAPI_TIMEOUT_MS = 4000
/** The live page. */
export const BIO_PAGE = /^https:\/\/bio\.mapltours\.com\//
/** The Origin the live page's own requests carry. */
export const LIVE_ORIGIN = 'https://bio.mapltours.com'

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** A Cookie header as name to value; a part without a name is skipped. */
function cookieJar(header: string | null): Map<string, string> {
  const jar = new Map<string, string>()
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim())
  }
  return jar
}

/** The visitor's browser sent Do Not Track or Global Privacy Control with this request. */
export function optedOut(headers: Headers): boolean {
  return headers.get('dnt') === '1' || headers.get('sec-gpc') === '1'
}

/** The ad link's fbclid, exactly as Meta wrote it, or undefined. */
function fbclidOf(page: string): string | undefined {
  // A page cut at the cap may end in a cut fbclid: no click id beats a wrong one.
  if (page.length >= PAGE_MAX) return undefined
  try {
    const id = new URL(page).searchParams.get('fbclid')
    return id && /^[\w-]{8,500}$/.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

/**
 * Meta's click id for this lead. The _fbc cookie as the pixel set it, when
 * it holds this visit's click or the link carries none. Otherwise one built
 * from the ad link's fbclid in Meta's server format,
 * fb.1.<ms when first seen>.<fbclid>, the fbclid unchanged: a visitor who
 * asks for the code before the pixel has loaded has no cookie yet, or one
 * from an older ad click, which fbevents.js would replace with this one.
 */
export function clickId(cookie: string | undefined, page: string, now: number): string | undefined {
  const saved = cookie && /^fb\.\d+\.\d+\./.test(cookie) ? cookie : undefined
  const clicked = fbclidOf(page)
  if (!clicked) return saved
  // The pixel's own cookie for this click carries the fbclid as its payload,
  // or the fbclid with Meta's suffix when the link also carried brid
  // (`<fbclid>_aem_<brid>`, merged by the dataset's cookie settings): keep it.
  const payload = saved?.split('.')[3]
  if (saved && payload && (payload === clicked || payload.startsWith(`${clicked}_`))) return saved
  return `fb.1.${now}.${clicked}`
}

/** What lead.mts knows about a lead once its code email has gone. */
export type LeadReport = {
  email: string
  /** From the page's request body; null when the page sent none (tracking off, or the no-JavaScript form). */
  eventId: string | null
  /** 'site' only for mapltours.com's relay (readLead proved it). */
  channel: 'site' | 'bio'
  /** Which form: bio_hero or bio_coupon. */
  source: string
  page: string
  /** Netlify geo's two letters for this request, or null. */
  country: string | null
  now: number
}

export type CapiEvent = {
  event_name: 'Lead'
  event_time: number
  event_id: string
  event_source_url: string
  action_source: 'website'
  user_data: Record<string, unknown>
  custom_data: { content_name: string }
}

/** The request to send, or why this lead is not reported. */
export function capiLeadEvent(req: Request, r: LeadReport, env: Record<string, string | undefined> = process.env): { url: string; body: { data: CapiEvent[] } } | { skipped: string } {
  const token = env.META_CAPI_TOKEN
  if (!token) return { skipped: 'not configured' }
  if (!r.eventId || !/^[\w-]{8,64}$/.test(r.eventId)) return { skipped: 'no event id' }
  if (r.channel !== 'bio') return { skipped: 'relayed by mapltours.com' }
  if (!BIO_PAGE.test(r.page)) return { skipped: 'not the live page' }
  if (req.headers.get('origin') !== LIVE_ORIGIN) return { skipped: 'not sent by the live page' }
  if (optedOut(req.headers)) return { skipped: 'opted out' }
  const email = r.email.trim().toLowerCase()
  if (!EMAIL.test(email)) return { skipped: 'no email' }

  const jar = cookieJar(req.headers.get('cookie'))
  const fbp = jar.get('_fbp')
  const fbc = clickId(jar.get('_fbc'), r.page, r.now)
  const ip = req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ua = req.headers.get('user-agent')
  const country = r.country && /^[A-Za-z]{2}$/.test(r.country) ? r.country.toLowerCase() : null
  return {
    url: `${GRAPH_URL}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`,
    body: {
      data: [{
        event_name: 'Lead',
        event_time: Math.floor(r.now / 1000),
        // The id the pixel sent as eventID with the browser's Lead: Meta keeps one.
        event_id: r.eventId,
        event_source_url: r.page,
        action_source: 'website',
        user_data: {
          em: [sha256(email)],
          ...(ip ? { client_ip_address: ip } : {}),
          ...(ua ? { client_user_agent: ua } : {}),
          // fb.<subdomain>.<time>.<random>, with the optional appendix fbevents.js also accepts.
          ...(fbp && /^fb\.\d+\.\d+\.\d+(\.[\w-]+)?$/.test(fbp) ? { fbp } : {}),
          ...(fbc ? { fbc } : {}),
          ...(country ? { country: [sha256(country)] } : {}),
        },
        custom_data: { content_name: r.source },
      }],
    },
  }
}

/** Best effort: never throws, and gives up after CAPI_TIMEOUT_MS. */
export async function capiLead(req: Request, r: LeadReport, opts: { fetch?: typeof fetch; timeoutMs?: number; env?: Record<string, string | undefined> } = {}): Promise<'sent' | 'skipped' | 'failed'> {
  try {
    const ev = capiLeadEvent(req, r, opts.env)
    if ('skipped' in ev) return 'skipped'
    const res = await (opts.fetch ?? fetch)(ev.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev.body), signal: AbortSignal.timeout(opts.timeoutMs ?? CAPI_TIMEOUT_MS) })
    if (!res.ok) {
      console.warn('[lead] capi refused', res.status, (await res.text()).slice(0, 200))
      return 'failed'
    }
    return 'sent'
  } catch (e) {
    console.warn('[lead] capi failed', e instanceof Error ? e.message : e)
    return 'failed'
  }
}
