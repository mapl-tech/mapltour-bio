import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportWeeks, weekLabel, torontoMidnight } from '../netlify/lib/report/window.mts'
import { extractActions } from '../netlify/lib/report/meta.mts'
import { ga4Week, parseRows, type RunReport } from '../netlify/lib/report/ga4.mts'
import { render, subject, type Report } from '../netlify/lib/report/render.mts'
import { buildReport, failures, keyMatches, manualRun } from '../netlify/lib/report/run.mts'
import { mask, TEST_EMAIL, withDeadline } from '../netlify/lib/report/util.mts'

test('Monday 13:00 UTC in September: last week is Mon 00:00 to Mon 00:00 EDT', () => {
  const { week, prev } = reportWeeks(new Date('2026-09-21T13:00:00Z'))
  assert.equal(week.start.toISOString(), '2026-09-14T04:00:00.000Z')
  assert.equal(week.end.toISOString(), '2026-09-21T04:00:00.000Z')
  assert.equal(week.startDate, '2026-09-14')
  assert.equal(week.endDate, '2026-09-20')
  assert.equal(week.label, 'Sept 14 to 20')
  assert.equal(prev.label, 'Sept 7 to 13')
  assert.equal(prev.end.getTime(), week.start.getTime())
})

test('DST ends Nov 1 2026: the week of Oct 26 is 169 hours, the week of Nov 2 starts at 05:00Z', () => {
  const a = reportWeeks(new Date('2026-11-02T13:00:00Z')).week
  assert.equal(a.start.toISOString(), '2026-10-26T04:00:00.000Z')
  assert.equal(a.end.toISOString(), '2026-11-02T05:00:00.000Z')
  assert.equal((a.end.getTime() - a.start.getTime()) / 3_600_000, 169)
  assert.equal(a.label, 'Oct 26 to Nov 1')

  const b = reportWeeks(new Date('2026-11-09T13:00:00Z'))
  assert.equal(b.week.start.toISOString(), '2026-11-02T05:00:00.000Z')
  assert.equal(b.week.end.toISOString(), '2026-11-09T05:00:00.000Z')
  assert.equal(b.week.label, 'Nov 2 to 8')
  assert.equal(b.prev.start.toISOString(), '2026-10-26T04:00:00.000Z')
})

test('a Sunday evening in Toronto that is already Monday in UTC still reports the week before', () => {
  // 2026-09-21T02:00Z is Sunday Sept 20, 22:00 in Toronto: the full week before is Sept 7 to 13.
  assert.equal(reportWeeks(new Date('2026-09-21T02:00:00Z')).week.label, 'Sept 7 to 13')
})

test('midnight lookup on the spring-forward day', () => {
  assert.equal(torontoMidnight({ y: 2027, m: 3, d: 14 }).toISOString(), '2027-03-14T05:00:00.000Z')
  assert.equal(torontoMidnight({ y: 2027, m: 3, d: 15 }).toISOString(), '2027-03-15T04:00:00.000Z')
})

test('labels: same month, across months, across years', () => {
  assert.equal(weekLabel({ y: 2026, m: 9, d: 15 }, { y: 2026, m: 9, d: 21 }), 'Sept 15 to 21')
  assert.equal(weekLabel({ y: 2026, m: 9, d: 28 }, { y: 2026, m: 10, d: 4 }), 'Sept 28 to Oct 4')
  assert.equal(weekLabel({ y: 2026, m: 12, d: 28 }, { y: 2027, m: 1, d: 3 }), 'Dec 28, 2026 to Jan 3, 2027')
})

test('Meta actions: the reported types are picked out, the rest ignored, missing ones are 0', () => {
  const a = extractActions([
    { action_type: 'link_click', value: '42' },
    { action_type: 'landing_page_view', value: '30' },
    { action_type: 'offsite_conversion.fb_pixel_view_content', value: '12' },
    { action_type: 'offsite_conversion.fb_pixel_lead', value: '2' },
    { action_type: 'post_engagement', value: '999' },
    { action_type: 'lead', value: '7' },
  ])
  assert.deepEqual(a, { linkClicks: 42, lpv: 30, viewContent: 12, addToCart: 0, initiateCheckout: 0, purchase: 0, lead: 2 })
  assert.deepEqual(extractActions(undefined), { linkClicks: 0, lpv: 0, viewContent: 0, addToCart: 0, initiateCheckout: 0, purchase: 0, lead: 0 })
})

