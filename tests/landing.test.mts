import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { LANDING_SCRIPT } from '../lib/landing.mts'

/** Runs the shipped <head> string against a fake location, history and navigation entry. */
function land(url: string, navType: string | null) {
  const u = new URL(url)
  const calls: string[] = []
  const listeners: Record<string, () => void> = {}
  const history = { state: { k: 1 }, scrollRestoration: 'auto', replaceState: (_s: unknown, _t: string, to: string) => { calls.push(to) } }
  vm.runInNewContext(LANDING_SCRIPT, {
    location: { hash: u.hash, pathname: u.pathname, search: u.search },
    history,
    performance: { getEntriesByType: () => (navType ? [{ type: navType }] : []) },
    addEventListener: (ev: string, fn: () => void) => { listeners[ev] = fn },
  })
  return { replaced: calls, history, listeners }
}

test('a link with #coupon or any fragment lands at the top: the fragment is dropped, the query kept', () => {
  for (const type of ['navigate', 'reload', null]) {
    const r = land('https://bio.mapltours.com/?utm_source=mapltours&utm_campaign=raft_2026#coupon', type)
    assert.deepEqual(r.replaced, ['/?utm_source=mapltours&utm_campaign=raft_2026'], String(type))
  }
  assert.deepEqual(land('https://bio.mapltours.com/#price', 'navigate').replaced, ['/'])
})

test('no fragment, no rewrite; a back/forward visit keeps its fragment', () => {
  assert.deepEqual(land('https://bio.mapltours.com/?utm_content=raft_giveaway', 'navigate').replaced, [])
  assert.deepEqual(land('https://bio.mapltours.com/#price', 'back_forward').replaced, [])
})

test('scroll restoration stays on while the visitor is here and is switched off as the page is left', () => {
  const r = land('https://bio.mapltours.com/', 'navigate')
  assert.equal(r.history.scrollRestoration, 'auto')
  r.listeners.pagehide()
  assert.equal(r.history.scrollRestoration, 'manual')
})

test('never throws into the page, whatever the browser lacks', () => {
  assert.doesNotThrow(() => vm.runInNewContext(LANDING_SCRIPT, {}))
  assert.doesNotThrow(() => vm.runInNewContext(LANDING_SCRIPT, { location: { hash: '#x', pathname: '/', search: '' }, history: {}, performance: {} }))
})
