'use client'

import { useRef, useState } from 'react'
import { lead, newEventId } from '@/lib/analytics'
import { leadKey, leadSeen, rememberLead, type LeadStore } from '@/lib/trackers.mts'
import type { TipsDefault } from '@/lib/tips.mts'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** localStorage, or undefined where the browser refuses it (private modes, blocked storage). */
function leadStore(): LeadStore | undefined {
  try { return window.localStorage } catch { return undefined }
}

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
let doneDraw = false
const listeners = new Set<(e: string, c: boolean, t: boolean, d: boolean) => void>()
export function markDone(email: string, coupon: boolean, tips = false, draw = false) { doneEmail = email; doneCoupon = coupon; doneTips = tips; doneDraw = draw; listeners.forEach((l) => l(email, coupon, tips, draw)) }

export function useLead(place: string) {
  const [email, setEmail] = useState('')
  const [hp, setHp] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>(doneEmail ? 'done' : 'idle')
  const [msg, setMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [sentTo, setSentTo] = useState(doneEmail ?? '')
  const [coupon, setCoupon] = useState(doneCoupon)
  const [tips, setTips] = useState(doneTips)
  // Whether the server entered this request in the raft draw (lib/giveaway.mts).
  const [draw, setDraw] = useState(doneDraw)

  // Trip tips box: unticked for everyone until the visitor ticks it
  // (lib/tips.mts), so what they saw before touching it is always 'unchecked'.
  const [optIn, setOptIn] = useState(false)
  const optInDefault: TipsDefault = 'unchecked'

  // Subscribe to a success elsewhere on the page.
  useState(() => { const l = (e: string, c: boolean, t: boolean, d: boolean) => { setSentTo(e); setCoupon(c); setTips(t); setDraw(d); setState('done') }; listeners.add(l); return l })

  const fail = (m: string) => { setState('error'); setMsg(m); inputRef.current?.focus() }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = email.trim()
    if (!v) return fail('Enter your email address so we can send your code.')
    if (!EMAIL.test(v)) return fail('That email does not look right. Check the spelling and try again.')
    setState('busy'); setMsg('')
    // The same address from this browser again (a reload brings the form
    // back): the code goes out again, but it is not a new lead, so neither the
    // pixel nor the server reports it (no event id, no lead()).
    const store = leadStore()
    const key = await leadKey(v)
    const repeat = leadSeen(store, key)
    const eventId = repeat ? undefined : newEventId()
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
      const d = j.draw === true
      inputRef.current?.blur()
      setSentTo(v); setCoupon(c); setTips(t); setDraw(d); setState('done'); markDone(v, c, t, d)
      if (!repeat) {
        lead(place, eventId)
        // Remembered only when it was reported: an opted-out visitor's address is never stored.
        if (eventId) rememberLead(store, key)
      }
      window.setTimeout(() => { host?.querySelector('.codecopy')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, 80)
    } catch {
      fail('No connection. Check your signal and try again.')
    }
  }

  return { email, setEmail, hp, setHp, state, setState, msg, inputRef, sentTo, coupon, tips, draw, optIn, setOptIn, submit }
}
