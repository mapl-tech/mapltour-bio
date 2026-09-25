/**
 * HubSpot contacts for the bio funnel.
 *
 * The portal is the contact database for nurture: every address that asks
 * for the code becomes a contact with where it came from, and mapltours.com
 * later marks the ones that book. The trip tips list itself is a Resend
 * segment (TIPS_SEGMENT_ID, netlify/lib/tips.mts); HubSpot keeps the record
 * of who asked for tips, when, where and in what words (mapl_tips_*), and
 * the record is written before anyone goes on the list. Resend's
 * `unsubscribed` flag is what decides who is mailed; the Resend webhook
 * (netlify/functions/resend-webhook.mts) copies its unsubscribes here.
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
  { name: 'mapl_giveaway', label: 'MAPL giveaway entry', type: 'string', fieldType: 'text', description: 'The giveaway this address was entered in when it asked for the code (martha-brae-2026).' },
  // Trip tips (the newsletter). "yes" is written only for consent that
  // lib/tips.mts accepts, with when, where, the exact words and whether the
  // box was pre-ticked; that set is the record of who asked.
  { name: 'mapl_tips', label: 'MAPL trip tips', type: 'string', fieldType: 'text', description: 'yes: asked for trip tips. no: did not, or asked to stop. Only yes is consent. Resend decides who is mailed; its unsubscribes are copied here by the webhook.' },
  { name: 'mapl_tips_at', label: 'MAPL trip tips changed at', type: 'datetime', fieldType: 'date', description: 'When they said yes, or stop.' },
  { name: 'mapl_tips_source', label: 'MAPL trip tips source', type: 'string', fieldType: 'text', description: 'Where: bio hero, bio coupon, site popup, code email; for a stop, code email stop or unsubscribe link.' },
  { name: 'mapl_tips_text', label: 'MAPL trip tips wording', type: 'string', fieldType: 'text', description: 'The exact words they agreed to: the checkbox label, or the email button.' },
  { name: 'mapl_tips_default', label: 'MAPL trip tips box default', type: 'string', fieldType: 'text', description: 'checked if the box was already ticked when they saw it (US visitors only), unchecked if they ticked it.' },
  { name: 'mapl_country', label: 'MAPL country', type: 'string', fieldType: 'text', description: 'Visitor country at capture (ISO code from Netlify geo).' },
] as const

/** A valid trip tips yes (lib/tips.mts tipsConsentValid), as HubSpot records it. */
export type TipsConsent = {
  /** Epoch ms. */
  at: number
  /** bio hero, bio coupon, site popup, code email. */
  source: string
  /** The words they agreed to. */
  text: string
  defaultShown: 'checked' | 'unchecked'
}

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
  /** The giveaway the request entered, while one is open (emails.mts GIVEAWAY.id). */
  giveaway?: string
  /** Present only for a valid trip tips yes. */
  tips?: TipsConsent
  /** ISO country code, when known. */
  country?: string | null
}

/**
 * What a capture did to trip tips. `before`: mapl_tips as it was (null for a
 * new contact or one without it). `stopped`: they had asked to stop, so the
 * form's yes was not written. `written`: mapl_tips "yes" and all its details
 * were saved (none dropped for a portal that lacks them).
 */
export type TipsOutcome = { before: string | null; stopped: boolean; written: boolean }

/**
 * `before` (setTips only): mapl_tips as it was before this change, null for
 * a new contact or one without it. recordTips starts the welcome series
 * only when a yes moves the contact from not-yes to yes.
 */
export type HubSpotResult = { ok: boolean; status: number; id?: string; action?: 'created' | 'updated' | 'skipped'; error?: string; tips?: TipsOutcome; before?: string | null }

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
    ...(input.giveaway ? { mapl_giveaway: input.giveaway } : {}),
    ...(input.tips ? tipsYesProperties(input.tips) : {}),
    ...(input.country ? { mapl_country: input.country } : {}),
  }
}

export function tipsYesProperties(t: TipsConsent): Record<string, string> {
  return { mapl_tips: 'yes', mapl_tips_at: String(t.at), mapl_tips_source: t.source.slice(0, 40), mapl_tips_text: t.text.slice(0, 300), mapl_tips_default: t.defaultShown }
}

const MISSING = /PROPERTY_DOESNT_EXIST|Property .* does not exist/i

/**
 * Which of `props` a HubSpot validation error names as missing on the
 * portal. Empty when the error is something else, or names none of them.
 */
