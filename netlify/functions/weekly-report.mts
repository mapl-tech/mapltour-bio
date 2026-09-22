import type { Config } from '@netlify/functions'
import { buildReport, failures, manualRun, sendReport } from '../lib/report/run.mts'

/**
 * The weekly ads, traffic, leads and bookings report, emailed to the owner
 * every Monday at 13:00 UTC (9:00 Toronto in summer, 8:00 in winter, 8:00
 * Jamaica). It covers the last full Monday-to-Sunday week in Toronto time,
 * against the week before.
 *
 * Netlify does not serve scheduled functions over a URL in production, so
 * the manual run (x-report-key, ?dry=1) lives in weekly-report-run.mts at
 * /api/weekly-report; the same header works here under `netlify dev`.
 */
export default async (req: Request) => {
  if (req.headers.has('x-report-key')) return manualRun(req)
  const report = await buildReport()
  const failed = failures(report)
  if (failed.length) console.warn('[weekly-report] sources unavailable', failed)
  const sent = await sendReport(report)
  if (!sent.ok) console.error('[weekly-report] send failed', sent.status, sent.error)
  else console.log('[weekly-report] sent', sent.id)
  return new Response(null, { status: sent.ok ? 204 : 502 })
}

export const config: Config = { schedule: '0 13 * * 1' }
