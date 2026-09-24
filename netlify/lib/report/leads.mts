import type { Week } from './window.mts'
import { TEST_EMAIL, getJson, reason } from './util.mts'

/**
 * Leads are HubSpot contacts created in the week that carry mapl_source (set
 * by the bio page and the site popup). Our own and test addresses are left
 * out. Full addresses go into the owner's inbox only (he is the data
 * controller); nothing here logs them.
 *
 * Trip tips: contacts whose mapl_tips is "yes", counted for the week (by
 * mapl_tips_at) and in total, with the same test-address rule. A stop sets
 * mapl_tips to "no": the code email's stop link directly, Resend's own
 * unsubscribe link through the Resend webhook (resend-webhook.mts). Until
 * that webhook is set up in Resend, the total can still include people who
 * unsubscribed there; Resend's flag is what decides who is mailed.
 *
 * Each lead in the list carries its trip tips answer (yes or no, whether the
 * box was already ticked or they ticked it, the country), so the owner can
 * see who checked the box, not only how many.
 */
const API = 'https://api.hubapi.com'
const PROPS = ['email', 'createdate', 'mapl_source', 'mapl_capture', 'mapl_utm_source', 'mapl_utm_medium', 'mapl_utm_content', 'mapl_tips', 'mapl_tips_default', 'mapl_tips_source', 'mapl_country']

export type Lead = {
  email: string; source: string; capture: string; utm_source: string; utm_medium: string; utm_content: string; createdAt: number
  /** mapl_tips ("yes", "no" or empty), mapl_tips_default, mapl_tips_source, mapl_country. */
  tips: string; tipsDefault: string; tipsSource: string; country: string
}
/** `more`: the page cap was hit, so the number is a floor. */
export type TipsCount = { ok: true; week: number; weekMore: boolean; total: number; totalMore: boolean } | { ok: false; error: string }
export type LeadsResult = { count: number; prevCount: number; bySource: Array<{ source: string; count: number }>; list: Lead[]; tips: TipsCount }

type Hit = { properties?: Record<string, string | null | undefined> }
type SearchPage = { results?: Hit[]; paging?: { next?: { after?: string } } }

async function search(token: string, w: Week, signal?: AbortSignal): Promise<Lead[]> {
  const out: Lead[] = []
  let after: string | undefined
  for (let i = 0; i < 10; i++) {
    const body = {
      filterGroups: [{ filters: [
        { propertyName: 'createdate', operator: 'GTE', value: String(w.start.getTime()) },
        { propertyName: 'createdate', operator: 'LT', value: String(w.end.getTime()) },
        { propertyName: 'mapl_source', operator: 'HAS_PROPERTY' },
      ] }],
      properties: PROPS,
      sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
      limit: 100,
      ...(after ? { after } : {}),
    }
    const j = await getJson<SearchPage>(`${API}/crm/v3/objects/contacts/search`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 'HubSpot search', signal)
    for (const h of j?.results ?? []) {
      const p = h.properties ?? {}
      out.push({
        email: String(p.email ?? ''),
        source: String(p.mapl_source ?? ''),
        capture: String(p.mapl_capture ?? ''),
        utm_source: String(p.mapl_utm_source ?? ''),
        utm_medium: String(p.mapl_utm_medium ?? ''),
        utm_content: String(p.mapl_utm_content ?? ''),
        createdAt: Date.parse(String(p.createdate ?? '')),
        tips: String(p.mapl_tips ?? ''),
        tipsDefault: String(p.mapl_tips_default ?? ''),
        tipsSource: String(p.mapl_tips_source ?? ''),
        country: String(p.mapl_country ?? ''),
      })
    }
    after = j?.paging?.next?.after
    if (!after) break
  }
  return out.filter((l) => l.email && !TEST_EMAIL.test(l.email))
}

/** Opted-in contacts, in `w` by mapl_tips_at or all time. Up to 10 pages of 100, like the lead search. */
async function tipsSearch(token: string, w: Week | null, signal?: AbortSignal): Promise<{ n: number; more: boolean }> {
  let n = 0
  let after: string | undefined
  for (let i = 0; i < 10; i++) {
    const body = {
      filterGroups: [{ filters: [
        { propertyName: 'mapl_tips', operator: 'EQ', value: 'yes' },
        ...(w ? [
          { propertyName: 'mapl_tips_at', operator: 'GTE', value: String(w.start.getTime()) },
          { propertyName: 'mapl_tips_at', operator: 'LT', value: String(w.end.getTime()) },
        ] : []),
      ] }],
      properties: ['email'],
      limit: 100,
      ...(after ? { after } : {}),
    }
    const j = await getJson<SearchPage>(`${API}/crm/v3/objects/contacts/search`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 'HubSpot tips search', signal)
    for (const h of j?.results ?? []) {
      const e = String(h.properties?.email ?? '')
      if (e && !TEST_EMAIL.test(e)) n++
    }
    after = j?.paging?.next?.after
    if (!after) return { n, more: false }
  }
  return { n, more: true }
}

/** Never fails the leads section: a portal without the tips properties yet shows one unavailable line. */
async function tipsCount(token: string, week: Week, signal?: AbortSignal): Promise<TipsCount> {
  try {
    const [w, all] = await Promise.all([tipsSearch(token, week, signal), tipsSearch(token, null, signal)])
    return { ok: true, week: w.n, weekMore: w.more, total: all.n, totalMore: all.more }
  } catch (e) {
    return { ok: false, error: reason(e) }
  }
}

export async function leads(week: Week, prev: Week, env = process.env, signal?: AbortSignal): Promise<LeadsResult> {
  const token = env.HUBSPOT_SERVICE_KEY
  if (!token) throw new Error('HUBSPOT_SERVICE_KEY is not set')
  const [list, prevList, tips] = await Promise.all([search(token, week, signal), search(token, prev, signal), tipsCount(token, week, signal)])
  const counts = new Map<string, number>()
  for (const l of list) counts.set(l.source || '(none)', (counts.get(l.source || '(none)') ?? 0) + 1)
  return {
    count: list.length,
    prevCount: prevList.length,
    bySource: [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    list,
    tips,
  }
}
