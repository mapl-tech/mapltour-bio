import type { Config, Context } from '@netlify/functions'
import { countryCode, json } from '../lib/http.mts'

/**
 * GET /api/geo -> {"country":"US"}, or {"country":null} when Netlify cannot
 * place the visitor. The page asks once, to decide whether the trip tips box
 * starts ticked (only in the US; lib/tips.mts). Never cached anywhere: the
 * answer belongs to this visitor alone.
 */
export default async (_req: Request, ctx: Context) => json(200, { country: countryCode(ctx?.geo?.country?.code) })

export const config: Config = { path: '/api/geo' }
