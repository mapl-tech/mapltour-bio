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
  assert.doesNotMatch(e.html, /write once more|only email/)
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
  assert.match(e.html, /You asked for this code at bio\.mapltours\.com\. To hear nothing more/)
})

test('copy rules: no em dashes, no exclamation marks, brand name in mixed case', () => {
  for (const tips of [undefined, { on: false, yesUrl: YES }, { on: true, stopUrl: STOP }, { on: true }]) {
    for (const now of [during, GIVEAWAY.closes]) {
      const e = codeEmail(COUPON, 'mapltours.com', now, tips)
      const text = e.html.replace(/<[^>]+>/g, ' ')
      assert.doesNotMatch(text, /—/)
      assert.doesNotMatch(text, /!/)
      assert.doesNotMatch(text, /MAPL TOURS/)
    }
  }
})

// Stand-ins for the signed links lead.mts makes (netlify/lib/tips.mts).
const YES = 'https://bio.mapltours.com/tips?a=yes&e=Z3Vlc3Q&t=tok-yes'
const STOP = 'https://bio.mapltours.com/tips?a=stop&e=Z3Vlc3Q&t=tok-stop'

test('did not opt in: the trip tips card sits after the tours, before the reply line, with the signed yes link', () => {
  const e = codeEmail(COUPON, 'bio.mapltours.com', during, { on: false, yesUrl: YES })
  assert.match(e.html, /<h2[^>]*>Trip tips before you fly\?<\/h2>/)
  assert.match(e.html, /About twice a month: what the ride from MBJ costs, the tours people book most, and what to know the week before you go\./)
  // The quiet outline pill, not a gold button, with the &s escaped.
  assert.match(e.html, /border:2px solid #12563A[^>]*><a href="https:\/\/bio\.mapltours\.com\/tips\?a=yes&amp;e=Z3Vlc3Q&amp;t=tok-yes"[^>]*>Yes, send me trip tips<\/a>/)
  assert.ok(e.html.indexOf('Choose my tour') < e.html.indexOf('Trip tips before you fly'))
  assert.ok(e.html.indexOf('Trip tips before you fly') < e.html.indexOf('Not sure which one?'))
  assert.match(e.html, /You asked for this code at bio\.mapltours\.com\. To hear nothing more from us, reply with the word <b>stop<\/b>/)
  assert.doesNotMatch(e.html, /Stop trip tips|a=stop/)
  assert.match(e.html, /mapltours\.com\/privacy/)
})

test('did not opt in, no signing secret: no card and no /tips link at all', () => {
  const e = codeEmail(COUPON, 'bio.mapltours.com', during, { on: false })
  assert.doesNotMatch(e.html, /Trip tips before you fly|\/tips\?/)
  assert.doesNotMatch(e.html, /only email/)
  assert.deepEqual(codeEmail(COUPON, 'bio.mapltours.com', during), e, 'the default is "did not ask, no links"')
})

test('opted in: no card; the footer says so, keeps stop-by-reply and privacy, and links the signed stop', () => {
  const e = codeEmail(COUPON, 'mapltours.com', during, { on: true, stopUrl: STOP })
  assert.doesNotMatch(e.html, /Trip tips before you fly|a=yes/)
  assert.match(e.html, /You asked for this code and for trip tips at mapltours\.com\. Tips come about twice a month, and every one has a one-tap unsubscribe\. To hear nothing more from us, reply with the word <b>stop<\/b> and we remove you the same day\./)
  assert.match(e.html, /Not you, or changed your mind\? <a href="https:\/\/bio\.mapltours\.com\/tips\?a=stop&amp;e=Z3Vlc3Q&amp;t=tok-stop"[^>]*>Stop trip tips<\/a>/)
  assert.match(e.html, /mapltours\.com\/privacy/)
  assert.doesNotMatch(e.html, /only email about it/)
})

test('opted in after the draw: no raft sentence; without the secret, no stop line', () => {
  const e = codeEmail(COUPON, 'bio.mapltours.com', GIVEAWAY.closes, { on: true, stopUrl: STOP })
  assert.doesNotMatch(e.html, /raft for two|giveaway|draw/i)
  assert.match(e.html, /every one has a one-tap unsubscribe\. To hear nothing more/)
  const bare = codeEmail(COUPON, 'bio.mapltours.com', during, { on: true })
  assert.doesNotMatch(bare.html, /Stop trip tips|\/tips\?/)
  assert.match(bare.html, /You asked for this code and for trip tips at bio\.mapltours\.com\./)
})
