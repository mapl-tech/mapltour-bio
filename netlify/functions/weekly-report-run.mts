import type { Config } from '@netlify/functions'
import { manualRun } from '../lib/report/run.mts'

/**
 * GET /api/weekly-report with header x-report-key: MAPL_REPORT_KEY builds
 * last week's report now and emails it to the fixed recipient; ?dry=1
 * returns the HTML without sending. The Monday send is weekly-report.mts.
 *
 * This is a plain synchronous function (10s on Netlify), so the sources get
 * a 6s deadline here (8s for ?dry=1) and the send 3s. A slow API shows as
 * "Unavailable" in the email rather than a platform 502.
 */
export default async (req: Request) => (req.method === 'GET' || req.method === 'POST' ? manualRun(req) : new Response(null, { status: 405 }))

export const config: Config = { path: '/api/weekly-report' }
