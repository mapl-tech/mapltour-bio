/**
 * Does the hero's button fit on the first screen of a phone?
 *
 * On a phone the hero is a picture with a panel under it: headline, one line,
 * the email field, the opt-in and the button. The picture used to take 46% of
 * the screen's height whatever was left for the rest, so on a short screen
 * the button started at or under the bottom edge: an iPhone SE in Safari
 * (375 x 548) cut it off entirely, a 360 x 640 Android showed 39 of its 54px.
 *
 * The stylesheet now sizes the picture as
 *     clamp(100px, 100svh - need, what it has always been)
 * where `need` is the distance from the picture's bottom edge to the button's
 * bottom edge plus 16px of clearance. CSS cannot measure that distance, and it
 * changes with the width (the text wraps), so it is measured in a browser and
 * written into the stylesheet as --hero-need in steps. This module holds the
 * measurements and does the sums, so tests/hero-fit.test.mts can prove the
 * steps cover every width, and fail the day the hero's wording changes
 * without a new measurement.
 *
 * To measure again (after any change to the hero's words, type or spacing):
 *     cd ../mapltours && node ../mapl-bio/scripts/hero-fit.mjs
 * then update HERO_NEEDS, the steps in app/globals.css and HERO_COPY_PRINT.
 */
import { createHash } from 'node:crypto'

export type HeroVariant = 'plain' | 'raft'

/**
 * [from, to, need at `from`, need at `to`]: what the hero needs under its
 * picture, in px, across a run of widths where its text wraps the same way.
 * Within a run it grows in a straight line with the width (the headline is
 * sized 8vw from 375px), so two numbers describe the run. Measured Nov 14
 * 2026 at every width from 280 to 479px in Chrome's and Safari's engines,
 * each width on a fresh load; each run holds the larger of the two engines'
 * numbers. (Fresh loads matter: sweeping the width a pixel at a time,
 * Safari's engine carries text wrapping forward. Swept up from 280px it kept
 * the opt-in on four lines as far as 393px, and swept up from 320px it kept
 * it on three lines past 405px, which made the widest phones look as if
 * they needed 20px more than they do. No phone that loads the page at its
 * own width shows either.) Where the runs break:
 *  - both, 313px and 317px: the headline goes from three lines to two (plain
 *    at 313px, raft at 317px); under 287px the plain hero's opt-in takes a
 *    fourth line, and the raft's prize line a fifth and a sixth;
 *  - plain, 374px: the line under the headline goes from three lines to two;
 *  - both, 409px: the opt-in goes from three lines to two (from 405px in
 *    Safari's engine, 409px in Chrome's; Chrome's is the one kept);
 *  - raft, 355px and 375px: the prize line goes from four lines to three, and
 *    is back on four at 373 and 374px, where the panel is a pixel too wide
 *    for the small raft thumbnail (the 340px container query);
 *  - raft, 441px and 472px: the prize line takes one line fewer at each.
 */
export const HERO_NEEDS: Record<HeroVariant, Array<[number, number, number, number]>> = {
  plain: [[280, 286, 411.6, 411.6], [287, 312, 391.6, 391.6], [313, 373, 360.4, 360.4], [374, 408, 336.4, 341.9], [409, 479, 322, 333.7]],
  raft: [[280, 281, 546.7, 546.7], [282, 288, 528.7, 528.7], [289, 312, 505.5, 505.5], [313, 316, 482.3, 482.3], [317, 354, 451.1, 451.1], [355, 372, 427.9, 427.9], [373, 374, 451.1, 451.1], [375, 408, 427.9, 433.4], [409, 440, 413.6, 418.8], [441, 471, 400.9, 405.9], [472, 479, 386.5, 387.7]],
}

/** Space kept between the button and the bottom edge of the screen. */
export const HERO_CLEARANCE = 16
/** The picture is never shorter than this: the logo bar is 72px and the panel overlaps the picture by 28px. */
export const HERO_PICTURE_MIN = 100
/** What the picture has always been on a phone: a share of the screen's height, capped. */
export const HERO_PICTURE: Record<HeroVariant, { share: number; cap: number }> = {
  plain: { share: 0.46, cap: 380 },
  raft: { share: 0.34, cap: 300 },
}
/** The steps apply up to this width; wider than a phone the hero is laid out differently or is not short. */
export const HERO_FIT_MAX_WIDTH = 479
/** The narrowest width measured: a fold's cover screen. */
export const HERO_FIT_MIN_WIDTH = 280

