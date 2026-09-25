import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RIDE_FROM, RIDE_TO, TIP_TEMPLATES, UNSUBSCRIBE_PLACEHOLDER, tip1, tip2, zoneFare } from '../netlify/lib/tip-emails.mts'
import transfers from '../data/transfers.json' with { type: 'json' }
import tours from '../data/tours.json' with { type: 'json' }
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
    // The card's last link to the tour is its button (the photo links there too, first).
    const at = html.lastIndexOf(`/experience/${slug}?`)
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

const imgs = (html: string) => [...html.matchAll(/<img[^>]*>/g)].map((m) => m[0])
const attrOf = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
const EMAIL_MEDIA = fileURLToPath(new URL('../public/media/email/', import.meta.url))

test('tip 1 opens with the coast road photo, above the fares, and the photo links to the fare finder', () => {
  for (const e of [tip1(), tip1({ postalAddress: ADDRESS })]) {
    const [img, ...rest] = imgs(e.html)
    assert.equal(rest.length, 0, 'one photo in tip 1')
    assert.equal(attrOf(img, 'src'), 'https://bio.mapltours.com/media/email/ride.jpg')
    assert.equal(attrOf(img, 'width'), '600')
    assert.equal(attrOf(img, 'height'), '450')
    assert.match(img, /aspect-ratio:4\/3;/)
    assert.match(attrOf(img, 'alt') ?? '', /^Price my ride\. A coast road seen from above/)
    // Under the headline and the one-line promise, before the fare table and the first button.
    const at = e.html.indexOf(img)
    assert.ok(e.html.indexOf('<h1') < at)
    assert.ok(at < e.html.indexOf('<th scope="col"'), 'photo before the fares')
    assert.ok(at < e.html.indexOf('utm_content=tip1_ride"'), 'photo before the first button')
    const a = e.html.slice(e.html.lastIndexOf('<a ', at), at)
    assert.match(a, /href="https:\/\/mapltours\.com\/transfers\?[^"]*utm_content=tip1_ride_photo"/)
  }
})

test('tip 2 has exactly three photos, one at the top of each tour card, each linking to its tour', () => {
  const html = tip2().html
  const cards = html.split('<table role="presentation" width="100%"').slice(1)
  assert.equal(cards.length, 3)
  const expected = [
    ['bamboo-rafting-on-the-martha-brae', 'martha-brae.jpg', /^See the Martha Brae\. A captain poling a bamboo raft on the Martha Brae/],
    ['ricks-cafe-cliff-diving-and-sunset', 'ricks-cafe.jpg', /^See Rick’s Cafe\. Rick’s Cafe at sunset/],
    ['dunns-river-blue-hole', 'blue-hole.jpg', /^See Dunn’s River\. Guests wading across the top of a waterfall at the Blue Hole/],
  ] as const
  for (const [i, card] of cards.entries()) {
    const [slug, file, alt] = expected[i]
    const found = imgs(card)
    assert.equal(found.length, 1, `${slug}: one photo per card`)
    const img = found[0]
    assert.equal(attrOf(img, 'src'), `https://bio.mapltours.com/media/email/tours/${file}`)
    assert.equal(attrOf(img, 'width'), '566')
    assert.equal(attrOf(img, 'height'), '318')
    assert.match(img, /aspect-ratio:16\/9;/)
    assert.match(attrOf(img, 'alt') ?? '', alt)
    // First thing in the card, ahead of the place, the title and the button.
    const at = card.indexOf(img)
    assert.ok(at < card.indexOf('<h2'), `${slug}: photo above the title`)
    assert.ok(at < card.lastIndexOf(`/experience/${slug}?`), `${slug}: photo above the button`)
    assert.equal(card.slice(card.indexOf('>') + 1, at).replace(/<a [^>]*>$/, '').replace(/<tr>|<td[^>]*>|\s/g, ''), '', `${slug}: nothing but its link before the photo`)
    assert.match(card.slice(0, at), new RegExp(`<a href="https://mapltours\\.com/experience/${slug}\\?[^"]*utm_content=tip2_[a-z_]+_photo"[^>]*>$`))
  }
  assert.equal(imgs(html).length, 3)
})

test('every photo: an https file on the bio site that exists in public/media/email, with width, height, alt and the code email’s style', () => {
  for (const { e } of all) {
    assert.doesNotMatch(e.html, /url\(|background-image|<picture|srcset/, 'no image except the <img> tags checked here')
    for (const img of imgs(e.html)) {
      const src = attrOf(img, 'src') ?? ''
      assert.match(src, /^https:\/\/bio\.mapltours\.com\/media\/email\/(tours\/)?[a-z-]+\.jpg$/, src)
      const file = src.replace('https://bio.mapltours.com/media/email/', '')
      assert.ok(existsSync(EMAIL_MEDIA + file), `public/media/email/${file} exists`)
      // The file's own ratio is the CSS ratio (ride.jpg 900x675 is 4:3, the tour photos 800x450 are 16:9).
      const jpg = readFileSync(EMAIL_MEDIA + file)
      const size = jpegSize(jpg)
      const ratio = /aspect-ratio:(\d+)\/(\d+);/.exec(img)
      assert.ok(ratio, 'aspect-ratio set')
      assert.equal(size.w * Number(ratio[2]), size.h * Number(ratio[1]), `${file} is ${size.w}x${size.h}, css ${ratio[1]}/${ratio[2]}`)
      for (const a of ['width', 'height']) assert.match(attrOf(img, a) ?? '', /^\d+$/, `${file} ${a}`)
      assert.ok((attrOf(img, 'alt') ?? '').length > 20, `${file} alt`)
      for (const rule of ['display:block;', 'width:100%;', 'height:auto;', 'border-radius:14px;', `max-width:${attrOf(img, 'width')}px;`]) assert.ok(img.includes(rule), `${file}: ${rule}`)
    }
  }
})

test('each email stays far under Gmail’s 102 KB clip, and each photo file is a web-sized JPEG', () => {
  for (const { e } of all) assert.ok(Buffer.byteLength(e.html) < 40_000, `${Buffer.byteLength(e.html)} bytes`)
  for (const file of ['ride.jpg', 'tours/martha-brae.jpg', 'tours/ricks-cafe.jpg', 'tours/blue-hole.jpg']) {
    const bytes = readFileSync(EMAIL_MEDIA + file).length
    assert.ok(bytes > 20_000 && bytes < 150_000, `${file}: ${bytes} bytes`)
  }
})

/** Width and height from a baseline or progressive JPEG's SOF marker. */
function jpegSize(b: Buffer) {
  let i = 2
  while (i < b.length) {
    const marker = b[i + 1]
    const len = b.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new Error('no SOF marker')
}

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
    for (const m of e.html.matchAll(/src="([^"]+)"/g)) assert.match(m[1], /^https:\/\/bio\.mapltours\.com\/media\/email\/(tours\/)?[a-z-]+\.jpg$/)
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
