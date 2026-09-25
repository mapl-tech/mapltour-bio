// The trip tips welcome series: the two emails the "Trip tips welcome"
// automation in Resend sends (scripts/tips-automation.mts turns these into
// published Resend templates). Same visual system as the code email
// (emails.mts): FAF9F7 page, 600px column, DM Sans stack, gold pill buttons,
// 16px body text, photos hosted on the bio site.
//
// These are Resend TEMPLATES, not emails sent from code: Resend fills in
// {{{RESEND_UNSUBSCRIBE_URL}}} at send time, and an automation's send_email
// step adds no unsubscribe link of its own, so the placeholder must be in
// the HTML itself. Nothing else in the HTML may contain "{{".
//
// Fares and tour prices come from data/*.json, the same export the bio page
// shows, so the email never states a number the site does not. A template
// is a snapshot: after re-exporting the data, re-run
// scripts/tips-automation.mts so Resend sends the new numbers.
//
// Pictures (owner, Sept 24 2026: "make sure the automations include
// pictures"): tip 1 opens with ride.jpg, the coast road; tip 2 has one photo
// at the top of each tour card, from public/media/email/tours/ (800x450,
// cropped from the site's own tour photos). The owner's Sept 24 no-people
// rule was given for ad creatives; these card photos were chosen for this
// ask and show the captain, guests at the Blue Hole and, small, the crowd at
// Rick's Cafe, as the code email's raft and Rick's Cafe photos do.
// Every photo is an https URL on the bio site with width, height and alt,
// and the copy stands without it (images off, or blocked until tapped).
import transfers from '../../data/transfers.json' with { type: 'json' }
import tours from '../../data/tours.json' with { type: 'json' }
import { COUPON, attr, box, btn, btnQuiet, h1, h2, p, small, textLink, wrap } from './emails.mts'

/**
 * The postal address marketing email must carry (CAN-SPAM, CASL): the
 * mailing address line as it should print, e.g. "12 Example Street, Montego
 * Bay, St. James, Jamaica". The owner has not supplied it yet (Sept 24
 * 2026). While it is null the footer says only "MAPL Tours Jamaica, Montego
 * Bay." and scripts/tips-automation.mts refuses --enable, so the automation
 * stays disabled and nothing is sent.
 */
export const POSTAL_ADDRESS: string | null = null

/** Resend's per-recipient unsubscribe link, written literally into the template. */
export const UNSUBSCRIBE_PLACEHOLDER = '{{{RESEND_UNSUBSCRIBE_URL}}}'

const SITE = 'https://mapltours.com'
/** Every link: mapltours.com, attributed to the bio's trip tips emails. `content` names the email and the button. */
const link = (path: string, content: string) => attr(`${SITE}${path}?utm_source=bio&utm_medium=email&utm_campaign=trip_tips&utm_content=${content}`)

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Tip 1's photo: what it shows, not where (the location is not known). */
const ROAD = 'A coast road seen from above, one car on it, white surf on one side and green hills on the other'

/**
 * A photo that is also a link, in the code email's photo style (emails.mts
 * `photo`: width and height attributes for Outlook, fluid with a CSS
 * aspect-ratio everywhere else, 14px corners, display:block, 16px below).
 * The picture is the biggest thing on the screen, so a tap on it goes where
 * the nearest button goes. `alt` names where the link goes (the button's
 * words), then says what the photo shows. border="0" stops old clients
 * outlining a linked image. `ratio` is the file's own (ride.jpg is 900x675,
 * the tour photos 800x450).
 */
const BIO = 'https://bio.mapltours.com'
const linkedPhoto = (href: string, file: string, alt: string, w: number, h: number, ratio: string) =>
  `<a href="${href}" style="display:block;text-decoration:none;"><img src="${BIO}/media/email/${file}" width="${w}" height="${h}" alt="${alt}" border="0" style="display:block;width:100%;max-width:${w}px;height:auto;aspect-ratio:${ratio};border:0;border-radius:14px;margin:0 0 16px;"></a>`

