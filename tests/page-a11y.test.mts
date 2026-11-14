import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Three things measured on the live page on Nov 14 2026 and fixed, held here
 * so a later edit cannot quietly undo them. The numbers themselves come from
 * a browser, not from this file: see the commit that added it.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')
const css = read('app/globals.css')

test('the shade behind a tour card\'s text is anchored to the text, not to the card', () => {
  // Fixed to the card, a taller text block put its title on the bright part of
  // the photo: 1.4:1 to 2.7:1 on four cards at 1024px, 2.0:1 on one at 360px.
  assert.match(css, /\.tour-body::before \{[^}]*inset: -88px 0 0;[^}]*linear-gradient\(180deg/)
  assert.doesNotMatch(css, /(^|\n)\.tour::after/)
  // The "All tours" card has no .tour-body, so it keeps its own fixed shade.
  assert.match(css, /\.tour-all::after \{[^}]*linear-gradient\(0deg/)
  // At the body's top edge (88px down the layer) and through the title and
  // the description's first line: 38%, 52% and 72% shade, as measured for AA.
  assert.match(css, /rgba\(17,17,16,0\.38\) 88px, rgba\(17,17,16,0\.52\) 124px, rgba\(17,17,16,0\.72\) 164px/)
})

test('both sideways rows can be reached and moved by keyboard', () => {
  // A phone-width row that scrolls and holds nothing focusable is out of a keyboard's reach (axe: scrollable-region-focusable).
  assert.match(read('components/Proof.tsx'), /<div className="proof-list" tabIndex=\{0\} role="group" aria-label="[^"]+">/)
  assert.match(read('components/Tours.tsx'), /<div className="tour-track" tabIndex=\{0\} role="group" aria-label="Tours">/)
})

test('pills that sit side by side are 8px apart', () => {
  assert.match(css, /\.zone-hotels \{[^}]*gap: 8px;/)
  assert.match(css, /\.footer-social \{[^}]*gap: 8px 10px;/)
  // Round trip / One way: two halves of one control, and still two targets.
  assert.match(css, /\.seg \{[^}]*gap: 8px;/)
})

test('the five stops on the journey line do not overlap on a phone', () => {
  // With 4px of side padding and the line inset 30px and 44px, the stops
  // overlapped by up to 5px at 360px (13px at 320px) and "MoBay" ran into
  // "Falmouth". Below 768px a stop is as wide as its words, and below 480px
  // the line starts at the text's left edge: 8.6px apart or more at 360px.
  assert.match(css, /@media \(max-width: 767px\) \{ \.journey-stop \{ padding: 0 0 6px; \}/)
  assert.match(css, /@media \(max-width: 479px\) \{ \.journey-track \{ margin: 0 22px 0 0; \} \.journey-stops \{ left: 0; right: 22px; \} \}/)
  // The track and the stops must share one inset, or the gold fill stops short of the chosen dot.
  assert.match(css, /\.journey-track \{[^}]*margin: 0 44px 0 30px;/)
  assert.match(css, /\.journey-stops \{[^}]*left: 30px; right: 44px;/)
})
