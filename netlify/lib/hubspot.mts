/**
 * HubSpot contacts for the bio funnel.
 *
 * The portal is the contact database for nurture: every address that asks
 * for the code becomes a contact with where it came from, and mapltours.com
 * later marks the ones that book. Newsletters and segments are built in
 * HubSpot; the timed code sequence stays in Resend (workflows are a paid
 * feature on this portal).
 *
 * Needs a HubSpot service key (starts with `pat-`) in
 * HUBSPOT_SERVICE_KEY with crm.objects.contacts read + write and, for the
 * one-time property setup, crm.schemas.contacts read + write. Everything
 * here is best effort and never throws: a HubSpot outage must not stop the
 * code email.
 */
const API = 'https://api.hubapi.com'

export const PROPERTY_GROUP = { name: 'mapl', label: 'MAPL Tours' }

/** Custom contact properties, created once by scripts/hubspot-setup.mts. */
export const LEAD_PROPERTIES = [
  { name: 'mapl_source', label: 'MAPL source', type: 'string', fieldType: 'text', description: 'Where the contact first came from (bio coupon, booking).' },
  { name: 'mapl_coupon_code', label: 'MAPL coupon code', type: 'string', fieldType: 'text', description: 'The code they were sent.' },
  { name: 'mapl_capture', label: 'MAPL capture point', type: 'string', fieldType: 'text', description: 'Which form on the page captured the address.' },
  { name: 'mapl_landing_page', label: 'MAPL landing page', type: 'string', fieldType: 'text', description: 'The page URL at capture, with its UTM tags.' },
  { name: 'mapl_utm_source', label: 'MAPL UTM source', type: 'string', fieldType: 'text' },
  { name: 'mapl_utm_medium', label: 'MAPL UTM medium', type: 'string', fieldType: 'text' },
  { name: 'mapl_utm_campaign', label: 'MAPL UTM campaign', type: 'string', fieldType: 'text' },
  { name: 'mapl_utm_content', label: 'MAPL UTM content', type: 'string', fieldType: 'text' },
  { name: 'mapl_lead_at', label: 'MAPL lead captured at', type: 'datetime', fieldType: 'date' },
  { name: 'mapl_booking_type', label: 'MAPL last booking type', type: 'string', fieldType: 'text', description: 'tour or transfer, written by mapltours.com when a booking is paid.' },
  { name: 'mapl_last_booking_at', label: 'MAPL last booking at', type: 'datetime', fieldType: 'date' },
  { name: 'mapl_bookings_total', label: 'MAPL bookings total (USD)', type: 'number', fieldType: 'number' },
] as const

export type LeadInput = {
  email: string
  /** Which form captured it: hero, capture, bio-nojs. */
  capture: string
  /** The page URL the visitor was on, with UTM tags. */
  page: string
  couponCode: string
  /** Where the address came from: 'bio coupon' (default) or 'site popup'. */
  source?: string
  /** Epoch ms; defaults to now. */
  at?: number
}

export type HubSpotResult = { ok: boolean; status: number; id?: string; action?: 'created' | 'updated' | 'skipped'; error?: string }

type Fetch = typeof fetch

async function call(token: string, method: string, path: string, body?: unknown, f: Fetch = fetch) {
  const r = await f(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let j: Record<string, unknown> = {}
  try { j = text ? (JSON.parse(text) as Record<string, unknown>) : {} } catch { j = { raw: text.slice(0, 200) } }
  return { ok: r.ok, status: r.status, j }
}

/** utm_* from a page URL. Unparseable input gives an empty object. */
export function utmFromPage(page: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const u = new URL(page)
    for (const k of ['source', 'medium', 'campaign', 'content']) {
      const v = u.searchParams.get(`utm_${k}`)
      if (v) out[`mapl_utm_${k}`] = v.slice(0, 120)
    }
  } catch { /* not a URL */ }
  return out
}

