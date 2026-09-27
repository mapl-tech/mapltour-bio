import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { GIVEAWAY, RAFT_PARAM, RAFT_SCRIPT, giveawayOpen } from '../lib/giveaway.mts'

/**
 * The <head> script that marks a raft-ad visit (lib/giveaway.mts), run
 * exactly as shipped: the string, in a sandbox with a fake location, clock
 * and <html> class list.
 */
let preloads: Array<Record<string, unknown>> = []
function runScript(search: string, now: number): boolean {
  const classes = new Set<string>()
  preloads = []
  const sandbox = {
    location: { search },
    document: {
      documentElement: { classList: { add: (c: string) => classes.add(c) } },
      createElement: () => { const el: Record<string, unknown> = {}; el.setAttribute = (k: string, v: string) => { el[k] = v }; return el },
      head: { appendChild: (el: Record<string, unknown>) => preloads.push(el) },
    },
    Date: { now: () => now },
  }
  vm.runInNewContext(RAFT_SCRIPT, sandbox)
  return classes.has('raft')
}

const OPEN = Date.parse('2026-09-26T17:00:00Z')
const AD = '?utm_source=facebook&utm_medium=paid&utm_campaign=bio_cold&utm_content=raft_giveaway'

test('the raft ad link marks the page while entries are open', () => {
  assert.equal(runScript(AD, OPEN), true)
})

test('only "raft" as a whole word of utm_content or utm_campaign counts', () => {
  for (const s of ['?utm_content=raft_giveaway', '?utm_content=raft', '?utm_campaign=martha-brae-raft', '?x=1&utm_content=bio.raft.v2', '?utm_content=RAFT_Giveaway', '?utm_content=raft_giveaway#coupon']) {
    assert.equal(runScript(s, OPEN), true, s)
    assert.equal(RAFT_PARAM.test(s), true, s)
  }
  for (const s of ['', '?utm_content=video_card', '?utm_content=draft_email', '?utm_content=rafting_reel', '?utm_source=raft', '?utm_term=raft', '?ref=raft_giveaway', '?utm_contents=raft', '?utm_content=bio_cold&next=raft']) {
    assert.equal(runScript(s, OPEN), false, s)
  }
})

test('the mark follows the entry window exactly: not before it opens, not once it closes', () => {
  assert.equal(runScript(AD, GIVEAWAY.opens - 1), false)
  assert.equal(runScript(AD, GIVEAWAY.opens), true)
  assert.equal(runScript(AD, GIVEAWAY.closes - 1), true)
  assert.equal(runScript(AD, GIVEAWAY.closes), false)
  assert.equal(giveawayOpen(GIVEAWAY.closes - 1), true)
  assert.equal(giveawayOpen(GIVEAWAY.closes), false)
})

test('a raft visit preloads the card thumbnail at the right density; nobody else fetches it', () => {
  runScript(AD, OPEN)
  assert.equal(preloads.length, 1)
  const p = preloads[0]
  assert.deepEqual({ rel: p.rel, as: p.as, href: p.href, set: p.imagesrcset }, { rel: 'preload', as: 'image', href: '/media/raft-thumb.webp', set: '/media/raft-thumb.webp 2x, /media/raft-thumb@3x.webp 3x' })
  runScript('?utm_content=video_card', OPEN)
  assert.equal(preloads.length, 0)
  runScript(AD, GIVEAWAY.closes)
  assert.equal(preloads.length, 0)
})

test('the page is still marked when the preload cannot be added', () => {
  const classes = new Set<string>()
  vm.runInNewContext(RAFT_SCRIPT, { location: { search: AD }, document: { documentElement: { classList: { add: (c: string) => classes.add(c) } } }, Date: { now: () => OPEN } })
  assert.equal(classes.has('raft'), true)
})

test('closes at 11:59 pm Eastern on Nov 30 2026 (EST), the rules page date', () => {
  assert.equal(new Date(GIVEAWAY.closes).toISOString(), '2026-12-01T05:00:00.000Z')
})

test('the script never throws into the page, even with no location or document', () => {
  assert.doesNotThrow(() => vm.runInNewContext(RAFT_SCRIPT, { Date: { now: () => OPEN } }))
})
