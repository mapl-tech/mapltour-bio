// The three emails the coupon capture sends. Plain HTML, no images, so they
// render everywhere and land in the primary tab more often than not. Each
// one carries the code, so it is in every message the person gets.
import transfers from '../../data/transfers.json' with { type: 'json' }
import offer from '../../data/offer.json' with { type: 'json' }

const SITE = 'https://mapltours.com'
const link = (path: string, content: string) => `${SITE}${path}${path.includes('?') ? '&' : '?'}utm_source=bio&utm_medium=email&utm_campaign=bio_coupon&utm_content=${content}`

const zones = transfers.zones as { code: string; label: string; duration: string; owMin: number; owMax: number; rtMin: number; count: number }[]
const cheapest = transfers.cheapestOneWay as number
const OFFER = offer.kind === 'percent' ? `${offer.value}%` : `$${offer.value}`

/** The public code, from data/offer.json: 5% off a tour or an airport ride, once per email address. */
export type CouponView = { code: string; label: string }
export const COUPON: CouponView = { code: offer.code, label: OFFER }

/** The inbox preview line: hidden in the body, read by the client before anything else. */
const preheader = (t: string) => `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${t}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`

const wrap = (title: string, body: string, preview = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head>
<body style="margin:0;background:#FAF9F7;font-family:'DM Sans',-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#171614;">
${preview ? preheader(preview) : ''}
<div style="max-width:600px;margin:0 auto;padding:28px 20px 40px;">
  <p style="margin:0 0 18px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#5A4A16;">MAPL Tours Jamaica</p>
  ${body}
  <hr style="border:0;border-top:1px solid rgba(23,22,20,.12);margin:32px 0 16px;">
  <p style="font-size:13px;line-height:1.6;color:#524F49;margin:0;">You asked for this code at bio.mapltours.com. Two short follow-ups come over the next two weeks and that is all. To stop them, reply with the word <b>stop</b> and we remove you the same day. MAPL Tours Jamaica, Montego Bay. <a href="${link('/privacy', 'footer')}" style="color:#12563A;">Privacy</a></p>
</div></body></html>`

const h1 = (t: string) => `<h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;letter-spacing:-.02em;">${t}</h1>`
const h2 = (t: string) => `<h2 style="margin:26px 0 8px;font-size:18px;line-height:1.25;">${t}</h2>`
const p = (t: string) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#2b2926;">${t}</p>`
const small = (t: string) => `<p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:#524F49;">${t}</p>`
const btn = (href: string, t: string) => `<p style="margin:22px 0 8px;"><a href="${href}" style="display:block;box-sizing:border-box;width:100%;max-width:320px;text-align:center;background:#C9A94E;color:#1A1508;font-weight:700;text-decoration:none;padding:15px 22px;border-radius:999px;font-size:16px;line-height:1.2;">${t}</a></p>`
const zoneRows = zones.map((z) => `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid rgba(23,22,20,.1);font-size:14px;"><b>${z.label}</b><br><span style="color:#524F49;">${z.duration}</span></td><td style="padding:8px 0;border-bottom:1px solid rgba(23,22,20,.1);font-size:14px;text-align:right;white-space:nowrap;">$${z.owMin}${z.owMax > z.owMin ? '+' : ''} one way<br><span style="color:#524F49;">$${z.rtMin}${z.owMax > z.owMin ? '+' : ''} round trip</span></td></tr>`).join('')

/** A 4:3 photo, hosted on the bio site (30-day cache). Copy stands without it. */
const BIO = 'https://bio.mapltours.com'
const photo = (file: string, alt: string) => `<img src="${BIO}/media/email/${file}" width="600" height="450" alt="${alt}" style="display:block;width:100%;max-width:600px;height:auto;aspect-ratio:4/3;border-radius:14px;margin:0 0 12px;">`

/** The code, big, with the two places it works. */
const couponBox = (c: CouponView) => `
<div style="border:2px dashed #C9A94E;border-radius:16px;padding:20px 18px 16px;margin:6px 0 18px;text-align:center;background:#FFFFFF;">
  <p style="margin:0 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:#5A4A16;">Your ${c.label} off code</p>
  <p style="margin:0 0 8px;font-size:30px;line-height:1.1;letter-spacing:.06em;font-weight:800;font-family:Menlo,Consolas,monospace;color:#171614;">${c.code}</p>
  <p style="margin:0;font-size:14px;line-height:1.5;color:#524F49;">${c.label} off one booking, an airport ride or a private tour. One use per email address. No expiry.</p>
</div>
${p(`<b>How it works:</b> book on mapltours.com. At checkout, type the code in the <b>Discount code</b> box and tap <b>Apply</b>. It comes off before you pay.`)}`

const couponLine = (c: CouponView, content: string, path = '/transfers') =>
  p(`Your ${c.label} code is <b style="font-family:Menlo,Consolas,monospace;letter-spacing:.04em;">${c.code}</b>. Type it in the Discount code box at <a href="${link(path, content)}" style="color:#12563A;">checkout</a> and it comes off before you pay. Rides or tours, your call.`)

/** The two things the code buys, each with its own button. Equal weight on purpose. */
const rideBlock = (content: string) => `
${h2('The ride from the airport')}
${photo('ride.jpg', 'The north coast road out of Montego Bay, sea on one side, hills on the other')}
${p('A private car from Sangster (MBJ) straight to your resort. One flat fare for up to 4 people, and you see it before you type a thing. Your driver is waiting at arrivals with your name on a sign, flight tracked, so a late landing is still met.')}
${btn(link('/transfers', content), 'Price my ride')}
${small('Every fare is the full price, nothing added at the airport.')}`

const tourBlock = (content: string) => `
${h2('A day off the resort')}
${photo('tour.jpg', 'Rick’s Cafe in Negril at sunset, the pool and the cliff bar full of people')}
${p('The Dunn’s River Falls climb. Rick’s Cafe at sunset. Nine Mile. Bamboo rafting on the Martha Brae. Every tour is private, picks you up at your hotel, and has one price for your group, so a couple and a family of three pay the same.')}
${btn(link('/explore', content), 'Choose my tour')}
${small('Nobody else joins your car. Your driver, your day.')}`

const reply = () => `<hr style="border:0;border-top:1px solid rgba(23,22,20,.12);margin:26px 0 16px;">${p('Not sure which one? Reply with your resort and your dates and a person answers, usually the same day.')}`

export const codeEmail = (c: CouponView) => ({
  subject: `Your ${c.label} code: ${c.code}, for the ride or a tour`,
  html: wrap('Your code', `
${h1(`${c.label} off your airport ride or a tour. Here is your code.`)}
${couponBox(c)}
${rideBlock('code_ride')}
${tourBlock('code_tour')}
${reply()}
`, `${c.code}: ${c.label} off your ride from MBJ or a private tour. One use, no expiry.`),
})

export const followup1 = (c: CouponView) => ({
  subject: `Your ${c.code} code is still waiting`,
  html: wrap('Your code is still waiting', `
${h1('Ride or tour, the 5% is yours either way.')}
${p('Use it on the ride, since that is the first thing to book, or save it for the one day you leave the resort. Both are private, and both are priced before you enter any details.')}
${couponBox(c)}
${rideBlock('followup1_ride')}
${tourBlock('followup1_tour')}
${reply()}
`, `${c.code} still takes ${c.label} off an airport ride or a tour. Both private, both priced before you book.`),
})

export const followup2 = (c: CouponView) => ({
  subject: 'How far is your resort from Montego Bay airport?',
  html: wrap('How far is your resort from Montego Bay airport?', `
${h1('Two numbers to know before you land.')}
${p('The drive time from the airport to your resort, and what the ride costs. Both depend only on which stretch of coast your resort is on.')}
<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:6px 0 4px;">${zoneRows}</table>
${p('One price for up to 4 people, private, never shared, and the driver meets you at arrivals with your name on a sign. Round trips are priced together and cost less than two one-ways.')}
${small(`Exact fares for all ${transfers.destinations.length} resorts are on the booking page, shown before you enter any details. From $${cheapest} one way.`)}
${btn(link('/transfers', 'followup2_book'), 'See my resort’s exact fare')}
${couponLine(c, 'followup2_code')}
${p(`If you would rather spend it on a day out, the same code works on any tour: <a href="${link('/explore', 'followup2_tours')}" style="color:#12563A;">see the tours and prices</a>.`)}
${p('If your resort is not on the list, reply with its name and we price it by email.')}
`, 'Drive time and fare for every stretch of the north coast, and your code still works on the ride.'),
})
