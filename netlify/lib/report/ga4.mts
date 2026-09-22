import type { Week } from './window.mts'
import { getJson, num } from './util.mts'

/**
 * GA4 Data API for the week and the week before. Totals and funnel events
 * are asked for both weeks in one request (named date ranges); the
 * breakdowns only for the report week. The cta_tap outcome breakdown needs
 * the `outcome` custom dimension registered on the property; when it is not,
 * GA answers 400 and that one table is left out.
 */
export const MAIN_PROPERTY = '532654689'
export const FUNNEL_EVENTS = ['view_item', 'details_open', 'cta_tap', 'add_to_cart', 'begin_checkout', 'purchase', 'generate_lead'] as const

type GaResponse = {
  dimensionHeaders?: Array<{ name: string }>
  metricHeaders?: Array<{ name: string }>
  rows?: Array<{ dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> }>
}
export type Row = { dims: Record<string, string>; mets: Record<string, number> }
export type RunReport = (body: Record<string, unknown>) => Promise<GaResponse>

/** Rows keyed by header name. A response with no `rows` (GA omits it when empty) is []. */
export function parseRows(r: GaResponse | null | undefined): Row[] {
  const dh = (r?.dimensionHeaders ?? []).map((h) => h.name)
  const mh = (r?.metricHeaders ?? []).map((h) => h.name)
  return (r?.rows ?? []).map((row) => ({
    dims: Object.fromEntries(dh.map((n, i) => [n, row.dimensionValues?.[i]?.value ?? ''])),
    mets: Object.fromEntries(mh.map((n, i) => [n, num(row.metricValues?.[i]?.value)])),
  }))
}

export type Totals = { sessions: number; users: number; engaged: number; engagementRate: number }
export type Ga4Week = {
  totals: Totals
  prevTotals: Totals
  sources: Array<{ source: string; users: number; engaged: number }>
  events: Record<string, number>
  prevEvents: Record<string, number>
  ctaOutcomes: Array<{ outcome: string; count: number }> | null
  pages: Array<{ path: string; views: number }>
}

const ZERO: Totals = { sessions: 0, users: 0, engaged: 0, engagementRate: 0 }
const range = (w: Week, name: string) => ({ startDate: w.startDate, endDate: w.endDate, name })
const byRange = (rows: Row[], name: string) => rows.filter((r) => (r.dims.dateRange ?? name) === name)
const toTotals = (rows: Row[], name: string): Totals => {
  const r = byRange(rows, name)[0]
  return r ? { sessions: r.mets.sessions ?? 0, users: r.mets.totalUsers ?? 0, engaged: r.mets.engagedSessions ?? 0, engagementRate: r.mets.engagementRate ?? 0 } : { ...ZERO }
}
const toSources = (rows: Row[]) => rows.map((r) => ({ source: r.dims.sessionSourceMedium, users: r.mets.totalUsers ?? 0, engaged: r.mets.engagedSessions ?? 0 }))

export async function ga4Week(run: RunReport, week: Week, prev: Week): Promise<Ga4Week> {
  const both = [range(week, 'cur'), range(prev, 'prev')]
  const one = [range(week, 'cur')]
  const [tot, src, ev, pages, cta] = await Promise.all([
    run({ dateRanges: both, metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' }, { name: 'engagementRate' }] }),
    run({ dateRanges: one, dimensions: [{ name: 'sessionSourceMedium' }], metrics: [{ name: 'totalUsers' }, { name: 'engagedSessions' }], orderBys: [{ metric: { metricName: 'engagedSessions' }, desc: true }], limit: 8 }),
    run({ dateRanges: both, dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: [...FUNNEL_EVENTS] } } } }),
    run({ dateRanges: one, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 6 }),
    run({ dateRanges: one, dimensions: [{ name: 'customEvent:outcome' }], metrics: [{ name: 'eventCount' }], dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'cta_tap' } } }, orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }], limit: 10 })
      .then(parseRows, () => null),
  ])
  const totRows = parseRows(tot)
  const evRows = parseRows(ev)
  const events = (name: string) => {
    const out: Record<string, number> = Object.fromEntries(FUNNEL_EVENTS.map((e) => [e, 0]))
    for (const r of byRange(evRows, name)) out[r.dims.eventName] = r.mets.eventCount ?? 0
    return out
  }
  return {
    totals: toTotals(totRows, 'cur'),
    prevTotals: toTotals(totRows, 'prev'),
    sources: toSources(parseRows(src)),
    events: events('cur'),
    prevEvents: events('prev'),
    ctaOutcomes: cta ? cta.map((r) => ({ outcome: r.dims['customEvent:outcome'] || '(not set)', count: r.mets.eventCount ?? 0 })) : null,
    pages: parseRows(pages).map((r) => ({ path: r.dims.pagePath, views: r.mets.screenPageViews ?? 0 })),
  }
}

export const runnerFor = (token: string, property: string, signal?: AbortSignal): RunReport => (body) =>
  getJson<GaResponse>(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, `GA4 ${property}`, signal)

export type BioWeek = { totals: Totals; prevTotals: Totals; sources: Ga4Week['sources'] }

export type Ga4Result = { main: Ga4Week; bio: BioWeek | null }

/**
 * The main property, plus the bio property when BIO_GA_PROPERTY is set. The
 * bio half is optional: unset, refused or failing, it is simply left out.
 */
export async function ga4(tokenP: Promise<string>, week: Week, prev: Week, env = process.env, signal?: AbortSignal): Promise<Ga4Result> {
  const token = await tokenP
  const bioProp = env.BIO_GA_PROPERTY?.trim()
  const [main, bio] = await Promise.all([
    ga4Week(runnerFor(token, MAIN_PROPERTY, signal), week, prev),
    bioProp ? bioWeek(runnerFor(token, bioProp, signal), week, prev).catch(() => null) : Promise.resolve(null),
  ])
  return { main, bio }
}

async function bioWeek(run: RunReport, week: Week, prev: Week): Promise<BioWeek> {
  const [tot, src] = await Promise.all([
    run({ dateRanges: [range(week, 'cur'), range(prev, 'prev')], metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' }, { name: 'engagementRate' }] }),
    run({ dateRanges: [range(week, 'cur')], dimensions: [{ name: 'sessionSourceMedium' }], metrics: [{ name: 'totalUsers' }, { name: 'engagedSessions' }], orderBys: [{ metric: { metricName: 'engagedSessions' }, desc: true }], limit: 5 }),
  ])
  const rows = parseRows(tot)
  return { totals: toTotals(rows, 'cur'), prevTotals: toTotals(rows, 'prev'), sources: toSources(parseRows(src)) }
}
