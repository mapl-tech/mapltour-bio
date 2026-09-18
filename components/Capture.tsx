'use client'

import { useRef, useState } from 'react'
import { lead } from '@/lib/analytics'
import { out } from '@/lib/data'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function Capture() {
  const [email, setEmail] = useState('')
  const [hp, setHp] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const fail = (m: string) => { setState('error'); setMsg(m); inputRef.current?.focus() }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = email.trim()
    if (!v) return fail('Enter your email address so we can send the guide.')
    if (!EMAIL.test(v)) return fail('That email does not look right. Check the spelling and try again.')
    setState('busy'); setMsg('')
    try {
      const r = await fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: v, website: hp, source: 'bio', page: location.href }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return fail(j.error || 'We could not send it. Please try again in a moment.')
      setState('done'); lead('bio_guide')
    } catch {
      fail('No connection. Check your signal and try again.')
    }
  }

  return (
    <section id="guide" className="capture section on-dark" aria-labelledby="capture-h">
      <div className="container capture-grid">
        <div>
          <p className="eyebrow">Free, by email, in a minute</p>
          <h2 id="capture-h" className="h2">The Montego Bay arrival guide.</h2>
          <p className="lead">What actually happens between the plane door and your resort, written by the people who drive it every week.</p>
        </div>
        <div className="capture-card">
          {state === 'done' ? (
            <div className="capture-done" role="status">
              <b>Check your inbox.</b>
              <p>The guide is on its way to {email.trim()}. If it is not there in a minute, look in Promotions or Spam and drag it out. Two more short notes follow over the next two weeks, then we leave you alone.</p>
              <a className="btn btn-gold" href="#price">Price my airport ride</a>
            </div>
          ) : (
            <>
              <ul className="capture-list">
                <li>Immigration, customs and the walk to the exit, step by step</li>
                <li>Every zone&rsquo;s drive time and fare, so nobody can surprise you</li>
                <li>What your driver&rsquo;s message looks like, and what to do if your flight moves</li>
                <li>Cash, SIM cards and tipping, in one paragraph each</li>
              </ul>
              <form className="capture-form" onSubmit={submit} noValidate action="/api/lead" method="post">
                <label className="capture-label" htmlFor="capture-email">Your email address</label>
                <input id="capture-email" ref={inputRef} name="email" className="capture-input" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => { setEmail(e.target.value); if (state === 'error') setState('idle') }} aria-invalid={state === 'error'} aria-describedby={state === 'error' ? 'capture-err' : undefined} required />
                {state === 'error' && <p id="capture-err" className="capture-err" role="alert">{msg}</p>}
                <input type="text" name="website" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="visually-hidden" aria-hidden="true" />
                <button type="submit" className="btn btn-gold" disabled={state === 'busy'}>{state === 'busy' ? 'Sending…' : 'Send me the guide'}</button>
                <p className="capture-fine">One guide, two follow-ups, unsubscribe in one tap. We never sell or share your address. <a href={out('/privacy', 'capture_privacy')}>Privacy.</a></p>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