test('GA rows: keyed by header, missing rows are empty, a missing custom dimension drops only that table', async () => {
  assert.deepEqual(parseRows({ dimensionHeaders: [{ name: 'eventName' }], metricHeaders: [{ name: 'eventCount' }] }), [])
  const run: RunReport = async (body) => {
    const dims = ((body.dimensions ?? []) as Array<{ name: string }>).map((d) => d.name)
    if (dims.includes('customEvent:outcome')) throw new Error('GA4 HTTP 400: Field customEvent:outcome is not a valid dimension.')
    const two = (body.dateRanges as unknown[]).length === 2
    const dh = [...dims, ...(two ? ['dateRange'] : [])].map((name) => ({ name }))
    if (!dims.length) return { dimensionHeaders: dh, metricHeaders: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' }, { name: 'engagementRate' }], rows: [
      { dimensionValues: [{ value: 'cur' }], metricValues: [{ value: '120' }, { value: '100' }, { value: '60' }, { value: '0.5' }] },
      { dimensionValues: [{ value: 'prev' }], metricValues: [{ value: '80' }, { value: '70' }, { value: '30' }, { value: '0.375' }] },
    ] }
    if (dims[0] === 'eventName') return { dimensionHeaders: dh, metricHeaders: [{ name: 'eventCount' }], rows: [
      { dimensionValues: [{ value: 'cta_tap' }, { value: 'cur' }], metricValues: [{ value: '9' }] },
      { dimensionValues: [{ value: 'purchase' }, { value: 'prev' }], metricValues: [{ value: '1' }] },
    ] }
    return { dimensionHeaders: dh, metricHeaders: [{ name: 'x' }] } // no rows: GA omits them when empty
  }
  const w = { start: new Date(0), end: new Date(1), startDate: '2026-09-14', endDate: '2026-09-20', label: '' }
  const r = await ga4Week(run, w, w)
  assert.deepEqual(r.totals, { sessions: 120, users: 100, engaged: 60, engagementRate: 0.5 })
  assert.equal(r.prevTotals.engaged, 30)
  assert.equal(r.events.cta_tap, 9)
  assert.equal(r.events.purchase, 0)
  assert.equal(r.prevEvents.purchase, 1)
  assert.equal(r.ctaOutcomes, null)
  assert.deepEqual(r.sources, [])
  assert.deepEqual(r.pages, [])
})

const week = { start: new Date('2026-09-14T04:00:00Z'), end: new Date('2026-09-21T04:00:00Z'), startDate: '2026-09-14', endDate: '2026-09-20', label: 'Sept 14 to 20' }
const prevWeek = { ...week, label: 'Sept 7 to 13' }
const zeroBookings = { paid: { count: 0, revenueUsd: 0, byType: { tour: { count: 0, revenueUsd: 0 }, transfer: { count: 0, revenueUsd: 0 } } }, started: { count: 0 }, abandoned: { count: 0 }, refunds: { count: 0, amountUsd: 0 }, coupons: { count: 0, discountUsd: 0 }, attribution: [] }
const zeroTotals = { sessions: 0, users: 0, engaged: 0, engagementRate: 0 }
const zeroActions = { linkClicks: 0, lpv: 0, viewContent: 0, addToCart: 0, initiateCheckout: 0, purchase: 0, lead: 0 }

function zeroReport(): Report {
  return {
    week, prev: prevWeek,
    ga4: { ok: true, data: { main: { totals: zeroTotals, prevTotals: zeroTotals, sources: [], events: {}, prevEvents: {}, ctaOutcomes: null, pages: [] }, bio: null } },
    gads: { ok: true, data: { campaigns: [], cost: 0, prevCost: 0, searchTerms: [] } },
    meta: { ok: true, data: { ads: [], spend: 0, prevSpend: 0, totals: { impressions: 0, ...zeroActions } } },
    leads: { ok: true, data: { count: 0, prevCount: 0, bySource: [], list: [] } },
    bookings: { ok: true, data: { week: zeroBookings, prev: zeroBookings } },
  }
}

test('subject with zero values, and with a source down', () => {
  const r = zeroReport()
  assert.equal(subject(r), 'MAPL weekly: Sept 14 to 20, CA$0 spent, 0 engaged visits, 0 leads, 0 bookings')
  r.bookings = { ok: false, error: 'Bookings report HTTP 404' }
  r.gads = { ok: false, error: 'x' }
  assert.equal(subject(r), 'MAPL weekly: Sept 14 to 20, CA$0+ spent, 0 engaged visits, 0 leads, ? bookings')
  const { html } = render(r)
  assert.match(html, /Unavailable: Bookings report HTTP 404/)
  assert.match(html, /Not enough data this week/)
})

