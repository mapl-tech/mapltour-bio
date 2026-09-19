'use client'

import { useRef, useState } from 'react'
import { lead, newEventId } from '@/lib/analytics'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * One capture flow shared by the hero, the coupon section and the sticky bar:
 * validate, POST /api/lead, report state. Every form reads the same success
 * flag, so a visitor who redeems in the hero sees the lower form already
 * done. `coupon` is whether the server actually minted a code for them.
 */
let doneEmail: string | null = null
let doneCoupon = false
const listeners = new Set<(e: string, c: boolean) => void>()
export function markDone(email: string, coupon: boolean) { doneEmail = email; doneCoupon = coupon; listeners.forEach((l) => l(email, coupon)) }

export function useLead(place: string) {
  const [email, setEmail] = useState('')
  const [hp, setHp] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>(doneEmail ? 'done' : 'idle')
  const [msg, setMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [sentTo, setSentTo] = useState(doneEmail ?? '')
  const [coupon, setCoupon] = useState(doneCoupon)

  // Subscribe to a success elsewhere on the page.
  useState(() => { const l = (e: string, c: boolean) => { setSentTo(e); setCoupon(c); setState('done') }; listeners.add(l); return l })

  const fail = (m: string) => { setState('error'); setMsg(m); inputRef.current?.focus() }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = email.trim()
    if (!v) return fail('Enter your email address so we can send your code.')
    if (!EMAIL.test(v)) return fail('That email does not look right. Check the spelling and try again.')
    setState('busy'); setMsg('')
    const eventId = newEventId()
    // The section this form lives in, captured now: the input unmounts when
    // the code replaces the form, and the code must land in view. On a
    // phone the keyboard has usually scrolled the page by then.
    const host = inputRef.current?.closest('header, section') as HTMLElement | null
    try {
      const r = await fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: v, website: hp, source: place, page: location.href, eventId }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return fail(j.error || 'We could not send it. Please try again in a moment.')
      const c = j.coupon !== false
      inputRef.current?.blur()
      setSentTo(v); setCoupon(c); setState('done'); markDone(v, c); lead(place, eventId)
      window.setTimeout(() => { host?.querySelector('.codecopy')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, 80)
    } catch {
      fail('No connection. Check your signal and try again.')
    }
  }

  return { email, setEmail, hp, setHp, state, setState, msg, inputRef, sentTo, coupon, submit }
}
