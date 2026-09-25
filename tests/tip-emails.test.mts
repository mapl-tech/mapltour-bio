import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RIDE_FROM, RIDE_TO, TIP_TEMPLATES, UNSUBSCRIBE_PLACEHOLDER, tip1, tip2, zoneFare } from '../netlify/lib/tip-emails.mts'
import transfers from '../data/transfers.json' with { type: 'json' }
import tours from '../data/tours.json' with { type: 'json' }

const ADDRESS = '12 Example Street, Montego Bay, St. James, Jamaica'
const all = [
  { n: 1, e: tip1() },
  { n: 2, e: tip2() },
  { n: 1, e: tip1({ postalAddress: ADDRESS }) },
  { n: 2, e: tip2({ postalAddress: ADDRESS }) },
]
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
/** The text with every run of whitespace (including the gaps tags leave) as one space. */
const flat = (html: string) => text(html).replace(/\s+/g, ' ')
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))

test('subjects, word for word', () => {
  assert.equal(tip1().subject, 'What your ride from MBJ costs')
  assert.equal(tip2().subject, 'A day off the resort: rafting, Rick’s Cafe or Dunn’s River')
})

test('the core lines and the shared close', () => {
  assert.ok(text(tip1().html).includes('One flat fare per vehicle for up to 4 people, bigger groups welcome. You see it before you book, and nothing is added at the airport.'))
  assert.ok(text(tip1().html).includes('Pick your resort for its exact fare. No account needed, and JAMAICA5 takes 5% off at checkout.'))
  assert.ok(text(tip2().html).includes('Three private tours, one near each resort area: Montego Bay, Negril and Ocho Rios. Your driver picks you up at your hotel, and one price covers your group.'))
  assert.ok(flat(tip2().html).includes('JAMAICA5 still takes 5% off. Type it in the Discount code box at checkout.'))
  for (const { e } of all) assert.ok(text(e.html).includes('Reply with your resort and dates and we’ll plan it with you. Booked already? You’re set.'))
})

test('copy rules: no em dashes, no exclamation marks, brand in mixed case, drivers pick you up', () => {
  for (const { e } of all) {
    for (const s of [e.subject, text(e.html)]) {
      assert.doesNotMatch(s, /—/)
      assert.doesNotMatch(s, /!/)
      assert.doesNotMatch(s, /MAPL TOURS/)
      assert.doesNotMatch(s, /collect you/i)
    }
    assert.match(e.html, /MAPL Tours Jamaica/)
    // The text check above cannot see CSS: the brand line at the top must not be uppercased by it either.
    const line = /<p[^>]*>MAPL Tours Jamaica<\/p>/.exec(e.html)?.[0] ?? ''
    assert.ok(line, 'brand line present')
    assert.doesNotMatch(line, /uppercase/)
  }
})

test('the ride: four is never read as the limit (groups up to 7 ride in one vehicle, bigger ones are quoted)', () => {
  for (const e of [tip1(), tip1({ postalAddress: ADDRESS })]) {
    const s = text(e.html)
    for (const m of s.matchAll(/up to 4 people[^.]*/g)) assert.match(m[0], /bigger groups welcome/, m[0])
  }
  assert.match(text(tip1().html), /up to 4 people, bigger groups welcome/)
  // In tip 2 a party size only ever follows a tour's own price (the tour page's "From $X up to N people").
  for (const m of flat(tip2().html).matchAll(/(.{0,24})up to \d+ people/g)) assert.match(m[1], /From \$\d+ for $/, m[0])
})

test('tip 1 says what the ride costs: every zone and its whole one-way range, straight from the export', () => {
  const s = text(tip1().html)
  for (const z of transfers.zones) {
    assert.ok(s.includes(z.label), z.label)
    const fare = z.owMin === z.owMax ? `$${z.owMin}` : `$${z.owMin}–$${z.owMax}`
    assert.equal(zoneFare(z), fare)
    assert.ok(flat(tip1().html).includes(`${z.label} ${z.duration.replace(/ from MBJ$/, '')} ${fare} `), `${z.label}: ${fare}`)
  }
  // Never a zone's floor on its own: "from $99" under Negril & Runaway Bay is the Runaway Bay price.
  assert.doesNotMatch(s, /from \$\d/)
  assert.equal(RIDE_FROM, Math.min(...transfers.zones.map((z) => z.owMin)))
  assert.equal(RIDE_TO, Math.max(...transfers.zones.map((z) => z.owMax)))
  assert.match(tip1().html, new RegExp(`One flat fare per vehicle, \\$${RIDE_FROM} to \\$${RIDE_TO} one way depending on where you’re staying\\. Your driver waits at arrivals`), 'the preheader gives the whole range')
  assert.ok(flat(tip1().html).includes(`Round trips cost ${Math.round(transfers.roundTripDiscount * 100)}% less than two one-ways .`))
  // The fares are a real table: header cells a screen reader can announce.
  assert.match(tip1().html, /<th scope="col"[^>]*>Where you’re staying<\/th>/)
})

