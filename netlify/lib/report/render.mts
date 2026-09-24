import type { Week } from './window.mts'
import { shortStamp } from './window.mts'
import type { Ga4Result, Totals } from './ga4.mts'
import type { GadsResult } from './gads.mts'
import type { MetaResult } from './meta.mts'
import type { Lead, LeadsResult, TipsCount } from './leads.mts'
import type { BookingsResult } from './bookings.mts'

/**
 * The weekly report email: plain HTML, inline styles, no images, 600px wide
 * at most, in the bio emails' palette. Every string that came from an API
 * (ad names, search terms, page paths, HubSpot fields, error text) is
 * escaped. A source that failed renders as one "Unavailable" line.
 */
export type Src<T> = { ok: true; data: T } | { ok: false; error: string }
export type Report = {
  week: Week
  prev: Week
  ga4: Src<Ga4Result>
  gads: Src<GadsResult>
  meta: Src<MetaResult>
  leads: Src<LeadsResult>
  bookings: Src<BookingsResult>
}

const INK = '#171614'
const MUTED = '#524F49'
const GOLD = '#5A4A16'
const GREEN = '#12563A'
const RULE = 'rgba(23,22,20,.12)'

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const int = (n: number) => Math.round(n).toLocaleString('en-US')
const dec = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const cad = (n: number) => `${n < 0 ? '-' : ''}CA$${dec(Math.abs(n))}`
export const usd = (n: number) => `${n < 0 ? '-' : ''}US$${dec(Math.abs(n))}`
const pct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`
const sign = (d: number) => (d < 0 ? '-' : '+')
const dInt = (cur: number, prev: number) => `${sign(cur - prev)}${int(Math.abs(cur - prev))}`
const dMoney = (cur: number, prev: number, f: (n: number) => string) => `${sign(cur - prev)}${f(Math.abs(cur - prev))}`
const plural = (n: number, one: string, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`
const ratio = (a: number, b: number, f: (n: number) => string) => (b > 0 ? f(a / b) : 'n/a')

const h1 = (t: string) => `<h1 style="margin:0 0 6px;font-size:22px;line-height:1.2;letter-spacing:-.01em;color:${INK};">${t}</h1>`
const h2 = (t: string) => `<h2 style="margin:30px 0 10px;padding-top:18px;border-top:1px solid ${RULE};font-size:18px;line-height:1.25;color:${INK};">${t}</h2>`
const h3 = (t: string) => `<h3 style="margin:18px 0 8px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:${GOLD};">${t}</h3>`
const p = (t: string) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.55;color:${INK};">${t}</p>`
const small = (t: string) => `<p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:${MUTED};">${t}</p>`
const down = (why: string) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#8A3B12;">Unavailable: ${esc(why)}</p>`
const delta = (t: string) => `<span style="font-size:12px;color:${MUTED};font-weight:400;"> (${t})</span>`

