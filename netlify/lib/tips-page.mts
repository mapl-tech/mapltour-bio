import { NO_STORE } from './http.mts'
import { TIPS_BUTTON } from './hubspot.mts'
import { recordTips, verifyTips, type TipsAction, type TipsEnv } from './tips.mts'

/**
 * /tips: the page behind the trip tips links in the code email.
 *
 * GET only shows a button. Mail security scanners open every link in a
 * message before the person does, so a GET that subscribed or unsubscribed
 * would act on their behalf; only the POST from the button records
 * anything. The page is one small self-contained document in the email's
 * palette: inline CSS, no scripts, no fonts to fetch.
 */
const TITLE = 'Trip tips from MAPL Tours Jamaica'
/** The heading never breaks inside the brand name (balanced wrap would split it at 360 and inside the desktop card). */
const H1 = TITLE.replace('MAPL Tours Jamaica', 'MAPL&nbsp;Tours&nbsp;Jamaica')
const HOME = 'https://mapltours.com/?utm_source=bio&utm_medium=bio&utm_campaign=trip_tips'

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * The confirm step names the step, not the brand (the brand is the page
 * title and the footer), and shows the address on its own line so the
 * visitor can check it before tapping. `ask` receives the address already
 * escaped: it goes into HTML.
 */
const COPY: Record<TipsAction, { heading: string; ask: (safeEmail: string) => string; button: string; done: string }> = {
  yes: { heading: 'One tap to turn on trip tips', ask: (e) => `<p>Tap the button to get Jamaica trip tips about twice a month. Unsubscribe anytime.</p><p style="overflow-wrap:anywhere;">Sending to <strong>${e}</strong></p>`, button: TIPS_BUTTON, done: 'You are in. Your first trip tip comes in a couple of weeks.' },
  stop: { heading: 'One tap to stop trip tips', ask: (e) => `<p>Tap the button to stop trip tips to this address:</p><p style="overflow-wrap:anywhere;"><strong>${e}</strong></p>`, button: 'Stop trip tips', done: 'Done. No more trip tips.' },
}
/**
 * What the tips cover, in the code email's own words (the tips card in
 * emails.mts), so the yes page restates the value at the button instead of
 * asking for a second tap on faith. Change both together.
 */
const COVERS = ['What the ride from MBJ costs', 'The tours people book most', 'What to know the week before you go']
export const BROKEN = 'That link did not work. Ask for your code again at bio.mapltours.com and tick the trip tips box.'
const FORM_URL = 'https://bio.mapltours.com/#coupon'
/** BROKEN as a paragraph, the domain a link to the form: on a phone nobody wants to type it. */
const brokenHtml = `<p>${esc(BROKEN).replace('bio.mapltours.com', `<a href="${FORM_URL}">bio.mapltours.com</a>`)}</p>`
export const SORRY = 'Sorry, trip tips cannot be changed from this page right now. Please try again later.'
export const RETRY = 'That did not go through. Please tap the button again in a moment.'
const PRIVACY = 'https://mapltours.com/privacy?utm_source=bio&utm_medium=bio&utm_campaign=trip_tips&utm_content=tips_privacy'

/**
 * A state's message in a panel of its own, so the outcome of a tap reads at
 * a glance: 'ok' (green, a tick, role=status) after a saved yes or stop,
 * 'warn' (clay, role=alert) for a failed save, a broken link or no secret.
 * The mark is decoration; the sentence carries the meaning.
 */
const note = (kind: 'ok' | 'warn', inner: string) =>
  `<div class="note ${kind}" role="${kind === 'ok' ? 'status' : 'alert'}"><span class="mark" aria-hidden="true"></span><div>${inner}</div></div>`