test('tip 2 prices each tour as the tour page does, straight from the export', () => {
  const s = flat(tip2().html)
  const three = ['bamboo-rafting-on-the-martha-brae', 'ricks-cafe-cliff-diving-and-sunset', 'dunns-river-blue-hole'].map((slug) => tours.tours.find((x) => x.slug === slug)!)
  for (const t of three) assert.ok(s.includes(`${t.duration} · From $${t.price} for ${t.unit}`), `${t.slug}: ${t.duration} · From $${t.price} for ${t.unit}`)
  // Each card carries the tour page's own title, and its place label starts with the page's destination.
  const typographic = flat(tip2().html).replace(/’/g, "'")
  for (const t of three) {
    assert.ok(typographic.includes(` ${t.title} `), t.title)
    assert.ok(typographic.toLowerCase().includes(` ${t.destination.toLowerCase()}`), t.destination)
  }
  // The preheader gives every tour its own price, cheapest first, never one floor for all three.
  const byPrice = [...three].sort((a, b) => a.price - b.price).map((t) => `from $${t.price}`)
  const pre = /<div style="display:none[^>]*>([^<&]*)/.exec(tip2().html)?.[1] ?? ''
  assert.match(pre, /^Private, with hotel pickup, one price per group: /)
  let at = 0
  for (const f of byPrice) { const i = pre.indexOf(f, at); assert.ok(i >= at, `${f} in order in "${pre}"`); at = i }
})

test('tip 2 claims only what each tour page lists as included', () => {
  const included = (slug: string) => tours.tours.find((x) => x.slug === slug)!.included
  const card = (slug: string) => {
    const html = tip2().html
    const at = html.indexOf(`/experience/${slug}?`)
    return text(html.slice(html.lastIndexOf('<table role="presentation" width="100%"', at), at)).replace(/’/g, "'")
  }
  // Every tour: private transport from the hotel.
  for (const slug of ['bamboo-rafting-on-the-martha-brae', 'ricks-cafe-cliff-diving-and-sunset', 'dunns-river-blue-hole']) {
    assert.ok(included(slug).some((i) => /^Round-trip private transport from your hotel/.test(i)), slug)
    assert.match(card(slug), /Your ride and /, slug)
  }
  assert.ok(included('bamboo-rafting-on-the-martha-brae').includes('Raft village entry'))
  assert.ok(included('bamboo-rafting-on-the-martha-brae').includes('Private raft and licensed captain'))
  assert.match(card('bamboo-rafting-on-the-martha-brae'), /licensed captain\. Your ride and the raft village entry are included\./)
  assert.ok(included('ricks-cafe-cliff-diving-and-sunset').includes("Rick's Cafe entry"))
  assert.match(card('ricks-cafe-cliff-diving-and-sunset'), /Your ride and entry are included\./)
  assert.ok(included('dunns-river-blue-hole').includes("Dunn's River and Blue Hole entry"))
  assert.ok(included('dunns-river-blue-hole').includes('A licensed guide at each falls'))
  assert.match(card('dunns-river-blue-hole'), /with a licensed guide at each falls\. Your ride and both entries are included\./)
})

test('no images of people: the only photo is the coast road in tip 1, described by what it shows', () => {
  for (const { n, e } of all) {
    const imgs = [...e.html.matchAll(/<img[^>]*>/g)].map((m) => m[0])
    assert.equal(imgs.length, n === 1 ? 1 : 0)
    for (const i of imgs) {
      assert.match(i, /src="https:\/\/bio\.mapltours\.com\/media\/email\/ride\.jpg"/)
      assert.match(i, /alt="A coast road seen from above[^"]*"/)
    }
  }
})

test('the unsubscribe link is Resend’s placeholder, written literally, and the only {{ in the template', () => {
  assert.equal(UNSUBSCRIBE_PLACEHOLDER, '{{{RESEND_UNSUBSCRIBE_URL}}}')
  for (const { e } of all) {
    assert.match(e.html, /<a href="\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}"[^>]*>Unsubscribe<\/a>/)
    assert.equal(e.html.split('{{').length - 1, 1, 'one placeholder, nothing else Resend would try to fill')
    assert.match(e.html, /You asked for trip tips from MAPL Tours Jamaica\./)
  }
})