/** Label/value pairs in rows of `cols`: labels small above, values bold below. Reads on a phone. */
function grid(pairs: Array<[string, string]>, cols = 4): string {
  const rows: string[] = []
  for (let i = 0; i < pairs.length; i += cols) {
    const chunk = pairs.slice(i, i + cols)
    const pad = cols - chunk.length
    const cell = (inner: string, top: boolean) => `<td style="width:${Math.floor(100 / cols)}%;vertical-align:top;padding:${top ? '8px' : '2px'} 6px ${top ? '0' : '8px'} 0;">${inner}</td>`
    rows.push(`<tr>${chunk.map(([l]) => cell(`<span style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:${MUTED};">${l}</span>`, true)).join('')}${'<td></td>'.repeat(pad)}</tr>`)
    rows.push(`<tr>${chunk.map(([, v]) => cell(`<span style="font-size:15px;font-weight:700;color:${INK};">${v}</span>`, false)).join('')}${'<td></td>'.repeat(pad)}</tr>`)
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 8px;">${rows.join('')}</table>`
}

/** A plain table; `right` marks numeric columns. Cells are HTML (escape first). */
function table(head: string[], rows: string[][], right: boolean[] = []): string {
  if (!rows.length) return small('None this week.')
  const th = head.map((h, i) => `<th style="text-align:${right[i] ? 'right' : 'left'};font-size:11px;letter-spacing:.04em;text-transform:uppercase;font-weight:700;color:${MUTED};padding:6px 6px 6px 0;border-bottom:1px solid ${RULE};">${h}</th>`).join('')
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${right[i] ? 'right' : 'left'};font-size:14px;line-height:1.4;color:${INK};padding:6px 6px 6px 0;border-bottom:1px solid ${RULE};vertical-align:top;word-break:break-word;">${c}</td>`).join('')}</tr>`).join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 12px;"><tr>${th}</tr>${tr}</table>`
}

/** Ad spend across the platforms that answered, and whether any did not. */
function spend(r: Report) {
  const parts = [r.meta.ok ? r.meta.data.spend : null, r.gads.ok ? r.gads.data.cost : null]
  const prevParts = [r.meta.ok ? r.meta.data.prevSpend : null, r.gads.ok ? r.gads.data.prevCost : null]
  const known = parts.filter((x): x is number => x !== null)
  return {
    any: known.length > 0,
    partial: known.length === 1,
    cur: known.reduce((s, x) => s + x, 0),
    prev: prevParts.reduce<number>((s, x) => s + (x ?? 0), 0),
  }
}

export function subject(r: Report): string {
  const s = spend(r)
  const spent = s.any ? `CA$${int(s.cur)}${s.partial ? '+' : ''}` : 'CA$?'
  const engaged = r.ga4.ok ? plural(r.ga4.data.main.totals.engaged, 'engaged visit') : '? engaged visits'
  const leads = r.leads.ok ? plural(r.leads.data.count, 'lead') : '? leads'
  const paid = r.bookings.ok ? plural(r.bookings.data.week.paid.count, 'booking') : '? bookings'
  return `MAPL weekly: ${r.week.label}, ${spent} spent, ${engaged}, ${leads}, ${paid}`
}

function oneLine(r: Report): string {
  const s = spend(r)
  const bits: string[] = []
  bits.push(s.any ? `<b>${cad(s.cur)}</b> on ads${delta(dMoney(s.cur, s.prev, cad))}${s.partial ? ` (${r.meta.ok ? 'Google Ads' : 'Meta'} missing)` : ''}` : 'ad spend unavailable')
  if (r.ga4.ok) { const t = r.ga4.data.main; bits.push(`<b>${plural(t.totals.engaged, 'engaged visit')}</b>${delta(dInt(t.totals.engaged, t.prevTotals.engaged))}`) } else bits.push('visits unavailable')
  if (r.leads.ok) bits.push(`<b>${plural(r.leads.data.count, 'lead')}</b>${delta(dInt(r.leads.data.count, r.leads.data.prevCount))}`)
  else bits.push('leads unavailable')
  if (r.bookings.ok) {
    const w = r.bookings.data.week.paid, pv = r.bookings.data.prev.paid
    bits.push(`<b>${plural(w.count, 'booking')}</b>${delta(dInt(w.count, pv.count))}`)
    bits.push(`<b>${usd(w.revenueUsd)}</b> revenue${delta(dMoney(w.revenueUsd, pv.revenueUsd, usd))}`)
  } else bits.push('bookings unavailable')
  return `${h2('The week in one line')}${p(bits.join(', ') + '.')}${small(`Changes in brackets are against ${esc(r.prev.label)}.`)}`
}

function ads(r: Report): string {
  let out = h2('Ads')
  out += h3('Meta (CA$)')
  if (!r.meta.ok) out += down(r.meta.error)
  else {
    const m = r.meta.data
    out += p(`${cad(m.spend)} spent${delta(dMoney(m.spend, m.prevSpend, cad))}, ${int(m.totals.impressions)} impressions, ${int(m.totals.lpv)} landing page views, ${ratio(m.spend, m.totals.lpv, cad)} per view.`)
    if (!m.ads.length) out += small('No ad delivered this week.')
    for (const a of m.ads) {
      out += `<p style="margin:16px 0 2px;font-size:15px;font-weight:700;color:${INK};">${esc(a.ad)}</p>${a.campaign ? small(esc(a.campaign)) : ''}`
      out += grid([
        ['Spend', cad(a.spend)], ['Impressions', int(a.impressions)], ['CTR', `${a.ctr.toFixed(2)}%`], ['Link clicks', int(a.linkClicks)],
        ['Landing views', int(a.lpv)], ['Per landing view', ratio(a.spend, a.lpv, cad)], ['View content', int(a.viewContent)], ['Add to cart', int(a.addToCart)],
        ['Checkout', int(a.initiateCheckout)], ['Lead', int(a.lead)], ['Purchase', int(a.purchase)],
      ])
    }
  }
  out += h3('Google Ads (CA$)')
  if (!r.gads.ok) out += down(r.gads.error)
  else {
    const g = r.gads.data
    out += p(`${cad(g.cost)} spent${delta(dMoney(g.cost, g.prevCost, cad))}.`)
    if (!g.campaigns.length) out += small('No campaign delivered this week.')
    for (const c of g.campaigns) {
      out += `<p style="margin:16px 0 2px;font-size:15px;font-weight:700;color:${INK};">${esc(c.name)}</p>`
      out += grid([
        ['Spend', cad(c.cost)], ['Impressions', int(c.impressions)], ['Clicks', int(c.clicks)],
        ['CPC', ratio(c.cost, c.clicks, cad)], ['Impr. share', c.impressionShare === null ? 'n/a' : pct(c.impressionShare)], ['Conversions', c.conversions % 1 ? c.conversions.toFixed(1) : int(c.conversions)],
      ], 3)
    }
    out += `<p style="margin:14px 0 6px;font-size:14px;font-weight:700;color:${INK};">Top search terms</p>`
    out += g.searchTermsError ? down(g.searchTermsError) : table(['Term', 'Clicks', 'Impr.'], g.searchTerms.map((t) => [esc(t.term), int(t.clicks), int(t.impressions)]), [false, true, true])
  }
  return out
}

const totalsGrid = (t: Totals, pv: Totals) => grid([
  ['Sessions', `${int(t.sessions)}${delta(dInt(t.sessions, pv.sessions))}`],
  ['Users', `${int(t.users)}${delta(dInt(t.users, pv.users))}`],
  ['Engaged', `${int(t.engaged)}${delta(dInt(t.engaged, pv.engaged))}`],
  ['Engagement', pct(t.engagementRate)],
])

function traffic(r: Report): string {
  let out = h2('Traffic')
  if (!r.ga4.ok) return out + down(r.ga4.error)
  const { main, bio } = r.ga4.data
  out += h3('mapltours.com')
  out += totalsGrid(main.totals, main.prevTotals)
  out += `<p style="margin:14px 0 6px;font-size:14px;font-weight:700;color:${INK};">Top sources</p>`
  out += table(['Source / medium', 'Users', 'Engaged'], main.sources.map((s) => [esc(s.source), int(s.users), int(s.engaged)]), [false, true, true])
  out += `<p style="margin:14px 0 6px;font-size:14px;font-weight:700;color:${INK};">Funnel events</p>`
  out += table(['Event', 'This week', 'Last week'], Object.keys(main.events).map((e) => [esc(e), int(main.events[e]), int(main.prevEvents[e] ?? 0)]), [false, true, true])
  if (main.ctaOutcomes) {
    out += `<p style="margin:14px 0 6px;font-size:14px;font-weight:700;color:${INK};">cta_tap by outcome</p>`
    out += table(['Outcome', 'Taps'], main.ctaOutcomes.map((o) => [esc(o.outcome), int(o.count)]), [false, true])
  }
  out += `<p style="margin:14px 0 6px;font-size:14px;font-weight:700;color:${INK};">Top pages</p>`
  out += table(['Page', 'Views'], main.pages.map((x) => [esc(x.path), int(x.views)]), [false, true])
  if (bio) {
    out += h3('bio.mapltours.com')
    out += totalsGrid(bio.totals, bio.prevTotals)
    out += table(['Source / medium', 'Users', 'Engaged'], bio.sources.map((s) => [esc(s.source), int(s.users), int(s.engaged)]), [false, true, true])
  }
  return out
}

/** "Trip tips: 3 opt-ins this week, 41 in total." A capped count reads "1,000+". */
export function tipsLine(t: TipsCount): string {
  if (!t.ok) return small(`Trip tips unavailable: ${esc(t.error)}`)
  const n = (x: number, more: boolean) => `${int(x)}${more ? '+' : ''}`
  return p(`Trip tips: <b>${n(t.week, t.weekMore)} ${t.week === 1 && !t.weekMore ? 'opt-in' : 'opt-ins'}</b> this week, ${n(t.total, t.totalMore)} in total.`)
}

/**
 * A lead's trip tips answer for the From cell: "trip tips: yes, pre-ticked,
 * US", "yes, ticked it", "yes, email link", "no", "stopped". Empty when the
 * contact predates trip tips. Plain text; the caller escapes it.
 */
export function tipsCell(l: Pick<Lead, 'tips' | 'tipsDefault' | 'tipsSource' | 'country'>): string {
  let answer = ''
  if (l.tips === 'yes') answer = `yes, ${l.tipsSource === 'code email' ? 'email link' : l.tipsDefault === 'checked' ? 'pre-ticked' : 'ticked it'}`
  else if (l.tips === 'no') answer = /stop|unsubscribe/.test(l.tipsSource) ? 'stopped' : 'no'
  if (!answer) return l.country ? l.country : ''
  return `trip tips: ${answer}${l.country ? `, ${l.country}` : ''}`
}

function leadsSection(r: Report): string {
  let out = h2('Leads')
  if (!r.leads.ok) return out + down(r.leads.error)
  const l = r.leads.data
  out += p(`<b>${plural(l.count, 'lead')}</b>${delta(dInt(l.count, l.prevCount))}${l.bySource.length ? `: ${l.bySource.map((s) => `${esc(s.source)} ${int(s.count)}`).join(', ')}` : ''}.`)
  out += tipsLine(l.tips)
  out += table(['When', 'Email', 'From'], l.list.map((x) => {
    const utm = [x.utm_source, x.utm_medium, x.utm_content].filter(Boolean).map(esc).join(' / ')
    const tips = tipsCell(x)
    return [esc(shortStamp(x.createdAt)), esc(x.email), `${esc(x.source)}${x.capture ? `, ${esc(x.capture)}` : ''}${tips ? `<br>${esc(tips)}` : ''}${utm ? `<br><span style="font-size:12px;color:${MUTED};">${utm}</span>` : ''}`]
  }))
  return out
}

function bookingsSection(r: Report): string {
  let out = h2('Bookings')
  if (!r.bookings.ok) return out + down(r.bookings.error)
  const { week: b, prev: pb } = r.bookings.data
  out += grid([
    ['Paid', `${int(b.paid.count)}${delta(dInt(b.paid.count, pb.paid.count))}`],
    ['Revenue', usd(b.paid.revenueUsd)],
    ['Tours', `${int(b.paid.byType.tour.count)}, ${usd(b.paid.byType.tour.revenueUsd)}`],
    ['Rides', `${int(b.paid.byType.transfer.count)}, ${usd(b.paid.byType.transfer.revenueUsd)}`],
    ['Checkouts started', `${int(b.started.count)}${delta(dInt(b.started.count, pb.started.count))}`],
    ['Still pending', int(b.abandoned.count)],
    ['Refunds', `${int(b.refunds.count)}, ${usd(b.refunds.amountUsd)}`],
    ['Coupon uses', `${int(b.coupons.count)}, ${usd(b.coupons.discountUsd)} off`],
  ])
  out += `<p style="margin:14px 0 6px;font-size:14px;font-weight:700;color:${INK};">Where checkouts came from</p>`
  out += table(['Source / medium', 'Started', 'Paid'], b.attribution.map((a) => [esc(`${a.source} / ${a.medium}`), int(a.started), int(a.paid)]), [false, true, true])
  return out
}

/** Two or three plain observations from fixed rules. Nothing here is a judgement the numbers do not show. */
export function notes(r: Report): string[] {
  const out: string[] = []
  const s = spend(r)
  if (s.any && s.cur > 0 && r.ga4.ok && r.ga4.data.main.totals.engaged > 0) {
    out.push(`Ad spend per engaged visit on mapltours.com: ${cad(s.cur / r.ga4.data.main.totals.engaged)} (every engaged visit counted, not only ad traffic).`)
  }
  if (r.meta.ok && r.meta.data.totals.lpv > 0 && r.leads.ok) {
    out.push(`Leads per Meta landing page view: ${int(r.leads.data.count)} of ${int(r.meta.data.totals.lpv)} (${pct(r.leads.data.count / r.meta.data.totals.lpv)}; leads from every source counted).`)
  }
  if (r.meta.ok) {
    const withLpv = r.meta.data.ads.filter((a) => a.lpv > 0 && a.spend > 0).map((a) => ({ ad: a.ad, per: a.spend / a.lpv }))
    if (withLpv.length >= 2) {
      withLpv.sort((a, b) => a.per - b.per)
      const best = withLpv[0], worst = withLpv[withLpv.length - 1]
      out.push(`Cheapest landing page view: ${esc(best.ad)} at ${cad(best.per)}. Dearest: ${esc(worst.ad)} at ${cad(worst.per)}.`)
    }
  }
  if (out.length < 3 && r.bookings.ok && r.bookings.data.week.started.count > 0) {
    const b = r.bookings.data.week
    out.push(`${plural(b.started.count, 'checkout')} reached the saved booking and ${int(b.paid.count)} paid (${pct(b.paid.count / b.started.count)}).`)
  }
  return out.slice(0, 3)
}

export function render(r: Report): { subject: string; html: string } {
  const subj = subject(r)
  const n = notes(r)
  const readThis = h2('Read this') + (n.length ? n.map((x) => p(x)).join('') : small('Not enough data this week for a comparison.'))
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subj)}</title></head>
<body style="margin:0;background:#FAF9F7;font-family:'DM Sans',-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${INK};">
<div style="max-width:600px;margin:0 auto;padding:28px 16px 40px;">
  <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:${GOLD};">MAPL Tours Jamaica</p>
  ${h1(`Weekly report: ${esc(r.week.label)}`)}
  ${small('Monday to Sunday, Toronto time. Ad spend in Canadian dollars, revenue in US dollars.')}
  ${oneLine(r)}
  ${ads(r)}
  ${traffic(r)}
  ${leadsSection(r)}
  ${bookingsSection(r)}
  ${readThis}
  <hr style="border:0;border-top:1px solid ${RULE};margin:28px 0 12px;">
  <p style="font-size:12px;line-height:1.5;color:${MUTED};margin:0;">Sent every Monday by the bio site's weekly-report function. Sources: Meta Ads, Google Ads, GA4, HubSpot, and the <a href="https://mapltours.com/admin" style="color:${GREEN};">mapltours.com</a> bookings table.</p>
</div></body></html>`
  return { subject: subj, html }
}
