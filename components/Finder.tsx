'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { byId, DESTINATIONS, money, out, QUICK_PICK_IDS, ROUND_TRIP_PCT, search, zoneByCode, type Destination } from '@/lib/data'
import { event, outbound } from '@/lib/analytics'

type Trip = 'round_trip' | 'one_way'
const KEY = 'bio-finder'

/** Fare for the party: flat up to 4, then the rate card's 5, 6 and 7 seat prices. */
function fareFor(d: Destination, trip: Trip, pax: number): number {
  if (pax <= 4) return trip === 'round_trip' ? d.rt : d.ow
  const row = d.big?.[Math.min(pax, 7) - 5]
  if (!row) return trip === 'round_trip' ? d.rt : d.ow
  return trip === 'round_trip' ? row[1] : row[0]
}

export default function Finder() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pick, setPick] = useState<Destination | null>(null)
  const [trip, setTrip] = useState<Trip>('round_trip')
  const [pax, setPax] = useState(2)
  const [popKey, setPopKey] = useState(0)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => search(q, 8), [q])
  const quick = useMemo(() => QUICK_PICK_IDS.map(byId).filter(Boolean) as Destination[], [])

  // A visitor who went to look at the booking page and came back finds their
  // ride still priced.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY)
      if (!raw) return
      const s = JSON.parse(raw) as { id?: string; trip?: Trip; pax?: number }
      const d = s.id ? byId(s.id) : undefined
      if (d) { setPick(d); setQ(d.name) }
      if (s.trip === 'one_way' || s.trip === 'round_trip') setTrip(s.trip)
      if (typeof s.pax === 'number' && s.pax >= 1 && s.pax <= 7) setPax(s.pax)
    } catch { /* no-op */ }
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify({ id: pick?.id, trip, pax })) } catch { /* no-op */ }
  }, [pick, trip, pax])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (cardRef.current && !cardRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const choose = (d: Destination, how: string) => {
    setPick(d); setQ(d.name); setOpen(false); setPopKey((k) => k + 1)
    event('bio_quote', { destination: d.id, zone: d.zone, trip, how })
  }

  const price = pick ? fareFor(pick, trip, pax) : null
  const zone = pick ? zoneByCode(pick.zone) : null
  const bookHref = pick ? out('/transfers', 'finder_book', { to: pick.id, trip: trip === 'round_trip' ? 'round-trip' : 'one-way', pax: String(pax) }) : out('/transfers', 'finder_open')
  const listShown = open && !pick

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { if (listShown && results[active]) { e.preventDefault(); choose(results[active], 'enter') } }
    else if (e.key === 'Escape') setOpen(false)
  }

  const onFocus = () => {
    setOpen(true)
    // Put the field at the top so the first results sit above the keyboard.
    if (window.matchMedia('(max-width: 767px)').matches) cardRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <section id="price" className="finder section" aria-labelledby="finder-h">
      <div className="container finder-grid">
        <div>
          <p className="eyebrow">Airport transfers</p>
          <h2 id="finder-h" className="h2">Your resort. Your exact fare. Before you book.</h2>
          <p className="lead">
            Type your hotel and see the all-in price for a private car from Sangster International (MBJ). {DESTINATIONS.length} resorts and villas, one flat fare for up to 4 people, round trips {ROUND_TRIP_PCT}% less than two one-ways.
          </p>
          <ul className="finder-facts" aria-label="Included in every fare">
            <li>Met at arrivals with a name sign</li>
            <li>Flight tracked, a late landing is still met</li>
            <li>Private car, never shared</li>
            <li>Driver&rsquo;s name, plate and WhatsApp before pickup</li>
          </ul>
        </div>

        <div className="finder-card" ref={cardRef}>
          <label className="finder-label" htmlFor="finder-input">Where are you staying?</label>
          <div className="finder-input-wrap">
            <svg className="finder-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              id="finder-input" ref={inputRef} className="finder-input" type="text" inputMode="search" autoComplete="off" autoCorrect="off" spellCheck={false}
              placeholder="Hotel, resort or villa"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPick(null); setOpen(true); setActive(0) }}
              onFocus={onFocus}
              onKeyDown={onKey}
              role="combobox" aria-expanded={listShown && results.length > 0} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={listShown && results[active] ? `${listId}-${results[active].id}` : undefined}
            />
            {q && (
              <button type="button" className="finder-clear" aria-label="Clear the resort" onClick={() => { setQ(''); setPick(null); setOpen(true); inputRef.current?.focus() }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" /></svg>
              </button>
            )}
          </div>

          {listShown && (
            results.length ? (
              <ul className="finder-list" id={listId} role="listbox" aria-label="Matching resorts">
                {results.map((d, i) => (
                  <li key={d.id} role="option" id={`${listId}-${d.id}`} aria-selected={i === active} className={`finder-opt${i === active ? ' is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(d, 'list')} onMouseEnter={() => setActive(i)}>
                    <span><b>{d.name}</b><small>{[d.parish, zoneByCode(d.zone)?.duration].filter(Boolean).join(' · ')}{d.reopening ? ` · reopening ${d.reopening}` : ''}</small></span>
                    <span className="price">{money(d.ow)} / {money(d.rt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="finder-list finder-empty" role="status">
                No match for &ldquo;{q}&rdquo;. Try the resort&rsquo;s name without the brand, or <a href={out('/transfers', 'finder_nomatch')} onClick={() => outbound('finder_nomatch')}>ask for a quote on the main site</a>. Kingston, Port Antonio and groups of 8 or more are quoted by email.
              </div>
            )
          )}

          <div className={`chips${pick ? ' is-dim' : ''}`} role="group" aria-label="Popular resorts">
            {quick.map((d) => (
              <button key={d.id} type="button" className="chip" aria-pressed={pick?.id === d.id} onClick={() => choose(d, 'chip')} onFocus={(e) => e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' })}>{d.name.replace(/ (Beach )?Resort( & Spa)?(, .*)?$/i, '')}</button>
            ))}
          </div>

          <div className="finder-row">
            <div className="seg" role="group" aria-label="Trip type">
              <button type="button" aria-pressed={trip === 'round_trip'} onClick={() => { setTrip('round_trip'); setPopKey((k) => k + 1) }}>Round trip<small className="seg-offer">{ROUND_TRIP_PCT}% off</small></button>
              <button type="button" aria-pressed={trip === 'one_way'} onClick={() => { setTrip('one_way'); setPopKey((k) => k + 1) }}>One way<small>either direction</small></button>
            </div>
            <div className="stepper" role="group" aria-label="Passengers">
              <span>Passengers</span>
              <div>
                <button type="button" aria-label="Fewer passengers" onClick={() => setPax((p) => Math.max(1, p - 1))} disabled={pax <= 1}>&minus;</button>
                <b aria-live="polite">{pax}</b>
                <button type="button" aria-label="More passengers" onClick={() => setPax((p) => Math.min(7, p + 1))} disabled={pax >= 7}>+</button>
              </div>
            </div>
          </div>

          {pick && price != null && zone ? (
            <div className="quote pop on-dark" key={popKey} aria-live="polite">
              <div>
                <div className="quote-route">{trip === 'round_trip' ? 'MBJ to your resort and back' : 'MBJ to your resort, or back'}<b>{pick.name}</b></div>
                <div className="quote-price" style={{ marginTop: 10 }}>
                  <strong>{money(price)}</strong>
                  <span>{pax <= 4 ? 'per car, up to 4 people' : `per car, ${pax} passengers`}</span>
                </div>
                <div className="quote-meta"><b>{zone.duration}</b> · Zone {zone.code} · {pick.reopening ? `Reopening ${pick.reopening}, bookable for stays from then` : 'Locked at checkout, nothing added at the airport'}</div>
              </div>
              <a className="btn btn-gold" href={bookHref} onClick={() => outbound('finder_book', { destination: pick.id, trip, pax })}>Book this ride</a>
              <p className="quote-note">Next page: your dates, flight number and payment. Nothing else to fill in. Cancel within 48 hours of booking, less a 20% admin charge.</p>
            </div>
          ) : (
            <div className="quote-empty">
              <b>Pick a resort to see the fare.</b> Every price is the full amount for a private car, shown before you give any details. Not booking yet? <a href="#guide">Get the free arrival guide by email</a>. Or <a href={out('/transfers', 'finder_all')} onClick={() => outbound('finder_all')}>see every fare on mapltours.com</a>.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
