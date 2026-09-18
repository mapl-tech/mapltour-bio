import { byId, money } from '@/lib/data'

/**
 * Real rides from the bookings table, no names. The amount shown is today's
 * fare for the same ride, so it always matches what the finder says.
 */
const RIDES = [
  { id: 'samsara-cliff-negril', where: 'Samsara Cliff Resort, Negril', what: 'Round trip, party of 4, booked 3 months ahead' },
  { id: 'azul-beach-negril', where: 'Azul Beach Resort, Negril', what: 'Round trip, party of 4, booked the day before' },
  { id: 'grand-palladium-lucea', where: 'Grand Palladium, Lucea', what: 'Round trip, a couple, booked 3 months ahead' },
]

export default function Recent() {
  return (
    <section className="section-tight" aria-labelledby="recent-h" data-tone="warm">
      <div className="container">
        <p className="eyebrow">Booked with us</p>
        <h2 id="recent-h" className="h2 h2-sm">Rides booked with us.</h2>
        <p className="lead lead-sm">Real bookings, no names. The fare beside each is today&rsquo;s price for the same ride, round trip.</p>
        <div className="recent">
          {RIDES.map((r) => (
            <div className="recent-item" key={r.where}>
              <span className="dot" aria-hidden="true" />
              <div><b>{r.where}</b><span>{r.what}</span></div>
              <em>{money(byId(r.id)?.rt ?? 0)}</em>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
