/**
 * The journey line in the zones section: five stops along a track, each one
 * a tap target.
 *
 * JOURNEY_POS is where each zone sits, as a share of the track. The steps are
 * uneven on purpose. "Falmouth" is the widest label, so the stops either side
 * of it stand further off than the rest. With near-even steps (0.16, 0.36,
 * 0.55, 0.76, 0.96) the stops overlapped on small phones, by 5px at 360px and
 * 13px at 320px (measured on the live page, Nov 14 2026), and a tap between
 * two towns chose the one on the right.
 */
export const JOURNEY_POS: Record<string, number> = { A: 0.14, B: 0.355, C: 0.57, D: 0.765, E: 0.96 }

/**
 * The widest each stop's tap area gets below 480px: its short label in bold
 * at 12px, and never under 44px. Measured in Chrome; only Falmouth's label is
 * wider than the 44px floor.
 */
export const PHONE_STOP_WIDTHS: Record<string, number> = { A: 44, B: 55, C: 44, D: 44, E: 44 }

/** The gutter each side of the page on a phone, and the track's inset from the right of the text column below 480px (app/globals.css). */
export const PHONE_GUTTER = 16
export const PHONE_TRACK_INSET_RIGHT = 14

/** The track's width on a phone of the given viewport width: it starts at the text's left edge. */
export const phoneTrackWidth = (viewport: number): number => viewport - 2 * PHONE_GUTTER - PHONE_TRACK_INSET_RIGHT

/** The clear space, in px, between each stop and the next on a track of the given width. */
export function stopGaps(trackPx: number, widths: Record<string, number> = PHONE_STOP_WIDTHS, pos: Record<string, number> = JOURNEY_POS): number[] {
  const codes = Object.keys(pos)
  return codes.slice(0, -1).map((c, i) => {
    const next = codes[i + 1]
    return (pos[next] - pos[c]) * trackPx - (widths[c] + widths[next]) / 2
  })
}

/** How far the first stop's left edge and the last stop's right edge sit inside the text column (negative means it sticks out). */
export function stopOverhang(viewport: number, widths: Record<string, number> = PHONE_STOP_WIDTHS, pos: Record<string, number> = JOURNEY_POS): { left: number; right: number } {
  const codes = Object.keys(pos)
  const first = codes[0], last = codes[codes.length - 1]
  const track = phoneTrackWidth(viewport)
  const column = viewport - 2 * PHONE_GUTTER
  return { left: pos[first] * track - widths[first] / 2, right: column - (pos[last] * track + widths[last] / 2) }
}
