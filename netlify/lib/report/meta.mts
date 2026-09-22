import type { Week } from './window.mts'
import { getJson, num } from './util.mts'

/**
 * Meta Marketing API insights per ad for the MAPL Tours Jamaica ad account.
 * The account's timezone is America/Toronto, so its calendar days line up
 * with the report week. Spend is CAD. The token is sent as a query parameter
 * (Graph's convention) and never logged; error text is masked upstream.
 */
const API = 'https://graph.facebook.com/v21.0'
export const AD_ACCOUNT = 'act_256162459122082'

export const ACTIONS = {
  linkClicks: 'link_click',
  lpv: 'landing_page_view',
  viewContent: 'offsite_conversion.fb_pixel_view_content',
  addToCart: 'offsite_conversion.fb_pixel_add_to_cart',
  initiateCheckout: 'offsite_conversion.fb_pixel_initiate_checkout',
  purchase: 'offsite_conversion.fb_pixel_purchase',
  lead: 'offsite_conversion.fb_pixel_lead',
} as const
export type ActionCounts = Record<keyof typeof ACTIONS, number>

/** The counts we report from an insights `actions` array. Missing types are 0. */
export function extractActions(actions: Array<{ action_type?: string; value?: string | number }> | undefined): ActionCounts {
  const out = Object.fromEntries(Object.keys(ACTIONS).map((k) => [k, 0])) as ActionCounts
  for (const a of actions ?? []) {
    for (const [k, type] of Object.entries(ACTIONS) as Array<[keyof typeof ACTIONS, string]>) {
      if (a.action_type === type) out[k] += num(a.value)
    }
  }
  return out
}

export type MetaAd = ActionCounts & { ad: string; campaign: string; spend: number; impressions: number; ctr: number }
export type MetaResult = { ads: MetaAd[]; spend: number; prevSpend: number; totals: ActionCounts & { impressions: number } }

type Insight = { ad_name?: string; campaign_name?: string; spend?: string; impressions?: string; ctr?: string; actions?: Array<{ action_type?: string; value?: string }> }
type Page = { data?: Insight[]; paging?: { next?: string } }

const url = (level: string, w: Week, fields: string, token: string) =>
  `${API}/${AD_ACCOUNT}/insights?level=${level}&time_range=${encodeURIComponent(JSON.stringify({ since: w.startDate, until: w.endDate }))}&fields=${fields}&limit=100&access_token=${encodeURIComponent(token)}`

async function all(first: string, signal?: AbortSignal): Promise<Insight[]> {
  const out: Insight[] = []
  let next: string | undefined = first
  for (let i = 0; next && i < 4; i++) {
    const page: Page = await getJson<Page>(next, {}, 'Meta insights', signal)
    out.push(...(page?.data ?? []))
    next = page?.paging?.next
  }
  return out
}

export async function meta(week: Week, prev: Week, env = process.env, signal?: AbortSignal): Promise<MetaResult> {
  const token = env.META_ADS_TOKEN
  if (!token) throw new Error('META_ADS_TOKEN is not set')
  const [rows, prevRows] = await Promise.all([
    all(url('ad', week, 'ad_name,campaign_name,spend,impressions,ctr,actions', token), signal),
    all(url('account', prev, 'spend', token), signal),
  ])
  const ads = rows
    .map((r): MetaAd => ({ ad: r.ad_name ?? '(unnamed)', campaign: r.campaign_name ?? '', spend: num(r.spend), impressions: num(r.impressions), ctr: num(r.ctr), ...extractActions(r.actions) }))
    .sort((a, b) => b.spend - a.spend)
  const totals = { impressions: 0, ...extractActions([]) }
  for (const a of ads) for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += a[k]
  return { ads, spend: ads.reduce((s, a) => s + a.spend, 0), prevSpend: prevRows.reduce((s, r) => s + num(r.spend), 0), totals }
}
