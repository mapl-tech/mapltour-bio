/**
 * Week boundaries in Toronto time. The report covers Monday 00:00 to the
 * next Monday 00:00 on the owner's wall clock, so a week that crosses a DST
 * change is 167 or 169 hours long. Offsets come from Intl, never a constant.
 */
export const TZ = 'America/Toronto'

export type Week = {
  /** Monday 00:00 Toronto, as an instant. */
  start: Date
  /** The next Monday 00:00 Toronto (exclusive). */
  end: Date
  /** Monday, YYYY-MM-DD, for APIs that take calendar dates. */
  startDate: string
  /** Sunday, YYYY-MM-DD (inclusive), for APIs that take calendar dates. */
  endDate: string
  /** "Sept 15 to 21" */
  label: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type Ymd = { y: number; m: number; d: number }

const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' })

/** The Toronto wall clock at an instant. */
export function zoned(ms: number): Ymd & { hh: number; mm: number; ss: number; weekday: number } {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second, weekday: WEEKDAYS.indexOf(p.weekday) }
}

/** Toronto's offset from UTC at an instant, in ms (negative: behind UTC). */
export function offsetMs(ms: number): number {
  const z = zoned(ms)
  return Date.UTC(z.y, z.m - 1, z.d, z.hh, z.mm, z.ss) - Math.floor(ms / 1000) * 1000
}

/** The instant of 00:00 Toronto on a calendar date. */
export function torontoMidnight({ y, m, d }: Ymd): Date {
  const guess = Date.UTC(y, m - 1, d)
  let t = guess - offsetMs(guess)
  t = guess - offsetMs(t)
  return new Date(t)
}

/** Calendar arithmetic on a date, with no timezone involved. */
const addDays = ({ y, m, d }: Ymd, n: number): Ymd => {
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
const iso = ({ y, m, d }: Ymd) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** "Sept 15 to 21", "Sept 29 to Oct 5", "Dec 28, 2026 to Jan 3, 2027". */
export function weekLabel(mon: Ymd, sun: Ymd): string {
  if (mon.y !== sun.y) return `${MONTHS[mon.m - 1]} ${mon.d}, ${mon.y} to ${MONTHS[sun.m - 1]} ${sun.d}, ${sun.y}`
  if (mon.m !== sun.m) return `${MONTHS[mon.m - 1]} ${mon.d} to ${MONTHS[sun.m - 1]} ${sun.d}`
  return `${MONTHS[mon.m - 1]} ${mon.d} to ${sun.d}`
}

function weekFrom(mon: Ymd): Week {
  const sun = addDays(mon, 6)
  return { start: torontoMidnight(mon), end: torontoMidnight(addDays(mon, 7)), startDate: iso(mon), endDate: iso(sun), label: weekLabel(mon, sun) }
}

/** The last full Monday-to-Sunday week before `now` in Toronto, and the week before it. */
export function reportWeeks(now: Date = new Date()): { week: Week; prev: Week } {
  const z = zoned(now.getTime())
  const thisMonday = addDays(z, -z.weekday)
  const lastMonday = addDays(thisMonday, -7)
  return { week: weekFrom(lastMonday), prev: weekFrom(addDays(lastMonday, -7)) }
}

/** "Sept 16, 14:05" in Toronto time, for lead rows. */
export function shortStamp(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  const z = zoned(ms)
  return `${MONTHS[z.m - 1]} ${z.d}, ${String(z.hh).padStart(2, '0')}:${String(z.mm).padStart(2, '0')}`
}
