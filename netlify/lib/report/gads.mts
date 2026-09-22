import type { Week } from './window.mts'
import { getJson, num, reason } from './util.mts'

/**
 * Google Ads API v22, read with the service account, which is a user on the
 * client account itself (no login-customer-id). Amounts are in the account
 * currency, CAD. Dates are the account's calendar days.
 */
const API = 'https://googleads.googleapis.com/v22'

export type Campaign = { name: string; cost: number; impressions: number; clicks: number; conversions: number; impressionShare: number | null }
export type GadsResult = {
  campaigns: Campaign[]
  cost: number
  prevCost: number
  searchTerms: Array<{ term: string; clicks: number; impressions: number; cost: number }>
  /** Set when only the search-terms query failed; the rest still stands. */
  searchTermsError?: string
}

type Row = Record<string, Record<string, unknown> | undefined>

const between = (w: Week) => `segments.date BETWEEN '${w.startDate}' AND '${w.endDate}'`

export async function gads(tokenP: Promise<string>, week: Week, prev: Week, env = process.env, signal?: AbortSignal): Promise<GadsResult> {
  const customer = (env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '')
  const dev = env.GOOGLE_ADS_DEVELOPER_TOKEN
  if (!customer || !dev) throw new Error('GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN is not set')
  const token = await tokenP
  const search = async (query: string): Promise<Row[]> => {
    const j = await getJson<{ results?: Row[] }>(`${API}/customers/${customer}/googleAds:search`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'developer-token': dev, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    }, 'Google Ads', signal)
    return j?.results ?? []
  }
  const [camps, prevTotal, terms] = await Promise.all([
    search(`SELECT campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.search_impression_share FROM campaign WHERE ${between(week)} AND campaign.status != 'REMOVED'`),
    search(`SELECT metrics.cost_micros FROM customer WHERE ${between(prev)}`),
    search(`SELECT search_term_view.search_term, metrics.clicks, metrics.impressions, metrics.cost_micros FROM search_term_view WHERE ${between(week)} ORDER BY metrics.clicks DESC LIMIT 5`)
      .then((rows) => ({ rows, error: undefined as string | undefined }), (e) => ({ rows: [] as Row[], error: reason(e) })),
  ])
  const campaigns = camps
    .map((r): Campaign => {
      const share = r.metrics?.searchImpressionShare
      return {
        name: String(r.campaign?.name ?? '(unnamed)'),
        cost: num(r.metrics?.costMicros) / 1e6,
        impressions: num(r.metrics?.impressions),
        clicks: num(r.metrics?.clicks),
        conversions: num(r.metrics?.conversions),
        impressionShare: share === undefined || share === null ? null : num(share),
      }
    })
    .filter((c) => c.impressions > 0 || c.cost > 0)
    .sort((a, b) => b.cost - a.cost)
  return {
    campaigns,
    cost: campaigns.reduce((s, c) => s + c.cost, 0),
    prevCost: prevTotal.reduce((s, r) => s + num(r.metrics?.costMicros) / 1e6, 0),
    searchTerms: terms.rows.map((r) => ({ term: String(r.searchTermView?.searchTerm ?? ''), clicks: num(r.metrics?.clicks), impressions: num(r.metrics?.impressions), cost: num(r.metrics?.costMicros) / 1e6 })),
    ...(terms.error ? { searchTermsError: terms.error } : {}),
  }
}
