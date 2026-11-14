import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tours from '../data/tours.json' with { type: 'json' }
import transfers from '../data/transfers.json' with { type: 'json' }
import { mostAreGroupPriced, reopensAhead, shortDuration, unitPhrase } from '../lib/catalogue.mts'

/**
 * The exported catalogue and the few rules this page applies to it.
 *
 * Nov 14 2026: the main site had moved the raft to a per-person price by
 * pickup area and the falls to a "from" price for up to four, while this page
 * still printed "$128 up to 3 people" and "$351 up to 3 people", and six
 * hotels were still "reopening" on dates three months gone. The numbers come
 * from scripts/export-catalogue.mts; these tests hold what the page says
 * about them.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')
const bySlug = (slug: string) => {
  const t = tours.tours.find((x) => x.slug === slug)
  assert.ok(t, slug)
  return t
}

test('every tour says whether its price is a "from" and whether it covers the group', () => {
  for (const t of tours.tours) {
    assert.equal(typeof t.from, 'boolean', `${t.slug}: from`)
    assert.equal(typeof t.group, 'boolean', `${t.slug}: group`)
    assert.ok(Number.isInteger(t.price) && t.price > 0, `${t.slug}: price`)
    // The unit is one of the main site's three labels, and agrees with the flags.
    assert.match(t.unit, /^(up to \d+ people|for 1 person|per person)$/, `${t.slug}: unit "${t.unit}"`)
    assert.equal(t.group, /^up to /.test(t.unit), `${t.slug}: group against its unit`)
    assert.equal(t.tierMax === null, t.unit === 'per person', `${t.slug}: only a per-person tour has no party size`)
  }
})

test('the prices Collin gave on Nov 12 and 13 2026, as the main site sells them', () => {
  // By pickup area, for the group: the falls. From Ocho Rios, up to four.
  for (const slug of ['dunns-river-falls-climb', 'blue-hole-and-secret-falls']) {
    const t = bySlug(slug)
    assert.deepEqual({ price: t.price, unit: t.unit, from: t.from, group: t.group }, { price: 243, unit: 'up to 4 people', from: true, group: true }, slug)
  }
  // By pickup area, per person: the raft. From Montego Bay.
  const raft = bySlug('bamboo-rafting-on-the-martha-brae')
  assert.deepEqual({ price: raft.price, unit: raft.unit, from: raft.from, group: raft.group }, { price: 115, unit: 'per person', from: true, group: false })
  // "All the prices I give you is from 1-4 persons": Nine Mile covers four.
  const nine = bySlug('bob-marley-nine-mile-pilgrimage')
  assert.deepEqual({ price: nine.price, unit: nine.unit, from: nine.from }, { price: 459, unit: 'up to 4 people', from: false })
})

test('the tours card prints "From" only for a price that depends on the pickup area', () => {
  const src = read('components/Tours.tsx')
  assert.match(src, /\{t\.from && <span className="tour-from">From <\/span>\}<strong>\{money\(t\.price\)\}<\/strong>/)
  // Never a typed price or party size in the component: they come from the export.
  assert.doesNotMatch(src, /\$\d{2,}/)
  assert.doesNotMatch(src, /up to \d people/)
})

test('"Most are one price for your group" is said only while it is true of the cards shown', () => {
  const shown = tours.tours.filter((t) => t.slug !== 'dunns-river-blue-hole')
  const src = read('components/Tours.tsx')
  assert.match(src, /\{MOST_GROUP \? 'Most are one price for your group\.' : 'Each card says who its price covers\.'\}/)
  // Today four of the seven cards are group prices (five until Nov 14 2026, when parasailing
  // became per person), so the sentence still shows. One more and it gives way by itself.
  assert.equal(shown.filter((t) => t.group).length, 4)
  assert.equal(mostAreGroupPriced(shown), true)
  assert.equal(mostAreGroupPriced(shown.map((t) => (t.slug === 'ricks-cafe-cliff-diving-and-sunset' ? { ...t, group: false } : t))), false)
  // Half is not most, and an empty row claims nothing.
  assert.equal(mostAreGroupPriced([{ group: true }, { group: false }]), false)
  assert.equal(mostAreGroupPriced([{ group: true }, { group: true }, { group: false }]), true)
  assert.equal(mostAreGroupPriced([]), false)
})

test('the card tag carries the short duration, and every tour has one', () => {
  assert.equal(shortDuration('2 hrs at the falls'), '2 hrs')
  assert.equal(shortDuration("3 hrs at Rick's"), '3 hrs')
  assert.equal(shortDuration('1 hr on the boat'), '1 hr')
  assert.equal(shortDuration('1.5 hrs at the river'), '1.5 hrs')
  assert.equal(shortDuration('Full day'), 'Full day')
  for (const t of tours.tours) assert.match(shortDuration(t.duration), /^(\d+(\.\d)? hrs?|Half day|Full day)$/, `${t.slug}: "${t.duration}"`)
  assert.match(read('components/Tours.tsx'), /\{t\.destination\} · \{shortDuration\(t\.duration\)\}/)
})

test('a unit reads as a phrase after a price', () => {
  assert.equal(unitPhrase('up to 4 people'), 'for up to 4 people')
  assert.equal(unitPhrase('per person'), 'per person')
  assert.equal(unitPhrase('for 1 person'), 'for 1 person')
})

test('a reopening label is said only while its date is ahead, in Jamaica time', () => {
  const at = (iso: string) => new Date(iso)
  // A day: through the end of that day in Jamaica (05:00 UTC the next morning).
  assert.equal(reopensAhead('25 Aug 2026', at('2026-08-25T12:00:00Z')), '25 Aug 2026')
  assert.equal(reopensAhead('25 Aug 2026', at('2026-08-26T04:59:00Z')), '25 Aug 2026')
  assert.equal(reopensAhead('25 Aug 2026', at('2026-08-26T05:00:00Z')), null)
  assert.equal(reopensAhead('25 Aug 2026', at('2026-11-14T12:00:00Z')), null)
  // A quarter and a year: through their last day.
  assert.equal(reopensAhead('Q1 2027', at('2027-03-31T23:00:00Z')), 'Q1 2027')
  assert.equal(reopensAhead('Q1 2027', at('2027-04-01T05:00:00Z')), null)
  assert.equal(reopensAhead('2027', at('2027-12-31T23:00:00Z')), '2027')
  assert.equal(reopensAhead('2027', at('2028-01-01T05:00:00Z')), null)
  // Nothing to say, and a shape nobody planned for is left as written.
  assert.equal(reopensAhead(null), null)
  assert.equal(reopensAhead(''), null)
  assert.equal(reopensAhead('spring 2027', at('2030-01-01T00:00:00Z')), 'spring 2027')
})

test('every reopening label in the export is one of the shapes the rule reads', () => {
  const labels = [...new Set(transfers.destinations.map((d) => d.reopening).filter(Boolean))] as string[]
  assert.ok(labels.length > 0)
  for (const l of labels) assert.match(l, /^(\d{1,2} [A-Z][a-z]{2} \d{4}|Q[1-4] \d{4}|\d{4})$/, l)
  // Read on Nov 14 2026: the six dated August and September have passed, the rest are ahead.
  const now = new Date('2026-11-14T15:00:00Z')
  const passed = transfers.destinations.filter((d) => d.reopening && reopensAhead(d.reopening, now) === null).map((d) => d.id).sort()
  assert.deepEqual(passed, ['grand-lido-negril', 'royalton-blue-water-trelawny', 'royalton-hideaway-negril', 'royalton-negril', 'royalton-white-sands', 'sea-garden-montego-bay'])
})

test('the page reads reopening labels through the rule, in one place', () => {
  assert.match(read('lib/data.ts'), /transfers\.destinations\.map\(\(d\) => \(\{ \.\.\.d, reopening: reopensAhead\(d\.reopening\) \}\)\)/)
})
