import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import offer from '../data/offer.json' with { type: 'json' }
import transfers from '../data/transfers.json' with { type: 'json' }
import { TIPS_LABEL } from '../lib/tips.mts'
import {
  HERO_CLEARANCE, HERO_COPY_PRINT, HERO_FIT_MAX_WIDTH, HERO_NEEDS, HERO_PICTURE_MIN,
  buttonClearance, cssNeed, heroCopyPrint, measuredNeed, needSteps, pictureHeight, type HeroVariant,
} from '../lib/hero-fit.mts'

/**
 * The hero's button stays on the first screen of a short phone (Nov 14 2026).
 * The numbers were measured in two browser engines; this file checks that the
 * stylesheet's steps cover every one of them, that screens the hero already
 * fitted on are left exactly as they were, and that nobody changes the
 * hero's wording without measuring again. See lib/hero-fit.mts.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')
const css = read('app/globals.css')
const steps = needSteps(css)
const VARIANTS: HeroVariant[] = ['plain', 'raft']

test('the stylesheet sizes the picture from what the screen has left, on phones only', () => {
  assert.match(css, /\.hero-media \{ height: clamp\(100px, calc\(100svh - var\(--hero-need\)\), min\(46svh, 380px\)\); \}/)
  assert.match(css, /\.raft \.hero-media \{ height: clamp\(100px, calc\(100svh - var\(--hero-need\)\), min\(34svh, 300px\)\); \}/)
  assert.equal(HERO_PICTURE_MIN, 100)
  // The steps: one for every phone, then two that only narrow it.
  assert.deepEqual(steps, [
    { from: 0, to: 479, plain: 377, raft: 468 },
    { from: 381, to: 479, plain: 358, raft: 455 },
    { from: 405, to: 479, plain: 370, raft: undefined },
  ])
  for (const s of steps) assert.equal(s.to, HERO_FIT_MAX_WIDTH)
  // The raft rule must come after the older `.raft .hero-media` height for phones and tablets, or that one wins.
  assert.ok(css.indexOf('.raft .hero-media { height: clamp(') > css.indexOf('@media (max-width: 899px) { .raft .hero-media { height: min(34svh, 300px); } }'))
  // Desktop is untouched: from 900px the picture fills the hero.
  assert.match(css, /\.hero-media \{ position: absolute; inset: 0; height: auto; \}/)
})

test('every measured width is covered: the step is the need plus 16px or more', () => {
  for (const variant of VARIANTS) {
    // The measurements run from 320 to 479 with no gap.
    const rows = HERO_NEEDS[variant]
    assert.equal(rows[0][0], 320)
    assert.equal(rows[rows.length - 1][1], HERO_FIT_MAX_WIDTH)
    for (let i = 1; i < rows.length; i++) assert.equal(rows[i][0], rows[i - 1][1] + 1, `${variant}: a gap before ${rows[i][0]}px`)
    for (let w = 320; w <= HERO_FIT_MAX_WIDTH; w++) {
      const need = measuredNeed(w, variant)
      const step = cssNeed(steps, w, variant)
      assert.ok(need !== null && step !== null, `${variant} ${w}px`)
      assert.ok(step - need >= HERO_CLEARANCE, `${variant} at ${w}px: the stylesheet allows ${step}px, the hero needs ${need}px`)
    }
  }
})

test('the steps sit clear of the widths where the text wraps differently', () => {
  // The line under the headline rewraps at 374px and the raft line at 373 to 375px. A phone's own text
  // rendering could move that by a pixel or two, and 375px is the iPhone SE and mini, so the roomier
  // step runs to 380px.
  for (let w = 320; w <= 380; w++) {
    assert.equal(cssNeed(steps, w, 'plain'), 377, `plain ${w}px`)
    assert.equal(cssNeed(steps, w, 'raft'), 468, `raft ${w}px`)
  }
  // The middle step is the one an iPhone 13, 14, 15 or 16 lands on (390, 393 and 402px): it is as small as
  // the measurements allow, so those phones keep the picture they have.
  for (const w of [381, 390, 393, 402, 404]) assert.equal(cssNeed(steps, w, 'plain'), 358, `plain ${w}px`)
  // The headline grows with the width, so the widest phones need more.
  assert.equal(cssNeed(steps, 405, 'plain'), 370)
  assert.equal(cssNeed(steps, 430, 'plain'), 370)
  assert.equal(cssNeed(steps, 479, 'plain'), 370)
  assert.equal(cssNeed(steps, 479, 'raft'), 455)
  // Past a phone's width nothing is set.
  assert.equal(cssNeed(steps, 480, 'plain'), null)
})

// width, height, what it is. Heights are what the browser gives a page with its bars showing.
const SHORT: Array<[number, number, string]> = [
  [320, 568, 'iPhone SE (1st gen) screen'],
  [360, 560, 'small Android inside an app'],
  [360, 640, 'small Android'],
  [360, 672, '360 x 800 Android in Chrome'],
  [375, 548, 'iPhone SE (2nd and 3rd gen) in Safari'],
  [375, 629, 'iPhone 13 mini in Safari'],
  [390, 664, 'iPhone 13, 14 and 15 in Safari'],
  [393, 659, 'iPhone 15 Pro and 16 in Safari'],
  [412, 780, 'Pixel in Chrome'],
  [430, 746, 'iPhone Pro Max in Safari'],
]

test('on each of these phones the button is on the first screen, with 16px or more under it', () => {
  for (const variant of VARIANTS) {
    for (const [w, h, what] of SHORT) {
      const after = buttonClearance(w, h, variant, steps)
      assert.ok(after >= HERO_CLEARANCE, `${variant}, ${what} (${w} x ${h}): ${after.toFixed(1)}px under the button`)
    }
  }
  // What it was: cut off on five of these with the plain hero, seven with the raft hero.
  const cutBefore = (variant: HeroVariant) => SHORT.filter(([w, h]) => buttonClearance(w, h, variant, null) < 0).map(([w, h]) => `${w}x${h}`)
  assert.deepEqual(cutBefore('plain'), ['320x568', '360x560', '360x640', '375x548'])
  assert.deepEqual(cutBefore('raft'), ['320x568', '360x560', '360x640', '375x548', '375x629'])
})

test('a screen the plain hero already fitted on with room to spare is left exactly as it was', () => {
  for (const [w, h] of [[390, 664], [390, 700], [390, 750], [390, 844], [412, 780], [412, 915], [430, 746], [430, 932], [360, 740], [360, 800], [320, 700]] as const) {
    const need = cssNeed(steps, w, 'plain')
    assert.equal(pictureHeight(h, need, 'plain'), pictureHeight(h, null, 'plain'), `${w} x ${h}`)
  }
  // And the picture never grows: the clamp's ceiling is what it has always been.
  for (const variant of VARIANTS) for (let h = 400; h <= 1000; h += 7) for (const w of [320, 375, 390, 430]) {
    assert.ok(pictureHeight(h, cssNeed(steps, w, variant), variant) <= pictureHeight(h, null, variant) + 1e-9)
    assert.ok(pictureHeight(h, cssNeed(steps, w, variant), variant) >= Math.min(HERO_PICTURE_MIN, pictureHeight(h, null, variant)) - 1e-9)
  }
})

test('where even the smallest picture cannot make room, the button is no worse off than before', () => {
  // Screens too short to hold the picture's floor and the panel: the picture stops at 100px and the
  // button is cut, by far less than it was.
  for (const [variant, h] of [['plain', 440], ['raft', 480]] as const) {
    assert.equal(pictureHeight(h, cssNeed(steps, 320, variant), variant), 100)
    assert.ok(buttonClearance(320, h, variant, steps) < 0)
    assert.ok(buttonClearance(320, h, variant, steps) >= buttonClearance(320, h, variant, null) + 60)
  }
})

test('the measurements were taken with the words the hero has now', () => {
  const print = heroCopyPrint(read('components/Hero.tsx'), TIPS_LABEL, `${offer.kind}:${offer.value}`, transfers.cheapestOneWay)
  assert.equal(print, HERO_COPY_PRINT, [
    'The hero\'s headline, lines, field, opt-in or button changed (or the offer or the cheapest fare did).',
    'Its height on a phone may have changed with it. Measure again:',
    '    cd ../mapltours && node ../mapl-bio/scripts/hero-fit.mjs',
    'then update HERO_NEEDS, the --hero-need steps in app/globals.css, and HERO_COPY_PRINT to ' + print + '.',
  ].join('\n'))
})
