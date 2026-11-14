/**
 * Small rules about the exported catalogue (data/tours.json and
 * data/transfers.json), shared by the page, the tip emails and the tests.
 * Pure: no imports, safe in the browser, in a function and under node --test.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * A hotel's reopening label while that date is still ahead, and null once it
 * has passed (or when there is none).
 *
 * The labels are typed by hand in the main catalogue and nobody comes back on
 * the day to delete them: in November this page was still telling guests six
 * hotels were "reopening 25 Aug 2026" and "bookable for stays from then".
 * Whether a hotel did reopen that day is not something this page knows, but
 * "closed until a date three months ago" is wrong either way, so a passed
 * date simply stops being said. The same rule as the main site's
 * lib/airport-transfers reopensAhead, so the two agree.
 *
 * Reads the three shapes the labels come in ("25 Aug 2026", "Q1 2027",
 * "2027"), each to the END of what it names, in Jamaica time. A label in any
 * other shape is returned as written.
 */
export function reopensAhead(label: string | null | undefined, now: Date = new Date()): string | null {
  if (!label) return null
  const text = label.trim()
  let end: number | null = null
  const day = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(text)
  const quarter = /^Q([1-4]) (\d{4})$/.exec(text)
  const year = /^(\d{4})$/.exec(text)
  // 05:00 UTC is midnight in Jamaica, so each of these is the first instant AFTER the period.
  if (day && MONTHS.includes(day[2].toLowerCase())) end = Date.UTC(Number(day[3]), MONTHS.indexOf(day[2].toLowerCase()), Number(day[1]) + 1, 5)
  else if (quarter) end = Date.UTC(Number(quarter[2]), Number(quarter[1]) * 3, 1, 5)
  else if (year) end = Date.UTC(Number(year[1]) + 1, 0, 1, 5)
  return end == null || now.getTime() < end ? text : null
}

/**
 * A tour's duration as the card's small tag carries it: "2 hrs", "1 hr",
 * "Full day". The catalogue's own label says where the time is spent ("2 hrs
 * at the falls", "1 hr on the boat"), which the tour page and the emails
 * print in full; in the tag that label wraps the pill onto a second line on a
 * 360px phone and in the four-across desktop row.
 */
export function shortDuration(duration: string): string {
  return duration.replace(/\s+(at|on|in)\s.*$/i, '')
}

/**
 * The words after a tour's price, as a sentence reads them: "for up to 4
 * people", "for 1 person", "per person". The export's `unit` is the main
 * site's own label, which leaves the "for" off a group price.
 */
export function unitPhrase(unit: string): string {
  return /^up to /i.test(unit) ? `for ${unit}` : unit
}

/**
 * True while most of the tours shown are one price for the whole party. The
 * tours section says "Most are one price for your group" only while this
 * holds, so the sentence cannot outlive the prices it describes.
 */
export function mostAreGroupPriced(tours: readonly { group?: boolean }[]): boolean {
  return tours.filter((t) => t.group === true).length * 2 > tours.length
}