/**
 * A tour photo at the top of its card. Drawn 566 wide in Outlook, the card's
 * inner width in the 600px column (600 less 16px padding and a 1px border
 * each side); 16/9 everywhere else, exactly the 800x450 file.
 */
const cardPhoto = (href: string, file: string, alt: string) => linkedPhoto(href, `tours/${file}`, alt, 566, 318, '16/9')

/**
 * Both emails end the same way: a person to write to, and a line for anyone
 * who already booked. No rule of its own: the footer's rule follows, and two
 * rules around one paragraph read as two endings. What comes before it
 * carries the 32px above it.
 */
const closing = () => p('Reply with your resort and dates and we’ll plan it with you. Booked already? You’re&nbsp;set.')

/**
 * Why they get it, the one-tap unsubscribe (Resend's, which sets the
 * contact's global unsubscribed flag, so the rest of the series is skipped
 * too), the address, and the privacy link, as in the code email.
 */
const footer = (tip: string, address: string | null) => {
  const s = 'font-size:14px;line-height:1.6;color:#524F49;margin:0;'
  const where = address ? `MAPL Tours Jamaica<br>${esc(address.trim()).replace(/\r?\n/g, '<br>')}` : 'MAPL Tours Jamaica, Montego Bay.'
  return `<p style="${s}">You asked for trip tips from MAPL Tours Jamaica. Changed your mind? ${textLink(UNSUBSCRIBE_PLACEHOLDER, 'Unsubscribe')}</p>
<p style="${s}margin-top:8px;">${where}<br>${textLink(link('/privacy', `${tip}_privacy`), 'Privacy')}</p>`
}

export type TipEmail = { subject: string; html: string }
export type TipOptions = { postalAddress?: string | null }

const addressOf = (o: TipOptions) => (o.postalAddress === undefined ? POSTAL_ADDRESS : o.postalAddress)

/** The cheapest and the dearest one-way fare in any zone: the preheader's range. */
export const RIDE_FROM = Math.min(...transfers.zones.map((z) => z.owMin))
export const RIDE_TO = Math.max(...transfers.zones.map((z) => z.owMax))

/**
 * A zone's one-way fares as the rate card has them: "$75" when every
 * property in it costs the same, "$99–$111" when they differ (an en dash, a
 * range, never an em dash). The whole range, not just the floor: "from $99"
 * under "Negril & Runaway Bay" is the Runaway Bay price, and Negril is $111.
 */
export const zoneFare = (z: { owMin: number; owMax: number }) => (z.owMin === z.owMax ? `$${z.owMin}` : `$${z.owMin}–$${z.owMax}`)

/** Binds the last two words, so a 320px phone never leaves one alone on a line. */
const bindLast = (s: string) => s.replace(/ (\S+)$/, '&nbsp;$1')

const cell = 'padding:8px 0;font-size:16px;line-height:1.5;color:#2b2926;'
const priceCell = 'padding:8px 0 8px 16px;font-size:16px;line-height:1.5;font-weight:700;color:#171614;white-space:nowrap;text-align:right;'
const headCell = 'padding:8px 0;font-size:14px;line-height:1.5;font-weight:700;color:#524F49;'

/**
 * What the ride costs, zone by zone, nearest first: the tip the opt-in
 * promised ("what the ride from MBJ costs"). A real table (header cells, one
 * row per zone) inside the code email's white box, so it reads as data to a
 * screen reader and survives Outlook.
 */
const fareTable = () => box('#FFFFFF', 'border:1px solid #DFDEDC;padding:8px 16px;', '0 0 16px', `
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
<tr><th scope="col" align="left" style="${headCell}text-align:left;">Where you’re staying</th><th scope="col" align="right" style="${headCell}padding-left:16px;white-space:nowrap;text-align:right;">One way</th></tr>
${transfers.zones.map((z) => `<tr><td style="${cell}border-top:1px solid #DFDEDC;">${bindLast(esc(z.label))}<br><span style="font-size:14px;color:#524F49;">${esc(z.duration.replace(/ from MBJ$/, ''))}</span></td><td align="right" style="${priceCell}border-top:1px solid #DFDEDC;">${zoneFare(z)}</td></tr>`).join('\n')}
</table>`)

