import type { Config } from '@netlify/functions'
import { handleResendWebhook } from '../lib/resend-webhook.mts'

/**
 * POST /api/resend-webhook: Resend's contact.updated events. An unsubscribe
 * in Resend (the one-tap link in every trip tips email) becomes mapl_tips
 * "no" in HubSpot (netlify/lib/resend-webhook.mts).
 */
export default async (req: Request) => handleResendWebhook(req)

export const config: Config = { path: '/api/resend-webhook' }
