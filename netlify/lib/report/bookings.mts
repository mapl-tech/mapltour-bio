import type { Week } from './window.mts'
import { getJson } from './util.mts'

/**
 * Bookings come from the main site's aggregate endpoint
 * (mapltours.com/api/report/bookings), which reads Supabase with the service
 * role and returns counts and sums only, never names or addresses. The bio
 * site holds the main site's REPORT_KEY as MAPL_REPORT_KEY (its own key, not the cron secret).
 */
type Bucket = { count: number; revenueUsd: number }
export type BookingsWeek = {
  paid: Bucket & { byType: { tour: Bucket; transfer: Bucket } }
  started: { count: number }
  abandoned: { count: number }
  refunds: { count: number; amountUsd: number }
  coupons: { count: number; discountUsd: number }
  attribution: Array<{ source: string; medium: string; paid: number; started: number }>
}
export type BookingsResult = { week: BookingsWeek; prev: BookingsWeek }

async function one(base: string, secret: string, w: Week, signal?: AbortSignal): Promise<BookingsWeek> {
  const q = `since=${encodeURIComponent(w.start.toISOString())}&until=${encodeURIComponent(w.end.toISOString())}`
  const j = await getJson<BookingsWeek & { ok?: boolean }>(`${base}/api/report/bookings?${q}`, { headers: { 'x-report-key': secret, Accept: 'application/json' } }, 'Bookings report', signal)
  if (!j?.ok || !j.paid) throw new Error('Bookings report: unexpected response shape')
  return j
}

export async function bookings(week: Week, prev: Week, env = process.env, signal?: AbortSignal): Promise<BookingsResult> {
  const secret = env.MAPL_REPORT_KEY
  if (!secret) throw new Error('MAPL_REPORT_KEY is not set')
  const base = (env.MAIN_SITE_URL || 'https://mapltours.com').replace(/\/+$/, '')
  const [w, p] = await Promise.all([one(base, secret, week, signal), one(base, secret, prev, signal)])
  return { week: w, prev: p }
}