test('render escapes HubSpot, ad and error text', () => {
  const r = zeroReport()
  r.leads = { ok: true, data: { count: 1, prevCount: 0, bySource: [{ source: '<b>bio</b>', count: 1 }], list: [{ email: 'a"b@x.co', source: '<script>x</script>', capture: 'hero', utm_source: 'ig&co', utm_medium: '', utm_content: "o'k", createdAt: Date.parse('2026-09-16T18:05:00Z') }] } }
  r.meta = { ok: true, data: { ads: [{ ad: '<img src=x onerror=1>', campaign: 'C', spend: 10, impressions: 1000, ctr: 1.5, ...zeroActions, lpv: 5 }], spend: 10, prevSpend: 0, totals: { impressions: 1000, ...zeroActions, lpv: 5 } } }
  r.ga4 = { ok: false, error: '<oops>' }
  const { html } = render(r)
  assert.doesNotMatch(html, /<script>x<\/script>|<img src=x|<b>bio<\/b>|<oops>/)
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/)
  assert.match(html, /a&quot;b@x\.co/)
  assert.match(html, /ig&amp;co/)
  assert.match(html, /o&#39;k/)
  assert.match(html, /Sept 16, 14:05/)
  assert.match(html, /CA\$2\.00/) // cost per landing page view
})

test('secrets are masked and the test-address rule matches the contract', () => {
  const s = mask('Bearer abc.def x access_token=EAAB123&y=1 pat-na1-aaaa re_AbCdEf123 ya29.zzz')
  assert.doesNotMatch(s, /abc\.def|EAAB123|na1-aaaa|AbCdEf123|zzz/)
  for (const e of ['a@example.com', 'x@resend.dev', 'me@mapltech.com', 'leshanpatterson@gmail.com', 'leshan_patterson@x.com']) assert.ok(TEST_EMAIL.test(e), e)
  assert.ok(!TEST_EMAIL.test('guest@gmail.com'))
})

test('report key: exact match only, never with an unset secret', () => {
  assert.equal(keyMatches('s3cret', 's3cret'), true)
  assert.equal(keyMatches('s3cret', 's3cre'), false)
  assert.equal(keyMatches(null, 's3cret'), false)
  assert.equal(keyMatches('', ''), false)
  assert.equal(keyMatches('x', undefined), false)
})

test('manual run: wrong key is 401, ?to= is refused before anything is built', async () => {
  const env = { MAPL_REPORT_KEY: 'k3y' } as NodeJS.ProcessEnv
  assert.equal((await manualRun(new Request('https://bio.mapltours.com/api/weekly-report?dry=1'), env)).status, 401)
  assert.equal((await manualRun(new Request('https://bio.mapltours.com/api/weekly-report?dry=1', { headers: { 'x-report-key': 'nope' } }), env)).status, 401)
  assert.equal((await manualRun(new Request('https://bio.mapltours.com/api/weekly-report?to=a@b.co', { headers: { 'x-report-key': 'k3y' } }), env)).status, 400)
})

test('brand line is mixed case in the email, never uppercased by CSS', () => {
  const { html } = render(zeroReport())
  const line = /<p[^>]*>MAPL Tours Jamaica<\/p>/.exec(html)?.[0] ?? ''
  assert.ok(line, 'brand line present')
  assert.doesNotMatch(line, /uppercase/)
})

test('deadline: a promise that never settles is cut off at the budget', async () => {
  const t0 = Date.now()
  await assert.rejects(withDeadline(new Promise(() => {}), AbortSignal.timeout(50), 50), /timed out at the 0s report deadline/)
  assert.ok(Date.now() - t0 < 1000)
  assert.equal(await withDeadline(Promise.resolve(7), AbortSignal.timeout(50), 50), 7)
})

test('deadline: every source hangs, the report still settles on time with each one unavailable', async () => {
  const realFetch = globalThis.fetch
  let aborted = 0
  // Every API hangs until its signal fires, like a slow upstream.
  globalThis.fetch = ((_u: unknown, init?: RequestInit) => new Promise((_r, reject) => {
    init?.signal?.addEventListener('abort', () => { aborted++; reject(init.signal!.reason) }, { once: true })
  })) as typeof fetch
  try {
    const env = {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'x@y.iam.gserviceaccount.com',
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: (await import('node:crypto')).generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      GOOGLE_ADS_CUSTOMER_ID: '1', GOOGLE_ADS_DEVELOPER_TOKEN: 'd', META_ADS_TOKEN: 't', HUBSPOT_SERVICE_KEY: 'h', MAPL_REPORT_KEY: 's',
    } as NodeJS.ProcessEnv
    const t0 = Date.now()
    const r = await buildReport(new Date('2026-09-21T13:00:00Z'), env, 300)
    const took = Date.now() - t0
    assert.ok(took < 1500, `settled in ${took}ms`)
    const f = failures(r)
    assert.equal(f.length, 5)
    for (const line of f) assert.match(line, /timed out at the 0s report deadline/)
    assert.ok(aborted > 0, 'in-flight requests were aborted by the deadline')
  } finally {
    globalThis.fetch = realFetch
  }
})