export function missingProperties(err: unknown, props: Record<string, string>): string[] {
  const text = JSON.stringify(err ?? '')
  if (!MISSING.test(text)) return []
  // \b keeps mapl_tips from matching inside mapl_tips_at.
  return Object.keys(props).filter((k) => new RegExp(`\\b${k}\\b`).test(text))
}

type Sent = Awaited<ReturnType<typeof call>>

/**
 * Sends `props`; when HubSpot answers that some of them do not exist on this
 * portal (the setup script has not been run since they were added), sends
 * the rest once more, so a new property never costs the fields that work.
 * `dropped` names what was left out, so a caller that needs a property (the
 * trip tips record) can tell a partial save from a whole one.
 */
async function sendTolerant(send: (props: Record<string, string>) => Promise<Sent>, props: Record<string, string>): Promise<Sent & { dropped: string[] }> {
  const first = await send(props)
  if (first.ok || first.status !== 400) return { ...first, dropped: [] }
  const missing = missingProperties(first.j, props)
  if (!missing.length) return { ...first, dropped: [] }
  console.warn(`[hubspot] portal lacks ${missing.join(', ')}; run \`node scripts/hubspot-setup.mts\` once. Saved the rest.`)
  return { ...(await send(Object.fromEntries(Object.entries(props).filter(([k]) => !missing.includes(k))))), dropped: missing }
}

/** mapl_tips_source values that mean "asked to stop": the code email's stop link, Resend's unsubscribe link. */
export const STOP_SOURCES: readonly string[] = ['code email stop', 'unsubscribe link']

/** A stop on record. A "no" written when a contact was created without a tick is not a stop. */
export function tipsStopped(p: Record<string, unknown>): boolean {
  return p.mapl_tips === 'no' && STOP_SOURCES.includes(String(p.mapl_tips_source ?? ''))
}

/** Whether a save kept the whole trip tips record. */
const tipsKept = (dropped: string[]) => !dropped.some((k) => k.startsWith('mapl_tips'))

const STANDARD_ON_CREATE = { lifecyclestage: 'lead', hs_lead_status: 'NEW' }

/**
 * Create the contact, or add the capture details to one that exists. An
 * existing contact keeps its lifecycle stage and lead status (a customer
 * who asks for the code again stays a customer). If the custom properties
 * are missing on the portal, the contact is still created with the standard
 * fields so no lead is lost; the warning names the setup script.
 *
 * Trip tips: a valid yes writes mapl_tips "yes" and its details. Without
 * one, a NEW contact gets mapl_tips "no"; an existing contact's mapl_tips is
 * left alone, so a later request without the box ticked never turns an
 * earlier yes into a no (only a stop does that). And a form never lifts a
 * stop: /api/lead cannot tell who typed the address, so for a contact that
 * asked to stop the yes is not written (`tips.stopped`); only the signed
 * link in the code email (setTips) turns them back on. An earlier yes is
 * kept as it was, not rewritten. `tips.written` says whether this call
 * saved a yes whole; lead.mts puts no one on the list without a yes on
 * record.
 */
