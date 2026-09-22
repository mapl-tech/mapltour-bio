import type { Week } from './window.mts'
import { TEST_EMAIL, getJson } from './util.mts'

/**
 * Leads are HubSpot contacts created in the week that carry mapl_source (set
 * by the bio page and the site popup). Our own and test addresses are left
 * out. Full addresses go into the owner's inbox only (he is the data
 * controller); nothing here logs them.
 */
const API = 'https://api.hubapi.com'
const PROPS = ['email', 'createdate', 'mapl_source', 'mapl_capture', 'mapl_utm_source', 'mapl_utm_medium', 'mapl_utm_content']

export type Lead = { email: string; source: string; capture: string; utm_source: string; utm_medium: string; utm_content: string; createdAt: number }
export type LeadsResult = { count: number; prevCount: number; bySource: Array<{ source: string; count: number }>; list: Lead[] }

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
      })
    }
    after = j?.paging?.next?.after
    if (!after) break
  }
  return out.filter((l) => l.email && !TEST_EMAIL.test(l.email))
}

export async function leads(week: Week, prev: Week, env = process.env, signal?: AbortSignal): Promise<LeadsResult> {
  const token = env.HUBSPOT_SERVICE_KEY
  if (!token) throw new Error('HUBSPOT_SERVICE_KEY is not set')
  const [list, prevList] = await Promise.all([search(token, week, signal), search(token, prev, signal)])
  const counts = new Map<string, number>()
  for (const l of list) counts.set(l.source || '(none)', (counts.get(l.source || '(none)') ?? 0) + 1)
  return {
    count: list.length,
    prevCount: prevList.length,
    bySource: [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    list,
  }
}