/**
 * Tip 1, two days after the yes (unless they book first): what the ride from
 * MBJ costs, and how it works. The coast road opens it, under the headline
 * and the one-line promise and above the fares, so a phone's first screen
 * holds a picture.
 */
export function tip1(o: TipOptions = {}): TipEmail {
  const subject = 'What your ride from MBJ costs'
  return {
    subject,
    html: wrap(subject, `
${h1('What your ride from MBJ&nbsp;costs')}
${p('One flat fare per vehicle for up to 4 people, bigger groups welcome. You see it before you book, and nothing is added at the airport.')}
${linkedPhoto(link('/transfers', 'tip1_ride_photo'), 'ride.jpg', `Price my ride. ${ROAD}`, 600, 450, '4/3')}
${fareTable()}
${small(`Round trips cost ${Math.round(transfers.roundTripDiscount * 100)}% less than <span style="white-space:nowrap;">two one-ways</span>.`)}
${btn(link('/transfers', 'tip1_ride'), 'Price my ride')}
${small(`Pick your resort for its exact fare. No account needed, and ${COUPON.code} takes ${COUPON.label} off at checkout.`)}
${h2('Three things to know before you&nbsp;land')}
${p('<b>Look for your name.</b> Past immigration and customs, your driver waits just outside the arrivals doors with your name on a sign. Not there within ten minutes? Contact us with the details in your confirmation email.')}
${p('<b>Land late, still met.</b> Book with your flight number and we track the flight. A delay moves the pickup with it, and there is no surcharge if you land late.')}
${p('<b>Know who is coming.</b> Your driver’s name, vehicle, plate and WhatsApp number reach you before pickup: the evening before a morning landing, that morning for an afternoon one.')}
${btnQuiet(link('/transfers', 'tip1_ride_end'), 'Price my ride', '8px 0 32px')}
${closing()}
`, `One flat fare per vehicle, $${RIDE_FROM} to $${RIDE_TO} one way depending on where you’re staying. Your driver waits at arrivals with your name on a sign.`, footer('tip1', addressOf(o))),
  }
}

type Tour = (typeof tours.tours)[number]
/** A tour from the export by slug. Throws, so a renamed tour stops the build instead of sending a dead link. */
const tourData = (slug: string): Tour => {
  const t = tours.tours.find((x) => x.slug === slug)
  if (!t) throw new Error(`tip-emails: no tour "${slug}" in data/tours.json`)
  return t
}

/** "1.5 hrs · From $128 for up to 3 people", from the export, as the tour page states it. */
export const tourFacts = (slug: string) => {
  const t = tourData(slug)
  return `${esc(t.duration)} · <b style="color:#171614;">From $${t.price}</b> for ${esc(t.unit)}`
}

/**
 * One tour card in tip 2. `title` is the tour page's own title (typographic
 * apostrophes, last two words bound so a phone never leaves one alone on a
 * line) and `where` starts with the page's destination; the tests hold both
 * to data/tours.json. `short` names it in the preheader; `content` is the
 * button's utm_content. `photo` is a file in public/media/email/tours/ and
 * `alt` says what it shows, naming the place only as the site does.
 */
type TipTour = { where: string; title: string; short: string; slug: string; body: string; content: string; button: string; photo: string; alt: string }

