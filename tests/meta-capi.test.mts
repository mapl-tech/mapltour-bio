import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { BIO_PAGE, CAPI_TIMEOUT_MS, LIVE_ORIGIN, capiLead, capiLeadEvent, clickId, optedOut, type LeadReport } from '../netlify/lib/meta-capi.mts'
import { PAGE_MAX } from '../netlify/lib/lead-input.mts'

const ENV = { META_PIXEL_ID: '1607953960710055', META_CAPI_TOKEN: 'capi-test-token' }
const NOW = 1759780800123
const AD_PAGE = 'https://bio.mapltours.com/?utm_source=facebook&utm_medium=paid&utm_campaign=bio_cold&fbclid=IwAR0abc_DEF-123'
// The live page's fetch carries its Origin, as a browser always sends it with a POST.
const req = (headers: Record<string, string> = {}) => new Request('https://bio.mapltours.com/api/lead', { method: 'POST', headers: { origin: LIVE_ORIGIN, ...headers } })
const bare = (headers: Record<string, string> = {}) => new Request('https://bio.mapltours.com/api/lead', { method: 'POST', headers })
const report = (o: Partial<LeadReport> = {}): LeadReport => ({ email: 'guest@gmail.com', eventId: 'evt-12345678', channel: 'bio', source: 'bio_hero', page: AD_PAGE, country: 'US', now: NOW, ...o })
// SHA-256 in hex of the exact strings Meta asks for, worked out independently (shasum -a 256).
const SHA_EMAIL = '2740b72f246529ea5061312ac3bb18ac9cd57f7a325f145b18713edc7d4696a9' // guest@gmail.com
const SHA_US = '79adb2a2fce5c6ba215fe5f27f532d4e7edbac4b6a5e09e1ef3a08084a904621' // us

test('a bio lead: one Lead to the page pixel\'s dataset, with the page\'s event id, hashed the way Meta asks', () => {
  const headers = { cookie: 'other=1; _fbp=fb.1.1759000000000.123456789', 'user-agent': 'UA test', 'x-nf-client-connection-ip': '203.0.113.7' }
  const ev = capiLeadEvent(req(headers), report({ email: '  Guest@Gmail.COM ' }), ENV)
  assert.ok(!('skipped' in ev))
  assert.equal(ev.url, 'https://graph.facebook.com/v21.0/1607953960710055/events?access_token=capi-test-token')
  assert.deepEqual(ev.body, {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(NOW / 1000),
      event_id: 'evt-12345678',
      event_source_url: AD_PAGE,
      action_source: 'website',
      user_data: {
        em: [SHA_EMAIL],
        client_ip_address: '203.0.113.7',
        client_user_agent: 'UA test',
        fbp: 'fb.1.1759000000000.123456789',
        fbc: `fb.1.${NOW}.IwAR0abc_DEF-123`,
        country: [SHA_US],
      },
      custom_data: { content_name: 'bio_hero' },
    }],
  })
})

test('ids go as they are, never hashed; a malformed _fbp, or no country, is left out', () => {
  const ev = capiLeadEvent(req({ cookie: '_fbp=not-a-browser-id; _fbc=fb.1.1758000000000.IwCookieClick', 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }), report({ country: null, page: 'https://bio.mapltours.com/?utm_source=facebook' }), ENV)
  assert.ok(!('skipped' in ev))
  const u = ev.body.data[0].user_data
  assert.equal(u.fbp, undefined)
  assert.equal(u.fbc, 'fb.1.1758000000000.IwCookieClick')
  assert.equal(u.client_ip_address, '198.51.100.4')
  assert.equal(u.country, undefined)
  for (const bad of ['USA', 'u', '12', '']) {
    const e = capiLeadEvent(req(), report({ country: bad }), ENV)
    assert.ok(!('skipped' in e) && e.body.data[0].user_data.country === undefined, bad)
  }
})

