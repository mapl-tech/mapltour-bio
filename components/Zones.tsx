'use client'

import { useRef, useState } from 'react'
import { DESTINATIONS, money, ZONES } from '@/lib/data'
import { event } from '@/lib/analytics'
import Lazy from './Lazy'

const SAMPLE: Record<string, string[]> = {
  A: ['iberostar-rose-hall', 'riu-montego-bay', 'riu-palace-jamaica', 'half-moon-resort', 'deja-resort'],
  B: ['excellence-oyster-bay', 'royalton-white-sands', 'ocean-coral-spring'],
  C: ['grand-palladium-lucea', 'round-hill', 'tryall-club'],
  D: ['sandals-negril', 'beaches-negril', 'royalton-negril', 'azul-beach-negril', 'bahia-principe-runaway-bay'],
  E: ['sandals-ochi', 'riu-ocho-rios', 'moon-palace-ocho-rios', 'jamaica-inn', 'sandals-south-coast'],
}

const pick = (id: string | null) => window.dispatchEvent(new CustomEvent('bio:pick', { detail: id }))

export default function Zones() {
  const [code, setCode] = useState('A')
  const tabsRef = useRef<HTMLDivElement>(null)
  const z = ZONES.find((x) => x.code === code) ?? ZONES[0]
  const sample = (SAMPLE[z.code] ?? []).map((id) => DESTINATIONS.find((d) => d.id === id)).filter((d) => d && !d.reopening) as typeof DESTINATIONS
  const hotels = sample.length >= 3 ? sample : DESTINATIONS.filter((d) => d.zone === z.code && !d.reopening).slice(0, 5)
  const range = z.owMax > z.owMin

  const select = (c: string, how: string) => {
    setCode(c); event('bio_zone', { zone: c, how })
    const el = tabsRef.current?.querySelector<HTMLButtonElement>(`#zone-tab-${c}`)
    el?.focus(); el?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }
  const onKey = (e: React.KeyboardEvent) => {
    const i = ZONES.findIndex((x) => x.code === code)
    const go = (n: number) => { e.preventDefault(); select(ZONES[(n + ZONES.length) % ZONES.length].code, 'key') }
    if (e.key === 'ArrowRight') go(i + 1)
    else if (e.key === 'ArrowLeft') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(ZONES.length - 1)
  }

  return (
    <section className="zones section on-dark" aria-labelledby="zones-h">
      <div className="container">
        <p className="eyebrow">How far is your resort?</p>
        <h2 id="zones-h" className="h2">Five zones from the airport. Here is the range for yours.</h2>
        <p className="lead">Fares depend on how far your resort is from the airport. Pick your stretch of coast for the drive time and the fares, then tap a resort to price it.</p>
        <div className="zone-tabs" role="tablist" aria-label="Zones" ref={tabsRef} onKeyDown={onKey}>
          {ZONES.map((x) => (
            <button key={x.code} role="tab" type="button" className="zone-tab" aria-selected={x.code === code} tabIndex={x.code === code ? 0 : -1} aria-controls="zone-panel" id={`zone-tab-${x.code}`} onClick={() => select(x.code, 'tap')}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="zone-panel pop" id="zone-panel" role="tabpanel" aria-labelledby={`zone-tab-${z.code}`} key={z.code}>
          <div className="zone-img">
            <Lazy>
              <picture>
                <source media="(max-width: 767px)" srcSet={`/media/zone-${z.code}-p.webp`} type="image/webp" />
                <img src={`/media/zone-${z.code}.webp`} alt="" decoding="async" width={880} height={660} />
              </picture>
            </Lazy>
          </div>
          <div className="zone-info">
            <h3>{z.label}</h3>
            <dl className="zone-stats">
              <div className="zone-stat"><dt>Drive from MBJ</dt><dd>{z.duration.replace(' from MBJ', '')}</dd></div>
              <div className="zone-stat"><dt>One way, per car</dt><dd>{range ? `${money(z.owMin)} to ${money(z.owMax)}` : money(z.owMin)}</dd></div>
              <div className="zone-stat"><dt>Round trip, per car</dt><dd>{range ? `from ${money(z.rtMin)}` : money(z.rtMin)}</dd></div>
            </dl>
            <ul className="zone-hotels" aria-label={`Resorts in ${z.label}, tap one to price it`}>
              {hotels.map((d) => <li key={d.id}><button type="button" onClick={() => pick(d.id)}>{d.name}</button></li>)}
              <li><button type="button" className="zone-more" onClick={() => pick(null)}>+ {Math.max(0, z.count - hotels.length)} more, search yours</button></li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
