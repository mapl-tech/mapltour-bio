import { createSign } from 'node:crypto'
import { getJson } from './util.mts'

/**
 * One OAuth token for the service account, good for both GA4 (read-only) and
 * Google Ads. The account is added as a viewer on the GA4 property and as a
 * user on the Ads account itself, so no login-customer-id is needed.
 *
 * GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY may arrive with literal \n sequences
 * (how Netlify and .env files usually hold it); they become newlines here.
 */
const TOKEN_URI = 'https://oauth2.googleapis.com/token'
export const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/adwords']

export function normalizeKey(raw: string): string {
  return raw.trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n')
}

/** The signed JWT assertion. Exported so a test can check the claims. */
export function assertion(email: string, key: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: email, scope: SCOPES.join(' '), aud: TOKEN_URI, iat: nowSec, exp: nowSec + 3600 })}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url')
  return `${unsigned}.${sig}`
}

export async function googleToken(env = process.env, signal?: AbortSignal): Promise<string> {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const raw = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  if (!email || !raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL or _PRIVATE_KEY is not set')
  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion(email, normalizeKey(raw))}`
  const j = await getJson<{ access_token?: string }>(TOKEN_URI, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, 'Google token', signal)
  if (!j?.access_token) throw new Error('Google token: no access_token in the response')
  return j.access_token
}
