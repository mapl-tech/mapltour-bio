/**
 * Shared bits for the weekly report: the test-address rule (the same one the
 * main site's bookings report uses), secret masking for anything that might
 * reach a log or the email, a JSON fetch with a hard timeout, and the shared
 * report deadline, so one slow API never eats the scheduled function's 30
 * seconds.
 */

/** Our own and test addresses. Excluded from leads, and from bookings on the main site. */
export const TEST_EMAIL = /@example\.com$|resend\.dev|mapltech\.com|leshanpatterson|leshan_patterson/i

/** Masks tokens that could ride along in an error message. */
export function mask(s: string): string {
  return s
    .replace(/(Bearer\s+)[\w.~+/=-]+/gi, '$1***')
    .replace(/(access_token=)[^&\s"']+/gi, '$1***')
    .replace(/\bpat-[\w-]+/g, 'pat-***')
    .replace(/\bre_[\w-]{6,}/g, 're_***')
    .replace(/\bya29\.[\w.-]+/g, 'ya29.***')
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[key]')
}

/** A short, masked reason for a failed source. */
export function reason(e: unknown): string {
  const raw = e instanceof Error ? (e.name === 'TimeoutError' ? 'timed out after 12s' : e.message) : String(e)
  return mask(raw).replace(/\s+/g, ' ').slice(0, 180)
}

export const TIMEOUT_MS = 12_000

/**
 * fetch + JSON with a per-request timeout. `signal` is the report's shared
 * deadline: once it fires, this request and any page loop calling it stop.
 * Non-2xx throws with the API's own message.
 */
export async function getJson<T = unknown>(url: string, init: RequestInit = {}, label = 'request', signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const r = await fetch(url, { ...init, signal: signal ? AbortSignal.any([timeout, signal]) : timeout })
  const text = await r.text()
  let j: unknown = null
  try { j = text ? JSON.parse(text) : null } catch { j = null }
  if (!r.ok) {
    const o = (j ?? {}) as { error?: { message?: string } | string; message?: string }
    const msg = typeof o.error === 'string' ? o.error : o.error?.message ?? o.message ?? ''
    throw new Error(`${label} HTTP ${r.status}${msg ? `: ${msg}` : ''}`)
  }
  return j as T
}

export const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Settles with `p`, or rejects with a plain "timed out" once the shared
 * deadline fires, whatever `p` is still waiting on (a token, a page loop).
 * This is what keeps Promise.allSettled inside the function's time limit.
 */
export function withDeadline<T>(p: Promise<T>, signal: AbortSignal, budgetMs: number): Promise<T> {
  const late = () => new Error(`timed out at the ${Math.round(budgetMs / 1000)}s report deadline`)
  if (signal.aborted) { p.catch(() => {}); return Promise.reject(late()) }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(late())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}
