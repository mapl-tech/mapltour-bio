import { out } from '@/lib/data'

const QA = [
  { q: 'Do I pay now or on the day?', a: 'Now, by card or Apple Pay, and the price you see is the price charged. Nothing is added at the airport and there is no account to create.' },
  { q: 'What if my flight is late?', a: 'We track the flight number you give us. A delay moves the pickup with it, and your driver is still outside arrivals with your name on a sign.' },
  { q: 'Can I cancel?', a: 'Yes, within 48 hours of booking, less a 20% admin charge. After that the ride is confirmed with the driver. The full policy is on the main site.' },
  { q: 'How many people fit in one fare?', a: 'Up to 4 passengers with normal luggage for the flat fare. Five to seven are priced on the booking page; eight or more are quoted by email.' },
  { q: 'Which airport?', a: 'Sangster International in Montego Bay (MBJ), where nearly every resort flight lands. Kingston and Port Antonio rides are quoted by email.' },
  { q: 'Who is picking me up?', a: 'A MAPL Tours Jamaica driver. You get their name, vehicle, plate and WhatsApp number before the day, and the driver has your name and flight.' },
]

export default function Faq() {
  return (
    <section className="section" aria-labelledby="faq-h">
      <div className="container">
        <p className="eyebrow">Before you book</p>
        <h2 id="faq-h" className="h2">Questions people ask first.</h2>
        <div className="faq">
          {QA.map((x, i) => (
            <details key={x.q} open={i === 0}>
              <summary>{x.q}</summary>
              <div className="faq-a">{x.a}{i === 2 ? <> <a href={out('/terms', 'faq_terms')}>Read the terms</a>.</> : null}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
