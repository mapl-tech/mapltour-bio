// Measures what lib/hero-fit.mts and the --hero-need steps in app/globals.css are built on, and checks the result.
//
// 1. For the plain hero and the raft-giveaway hero, at every phone width, in Chrome's and Safari's engines:
//    how much room the hero needs under its picture (picture bottom to button bottom). Text wraps differently
//    from width to width and from engine to engine, so a few sample sizes are not enough.
// 2. On real phone screen sizes: whether the button is on the first screen, and by how much.
//
// Read-only: it loads the page and resizes it. Analytics hosts are blocked.
//
// This repo has no browser of its own; run it from the main site's repo, which has Playwright:
//     cd ../mapltours && node ../mapl-bio/scripts/hero-fit.mjs [url] [from] [to]
// The url defaults to the live page. For a local build: npx next build, serve out/, pass http://localhost:PORT.
// After a change to the hero's words, type or spacing: copy the runs it prints into HERO_NEEDS (keep the larger
// engine's numbers), adjust the --hero-need steps so each is the need plus 16px or more, and update
// HERO_COPY_PRINT to the value the failing test prints.
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(path.join(process.cwd(), 'package.json'))
let pw
try { pw = require('playwright') } catch { console.error('Playwright is not installed here. Run this from the main site repo: cd ../mapltours && node ../mapl-bio/scripts/hero-fit.mjs'); process.exit(2) }

const BASE = (process.argv[2] ?? 'https://bio.mapltours.com').replace(/\/$/, '')
const FROM = Number(process.argv[3] ?? 320), TO = Number(process.argv[4] ?? 479)
const VARIANTS = [['plain', '/'], ['raft', '/?utm_source=meta&utm_content=raft_giveaway']]
const TRACKERS = /googletagmanager|google-analytics|analytics\.google|doubleclick|facebook|hotjar/i
// width, height the browser gives a page with its bars showing, what it is
const PHONES = [
  [320, 568, 'iPhone SE (1st gen) screen'], [360, 560, 'small Android inside an app'], [360, 640, 'small Android'],
  [360, 672, '360 x 800 Android in Chrome'], [375, 548, 'iPhone SE (2nd and 3rd gen) in Safari'], [375, 629, 'iPhone 13 mini in Safari'],
  [390, 664, 'iPhone 13, 14 and 15 in Safari'], [393, 659, 'iPhone 15 Pro and 16 in Safari'], [412, 780, 'Pixel in Chrome'], [430, 746, 'iPhone Pro Max in Safari'],
]
const read = () => {
  const hero = document.querySelector('#top'); const media = hero.querySelector('.hero-media'); const btn = hero.querySelector('button[type=submit]')
  const lines = (sel) => { const e = hero.querySelector(sel); if (!e || !e.offsetParent) return 0; return Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) }
  const b = btn.getBoundingClientRect(), m = media.getBoundingClientRect()
  return { raft: document.documentElement.classList.contains('raft'), need: Math.round((b.bottom - m.bottom) * 10) / 10, picture: Math.round(m.height * 10) / 10, under: Math.round((innerHeight - b.bottom) * 10) / 10, iw: innerWidth, sideways: document.documentElement.scrollWidth > innerWidth, shape: `${lines('.hero-title')}/${lines('.hero-sub')}/${lines('.hero-raft-sub')}/${Math.round(hero.querySelector('.hero-tips')?.getBoundingClientRect().height ?? 0)}` }
}

let cut = 0
for (const engine of ['chromium', 'webkit']) {
  let browser
  try { browser = await pw[engine].launch() } catch (e) { console.log(`\n${engine}: not installed (${String(e.message).split('\n')[0]})`); continue }
  for (const [vname, route] of VARIANTS) {
    const ctx = await browser.newContext({ viewport: { width: FROM, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    await ctx.route(TRACKERS, (r) => r.abort())
    const page = await ctx.newPage()
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await page.evaluate(() => document.fonts.ready)
    const needs = []
    for (let w = FROM; w <= TO; w++) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.waitForTimeout(40)
      const m = await page.evaluate(read)
      if ((vname === 'raft') !== m.raft || m.iw !== w) { console.log(`  ${engine} ${vname} ${w}px: not measured (raft ${m.raft}, width ${m.iw})`); continue }
      needs.push([w, m.need, m.shape])
    }
    const runs = []
    for (const [w, n, shape] of needs) { const last = runs[runs.length - 1]; if (last && last.shape === shape && Math.abs(last.end - n) < 9) { last.to = w; last.end = n } else runs.push({ from: w, to: w, start: n, end: n, shape }) }
    console.log(`\n${engine}, ${vname} hero: room needed under the picture  [lines: headline / line under it / raft line / opt-in px]`)
    for (const r of runs) console.log(`   ${String(r.from).padStart(3)} to ${String(r.to).padEnd(3)}  ${r.start}${r.end !== r.start ? ` to ${r.end}` : ''}px   ${r.shape}`)
    console.log(`   on real screens:`)
    for (const [w, h, what] of PHONES) {
      await page.setViewportSize({ width: w, height: h })
      await page.waitForTimeout(120)
      const m = await page.evaluate(read)
      if (m.under < 0) cut++
      console.log(`   ${String(w).padStart(3)} x ${h}  picture ${String(m.picture).padStart(5)}px  ${m.under >= 0 ? `button on screen, ${m.under}px under it` : `BUTTON CUT OFF by ${-m.under}px`}${m.sideways ? '  SIDEWAYS SCROLL' : ''}   ${what}`)
    }
    await ctx.close()
  }
  await browser.close()
}
console.log(cut ? `\nThe button is cut off on ${cut} of the screens above.` : '\nThe button is on the first screen on every screen above.')
process.exit(cut ? 1 : 0)