test('click id: the _fbc cookie when it holds this click (or the link has none), else built from the ad link\'s fbclid, else none', () => {
  const PLAIN = 'https://bio.mapltours.com/?utm_source=facebook'
  // The cookie already holds this click (the pixel loaded first): kept as set, with its own time.
  assert.equal(clickId('fb.1.1759000000000.IwAR0abc_DEF-123', AD_PAGE, NOW), 'fb.1.1759000000000.IwAR0abc_DEF-123')
  assert.equal(clickId('fb.1.1759000000000.IwAR0abc_DEF-123.AQextra', AD_PAGE, NOW), 'fb.1.1759000000000.IwAR0abc_DEF-123.AQextra')
  // An older ad click in the cookie, a new one in the link: the new one, as fbevents.js would set it.
  assert.equal(clickId('fb.1.1758000000000.IwOldClick_99', AD_PAGE, NOW), `fb.1.${NOW}.IwAR0abc_DEF-123`)
  // No fbclid in the link: the cookie as it is.
  assert.equal(clickId('fb.1.1758000000000.IwOldClick_99', PLAIN, NOW), 'fb.1.1758000000000.IwOldClick_99')
  assert.equal(clickId(undefined, AD_PAGE, NOW), `fb.1.${NOW}.IwAR0abc_DEF-123`)
  assert.equal(clickId('not-a-click-id', AD_PAGE, NOW), `fb.1.${NOW}.IwAR0abc_DEF-123`)
  assert.equal(clickId('not-a-click-id', PLAIN, NOW), undefined)
  assert.equal(clickId(undefined, 'https://bio.mapltours.com/', NOW), undefined)
  assert.equal(clickId(undefined, 'https://bio.mapltours.com/?fbclid=%3Cscript%3E', NOW), undefined)
  assert.equal(clickId(undefined, 'https://bio.mapltours.com/?fbclid=short', NOW), undefined)
  assert.equal(clickId(undefined, '', NOW), undefined)
  // The fbclid is case-sensitive and kept exactly.
  assert.equal(clickId(undefined, 'https://bio.mapltours.com/?fbclid=IwZXh0bgNhZW0BMABhZGlk_aem_AbCdEf', NOW), `fb.1.${NOW}.IwZXh0bgNhZW0BMABhZGlk_aem_AbCdEf`)
  // The link also carried brid: the dataset's cookie settings merge it into the pixel's own
  // cookie as <fbclid>_aem_<brid>. That cookie is this click, so it is kept as the pixel set it.
  assert.equal(clickId('fb.1.1759000000000.IwAR0abc_DEF-123_aem_Z2hpamtsbW5vcHFy', `${AD_PAGE}&brid=Z2hpamtsbW5vcHFy`, NOW), 'fb.1.1759000000000.IwAR0abc_DEF-123_aem_Z2hpamtsbW5vcHFy')
  // ...but a different click that merely starts the same way is not this one.
  assert.equal(clickId('fb.1.1759000000000.IwAR0abc_DEF-123456', AD_PAGE, NOW), `fb.1.${NOW}.IwAR0abc_DEF-123`)
  // A page cut at the cap may end in a cut fbclid: none rather than a wrong one.
  const long = `https://bio.mapltours.com/?utm_content=${'x'.repeat(PAGE_MAX)}&fbclid=IwAR0abc_DEF-123`.slice(0, PAGE_MAX)
  assert.equal(long.length, PAGE_MAX)
  assert.equal(clickId(undefined, long, NOW), undefined)
  assert.equal(clickId('fb.1.1758000000000.IwOldClick_99', long, NOW), 'fb.1.1758000000000.IwOldClick_99')
})

test('not reported: not configured, no event id, the mapltours.com relay, anything but the live page, DNT or GPC', () => {
  const skipped = (ev: ReturnType<typeof capiLeadEvent>) => ('skipped' in ev ? ev.skipped : 'SENT')
  assert.equal(skipped(capiLeadEvent(req(), report(), {})), 'not configured')
  assert.equal(skipped(capiLeadEvent(req(), report(), { META_PIXEL_ID: ENV.META_PIXEL_ID })), 'not configured')
  for (const eventId of [null, '', 'short', 'has space 123', 'x'.repeat(65)]) assert.equal(skipped(capiLeadEvent(req(), report({ eventId }), ENV)), 'no event id', String(eventId))
  assert.equal(skipped(capiLeadEvent(req(), report({ channel: 'site' }), ENV)), 'relayed by mapltours.com')
  for (const page of ['', 'http://localhost:3000/', 'http://localhost:8888/', 'https://deploy-preview-3--mapl-bio.netlify.app/', 'https://main--mapl-bio.netlify.app/', 'https://mapltours.com/', 'http://bio.mapltours.com/', 'https://bio.mapltours.com.example.net/', 'https://www.bio.mapltours.com/']) {
    assert.equal(skipped(capiLeadEvent(req(), report({ page }), ENV)), 'not the live page', page)
  }
  // Forged: no Origin (curl, a server), or another site's form or script.
  assert.equal(LIVE_ORIGIN, 'https://bio.mapltours.com')
  assert.equal(skipped(capiLeadEvent(bare(), report(), ENV)), 'not sent by the live page')
  for (const origin of ['https://evil-anyone.netlify.app', 'https://deploy-preview-3--mapl-bio.netlify.app', 'https://mapltours.com', 'http://bio.mapltours.com', 'null', 'https://bio.mapltours.com.example.net']) {
    assert.equal(skipped(capiLeadEvent(bare({ origin }), report(), ENV)), 'not sent by the live page', origin)
  }
  assert.equal(skipped(capiLeadEvent(req({ DNT: '1' }), report(), ENV)), 'opted out')
  assert.equal(skipped(capiLeadEvent(req({ 'Sec-GPC': '1' }), report(), ENV)), 'opted out')
  assert.equal(skipped(capiLeadEvent(req(), report({ email: 'not-an-email' }), ENV)), 'no email')
  // The live page, with or without a query, is reported; so is an explicit DNT: 0.
  assert.ok(BIO_PAGE.test('https://bio.mapltours.com/'))
  assert.equal(skipped(capiLeadEvent(req({ DNT: '0' }), report({ page: 'https://bio.mapltours.com/' }), ENV)), 'SENT')
  assert.equal(optedOut(new Headers()), false)
})

