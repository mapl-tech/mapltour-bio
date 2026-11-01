/**
 * How often one inbox may be sent the code email.
 *
 * /api/lead mails whatever address it is given, and anyone can call it, so
 * without a limit it is a way to flood a stranger's inbox from our domain.
 * On Oct 31 2026 a bot did exactly that through mapltours.com's contact form
 * (Tor exits, the same Gmail address padded with dots). The code itself is
 * public and shown on the page, so a request that is held still gets it; only
 * the email is skipped.
 *
 * Two rules:
 *  - Persistent: one code email per address a day, read from the HubSpot
 *    contact's mapl_lead_at (written on every capture, so a run of requests
 *    keeps the address held until it goes quiet for a day).
 *  - In memory, per warm function instance: two a day per inbox, with Gmail
 *    dot and +tag variants counted as one inbox, which HubSpot (one contact
 *    per exact address) cannot see. It also stands in when HubSpot is unset
 *    or down.
 */

export const CODE_EMAIL_GAP_MS = 24 * 60 * 60 * 1000
const MEMORY_MAX = 2
const MEMORY_KEYS = 5000

/** The inbox an address really reaches: lowercase, no +tag, and for Gmail no dots and one domain. */
export function inboxKey(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split(/@(?=[^@]*$)/)
  const base = local.split('+')[0]
  if (domain === 'gmail.com' || domain === 'googlemail.com') return `${base.replace(/\./g, '')}@gmail.com`
  return `${base}@${domain}`
}

/** HubSpot's mapl_lead_at as epoch ms: it is written as ms and read back as ISO. Null when unreadable. */
export function leadAtMs(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null
  const ms = /^\d+$/.test(v) ? Number(v) : Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

/** The persistent rule: this address was captured less than a day ago. */
export function capturedRecently(lastLeadAt: number | null | undefined, now: number): boolean {
  return typeof lastLeadAt === 'number' && now - lastLeadAt >= 0 && now - lastLeadAt < CODE_EMAIL_GAP_MS
}

const sends = new Map<string, number[]>()

/** The in-memory rule. Counts this request when it allows it. */
export function memoryAllows(email: string, now: number): boolean {
  const key = inboxKey(email)
  const times = (sends.get(key) ?? []).filter((t) => now - t < CODE_EMAIL_GAP_MS)
  if (times.length >= MEMORY_MAX) {
    sends.set(key, times)
    return false
  }
  times.push(now)
  sends.set(key, times)
  if (sends.size > MEMORY_KEYS) {
    sends.forEach((t, k) => { if (!t.some((x) => now - x < CODE_EMAIL_GAP_MS)) sends.delete(k) })
  }
  return true
}

/** Gives back the count for a request whose email was not sent after all. */
export function memoryForget(email: string, now: number): void {
  const key = inboxKey(email)
  const times = sends.get(key)
  if (!times) return
  const i = times.lastIndexOf(now)
  if (i >= 0) times.splice(i, 1)
}

/** For tests: every inbox starts fresh. */
export function resetCodeLimit(): void {
  sends.clear()
}