/** The measured need at a width, or null outside the measured range. */
export function measuredNeed(width: number, variant: HeroVariant): number | null {
  const row = HERO_NEEDS[variant].find(([from, to]) => width >= from && width <= to)
  if (!row) return null
  const [from, to, atFrom, atTo] = row
  return to === from ? atFrom : atFrom + ((atTo - atFrom) * (width - from)) / (to - from)
}

export interface NeedStep { from: number; to: number; plain?: number; raft?: number }

/**
 * The --hero-need steps as the stylesheet declares them, in order. Reads the
 * `@media (max-width: 479px)` block and the one-line rules that follow it:
 * `@media (min-width: Npx) and (max-width: 479px)` for the wider phones and
 * `@media (max-width: Npx)` for the screens under 320px.
 */
export function needSteps(css: string): NeedStep[] {
  const steps: NeedStep[] = []
  const value = (block: string, selector: string): number | undefined => {
    // `.hero` must not be read out of `.raft .hero`: a step may set the raft hero alone.
    const lead = selector === '.hero' ? '(?<!\\.raft )' : ''
    const m = new RegExp(`(^|[\\s}])${lead}${selector.replace(/[.]/g, '\\.')} \\{ --hero-need: (\\d+)px; \\}`).exec(block)
    return m ? Number(m[2]) : undefined
  }
  const base = /@media \(max-width: (\d+)px\) \{\s*\.hero \{ --hero-need: \d+px; \}[\s\S]*?\n\}/.exec(css)
  if (base) steps.push({ from: 0, to: Number(base[1]), plain: value(base[0], '.hero'), raft: value(base[0], '.raft .hero') })
  const re = /@media (?:\(min-width: (\d+)px\) and )?\(max-width: (\d+)px\) \{([^\n]*--hero-need[^\n]*)\}/g
  for (let m = re.exec(css); m; m = re.exec(css)) steps.push({ from: m[1] ? Number(m[1]) : 0, to: Number(m[2]), plain: value(m[3], '.hero'), raft: value(m[3], '.raft .hero') })
  return steps
}

/** The --hero-need the stylesheet gives a width: the last step that sets it wins, as in the cascade. */
export function cssNeed(steps: NeedStep[], width: number, variant: HeroVariant): number | null {
  let need: number | null = null
  for (const s of steps) if (width >= s.from && width <= s.to && s[variant] !== undefined) need = s[variant] as number
  return need
}

/** The picture's height on a screen this tall: clamp(100px, screen - need, what it has always been). */
export function pictureHeight(screenHeight: number, need: number | null, variant: HeroVariant): number {
  const { share, cap } = HERO_PICTURE[variant]
  const always = Math.min(share * screenHeight, cap)
  if (need === null) return always
  return Math.max(HERO_PICTURE_MIN, Math.min(screenHeight - need, always))
}

/** How far the button's bottom edge sits above the bottom of the screen (negative: cut off by that much). */
export function buttonClearance(width: number, screenHeight: number, variant: HeroVariant, steps: NeedStep[] | null): number {
  const measured = measuredNeed(width, variant)
  if (measured === null) throw new Error(`No measurement for ${variant} at ${width}px`)
  const picture = pictureHeight(screenHeight, steps ? cssNeed(steps, width, variant) : null, variant)
  return screenHeight - (picture + measured)
}

/**
 * A fingerprint of everything that decides how tall the hero's panel is on a
 * phone: the hero's own markup from the headline to the button, the opt-in
 * line, the discount and the cheapest fare it prints. Change any of them and
 * the measurements above may no longer hold.
 */
export function heroCopyPrint(heroSource: string, tipsLabel: string, offer: string, cheapestFare: number): string {
  const from = heroSource.indexOf('<h1 className="hero-title">')
  const to = heroSource.indexOf('<input type="hidden" name="place"')
  if (from < 0 || to < from) throw new Error('The hero markup no longer has the headline or the hidden place field this reads between')
  const slice = heroSource.slice(from, to).replace(/\s+/g, ' ').trim()
  return createHash('sha256').update([slice, tipsLabel, offer, String(cheapestFare)].join('\n')).digest('hex').slice(0, 16)
}

/**
 * The fingerprint of the copy the measurements in HERO_NEEDS were taken with.
 * Measured again on Nov 21 2026, when the cheapest fare went from $22 to $21:
 * every run in both engines and both heroes came out as before, so HERO_NEEDS
 * and the steps in app/globals.css did not change.
 */
export const HERO_COPY_PRINT = 'eee97a6489a910e9'
