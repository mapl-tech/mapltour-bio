import { money } from '@/lib/data'

/** Real rides, from the bookings table, no names. Update when new ones are paid. */
const RIDES = [
  { where: 'Samsara Cliff Resort, Negril', what: 'Round trip, party of 4, booked 3 months ahead', price: 199 },
  { where: 'Azul Beach Resort, Negril', what: 'Round trip, party of 4, booked the day before', price: 154 },
  { where: 'Grand Palladium, Lucea', what: 'Round trip, couple, booked 3 months ahead', price: 132 },
]

export default function Recent() {
  return (
    <section className="section-tight" aria-labelledby="recent-h" style={{ background: 'var(--bg-warm)', borderTop: '1px solid var(--border)' }}>
      <div className="container">
        <p className="eyebrow">Recently booked</p>
        <h2 id="recent-h" className="h2" style={{ fontSize: 'clamp(22px, 2vw + 12px, 30px)' }}>Rides guests have paid for, at the price they saw.</h2>
        <div className="recent">
          {RIDES.map((r) => (
            <div className="recent-item" key={r.where}>
              <span className="dot" aria-hidden="true" />
              <div><b>{r.where}</b><span>{r.what}</span></div>
              <em>{money(r.price)}</em>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
