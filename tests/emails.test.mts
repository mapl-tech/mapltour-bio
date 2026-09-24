import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COUPON, GIVEAWAY, codeEmail, giveawayOpen } from '../netlify/lib/emails.mts'

const during = Date.parse('2026-10-15T15:00:00Z')

test('the draw window: opens Sept 24 Eastern, closes the moment Nov 30 ends in Eastern time', () => {
  assert.equal(giveawayOpen(Date.parse('2026-09-24T03:59:59Z')), false)
  assert.equal(giveawayOpen(Date.parse('2026-09-24T04:00:00Z')), true)
  assert.equal(giveawayOpen(Date.parse('2026-12-01T04:59:59Z')), true) // 11:59:59 pm EST, Nov 30
  assert.equal(giveawayOpen(Date.parse('2026-12-01T05:00:00Z')), false)
  assert.equal(GIVEAWAY.id, 'martha-brae-2026')
})

test('while open, the code email carries the draw: block, rules link, subject, preheader, footer', () => {
  const e = codeEmail(COUPON, 'mapltours.com', during)
  assert.match(e.subject, /JAMAICA5/)
  assert.match(e.subject, /raft draw/)
  assert.doesNotMatch(e.subject, /\b(win|free)\b/i, 'no spam-trigger words in the subject')
  assert.match(e.html, /You’re in the draw for a&nbsp;raft&nbsp;for&nbsp;two/)
  assert.match(e.html, /bio\.mapltours\.com\/media\/email\/raft\.jpg/)
  assert.match(e.html, /mapltours\.com\/giveaway\?utm_source=bio&amp;|mapltours\.com\/giveaway\?utm_source=bio&/)
  assert.match(e.html, /December 1/)
  assert.match(e.html, /No purchase needed/)
  assert.match(e.html, /we refund your raft, up to US\$128\./)
  assert.match(e.html, />Book my raft</)
  assert.match(e.html, /color-scheme" content="light only/)
  assert.match(e.html, /If you win the raft, we write once more, on December 1\./)
  assert.match(e.html, /Plus a private raft for two on the Martha Brae/)
  // The code still comes first: the box sits above the draw.
  assert.ok(e.html.indexOf('JAMAICA5') < e.html.indexOf('in the draw'))
  // ...and the first button (the ride) still comes before the draw card.
  assert.ok(e.html.indexOf('Price my ride') < e.html.indexOf('in the draw for'))
  assert.ok(e.html.indexOf('in the draw for') < e.html.indexOf('Choose my tour'))
})

test('after entries close, not a word about the draw', () => {
  const e = codeEmail(COUPON, 'bio.mapltours.com', GIVEAWAY.closes)
  assert.equal(e.subject, 'Your 5% code: JAMAICA5, for the ride or a tour')
  assert.doesNotMatch(e.html, /raft for two|giveaway|draw/i)
  assert.match(e.html, /this is the only email about it\. To hear nothing more/)
})

test('copy rules: no em dashes, no exclamation marks, brand name in mixed case', () => {
  const e = codeEmail(COUPON, 'mapltours.com', during)
  const text = e.html.replace(/<[^>]+>/g, ' ')
  assert.doesNotMatch(text, /—/)
  assert.doesNotMatch(text, /!/)
  assert.doesNotMatch(text, /MAPL TOURS/)
})
