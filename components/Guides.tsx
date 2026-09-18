import { out } from '@/lib/data'

const POSTS = [
  { slug: 'best-time-to-visit-jamaica', tag: 'Planning', title: 'Best time to visit Jamaica', blurb: 'Weather, prices and crowds month by month, so you book the right week.' },
  { slug: 'nine-mile-marley-pilgrimage', tag: 'Culture', title: "Nine Mile: Bob Marley's birthplace and mausoleum", blurb: 'Hours, the entry fee and the drive from Montego Bay, Ocho Rios and Negril.' },
  { slug: 'reach-falls-vs-dunns-river', tag: 'Waterfalls', title: "Reach Falls vs Dunn's River", blurb: 'Which waterfall wins for crowds, cost and the climb, from people who do both.' },
]

export default function Guides() {
  return (
    <section className="section" aria-labelledby="guides-h" style={{ background: 'var(--bg-warm)', borderTop: '1px solid var(--border)' }}>
      <div className="container">
        <p className="eyebrow">Read before you go</p>
        <h2 id="guides-h" className="h2">Local answers, not brochure copy.</h2>
        <div className="guides">
          {POSTS.map((p) => (
            <a key={p.slug} className="guide" href={out(`/blog/${p.slug}`, `guide_${p.slug}`)}>
              <small>{p.tag}</small>
              <b>{p.title}</b>
              <span>{p.blurb}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