export async function upsertLead(token: string | undefined, input: LeadInput, f: Fetch = fetch): Promise<HubSpotResult> {
  if (!token) return { ok: true, status: 0, action: 'skipped' }
  const email = input.email.trim().toLowerCase()
  const asked = !!input.tips
  try {
    const existing = await call(token, 'GET', `/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email&properties=email,mapl_tips,mapl_tips_source`, undefined, f)
    if (existing.ok) {
      const id = String(existing.j.id ?? '')
      const now = (existing.j.properties ?? {}) as Record<string, unknown>
      const before = typeof now.mapl_tips === 'string' && now.mapl_tips ? now.mapl_tips : null
      const stopped = tipsStopped(now)
      // An earlier yes stays as it was recorded (the first time they asked is
      // the evidence, and the weekly count is by mapl_tips_at).
      const write = asked && !stopped && before !== 'yes'
      const custom = leadProperties(write ? input : { ...input, tips: undefined })
      const patched = await sendTolerant((p) => call(token, 'PATCH', `/crm/v3/objects/contacts/${id}`, { properties: p }, f), custom)
      const tips = { before, stopped, written: patched.ok && write && tipsKept(patched.dropped) }
      if (patched.ok) return { ok: true, status: patched.status, id, action: 'updated', tips }
      return { ok: false, status: patched.status, id, error: String(patched.j.message ?? '').slice(0, 200), tips }
    }
    if (existing.status !== 404) return { ok: false, status: existing.status, error: String(existing.j.message ?? '').slice(0, 200) }

    const onCreate = { ...(asked ? {} : { mapl_tips: 'no' }), ...leadProperties(input) }
    const created = await sendTolerant((p) => call(token, 'POST', '/crm/v3/objects/contacts', { properties: { email, ...STANDARD_ON_CREATE, ...p } }, f), onCreate)
    if (created.ok) return { ok: true, status: created.status, id: String(created.j.id ?? ''), action: 'created', tips: { before: null, stopped: false, written: asked && tipsKept(created.dropped) } }
    if (created.status === 400 && MISSING.test(JSON.stringify(created.j))) {
      console.warn('[hubspot] custom properties missing; run `node scripts/hubspot-setup.mts` once. Creating with standard fields only.')
      const bare = await call(token, 'POST', '/crm/v3/objects/contacts', { properties: { email, ...STANDARD_ON_CREATE } }, f)
      const tips = { before: null, stopped: false, written: false }
      return bare.ok
        ? { ok: true, status: bare.status, id: String(bare.j.id ?? ''), action: 'created', tips }
        : { ok: false, status: bare.status, error: String(bare.j.message ?? '').slice(0, 200), tips }
    }
    return { ok: false, status: created.status, error: String(created.j.message ?? '').slice(0, 200) }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

/** The words on the email's button, kept as what a code email yes agreed to. */
export const TIPS_BUTTON = 'Yes, send me trip tips'

/**
 * The trip tips link in the code email (/tips, after the POST). A yes
 * creates the contact if HubSpot never got it (it was down at capture);
 * the email link is an act of its own, so nothing was pre-selected and the
 * default is recorded as unchecked. A stop only ever updates: an address
 * HubSpot does not have has nothing to stop. Unlike a capture, the tips
 * properties are the whole point here, so a portal without them is a
 * failure the page reports, not something to save around.
 *
 * `source` names where a stop came from ('code email stop' by default,
 * 'unsubscribe link' from the Resend webhook). `onlyIfYes` leaves any
 * contact that is not currently "yes" alone, so the webhook never rewrites
 * the source of a stop that is already on record.
 */
export async function setTips(token: string | undefined, email: string, change: { action: 'yes' | 'stop'; at: number; source?: string; onlyIfYes?: boolean }, f: Fetch = fetch): Promise<HubSpotResult> {
  if (!token) return { ok: true, status: 0, action: 'skipped' }
  const addr = email.trim().toLowerCase()
  const props = change.action === 'yes'
    ? tipsYesProperties({ at: change.at, source: 'code email', text: TIPS_BUTTON, defaultShown: 'unchecked' })
    : { mapl_tips: 'no', mapl_tips_at: String(change.at), mapl_tips_source: change.source ?? 'code email stop' }
  try {
    const existing = await call(token, 'GET', `/crm/v3/objects/contacts/${encodeURIComponent(addr)}?idProperty=email&properties=email,mapl_tips`, undefined, f)
    if (existing.ok) {
      const id = String(existing.j.id ?? '')
      const was = ((existing.j.properties ?? {}) as Record<string, unknown>).mapl_tips
      const before = typeof was === 'string' && was ? was : null
      if (change.onlyIfYes && before !== 'yes') return { ok: true, status: existing.status, id, action: 'skipped', before }
      const patched = await call(token, 'PATCH', `/crm/v3/objects/contacts/${id}`, { properties: props }, f)
      return patched.ok ? { ok: true, status: patched.status, id, action: 'updated', before } : { ok: false, status: patched.status, id, error: String(patched.j.message ?? '').slice(0, 200), before }
    }
    if (existing.status !== 404) return { ok: false, status: existing.status, error: String(existing.j.message ?? '').slice(0, 200) }
    if (change.action === 'stop') return { ok: true, status: 404, action: 'skipped' }
    const created = await call(token, 'POST', '/crm/v3/objects/contacts', { properties: { email: addr, ...STANDARD_ON_CREATE, ...props } }, f)
    return created.ok ? { ok: true, status: created.status, id: String(created.j.id ?? ''), action: 'created', before: null } : { ok: false, status: created.status, error: String(created.j.message ?? '').slice(0, 200), before: null }
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
