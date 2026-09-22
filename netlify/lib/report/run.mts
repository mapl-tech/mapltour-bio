import { timingSafeEqual } from 'node:crypto'
import { reportWeeks } from './window.mts'
import { googleToken } from './google-auth.mts'
import { ga4 } from './ga4.mts'
import { gads } from './gads.mts'
import { meta } from './meta.mts'
import { leads } from './leads.mts'
import { bookings } from './bookings.mts'
import { render, type Report, type Src } from './render.mts'
import { reason, withDeadline } from './util.mts'

/**
 * Builds and sends the weekly report. Every source runs in parallel and a
 * failure in one becomes an "Unavailable" line, never a failed email.
 *
 * Time: the scheduled function has 30 seconds. Each request has 12, but some
 * wait on others (the Google token, HubSpot and Meta page loops), so all
 * sources also share one deadline: 18s, then the send gets 8s. A manual run
 * is a plain synchronous function (10s on Netlify), so it gets 6s for the
 * sources and 3s for the send; ?dry=1 skips the send and gets 8s.
 */
export const SCHEDULED_BUDGET_MS = 18_000
export const SEND_TIMEOUT_MS = 8_000
export const MANUAL_BUDGET_MS = 6_000
export const MANUAL_SEND_TIMEOUT_MS = 3_000
export const DRY_BUDGET_MS = 8_000

const FROM = 'MAPL Tours Jamaica <contact@mapltours.com>'
const REPLY_TO = 'contact@mapltours.com'
const DEFAULT_TO = 'leshan@mapltech.com'

const settle = <T,>(r: PromiseSettledResult<T>): Src<T> => (r.status === 'fulfilled' ? { ok: true, data: r.value } : { ok: false, error: reason(r.reason) })

export async function buildReport(now = new Date(), env = process.env, budgetMs = SCHEDULED_BUDGET_MS): Promise<Report> {
  const { week, prev } = reportWeeks(now)
  const deadline = AbortSignal.timeout(budgetMs)
  const token = googleToken(env, deadline)
  token.catch(() => { /* reported by the sources that await it */ })
  const due = <T,>(p: Promise<T>) => withDeadline(p, deadline, budgetMs)
  const [g, a, m, l, b] = await Promise.allSettled([
    due(ga4(token, week, prev, env, deadline)),
    due(gads(token, week, prev, env, deadline)),
    due(meta(week, prev, env, deadline)),
    due(leads(week, prev, env, deadline)),
    due(bookings(week, prev, env, deadline)),
  ])
  return { week, prev, ga4: settle(g), gads: settle(a), meta: settle(m), leads: settle(l), bookings: settle(b) }
}

/** Source names that failed, with their masked reasons. Safe to log. */
export const failures = (r: Report) =>
  (['ga4', 'gads', 'meta', 'leads', 'bookings'] as const).flatMap((k) => { const s = r[k]; return s.ok ? [] : [`${k}: ${s.error}`] })

export async function sendReport(r: Report, env = process.env, timeoutMs = SEND_TIMEOUT_MS): Promise<{ ok: boolean; status: number; id?: string; error?: string; subject: string }> {
  const { subject, html } = render(r)
  const key = env.RESEND_API_KEY
  if (!key) return { ok: false, status: 0, error: 'RESEND_API_KEY is not set', subject }
  const to = env.REPORT_TO?.trim() || DEFAULT_TO
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html, tags: [{ name: 'flow', value: 'weekly_report' }] }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
    return res.ok ? { ok: true, status: res.status, id: j.id, subject } : { ok: false, status: res.status, error: reason(j.message ?? 'refused'), subject }
  } catch (e) {
    return { ok: false, status: 0, error: reason(e), subject }
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export function keyMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false
  const a = Buffer.from(given), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * A manual run over HTTP: header x-report-key must equal MAPL_REPORT_KEY.
 * ?dry=1 returns the HTML instead of sending. The recipient is fixed; a
 * ?to= parameter is refused rather than ignored, so nobody mistakes it for
 * a working option.
 */
export async function manualRun(req: Request, env = process.env): Promise<Response> {
  if (!keyMatches(req.headers.get('x-report-key'), env.MAPL_REPORT_KEY)) return json(401, { error: 'Unauthorized' })
  const url = new URL(req.url)
  if (url.searchParams.has('to')) return json(400, { error: 'The recipient is fixed; ?to= is not supported.' })
  const dry = url.searchParams.get('dry') === '1'
  const report = await buildReport(new Date(), env, dry ? DRY_BUDGET_MS : MANUAL_BUDGET_MS)
  const failed = failures(report)
  if (dry) {
    return new Response(render(report).html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  }
  const sent = await sendReport(report, env, MANUAL_SEND_TIMEOUT_MS)
  if (failed.length) console.warn('[weekly-report] sources unavailable', failed)
  return json(sent.ok ? 200 : 502, { ...sent, unavailable: failed })
}