/** The properties a lead capture writes. Exported so a test can check the shape. */
export function leadProperties(input: LeadInput): Record<string, string> {
  return {
    mapl_source: input.source ?? 'bio coupon',
    mapl_coupon_code: input.couponCode,
    mapl_capture: input.capture.slice(0, 40),
    mapl_landing_page: input.page.slice(0, 300),
    mapl_lead_at: String(input.at ?? Date.now()),
    ...utmFromPage(input.page),
  }
}

const STANDARD_ON_CREATE = { lifecyclestage: 'lead', hs_lead_status: 'NEW' }

/**
 * Create the contact, or add the capture details to one that exists. An
 * existing contact keeps its lifecycle stage and lead status (a customer
 * who asks for the code again stays a customer). If the custom properties
 * are missing on the portal, the contact is still created with the standard
 * fields so no lead is lost; the warning names the setup script.
 */
export async function upsertLead(token: string | undefined, input: LeadInput, f: Fetch = fetch): Promise<HubSpotResult> {
  if (!token) return { ok: true, status: 0, action: 'skipped' }
  const email = input.email.trim().toLowerCase()
  const custom = leadProperties(input)
  try {
    const existing = await call(token, 'GET', `/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email&properties=email`, undefined, f)
    if (existing.ok) {
      const id = String(existing.j.id ?? '')
      const patched = await call(token, 'PATCH', `/crm/v3/objects/contacts/${id}`, { properties: custom }, f)
      if (patched.ok) return { ok: true, status: patched.status, id, action: 'updated' }
      return { ok: false, status: patched.status, id, error: String(patched.j.message ?? '').slice(0, 200) }
    }
    if (existing.status !== 404) return { ok: false, status: existing.status, error: String(existing.j.message ?? '').slice(0, 200) }

    const created = await call(token, 'POST', '/crm/v3/objects/contacts', { properties: { email, ...STANDARD_ON_CREATE, ...custom } }, f)
    if (created.ok) return { ok: true, status: created.status, id: String(created.j.id ?? ''), action: 'created' }
    if (created.status === 400 && /PROPERTY_DOESNT_EXIST|Property .* does not exist/i.test(JSON.stringify(created.j))) {
      console.warn('[hubspot] custom properties missing; run `node scripts/hubspot-setup.mts` once. Creating with standard fields only.')
      const bare = await call(token, 'POST', '/crm/v3/objects/contacts', { properties: { email, ...STANDARD_ON_CREATE } }, f)
      return bare.ok
        ? { ok: true, status: bare.status, id: String(bare.j.id ?? ''), action: 'created' }
        : { ok: false, status: bare.status, error: String(bare.j.message ?? '').slice(0, 200) }
    }
    return { ok: false, status: created.status, error: String(created.j.message ?? '').slice(0, 200) }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * One-time, idempotent: the property group and every custom property.
 * Existing ones answer 409 and are reported as such.
 */
export async function ensureLeadProperties(token: string, f: Fetch = fetch): Promise<Array<{ name: string; status: number; state: 'created' | 'exists' | 'failed'; error?: string }>> {
  const out: Array<{ name: string; status: number; state: 'created' | 'exists' | 'failed'; error?: string }> = []
  const group = await call(token, 'POST', '/crm/v3/properties/contacts/groups', { name: PROPERTY_GROUP.name, label: PROPERTY_GROUP.label }, f)
  out.push({ name: `group:${PROPERTY_GROUP.name}`, status: group.status, state: group.ok ? 'created' : group.status === 409 ? 'exists' : 'failed', ...(group.ok || group.status === 409 ? {} : { error: String(group.j.message ?? '').slice(0, 200) }) })
  for (const p of LEAD_PROPERTIES) {
    const r = await call(token, 'POST', '/crm/v3/properties/contacts', { ...p, groupName: PROPERTY_GROUP.name }, f)
    out.push({ name: p.name, status: r.status, state: r.ok ? 'created' : r.status === 409 ? 'exists' : 'failed', ...(r.ok || r.status === 409 ? {} : { error: String(r.j.message ?? '').slice(0, 200) }) })
  }
  return out
}
