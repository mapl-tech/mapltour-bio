import { createHash, timingSafeEqual } from 'node:crypto'
import type { TipsDefault } from '../../lib/tips.mts'
import { countryCode } from './http.mts'

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** What /api/lead was asked, normalised. Nothing here is trusted beyond its shape. */
export type LeadRequest = {
  isForm: boolean
  email: string
  website: string
  source: string
  page: string
  eventId: string | null
  /** 'site' only for a relay from mapltours.com that proved itself (relayAuthorized). */
  channel: 'site' | 'bio'
  /** True only when the trip tips box was ticked. */
  optIn: boolean
  /** Anything but an explicit 'unchecked' counts as a box that arrived ticked, the reading that never makes consent. */
  optInDefault: TipsDefault
  /** The visitor's country, or null. */
  country: string | null
  /** Which form: bio_hero, bio_coupon (from the JSON source, or the no-JS form's hidden field). */
  place: string
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v : '').slice(0, max)

/** The header app/api/lead on mapltours.com sends with LEAD_RELAY_SECRET. */
export const RELAY_HEADER = 'x-mapl-relay'

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest()

/**
 * Whether this request is mapltours.com's relay: the shared secret, compared
 * in constant time (both sides hashed first, so the lengths always match).
 * False whenever the secret is unset on this site.
 */
export function relayAuthorized(req: Request, secret: string | undefined): boolean {
  const got = req.headers.get(RELAY_HEADER)
  if (!secret || !got) return false
  return timingSafeEqual(digest(got), digest(secret))
}

/**
 * JSON from the page and the site relay, or a plain form post from the
 * no-JavaScript fallback. `geoCountry` is Netlify's context.geo code for this
 * request. Null when the body cannot be read.
 *
 * The country decides whether a pre-ticked box can count, and HubSpot keeps
 * it as evidence, so the body's word for it is taken only from the relay,
 * and only when it carries the shared secret (`relaySecret`, the
 * LEAD_RELAY_SECRET env var on both sites). On a relayed request
 * context.geo is the mapltours server's location, not the visitor's, so a
 * request that claims to be the relay without proving it gets neither: it
 * is recorded as the bio page's own, with no country, and a pre-ticked box
 * from it never counts.
 */
export async function readLead(req: Request, geoCountry: unknown, relaySecret?: string): Promise<LeadRequest | null> {
  const isForm = (req.headers.get('content-type') || '').includes('application/x-www-form-urlencoded')
  try {
    if (isForm) {
      const f = await req.formData()
      const get = (k: string) => { const v = f.get(k); return typeof v === 'string' ? v : '' }
      return {
        isForm, email: get('email').slice(0, 320), website: get('website').slice(0, 200), source: 'bio-nojs', page: '', eventId: null, channel: 'bio',
        optIn: get('tips') === 'yes',
        // Without JavaScript the box is always rendered unticked.
        optInDefault: 'unchecked',
        country: countryCode(geoCountry),
        place: str(get('place'), 40),
      }
    }
    const b: unknown = await req.json()
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null
    const o = b as Record<string, unknown>
    const claimed = o.channel === 'site'
    const relay = claimed && relayAuthorized(req, relaySecret)
    const source = str(o.source, 40) || 'bio'
    return {
      isForm, email: str(o.email, 320), website: str(o.website, 200), source, page: str(o.page, 300),
      eventId: typeof o.eventId === 'string' && /^[\w-]{8,64}$/.test(o.eventId) ? o.eventId : null,
      channel: relay ? 'site' : 'bio',
      optIn: o.optIn === true,
      optInDefault: o.optInDefault === 'unchecked' ? 'unchecked' : 'checked',
      country: relay ? countryCode(o.country) : claimed ? null : countryCode(geoCountry),
      place: source,
    }
  } catch {
    return null
  }
}

/** mapl_tips_source for a capture: 'site popup', 'bio hero' or 'bio coupon'. */
export function tipsSource(r: Pick<LeadRequest, 'channel' | 'place'>): string {
  if (r.channel === 'site') return 'site popup'
  return r.place === 'bio_hero' ? 'bio hero' : 'bio coupon'
}
