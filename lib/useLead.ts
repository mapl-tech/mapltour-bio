'use client'

import { useEffect, useRef, useState } from 'react'
import { lead, newEventId } from '@/lib/analytics'
import { tipsDefaultFor, type TipsDefault } from '@/lib/tips.mts'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * One capture flow shared by the hero, the coupon section and the sticky bar:
 * validate, POST /api/lead, report state. Every form reads the same success
 * flag, so a visitor who redeems in the hero sees the lower form already
 * done. `coupon` is whether the server actually minted a code for them;
 * `tips` whether it recorded a valid trip tips yes.
 */
let doneEmail: string | null = null
let doneCoupon = false
let doneTips = false
const listeners = new Set<(e: string, c: boolean, t: boolean) => void>()
export function markDone(email: string, coupon: boolean, tips = false) { doneEmail = email; doneCoupon = coupon; doneTips = tips; listeners.forEach((l) => l(email, coupon, tips)) }

/**
 * The visitor's country, asked once per page load and shared by every form.
 * Null when the lookup fails; the trip tips box then stays unticked.
 */
let geo: Promise<string | null> | null = null
function visitorCountry(): Promise<string | null> {
  geo ??= fetch('/api/geo', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && typeof j.country === 'string' && /^[A-Z]{2}$/.test(j.country) ? (j.country as string) : null))
    .catch(() => null)
  return geo
}

export function useLead(place: string) {
  const [email, setEmail] = useState('')
  const [hp, setHp] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>(doneEmail ? 'done' : 'idle')
  const [msg, setMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [sentTo, setSentTo] = useState(doneEmail ?? '')
  const [coupon, setCoupon] = useState(doneCoupon)
  const [tips, setTips] = useState(doneTips)

  // Trip tips box. It renders unticked (on the server too, so hydration
  // agrees); when the country arrives it takes the default for it (ticked
  // only in the US, lib/tips.mts), unless the visitor has already touched the
  // box or submitted. `optInDefault` is what they saw before touching it.
  const [optIn, setOptInState] = useState(false)
  const [optInDefault, setOptInDefault] = useState<TipsDefault>('unchecked')
  const touched = useRef(false)
  const submitted = useRef(false)
  const setOptIn = (v: boolean) => { touched.current = true; setOptInState(v) }
  useEffect(() => {
    let live = true
    visitorCountry().then((c) => {
      if (!live || touched.current || submitted.current) return
      const on = tipsDefaultFor(c)
      setOptInState(on); setOptInDefault(on ? 'checked' : 'unchecked')
    })
    return () => { live = false }
  }, [])

  // Subscribe to a success elsewhere on the page.
  useState(() => { const l = (e: string, c: boolean, t: boolean) => { setSentTo(e); setCoupon(c); setTips(t); setState('done') }; listeners.add(l); return l })

  const fail = (m: string) => { setState('error'); setMsg(m); inputRef.current?.focus() }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = email.trim()
    if (!v) return fail('Enter your email address so we can send your code.')
    if (!EMAIL.test(v)) return fail('That email does not look right. Check the spelling and try again.')
    setState('busy'); setMsg('')
    submitted.current = true
    const eventId = newEventId()
    // The section this form lives in, captured now: the input unmounts when
    // the code replaces the form, and the code must land in view. On a
    // phone the keyboard has usually scrolled the page by then.
    const host = inputRef.current?.closest('header, section') as HTMLElement | null
    try {
      const r = await fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: v, website: hp, source: place, page: location.href, eventId, optIn, optInDefault }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return fail(j.error || 'We could not send it. Please try again in a moment.')
      const c = j.coupon !== false
      const t = j.tips === true
      inputRef.current?.blur()
      setSentTo(v); setCoupon(c); setTips(t); setState('done'); markDone(v, c, t); lead(place, eventId)
      window.setTimeout(() => { host?.querySelector('.codecopy')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, 80)
    } catch {
      fail('No connection. Check your signal and try again.')
    }
  }

  return { email, setEmail, hp, setHp, state, setState, msg, inputRef, sentTo, coupon, tips, optIn, setOptIn, submit }
}