// The gold button keeps its literal colours (owner's choice, pinned by the
// tests): #A58326 with white is 3.57:1, AA for the 19px bold label (large
// text); hover darkens to #957520 (4.34:1), so contrast rises on hover.
// Measured on the rest: ink on the page 17.2:1, body 13.8:1, muted 7.8:1,
// green 8.3:1 (7.8:1 on the ok panel), clay #A33A20 on its panel 6.0:1.
// Spacing is on 4/8: heading to text 12, text to action 24, sections 32.
const CSS = `:root{--page:#FAF9F7;--ink:#171614;--body:#2B2926;--muted:#524F49;--green:#12563A;--gold:#A58326;--line:rgba(23,22,20,.12);--ok:#EEF4EE;--ok-line:rgba(18,86,58,.24);--warn:#FCF1EC;--clay:#A33A20}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
main,footer{max-width:480px;margin:0 auto;padding:40px 20px 32px}
h1{margin:0 0 12px;font-size:26px;line-height:1.15;letter-spacing:-.02em;text-wrap:balance}
p{margin:0 0 24px;font-size:17px;line-height:1.6;color:var(--body);overflow-wrap:anywhere}
p a{display:inline-block;padding:12px 0;margin:-12px 0;color:var(--green);font-weight:700;text-underline-offset:3px}
ul{margin:0 0 24px;padding:0;list-style:none}
li{position:relative;margin:0 0 4px;padding-left:20px;font-size:17px;line-height:1.5;color:var(--body)}
li::before{content:"";position:absolute;left:2px;top:.6em;width:8px;height:8px;border-radius:50%;background:var(--gold)}
form{margin:0}
button{display:block;width:100%;min-height:56px;padding:16px 24px;border:0;border-radius:999px;background:#A58326;color:#FFFFFF;font-family:inherit;font-size:19px;font-weight:700;line-height:1.2;cursor:pointer;transition:background-color .15s ease,transform .1s ease}
button:hover{background:#957520}
.pill{display:flex;align-items:center;justify-content:center;min-height:52px;padding:12px 24px;border:2px solid var(--green);border-radius:999px;color:var(--green);font-size:17px;font-weight:700;line-height:1.2;text-decoration:none;transition:background-color .15s ease,transform .1s ease}
.pill:hover{background:#E6EFE9}
button:active,.pill:active{transform:scale(.98)}
.note{display:flex;gap:12px;align-items:flex-start;margin:0 0 24px;padding:16px;border:1px solid var(--ok-line);border-radius:16px;background:var(--ok)}
.note p{margin:0}
.mark{flex:none;position:relative;width:28px;height:28px;border-radius:50%;background:var(--green)}
.mark::before,.mark::after{content:"";position:absolute;background:#FFFFFF}
.ok .mark::after{left:10px;top:6px;width:7px;height:12px;border:solid #FFFFFF;border-width:0 3px 3px 0;background:none;transform:rotate(45deg)}
.warn{border-color:rgba(163,58,32,.32);background:var(--warn)}
.warn .mark{background:var(--clay)}
.warn .mark::before{left:12.5px;top:6px;width:3px;height:10px;border-radius:2px}
.warn .mark::after{left:12.5px;top:19px;width:3px;height:3px;border-radius:50%}
footer{padding-top:0;padding-bottom:40px}
footer p{margin:0;padding-top:16px;border-top:1px solid var(--line);font-size:14px;line-height:1.6;color:var(--muted)}
:focus-visible{outline:3px solid #171614;outline-offset:3px}
p a:focus-visible{outline-offset:0;border-radius:4px}
@media (min-width:600px){main{margin-top:64px;margin-bottom:24px;padding:40px;background:#FFFFFF;border:1px solid var(--line);border-radius:20px}footer{padding:0 40px 48px}footer p{border-top:0}}
@media (prefers-reduced-motion:reduce){button,.pill{transition:none}button:active,.pill:active{transform:none}}`

function doc(body: string, heading = H1): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light only"><title>${TITLE}</title><style>${CSS}</style></head><body><main><h1>${heading}</h1>${body}</main><footer><p>MAPL Tours Jamaica, Montego Bay. <a href="${esc(PRIVACY)}">Privacy</a></p></footer></body></html>`
}

// The link's own URL carries the token and the address: never send it on as
// a referrer, never let the page be framed.
const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  ...NO_STORE,
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
}

const html = (status: number, body: string, head = false, extra: Record<string, string> = {}, heading = H1) =>
  new Response(head ? null : doc(body, heading), { status, headers: { ...HEADERS, ...extra } })

/** A broken link: the sentence (its domain a link) and the same way back as a pill a thumb can hit. */
const brokenBody = `${note('warn', brokenHtml)}<a class="pill" href="${FORM_URL}">Ask for your code again</a>`
const sorryBody = note('warn', `<p>${esc(SORRY)}</p>`)
/** The yes page restates what the tips cover before the ask; the stop page asks straight away. role=list: WebKit drops list semantics under list-style:none. */
const covers = (a: TipsAction) => (a === 'yes' ? `<ul role="list">${COVERS.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '')

/** The confirm form: the same a, e, t posted back, escaped although they were checked. */
function form(a: TipsAction, e: string, t: string): string {
  return `<form method="post" action="/tips"><input type="hidden" name="a" value="${esc(a)}"><input type="hidden" name="e" value="${esc(e)}"><input type="hidden" name="t" value="${esc(t)}"><button type="submit">${esc(COPY[a].button)}</button></form>`
}

export async function handleTips(req: Request, env: TipsEnv = process.env, f: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  const head = req.method === 'HEAD'
  if (req.method !== 'GET' && !head && req.method !== 'POST') return html(405, brokenBody, false, { Allow: 'GET, HEAD, POST' })
  const secret = env.TIPS_SECRET
  if (!secret) return html(503, sorryBody, head)

  let q: URLSearchParams
  if (req.method === 'POST') {
    try { q = new URLSearchParams((await req.text()).slice(0, 4096)) } catch { return html(400, brokenBody) }
  } else q = new URL(req.url).searchParams
  const a = q.get('a'), e = q.get('e'), t = q.get('t')
  const link = verifyTips(a, e, t, secret)
  if (!link || !e || !t) return html(400, brokenBody, head)
  const c = COPY[link.action]

  if (req.method !== 'POST') return html(200, `${covers(link.action)}${c.ask(esc(link.email))}${form(link.action, e, t)}`, head, {}, c.heading)

  const r = await recordTips(link.action, link.email, env, f, now)
  if (!r.ok) return html(r.status === 503 ? 503 : 502, r.status === 503 ? sorryBody : `${note('warn', `<p>${esc(RETRY)}</p>`)}${form(link.action, e, t)}`)
  return html(200, `${note('ok', `<p>${esc(c.done)}</p>`)}<a class="pill" href="${esc(`${HOME}&utm_content=tips_${link.action}`)}">Go to mapltours.com</a>`)
}
