import Lazy from './Lazy'

const ITEMS = [
  { img: '/media/proof-arrivals.webp', h: 'Met at arrivals, name on a sign', p: 'Your driver waits just outside the arrivals hall with your name. No taxi rank, no negotiating with a bag in each hand.' },
  { img: '/media/proof-flight.webp', h: 'We track your flight', p: 'Land early or two hours late, the driver is there when you walk out. The pickup follows the plane, not the clock.' },
  { img: '/media/proof-car.webp', h: 'Private car, never shared', p: 'One flat fare for the car, up to 4 people. Straight to your resort with no other stops and no other guests.' },
  { img: '/media/proof-driver.webp', h: 'Driver details before pickup', p: 'Name, vehicle, plate and WhatsApp number reach you before pickup: the evening before a morning landing, that morning for an afternoon one.' },
]

export default function Proof() {
  return (
    <section className="section" aria-labelledby="proof-h">
      <div className="container">
        <p className="eyebrow">How a MAPL ride works</p>
        <h2 id="proof-h" className="h2">Everything is arranged before you land.</h2>
        <p className="lead">A local Jamaican family business. What you see here is what happens on the day.</p>
        <div className="proof-list">
          {ITEMS.map((it, i) => (
            <article className="proof reveal on-dark" key={it.h}>
              <Lazy><img src={it.img} alt="" decoding="async" loading="lazy" width={900} height={1125} /></Lazy>
              <div className="proof-body">
                <span className="proof-n" aria-hidden="true">{i + 1}</span>
                <h3>{it.h}</h3>
                <p>{it.p}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
