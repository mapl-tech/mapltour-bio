import type { Config } from '@netlify/functions'
import { handleTips } from '../lib/tips-page.mts'

/**
 * /tips?a=yes|stop&e=...&t=...: the trip tips links in the code email.
 * GET shows the button and changes nothing; the button's POST records the
 * yes or the stop (netlify/lib/tips-page.mts). Needs TIPS_SECRET; a yes
 * needs HUBSPOT_SERVICE_KEY (the consent record) and, to reach the list,
 * RESEND_API_KEY + TIPS_SEGMENT_ID; a stop needs either store.
 */
export default async (req: Request) => handleTips(req)

export const config: Config = { path: '/tips' }