test('every link is https on mapltours.com and tagged for the trip tips emails', () => {
  for (const { n, e } of all) {
    const links = hrefs(e.html).filter((h) => h !== UNSUBSCRIBE_PLACEHOLDER)
    assert.ok(links.length >= 2)
    for (const h of links) {
      const u = new URL(h)
      assert.equal(u.protocol, 'https:', h)
      assert.equal(u.host, 'mapltours.com', h)
      assert.equal(u.searchParams.get('utm_source'), 'bio', h)
      assert.equal(u.searchParams.get('utm_medium'), 'email', h)
      assert.equal(u.searchParams.get('utm_campaign'), 'trip_tips', h)
      assert.match(u.searchParams.get('utm_content') ?? '', new RegExp(`^tip${n}_[a-z_]+$`), h)
    }
    assert.ok(links.some((h) => h.startsWith('https://mapltours.com/privacy?')), 'privacy link')
    for (const m of e.html.matchAll(/src="([^"]+)"/g)) assert.match(m[1], /^https:\/\/bio\.mapltours\.com\/media\/email\/[a-z]+\.jpg$/)
    // The &s in an href are escaped, as HTML wants.
    assert.doesNotMatch(e.html, /href="[^"]*&(?!amp;)[^"]*"/)
  }
})

test('tip 1 sends people to the fare finder; tip 2 to the three tours', () => {
  const t1 = hrefs(tip1().html).map((h) => h.split('?')[0])
  assert.ok(t1.includes('https://mapltours.com/transfers'))
  for (const c of ['tip1_ride', 'tip1_ride_end']) assert.ok(hrefs(tip1().html).some((h) => h.startsWith('https://mapltours.com/transfers?') && h.endsWith(`utm_content=${c}`)), c)
  assert.ok(hrefs(tip2().html).some((h) => h.startsWith('https://mapltours.com/transfers?') && h.endsWith('utm_content=tip2_ride')), 'tip 2 keeps a quiet way back to the ride')
  const t2 = hrefs(tip2().html).map((h) => h.split('?')[0])
  for (const slug of ['ricks-cafe-cliff-diving-and-sunset', 'dunns-river-blue-hole', 'bamboo-rafting-on-the-martha-brae']) assert.ok(t2.includes(`https://mapltours.com/experience/${slug}`), slug)
  for (const c of ['tip2_ricks_cafe', 'tip2_dunns_river', 'tip2_martha_brae']) assert.ok(hrefs(tip2().html).some((h) => h.endsWith(`utm_content=${c}`)), c)
})

test('postal address: printed when set (escaped, one line per line), the short sign-off while it is null', () => {
  for (const e of [tip1({ postalAddress: ADDRESS }), tip2({ postalAddress: ADDRESS })]) {
    assert.ok(e.html.includes(`MAPL Tours Jamaica<br>${ADDRESS}`))
    assert.doesNotMatch(e.html, /MAPL Tours Jamaica, Montego Bay\./)
  }
  assert.ok(tip1({ postalAddress: 'PO Box 1 & 2\nMontego Bay' }).html.includes('PO Box 1 &amp; 2<br>Montego Bay'))
  for (const e of [tip1({ postalAddress: null }), tip2({ postalAddress: null })]) assert.match(e.html, /MAPL Tours Jamaica, Montego Bay\./)
})

test('the code email’s visual system: page colour, 600px column, DM Sans, gold pills, 16px body, light only', () => {
  for (const { e } of all) {
    assert.match(e.html, /background:#FAF9F7/)
    assert.match(e.html, /max-width:600px/)
    assert.match(e.html, /font-family:'DM Sans'/)
    assert.match(e.html, /bgcolor="#A58326"/)
    assert.match(e.html, /font-size:16px;line-height:1\.6/)
    assert.match(e.html, /color-scheme" content="light only/)
    assert.match(e.html, /<html lang="en">/)
  }
})

test('template registry: two templates, tip 1 first, distinct aliases', () => {
  assert.deepEqual(TIP_TEMPLATES.map((t) => t.alias), ['trip-tips-1-ride', 'trip-tips-2-tours'])
  assert.equal(TIP_TEMPLATES[0].build().subject, tip1().subject)
  assert.equal(TIP_TEMPLATES[1].build().subject, tip2().subject)
})
