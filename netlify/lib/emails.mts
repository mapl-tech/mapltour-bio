// The three emails the coupon capture sends. Plain HTML, no images, so they
// render everywhere and land in the primary tab more often than not. Each
// one takes the coupon (or null when it could not be issued) so the code is
// in every message the person gets.
import transfers from '../../data/transfers.json' with { type: 'json' }
import offer from '../../data/offer.json' with { type: 'json' }

const SITE = 'https://mapltours.com'
const link = (path: string, content: string) => `${SITE}${path}${path.includes('?') ? '&' : '?'}utm_source=bio&utm_medium=email&utm_campaign=bio_coupon&utm_content=${content}`

const zones = transfers.zones as { code: string; label: string; duration: string; owMin: number; owMax: number; rtMin: number; count: number }[]
const cheapest = transfers.cheapestOneWay as number
const OFFER = offer.kind === 'percent' ? `${offer.value}%` : `$${offer.value}`

/** What the lead function hands over once the code is issued. */
export type CouponView = { code: string; label: string; until: string; spent: boolean }

const wrap = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head>
<body style="margin:0;background:#FAF9F7;font-family:'DM Sans',-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#171614;">
<div style="max-width:600px;margin:0 auto;padding:28px 20px 40px;">
  <p style="margin:0 0 18px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#5A4A16;">MAPL Tours Jamaica</p>
  ${body}
  <hr style="border:0;border-top:1px solid rgba(23,22,20,.12);margin:32px 0 16px;">
  <p style="font-size:12px;line-height:1.6;color:#524F49;margin:0;">You asked for this code at bio.mapltours.com. Two short follow-ups come over the next two weeks and that is all. To stop them, reply with the word <b>stop</b> and we remove you the same day. MAPL Tours Jamaica, Montego Bay. <a href="${link('/privacy', 'footer')}" style="color:#12563A;">Privacy</a></p>
</div></body></html>`

const h1 = (t: string) => `<h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;letter-spacing:-.02em;">${t}</h1>`
const h2 = (t: string) => `<h2 style="margin:26px 0 8px;font-size:18px;line-height:1.25;">${t}</h2>`
const p = (t: string) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#2b2926;">${t}</p>`
const small = (t: string) => `<p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:#524F49;">${t}</p>`
const btn = (href: string, t: string) => `<p style="margin:22px 0 8px;"><a href="${href}" style="display:inline-block;background:#C9A94E;color:#1A1508;font-weight:700;text-decoration:none;padding:14px 22px;border-radius:999px;font-size:16px;">${t}</a></p>`
const zoneRows = zones.map((z) => `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid rgba(23,22,20,.1);font-size:14px;"><b>${z.label}</b><br><span style="color:#524F49;">${z.duration}</span></td><td style="padding:8px 0;border-bottom:1px solid rgba(23,22,20,.1);font-size:14px;text-align:right;white-space:nowrap;">$${z.owMin}${z.owMax > z.owMin ? '+' : ''} one way<br><span style="color:#524F49;">$${z.rtMin}${z.owMax > z.owMin ? '+' : ''} round trip</span></td></tr>`).join('')

/** The code, big, with the three taps that redeem it. */
const couponBox = (c: CouponView) => `
<div style="border:2px dashed #C9A94E;border-radius:16px;padding:20px 18px 16px;margin:6px 0 18px;text-align:center;background:#FFFFFF;">
  <p style="margin:0 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:#5A4A16;">Your ${c.label} off code</p>
  <p style="margin:0 0 8px;font-size:30px;line-height:1.1;letter-spacing:.06em;font-weight:800;font-family:Menlo,Consolas,monospace;color:#171614;">${c.code}</p>
  <p style="margin:0;font-size:14px;line-height:1.5;color:#524F49;">${c.label} off your first tour. Valid until ${c.until}. One use, one per person, tours only.</p>
</div>
${p(`<b>How to use it:</b> pick a tour at <a href="${link('/explore', 'coupon_tours')}" style="color:#12563A;">mapltours.com/explore</a>. At checkout tap <b>Have a code?</b>, paste it and tap <b>Apply</b>. The discount comes off before you pay.`)}`

const couponLine = (c: CouponView | null, content: string) => {
  if (!c) return ''
  if (c.spent) return small(`Your ${c.label} code ${c.code} has already been used.`)
  return p(`Your ${c.label} tour code is <b style="font-family:Menlo,Consolas,monospace;letter-spacing:.04em;">${c.code}</b>, valid until ${c.until}. Paste it under <b>Have a code?</b> at <a href="${link('/explore', content)}" style="color:#12563A;">checkout</a>.`)
}

const couponMissing = () => p(`We could not issue your ${OFFER} code just now. Reply to this email and we send it by hand, usually the same day.`)

const tours = `
${h2('Where people spend it')}
${p('The Dunn’s River Falls climb, Rick’s Cafe at sunset in Negril, Bob Marley’s Nine Mile, bamboo rafting on the Martha Brae. Every MAPL tour is private, picks you up at your hotel, and has one price for your group.')}
${btn(link('/explore', 'code_tours'), 'See the tours and prices')}`

export const codeEmail = (c: CouponView | null) => ({
  subject: c && !c.spent ? `Your ${c.label} off code for a MAPL tour` : 'Your MAPL Tours Jamaica code',
  html: wrap('Your code', `
${c && !c.spent ? h1(`${c.label} off your first tour. Here is your code.`) + couponBox(c) : h1('Your MAPL Tours Jamaica code.') + (c ? couponLine(c, 'code_used') : couponMissing())}
${tours}
${p('No problem.')}
`),
})

export const followup1 = (c: CouponView | null) => ({
  subject: c && !c.spent ? `Your ${c.label} code is still waiting` : 'One day off the resort, done properly',
  html: wrap('One day off the resort', `
${h1('One day off the resort, done properly.')}
${p('Most guests do one thing away from the resort. The ones people come back talking about: the Dunn’s River Falls climb, Rick’s Cafe at sunset, Nine Mile, and bamboo rafting on the Martha Brae.')}
${p('Every MAPL tour is private, picks you up at your hotel, and has one price for your group, so a couple and a family of three pay the same.')}
${c && !c.spent ? couponBox(c) : couponLine(c, 'followup1_code')}
${btn(link('/explore', 'followup1_tours'), 'Choose a tour')}
${p('No problem.')}
`),
})

export const followup2 = (c: CouponView | null) => ({
  subject: 'How far is your resort from Montego Bay airport?',
  html: wrap('How far is your resort from Montego Bay airport?', `
${h1('Two numbers to know before you land.')}
${p('The drive time from the airport to your resort, and what the ride costs. Both depend only on which stretch of coast your resort is on.')}
<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:6px 0 4px;">${zoneRows}</table>
${p('One price for up to 4 people, private, never shared, and the driver meets you at arrivals with your name on a sign. Round trips are priced together and cost less than two one-ways.')}
${small(`Exact fares for all ${transfers.destinations.length} resorts are on the booking page, shown before you enter any details. From $${cheapest} one way.`)}
${btn(link('/transfers', 'followup2_book'), 'See my resort’s exact fare')}
${couponLine(c, 'followup2_code')}
${p('If your resort is not on the list, reply with its name and we price it by email.')}
`),
})
