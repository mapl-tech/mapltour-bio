'use client'

import { useState } from 'react'
import { DESTINATIONS, money, out, ZONES } from '@/lib/data'
import { event, outbound } from '@/lib/analytics'

const SAMPLE: Record<string, string[]> = {
  A: ['iberostar-rose-hall', 'secrets-wild-orchid', 'sandals-montego-bay', 'holiday-inn-montego-bay', 'deja-resort'],
  B: ['excellence-oyster-bay', 'royalton-white-sands', 'ocean-coral-spring'],
  C: ['grand-palladium-lucea', 'round-hill', 'tryall-club'],
  D: ['sandals-negril', 'beaches-negril', 'royalton-negril', 'azul-beach-negril', 'bahia-principe-runaway-bay'],
  E: ['sandals-ochi', 'riu-ocho-rios', 'moon-palace-ocho-rios', 'jamaica-inn', 'sandals-south-coast'],
}

export default function Zones() {
  const [code, setCode] = useState('D')
  const z = ZONES.find((x) => x.code === code) ?? ZONES[0]
  const names = (SAMPLE[z.code] ?? []).map((id) => DESTINATIONS.find((d) => d.id === id)?.name).filter(Boolean) as string[]
  const fallback = DESTINATIONS.filter((d) => d.zone === z.code).slice(0, 5).map((d) => d.name)
  const hotels = names.length >= 3 ? names : fallback

  return (
    <section className="zones section on-dark" aria-labelledby="zones-h">
      <div className="container">
        <p className="eyebrow">How far is your resort?</p>
        <h2 id="zones-h" className="h2">Five zones from the airport, one fare each way.</h2>
        <p className="lead">Fares are set by zone, so two resorts on the same stretch of coast cost the same. Pick yours.</p>
        <div className="zone-tabs" role="tablist" aria-label="Zones">
          {ZONES.map((x) => (
            <button key={x.code} role="tab" type="button" className="zone-tab" aria-selected={x.code === code} aria-controls="zone-panel" id={`zone-tab-${x.code}`} onClick={() => { setCode(x.code); event('bio_zone', { zone: x.code }) }}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="zone-panel pop" id="zone-panel" role="tabpanel" aria-labelledby={`zone-tab-${z.code}`} key={z.code}>
          <img src={`/media/zone-${z.code}.webp`} alt="" loading="lazy" decoding="async" width={400} height={300} />
          <div className="zone-info">
            <h3>{z.label}</h3>
            <div className="zone-stats">
              <div className="zone-stat"><b>{z.duration.replace(' from MBJ', '')}</b><span>from MBJ</span></div>
              <div className="zone-stat"><b>{money(z.owMin)}{z.owMax > z.owMin ? '+' : ''}</b><span>one way, per car</span></div>
              <div className="zone-stat"><b>{money(z.rtMin)}{z.owMax > z.owMin ? '+' : ''}</b><span>round trip, per car</span></div>
            </div>
            <ul className="zone-hotels" aria-label={`Resorts in ${z.label}`}>
              {hotels.map((n) => <li key={n}>{n}</li>)}
              <li>+ {Math.max(0, z.count - hotels.length)} more</li>
            </ul>
            <a className="btn btn-gold" href="#price" onClick={() => outbound('zone_price', { zone: z.code })}>Find my resort&rsquo;s fare</a>
          </div>
        </div>
      </div>
    </section>
  )
}
