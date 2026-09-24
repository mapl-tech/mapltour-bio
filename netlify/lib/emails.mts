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
const preheader = (t: string) => `<div style="display:none;mso-hide:all;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${t}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`

/** A rule in solid hex: Word-engine Outlook drops rgba colours. */
const RULE = `<hr style="border:0;border-top:1px solid #DFDEDC;margin:32px 0 16px;">`

// x-apple-disable-message-reformatting and text-size-adjust stop Apple Mail
// and iOS from rescaling the 16px body text.
const wrap = (title: string, body: string, preview: string, footer: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${title}</title></head>
<body style="margin:0;background:#FAF9F7;font-family:'DM Sans',-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#171614;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${preview ? preheader(preview) : ''}
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<div role="article" aria-roledescription="email" aria-label="${title}" lang="en" style="max-width:600px;margin:0 auto;padding:32px 20px 40px;">
  <p style="margin:0 0 16px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#5A4A16;">MAPL Tours Jamaica</p>
  ${body}
  ${RULE}
  ${footer}
</div>
<!--[if mso]></td></tr></table><![endif]-->
</body></html>`

const h1 = (t: string) => `<h1 style="margin:0 0 16px;font-size:26px;line-height:1.15;letter-spacing:-.02em;">${t}</h1>`
const h2 = (t: string) => `<h2 style="margin:32px 0 8px;font-size:18px;line-height:1.25;">${t}</h2>`
const p = (t: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#2b2926;">${t}</p>`
const small = (t: string) => `<p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#524F49;">${t}</p>`
/**
 * A pill that survives Outlook: the cell carries the colour or the outline
 * (and, in Outlook only, the padding); everywhere else the whole pill is the
 * link. 'solid' is the gold primary; 'quiet' is the green outline for a
 * secondary action, so a card never out-shouts the gold buttons.
 */
const pill = (href: string, t: string, kind: 'solid' | 'quiet' = 'solid', margin = kind === 'solid' ? '24px 0 8px' : '0 0 16px') => {
  const solid = kind === 'solid'
  const cell = solid ? 'bgcolor="#A58326" style="background:#A58326;border-radius:999px;mso-padding-alt:16px 24px;"' : 'style="border:2px solid #12563A;border-radius:999px;mso-padding-alt:12px 24px;"'
  const a = solid ? 'padding:16px 24px;color:#FFFFFF;font-size:19px;' : 'padding:12px 24px;color:#12563A;font-size:17px;'
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${margin};width:100%;max-width:320px;border-collapse:separate;"><tr><td align="center" ${cell}><a href="${href}" style="display:block;${a}font-weight:700;text-decoration:none;line-height:1.2;border-radius:999px;">${t}</a></td></tr></table>`
}
const btn = (href: string, t: string) => pill(href, t)

const btnQuiet = (href: string, t: string, margin?: string) => pill(href, t, 'quiet', margin)

/** The small bold text link: its own line, 12px above and below, so it is a 46px-tall target. */
const textLink = (href: string, t: string) => `<a href="${href}" style="display:inline-block;padding:12px 0;color:#12563A;font-weight:700;">${t}</a>`

/**
 * A box that keeps its inner spacing in Outlook: a one-cell table whose cell
 * carries the fill, the border and the padding (Word-engine Outlook drops
 * padding on a div). Borders are solid hex because Outlook drops rgba.
 */
const box = (bg: string, cell: string, margin: string, inner: string, align = 'left') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:${margin};border-collapse:separate;"><tr><td align="${align}" bgcolor="${bg}" style="background:${bg};border-radius:16px;${cell}">${inner}</td></tr></table>`

/**
 * A photo hosted on the bio site (30-day cache), 4:3 unless told otherwise.
 * Copy stands without it. `w` is the width Outlook draws it at: 600 for the
 * column, less inside a box so it stays within the box's padding.
 */
const BIO = 'https://bio.mapltours.com'
const photo = (file: string, alt: string, h = 450, w = 600) => `<img src="${BIO}/media/email/${file}" width="${w}" height="${h}" alt="${alt}" style="display:block;width:100%;max-width:${w}px;height:auto;aspect-ratio:${w}/${h};border-radius:14px;margin:0 0 16px;">`

/** The code, big, with the two places it works. */
const couponBox = (c: CouponView) => `
${box('#FFFFFF', 'border:2px dashed #C9A94E;padding:24px 16px 16px;', '8px 0 16px', `
  <p style="margin:0 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:#5A4A16;">Your ${c.label} off code</p>
  <p style="margin:0 0 8px;font-size:30px;line-height:1.1;letter-spacing:.06em;font-weight:800;font-family:Menlo,Consolas,monospace;color:#171614;">${c.code}</p>
  <p style="margin:0;font-size:14px;line-height:1.5;color:#524F49;">${c.label} off one booking, an airport ride or a private tour. One use per email address. No expiry.</p>
`, 'center')}
${p(`<b>How it works:</b> book on mapltours.com. At checkout, type the code in the <b>Discount code</b> box and tap <b>Apply</b>. It comes off before you pay.`)}`

/**
 * The Martha Brae raft giveaway. Every code email sent while entries are
 * open is an entry (rules: mapltours.com/giveaway). Entries close at
 * 11:59 pm Eastern on Nov 30 2026 (EST, so 05:00Z on Dec 1); from then the
 * block and the footer line drop out by themselves, so a late request is
 * never told it is in a draw that has closed. The lead function tags the
 * HubSpot contact mapl_giveaway with the id, and the Dec 1 draw picks from
 * those contacts.
 */
export const GIVEAWAY = {
  id: 'martha-brae-2026',
  opens: Date.parse('2026-09-24T04:00:00Z'),
  closes: Date.parse('2026-12-01T05:00:00Z'),
} as const
export const giveawayOpen = (now = Date.now()) => now >= GIVEAWAY.opens && now < GIVEAWAY.closes

// Between the ride and the tours on purpose: above both, it pushed the first
// button from 851px to 1,508px down a phone; here the ride button keeps its
// place and the draw lands just before the tour list, where "Book it now"
// for the raft makes the most sense.
const giveawayBlock = () => `
${box('#EEF4EE', 'border:1px solid #C6D8CE;padding:16px 16px 4px;', '32px 0 0', `
  <h2 style="margin:0 0 8px;font-size:18px;line-height:1.25;">You’re in the draw for a&nbsp;raft&nbsp;for&nbsp;two</h2>
  ${photo('raft.jpg', 'On a bamboo raft on the Martha Brae, the captain poling ahead past the raft village umbrellas', 319, 566)}
  ${p('One winner gets a private bamboo raft for two on the Martha Brae: three slow miles of green river, a captain poling you down, and a car to and from your hotel. We draw on <b>December 1</b> and email the winner that day. Asking for the code was your entry, so there is nothing more to do.')}
  ${p('Planning to raft anyway? Book now, and if you win, we refund your raft, up to US$128.')}
  ${btnQuiet(link('/experience/bamboo-rafting-on-the-martha-brae', 'code_giveaway_raft'), 'Book my raft')}
  <p style="margin:0;font-size:14px;line-height:1.55;color:#524F49;">No purchase needed, and booking does not change your odds. Open to adults in Canada (outside Quebec), the US and the UK.<br>${textLink(link('/giveaway', 'code_giveaway_rules'), 'Read the full rules')}</p>
`)}`

/** The two things the code buys, each with its own button. Equal weight on purpose. */
const rideBlock = (content: string) => `
${h2('The ride from the airport')}
${photo('ride.jpg', 'The north coast road out of Montego Bay, sea on one side, hills on the other')}
${p('A private car from Sangster (MBJ) straight to your resort. One flat fare for up to 4 people, bigger groups welcome, and you see the price before you type a thing. Your driver is waiting at arrivals with your name on a sign, flight tracked, so a late landing is still met.')}
${btn(link('/transfers', content), 'Price my ride')}
${small('Every fare is the full price, nothing added at the airport.')}`

const tourBlock = (content: string) => `
${h2('A day off the resort')}
${photo('tour.jpg', 'Rick’s Cafe in Negril at sunset, the pool and the cliff bar full of people')}
${p('The Dunn’s River Falls climb. Rick’s Cafe at sunset. Nine Mile. Bamboo rafting on the Martha Brae. Every tour is private, picks you up at your hotel, and has one price for your group, so a couple and a family of three pay the same.')}
${btn(link('/explore', content), 'Choose my tour')}
${small('Nobody else joins your car. Your driver, your day.')}`

const reply = () => `${RULE}${p('Not sure which one? Reply with your resort and your dates and a person answers, usually the same day.')}`

/** A URL inside an href: the &s escaped, as HTML wants. */
const attr = (u: string) => u.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/**
 * Trip tips for someone who did not tick the box (or could not: the box
 * starts unticked outside the US). One quiet ask after the tours; the pill
 * opens the signed confirm page, which records nothing until they tap again.
 */
const tipsCard = (yesUrl: string) => `
${box('#F3F2EF', 'border:1px solid #DDDCD9;padding:16px;', '32px 0 0', `
  <h2 style="margin:0 0 8px;font-size:18px;line-height:1.25;">Trip tips before you fly?</h2>
  ${p('About twice a month: what the ride from MBJ costs, the tours people book most, and what to know the week before you go.')}
  ${btnQuiet(attr(yesUrl), 'Yes, send me trip tips', '0 0 8px')}
  <p style="margin:0;font-size:14px;line-height:1.55;color:#524F49;">One more tap on the next page confirms it. Unsubscribe anytime.</p>
`)}`

/**
 * Whether this address validly asked for trip tips (lib/tips.mts), and the
 * signed links for it. A missing link (no TIPS_SECRET on the site) drops
 * the card or the stop line; the email never carries a link that fails.
 */
export type TipsView = { on: boolean; yesUrl?: string; stopUrl?: string }

const footer = (site: string, draw: boolean, tips: TipsView) => {
  const small14 = 'font-size:14px;line-height:1.6;color:#524F49;margin:0;'
  // No promise about future emails here (owner, Sept 24 2026): the "only
  // email" and "we write once more" lines are gone. Whether someone gets
  // trip tips is decided by the recorded consent, not by this sentence.
  void draw
  const why = tips.on
    ? `You asked for this code and for trip tips at ${site}. Tips come about twice a month, and every one has a one-tap unsubscribe.`
    : `You asked for this code at ${site}.`
  const stop = tips.on && tips.stopUrl
    ? `<p style="${small14}margin-top:8px;">Not you, or changed your mind? ${textLink(attr(tips.stopUrl), 'Stop trip tips')}</p>`
    : ''
  return `<p style="${small14}">${why} To hear nothing more from us, reply with the word <b>stop</b> and we remove you the same day. MAPL Tours Jamaica, Montego Bay.<br>${textLink(link('/privacy', 'footer'), 'Privacy')}</p>${stop}`
}

/**
 * `site` is the host the guest typed the address on: the bio page by default,
 * mapltours.com for its popup. `tips` defaults to "did not ask, no links".
 */
export const codeEmail = (c: CouponView, site = 'bio.mapltours.com', now = Date.now(), tips: TipsView = { on: false }) => {
  const draw = giveawayOpen(now)
  return {
    subject: draw ? `Your ${c.label} code: ${c.code}. You’re in the raft draw too.` : `Your ${c.label} code: ${c.code}, for the ride or a tour`,
    html: wrap(`Your ${c.label} code from MAPL Tours Jamaica`, `
${h1(`${c.label} off your airport ride or a tour. Here is your code.`)}
${couponBox(c)}
${rideBlock('code_ride')}
${draw ? giveawayBlock() : ''}
${tourBlock('code_tour')}
${!tips.on && tips.yesUrl ? tipsCard(tips.yesUrl) : ''}
${reply()}
`, draw
      ? `${c.label} off your ride from MBJ or a private tour. Plus a private raft for two on the Martha Brae, drawn December 1.`
      : `${c.code}: ${c.label} off your ride from MBJ or a private tour. One use, no expiry.`, footer(site, draw, tips)),
  }
}
