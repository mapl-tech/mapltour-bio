import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeKey, generateCode, mintCoupon, VALUE } from '../netlify/lib/coupon.mts'

const RE = /^MAPL-[ACDEFHJKLMNPQRTUVWXY2346789]{4}-[ACDEFHJKLMNPQRTUVWXY2346789]{4}$/

/** A tiny PostgREST: one table, the three queries the minter makes. */
function fakeDb(seed: Record<string, unknown>[] = []) {
  const rows = [...seed]
  const posts: Record<string, unknown>[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input))
    assert.equal(u.pathname, '/rest/v1/gift_cards')
    const h = init?.headers as Record<string, string>
    assert.equal(h.apikey, 'k')
    if (init?.method === 'POST') {
      const b = JSON.parse(String(init.body)) as Record<string, unknown>
      if (rows.some((r) => r.code === b.code)) return new Response('{"code":"23505"}', { status: 409 })
      const row = { ...b, created_at: new Date().toISOString() }
      rows.push(row); posts.push(row)
      return new Response(JSON.stringify([row]), { status: 201 })
    }
    const p = u.searchParams
    if (p.has('purchaser_email')) {
      const key = p.get('purchaser_email')!.slice(3)
      return Response.json(rows.filter((r) => r.purchaser_email === key && r.message === p.get('message')!.slice(3)))
    }
    return Response.json(rows.filter((r) => r.message === p.get('message')!.slice(3)))
  }) as typeof fetch
  return { rows, posts, fetchImpl }
}

test('code has the checkout shape and alphabet', () => {
  for (let i = 0; i < 50; i++) assert.match(generateCode(), RE)
})

test('dedupe key strips plus tags, and dots only on gmail', () => {
  assert.equal(dedupeKey('Le.Shan+promo@Gmail.com'), 'leshan@gmail.com')
  assert.equal(dedupeKey('x@googlemail.com'), 'x@gmail.com')
  assert.equal(dedupeKey('a.b+c@example.com'), 'a.b@example.com')
})

test('not configured without url and key', async () => {
  const m = await mintCoupon({ email: 'a@example.com' })
  assert.deepEqual(m, { ok: false, reason: 'not_configured' })
})

test('mints an active card once, then returns the same code', async () => {
  const db = fakeDb()
  const a = await mintCoupon({ url: 'https://x.supabase.co/', key: 'k', email: 'Guest+1@example.com', fetchImpl: db.fetchImpl })
  assert.ok(a.ok)
  assert.equal(a.coupon.reused, false)
  assert.match(a.coupon.code, RE)
  const row = db.posts[0]
  assert.equal(row.status, 'active')
  assert.equal(row.balance, VALUE)
  assert.equal(row.initial_amount, VALUE)
  assert.equal(row.recipient_email, 'guest+1@example.com')
  assert.equal(row.purchaser_email, 'guest@example.com')
  assert.equal(row.message, 'bio-coupon')
  assert.ok(Date.parse(row.expires_at as string) > Date.now() + 170 * 86400000)

  const b = await mintCoupon({ url: 'https://x.supabase.co', key: 'k', email: 'guest@example.com', fetchImpl: db.fetchImpl })
  assert.ok(b.ok)
  assert.equal(b.coupon.reused, true)
  assert.equal(b.coupon.spent, false)
  assert.equal(b.coupon.code, a.coupon.code)
  assert.equal(db.posts.length, 1)
})

test('a used or expired card is reported as spent, never re-minted', async () => {
  const db = fakeDb([{ code: 'MAPL-AAAA-AAAA', message: 'bio-coupon', purchaser_email: 'u@example.com', status: 'depleted', balance: 0, expires_at: null, created_at: new Date().toISOString() }])
  const m = await mintCoupon({ url: 'https://x.supabase.co', key: 'k', email: 'u@example.com', fetchImpl: db.fetchImpl })
  assert.ok(m.ok && m.coupon.spent && m.coupon.reused)
  const old = fakeDb([{ code: 'MAPL-AAAA-AAAA', message: 'bio-coupon', purchaser_email: 'v@example.com', status: 'active', balance: 10, expires_at: '2020-01-01T00:00:00Z', created_at: new Date().toISOString() }])
  const n = await mintCoupon({ url: 'https://x.supabase.co', key: 'k', email: 'v@example.com', fetchImpl: old.fetchImpl })
  assert.ok(n.ok && n.coupon.spent)
  assert.equal(old.posts.length, 0)
})

test('daily ceiling stops minting', async () => {
  const seed = Array.from({ length: 3 }, (_, i) => ({ code: `MAPL-AAAA-AAA${i}`, message: 'bio-coupon', purchaser_email: `s${i}@example.com`, status: 'active', balance: 10, created_at: new Date().toISOString() }))
  const db = fakeDb(seed)
  const m = await mintCoupon({ url: 'https://x.supabase.co', key: 'k', email: 'new@example.com', fetchImpl: db.fetchImpl, dailyCap: 3 })
  assert.deepEqual(m, { ok: false, reason: 'capped' })
  assert.equal(db.posts.length, 0)
})

test('a code collision draws again once', async () => {
  const db = fakeDb([{ code: 'MAPL-AAAA-AAAA', message: 'other', purchaser_email: 'z@example.com', status: 'active', balance: 10, created_at: '2020-01-01T00:00:00Z' }])
  let calls = 0
  const random = () => (calls++ === 0 ? Array(8).fill(0) : Array(8).fill(1))
  const m = await mintCoupon({ url: 'https://x.supabase.co', key: 'k', email: 'z2@example.com', fetchImpl: db.fetchImpl, random })
  assert.ok(m.ok)
  assert.equal(m.coupon.code, 'MAPL-CCCC-CCCC')
})

test('backend failure is reported, not thrown', async () => {
  const fetchImpl = (async () => new Response('down', { status: 503 })) as typeof fetch
  const m = await mintCoupon({ url: 'https://x.supabase.co', key: 'k', email: 'a@example.com', fetchImpl })
  assert.deepEqual(m, { ok: false, reason: 'backend' })
})
