'use client'

import { COUPON, money, out } from '@/lib/data'
import { useLead } from '@/lib/useLead'

export default function Capture() {
  const L = useLead('bio_guide')
  const off = money(COUPON.value)
  return (
    <section id="guide" className="capture section on-dark" aria-labelledby="capture-h">
      <div className="container capture-grid">
        <div>
          <p className="eyebrow">{off} off, by email</p>
          <h2 id="capture-h" className="h2">Your {off} tour code and the arrival guide.</h2>
          <p className="lead">One code, {off} off your first private tour, sent with the Montego Bay arrival guide written by the people who drive it every week.</p>
        </div>
        <div className="capture-card">
          {L.state === 'done' ? (
            <div className="capture-done" role="status">
              <b>{L.coupon ? `Your ${off} code is on its way to ${L.sentTo}.` : `The guide is on its way to ${L.sentTo}.`}</b>
              <p>{L.coupon ? 'Paste it under "Have a gift card?" at checkout and the discount comes off before you pay.' : 'Your code did not generate just now; reply to the email and we send it by hand.'} Not there in a minute? Look in Promotions or Spam.</p>
              <a className="btn btn-gold" href="#tours">Choose a tour</a>
            </div>
          ) : (
            <>
              <ul className="capture-list">
                <li><span><b>{off} off</b> your first tour, one code, valid {Math.round(COUPON.days / 30)} months</span></li>
                <li><span>The walk from the plane to your driver, step by step</span></li>
                <li><span>Every zone&rsquo;s drive time and fare, before you book</span></li>
              </ul>
              <form className="capture-form" onSubmit={L.submit} noValidate action="/api/lead" method="post">
                <label className="capture-label" htmlFor="capture-email">Your email address</label>
                <input id="capture-email" ref={L.inputRef} name="email" className="capture-input" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={L.email} onChange={(e) => { L.setEmail(e.target.value); if (L.state === 'error') L.setState('idle') }} aria-invalid={L.state === 'error'} aria-describedby={L.state === 'error' ? 'capture-err' : undefined} required />
                {L.state === 'error' && <p id="capture-err" className="capture-err" role="alert">{L.msg}</p>}
                <input type="text" name="website" tabIndex={-1} autoComplete="off" value={L.hp} onChange={(e) => L.setHp(e.target.value)} className="visually-hidden" aria-hidden="true" />
                <button type="submit" className="btn btn-gold" disabled={L.state === 'busy'}>{L.state === 'busy' ? 'Sending…' : <>Redeem {off} OFF <span aria-hidden="true">&rarr;</span></>}</button>
                <p className="capture-fine">One code per person, no cash value. Unsubscribe in one tap. <a href={out('/privacy', 'capture_privacy')}>Privacy.</a></p>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
