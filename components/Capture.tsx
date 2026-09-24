'use client'

import { COUPON, offerLabel, out } from '@/lib/data'
import { useLead } from '@/lib/useLead'
import { TIPS_LABEL, TIPS_ON } from '@/lib/tips.mts'
import CodeCopy from './CodeCopy'

const BRAND = 'MAPL Tours Jamaica'

/**
 * The trip tips box, in this form and the hero's. The whole row is the label.
 * The words are TIPS_LABEL exactly (the lead function stores that constant as
 * the consent text); the only styling is that the brand name never breaks
 * across two lines.
 */
export function TipsRow({ id, className, checked, onChange }: { id: string; className: string; checked: boolean; onChange: (on: boolean) => void }) {
  const at = TIPS_LABEL.indexOf(BRAND)
  return (
    <label className={`tips-row ${className}`} htmlFor={id}>
      <input id={id} type="checkbox" name="tips" value="yes" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{at < 0 ? TIPS_LABEL : <>{TIPS_LABEL.slice(0, at)}<span className="tips-brand">{BRAND}</span>{TIPS_LABEL.slice(at + BRAND.length)}</>}</span>
    </label>
  )
}

export default function Capture() {
  const L = useLead('bio_coupon')
  const off = offerLabel()
  return (
    <section id="coupon" className="capture section on-dark" aria-labelledby="capture-h">
      <div className="container capture-grid">
        <div>
          <p className="eyebrow">{off} off, by email</p>
          <h2 id="capture-h" className="h2">Your {off} code for your first tour or ride.</h2>
          <p className="lead">One code, {off} off any private tour or airport ride with us. We email it to you in a minute and it comes off at checkout on mapltours.com.</p>
        </div>
        <div className="capture-card">
          {L.state === 'done' ? (
            <div className="capture-done" role="status">
              <b>Here is your {off} code. It is on its way to {L.sentTo} too.</b>
              <CodeCopy code={COUPON.code} place="capture" />
              <p>Paste it in the discount code box at checkout and {off} comes off before you pay. Not in your inbox in a minute? Look in Promotions or Spam.</p>
              {L.tips && <p className="tips-on">{TIPS_ON}</p>}
              <a className="btn btn-gold" href="#tours">Choose a tour</a>
            </div>
          ) : (
            <>
              <ul className="capture-list">
                <li><span><b>{off} off</b> your first tour or airport ride, one use per email</span></li>
                <li><span>Works on every tour and every resort ride</span></li>
                <li><span>Enter it in the discount code box at checkout</span></li>
              </ul>
              <form className="capture-form" onSubmit={L.submit} noValidate action="/api/lead" method="post">
                <label className="capture-label" htmlFor="capture-email">Your email address</label>
                <input id="capture-email" ref={L.inputRef} name="email" className="capture-input" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={L.email} onChange={(e) => { L.setEmail(e.target.value); if (L.state === 'error') L.setState('idle') }} aria-invalid={L.state === 'error'} aria-describedby={L.state === 'error' ? 'capture-err' : 'capture-fine'} required />
                {L.state === 'error' && <p id="capture-err" className="capture-err" role="alert">{L.msg}</p>}
                <input type="text" name="website" tabIndex={-1} autoComplete="off" value={L.hp} onChange={(e) => L.setHp(e.target.value)} className="visually-hidden" aria-hidden="true" />
                {/* Before the button, in the markup and on a phone: the box is seen and reached before the tap that sends it. */}
                <TipsRow id="capture-tips" className="capture-tips" checked={L.optIn} onChange={L.setOptIn} />
                <button type="submit" className="btn btn-gold" disabled={L.state === 'busy'}>{L.state === 'busy' ? 'Sending…' : <>Redeem {off} OFF <span aria-hidden="true">&rarr;</span></>}</button>
                <input type="hidden" name="place" value="bio_coupon" />
                <p id="capture-fine" className="capture-fine">One use per email address, no cash value. Unsubscribe in one tap. <a href={out('/privacy', 'capture_privacy')}>Privacy.</a></p>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