/** The three tours in tip 2, one near each resort area, in the order they appear. */
const TIP2_TOURS: readonly TipTour[] = [
  { where: 'Falmouth, near Montego Bay', title: 'Bamboo Rafting on the Martha&nbsp;Brae', short: 'Martha Brae rafting', slug: 'bamboo-rafting-on-the-martha-brae', body: 'Float three slow miles down the Martha Brae on a <span style="white-space:nowrap;">30-foot</span> bamboo raft, poled by a licensed captain. Your ride and the raft village entry are included.', content: 'tip2_martha_brae', button: 'See the Martha Brae', photo: 'martha-brae.jpg', alt: 'A captain poling a bamboo raft on the Martha Brae, past the raft village umbrellas' },
  { where: 'Negril', title: 'Rick’s Cafe Cliff Diving &amp;&nbsp;Sunset', short: 'Rick’s Cafe', slug: 'ricks-cafe-cliff-diving-and-sunset', body: 'Jump from the cliffs if you dare, or hold a drink and watch the divers while the sun drops into the sea. Your ride and entry are included.', content: 'tip2_ricks_cafe', button: 'See Rick’s Cafe', photo: 'ricks-cafe.jpg', alt: 'Rick’s Cafe at sunset: a thatched shelter on the rocks above the sea, red umbrellas and a crowd to the right' },
  { where: 'Ocho Rios', title: 'Dunn’s River + Blue&nbsp;Hole', short: 'Dunn’s River', slug: 'dunns-river-blue-hole', body: 'Climb Dunn’s River in the morning and jump the Blue Hole in the afternoon, with a licensed guide at each falls. Your ride and both entries are included.', content: 'tip2_dunns_river', button: 'See Dunn’s River', photo: 'blue-hole.jpg', alt: 'Guests wading across the top of a waterfall at the Blue Hole, water spilling over the rocks to the right' },
]

/**
 * The preheader's prices: every tour's own "from", cheapest first, never one
 * floor for all three (the cheapest is a Montego Bay area price; Negril's
 * starts at twice that).
 */
export const tourPrices = () => [...TIP2_TOURS].sort((a, b) => tourData(a.slug).price - tourData(b.slug).price).map((t) => `${t.short} from $${tourData(t.slug).price}`)

/**
 * One tour in its own white card: its photo, where it is, the site's own
 * title, the duration and price for the group, what the day is, and its
 * page. The card (common region) keeps each tour, its picture and its one
 * button together. 16px from every edge: the bottom padding is 8px because
 * the pill brings 8px of its own. 32px between cards, more than the 24px
 * above each pill, so the space groups each tour as well as the border. The
 * facts line is 16px (the price is what the three cards are compared on)
 * and closes the card's heading: 8px under the title, 16px above the body.
 */
const tourCard = (t: TipTour) => box('#FFFFFF', 'border:1px solid #DFDEDC;padding:16px 16px 8px;', '32px 0 0', `
  ${cardPhoto(link(`/experience/${t.slug}`, `${t.content}_photo`), t.photo, `${t.button}. ${t.alt}`)}
  <p style="margin:0 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:#5A4A16;">${t.where}</p>
  <h2 style="margin:0 0 8px;font-size:18px;line-height:1.25;">${t.title}</h2>
  <p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#524F49;">${tourFacts(t.slug)}</p>
  <p style="margin:0;font-size:16px;line-height:1.6;color:#2b2926;">${t.body}</p>
  ${btn(link(`/experience/${t.slug}`, t.content), t.button)}
`)

/**
 * Tip 2, twelve days after tip 1 (unless they book first): three tours, one
 * near each resort area, each card led by its own photo, so the first
 * picture of the day out is on a phone's first screen.
 */
export function tip2(o: TipOptions = {}): TipEmail {
  const subject = 'A day off the resort: rafting, Rick’s Cafe or Dunn’s River'
  return {
    subject,
    html: wrap(subject, `
${h1('A day off the resort')}
${p('Three private tours, one near each resort area: Montego Bay, Negril and Ocho Rios. Your driver picks you up at your hotel, and one price covers your group.')}
${small(`${COUPON.code} still takes ${COUPON.label} off. Type it in the <b>Discount code</b> box at checkout.`)}
${TIP2_TOURS.map(tourCard).join('\n')}
<p style="margin:32px 0;font-size:14px;line-height:1.55;color:#524F49;">Still need the ride from the airport? ${textLink(link('/transfers', 'tip2_ride'), 'Price my ride')}</p>
${closing()}
`, `Private, with hotel pickup, one price per group: ${tourPrices().join(', ')}.`, footer('tip2', addressOf(o))),
  }
}

/** Both, in the order the automation sends them, with the alias each Resend template is kept under. */
export const TIP_TEMPLATES = [
  { alias: 'trip-tips-1-ride', name: 'Trip tips 1: the ride from MBJ', build: tip1 },
  { alias: 'trip-tips-2-tours', name: 'Trip tips 2: a day out', build: tip2 },
] as const