test('capiLead: one POST with a timeout, and never throws, whether Meta refuses, fails or hangs', async () => {
  assert.equal(CAPI_TIMEOUT_MS, 4000)
  const warn = mock.method(console, 'warn', () => {})
  try {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const ok = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response('{"events_received":1}', { status: 200 }) }) as unknown as typeof fetch
    assert.equal(await capiLead(req(), report(), { fetch: ok, env: ENV }), 'sent')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].init.method, 'POST')
    assert.ok(seen[0].init.signal instanceof AbortSignal, 'the call carries a timeout')
    assert.equal(JSON.parse(String(seen[0].init.body)).data[0].event_id, 'evt-12345678')

    // Skipped: nothing is fetched at all.
    assert.equal(await capiLead(req(), report({ eventId: null }), { fetch: ok, env: ENV }), 'skipped')
    assert.equal(seen.length, 1)

    const refused = (async () => new Response('{"error":{"message":"no"}}', { status: 400 })) as unknown as typeof fetch
    assert.equal(await capiLead(req(), report(), { fetch: refused, env: ENV }), 'failed')
    const throws = (async () => { throw new Error('socket hang up') }) as unknown as typeof fetch
    assert.equal(await capiLead(req(), report(), { fetch: throws, env: ENV }), 'failed')
    // Meta never answers: the call gives up at the timeout instead of holding the visitor.
    const hangs = ((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch
    const t0 = Date.now()
    assert.equal(await capiLead(req(), report(), { fetch: hangs, env: ENV, timeoutMs: 50 }), 'failed')
    assert.ok(Date.now() - t0 < 1000)
  } finally {
    warn.mock.restore()
  }
})

test('the dataset is always the page pixel\'s own: a stale META_PIXEL_ID (the old bio pixel) changes nothing', async () => {
  const { PIXEL_ID } = await import('../lib/trackers.mts')
  assert.equal(PIXEL_ID, '1607953960710055')
  for (const env of [{ META_CAPI_TOKEN: 'x' }, { META_CAPI_TOKEN: 'x', META_PIXEL_ID: '1060325803564034' }, { META_CAPI_TOKEN: 'x', META_PIXEL_ID: '' }]) {
    const ev = capiLeadEvent(req(), report(), env)
    assert.ok(!('skipped' in ev), JSON.stringify(env))
    assert.equal(ev.url.split('?')[0], `https://graph.facebook.com/v21.0/${PIXEL_ID}/events`, JSON.stringify(env))
  }
})

test('_fbp: Meta\'s four-part cookie and the five-part one with an appendix are sent; anything else is left out', () => {
  for (const [cookie, sent] of [['fb.1.1759000000000.123456789', true], ['fb.1.1759000000000.123456789.AQ', true], ['fb.2.1759000000000.987654321', true], ['fb.1.abc.123', false], ['fb.1.1759000000000', false], ['nope', false]] as Array<[string, boolean]>) {
    const ev = capiLeadEvent(req({ cookie: `_fbp=${cookie}` }), report(), ENV)
    assert.ok(!('skipped' in ev))
    assert.equal(ev.body.data[0].user_data.fbp, sent ? cookie : undefined, cookie)
  }
})

