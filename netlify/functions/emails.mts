// The three emails the arrival-guide capture sends. Plain HTML, no images, so
// they render everywhere and land in the primary tab more often than not.
import transfers from '../../data/transfers.json' with { type: 'json' }

const SITE = 'https://mapltours.com'
const link = (path: string, content: string) => `${SITE}${path}${path.includes('?') ? '&' : '?'}utm_source=bio&utm_medium=email&utm_campaign=arrival_guide&utm_content=${content}`

const zones = transfers.zones as { code: string; label: string; duration: string; owMin: number; owMax: number; rtMin: number; count: number }[]
const cheapest = transfers.cheapestOneWay as number

const wrap = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head>
<body style="margin:0;background:#FAF9F7;font-family:'DM Sans',-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#171614;">
<div style="max-width:600px;margin:0 auto;padding:28px 20px 40px;">
  <p style="margin:0 0 18px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#5A4A16;">MAPL Tours Jamaica</p>
  ${body}
  <hr style="border:0;border-top:1px solid rgba(23,22,20,.12);margin:32px 0 16px;">
  <p style="font-size:12px;line-height:1.6;color:#524F49;margin:0;">You asked for this guide at bio.mapltours.com. Two short follow-ups come over the next two weeks and that is all. To stop them, reply with the word <b>stop</b> and we remove you the same day. MAPL Tours Jamaica, Montego Bay. <a href="${link('/privacy', 'footer')}" style="color:#12563A;">Privacy</a></p>
</div></body></html>`

const h1 = (t: string) => `<h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;letter-spacing:-.02em;">${t}</h1>`
const h2 = (t: string) => `<h2 style="margin:26px 0 8px;font-size:18px;line-height:1.25;">${t}</h2>`
const p = (t: string) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#2b2926;">${t}</p>`
const btn = (href: string, t: string) => `<p style="margin:22px 0 8px;"><a href="${href}" style="display:inline-block;background:#C9A94E;color:#1A1508;font-weight:700;text-decoration:none;padding:14px 22px;border-radius:999px;font-size:16px;">${t}</a></p>`
const zoneRows = zones.map((z) => `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid rgba(23,22,20,.1);font-size:14px;"><b>${z.label}</b><br><span style="color:#524F49;">${z.duration}</span></td><td style="padding:8px 0;border-bottom:1px solid rgba(23,22,20,.1);font-size:14px;text-align:right;white-space:nowrap;">$${z.owMin}${z.owMax > z.owMin ? '+' : ''} one way<br><span style="color:#524F49;">$${z.rtMin}${z.owMax > z.owMin ? '+' : ''} round trip</span></td></tr>`).join('')

export const guide = {
  subject: 'Your Montego Bay arrival guide',
  html: wrap('Your Montego Bay arrival guide', `
${h1('From the plane door to your resort.')}
${p('Here is what happens at Sangster International (MBJ) and on the road after it, in the order it happens. Save this email for the day you land.')}
${h2('1. Before you fly')}
${p('If you have booked a ride with us, the day before you land you get an email with your driver’s name, the vehicle, the plate and a WhatsApp number. Keep it on your phone. The driver has your name and your flight number, and we track the flight, so a delay moves the pickup with it.')}
${h2('2. Immigration, bags, customs')}
${p('Have your passport and your resort name ready; immigration asks where you are staying. Bags come out on the belts past immigration, customs is a short queue after that. Most arrivals are through in 30 to 60 minutes on a normal day, longer when several flights land together.')}
${h2('3. The exit, and who is waiting')}
${p('Through the sliding doors you are in the arrivals hall. People will offer you rides; a polite no is enough. Your MAPL driver waits just outside with your name on a sign. If you do not see them, message the WhatsApp number from your email; the driver is on that phone.')}
${h2('4. How far is your resort')}
${p('Fares are per car for up to 4 people, and they are the full price: nothing is added at the airport.')}
<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:6px 0 4px;">${zoneRows}</table>
${p(`<span style="font-size:13px;color:#524F49;">Exact fares for all ${transfers.destinations.length} resorts are on the booking page, shown before you enter any details. From $${cheapest} one way.</span>`)}
${h2('5. Money, SIM cards, tipping')}
${p('US dollars are accepted almost everywhere tourists go; Jamaican dollars are handy for small purchases in town. Cards work at resorts and larger shops. If you want data, the phone company counters are in the arrivals hall, or turn on your carrier’s roaming plan before you land. Tipping is welcome and never demanded; a few dollars for a driver or a porter is normal.')}
${h2('6. If your flight changes')}
${p('Reply to your booking email or message the driver on WhatsApp with the new flight. We move the pickup. A late plane is still met.')}
${btn(link('/transfers', 'guide_book'), 'Price my airport ride')}
${p('No problem.')}
`),
}

export const followup1 = {
  subject: 'How far is your resort from Montego Bay airport?',
  html: wrap('How far is your resort from Montego Bay airport?', `
${h1('Two numbers to know before you land.')}
${p('The drive time from the airport to your resort, and what the car costs. Both depend only on which stretch of coast your resort is on.')}
<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:6px 0 4px;">${zoneRows}</table>
${p('One price per car for up to 4 people, private, never shared, and the driver meets you at arrivals with your name on a sign. Round trips are priced together and cost less than two one-ways.')}
${btn(link('/transfers', 'followup1_book'), 'See my resort’s exact fare')}
${p('If your resort is not on the list, reply with its name and we price it by email.')}
`),
}

export const followup2 = {
  subject: 'The day you are not at the resort',
  html: wrap('The day you are not at the resort', `
${h1('One day off the resort, done properly.')}
${p('Most guests do one thing away from the resort. The ones people come back talking about: the Dunn’s River Falls climb, Rick’s Cafe at sunset in Negril, Bob Marley’s Nine Mile, and bamboo rafting on the Martha Brae.')}
${p('Every MAPL tour is private, picks you up at your hotel and is priced per car, so a couple and a family of three pay the same.')}
${btn(link('/explore', 'followup2_tours'), 'See the tours and prices')}
${p('Booked your airport ride already? Thank you. If not, it is still <a href="' + link('/transfers', 'followup2_transfer') + '" style="color:#12563A;">one flat fare per car</a>, priced before you book.')}
${p('No problem.')}
`),
}
