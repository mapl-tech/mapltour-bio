// The three emails the coupon capture sends. Plain HTML, no images, so they
// render everywhere and land in the primary tab more often than not. Each
// one carries the code, so it is in every message the person gets.
import offer from '../../data/offer.json' with { type: 'json' }

const SITE = 'https://mapltours.com'
const link = (path: string, content: string) => `${SITE}${path}${path.includes('?') ? '&' : '?'}utm_source=bio&utm_medium=email&utm_campaign=bio_coupon&utm_content=${content}`

const OFFER = offer.kind === 'percent' ? `${offer.value}%` : `$${offer.value}`

/** The public code, from data/offer.json: 5% off a tour or an airport ride, once per email address. */
export type CouponView = { code: string; label: string }
export const COUPON: CouponView = { code: offer.code, label: OFFER }

/** The inbox preview line: hidden in the body, read by the client before anything else. */
const preheader = (t: string) => `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${t}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`

const wrap = (title: string, body: string, preview = '', site = 'bio.mapltours.com') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head>
<body style="margin:0;background:#FAF9F7;font-family:'DM Sans',-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#171614;">
${preview ? preheader(preview) : ''}
<div style="max-width:600px;margin:0 auto;padding:28px 20px 40px;">
  <p style="margin:0 0 18px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#5A4A16;">MAPL Tours Jamaica</p>
  ${body}
  <hr style="border:0;border-top:1px solid rgba(23,22,20,.12);margin:32px 0 16px;">
  <p style="font-size:13px;line-height:1.6;color:#524F49;margin:0;">You asked for this code at ${site}, and this is the only email about it. To hear nothing more from us, reply with the word <b>stop</b> and we remove you the same day. MAPL Tours Jamaica, Montego Bay. <a href="${link('/privacy', 'footer')}" style="color:#12563A;">Privacy</a></p>
</div></body></html>`

const h1 = (t: string) => `<h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;letter-spacing:-.02em;">${t}</h1>`
const h2 = (t: string) => `<h2 style="margin:26px 0 8px;font-size:18px;line-height:1.25;">${t}</h2>`
const p = (t: string) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#2b2926;">${t}</p>`
const small = (t: string) => `<p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:#524F49;">${t}</p>`
const btn = (href: string, t: string) => `<p style="margin:22px 0 8px;"><a href="${href}" style="display:block;box-sizing:border-box;width:100%;max-width:320px;text-align:center;background:#A58326;color:#FFFFFF;font-weight:700;text-decoration:none;padding:14px 22px;border-radius:999px;font-size:19px;line-height:1.2;">${t}</a></p>`

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

/** `site` is the host the guest typed the address on: the bio page by default, mapltours.com for its popup. */
export const codeEmail = (c: CouponView, site = 'bio.mapltours.com') => ({
  subject: `Your ${c.label} code: ${c.code}, for the ride or a tour`,
  html: wrap('Your code', `
${h1(`${c.label} off your airport ride or a tour. Here is your code.`)}
${couponBox(c)}
${rideBlock('code_ride')}
${tourBlock('code_tour')}
${reply()}
`, `${c.code}: ${c.label} off your ride from MBJ or a private tour. One use, no expiry.`, site),
})
