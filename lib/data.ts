import transfers from '@/data/transfers.json'
import offer from '../data/offer.json'
import toursJson from '@/data/tours.json'

export const SITE = 'https://mapltours.com'

export type Zone = { code: string; label: string; duration: string; count: number; owMin: number; owMax: number; rtMin: number }
export type Destination = { id: string; name: string; town: string | null; parish: string | null; zone: string; ow: number; rt: number; reopening: string | null; popular: boolean; big?: number[][] }
export type Tour = {
  slug: string; title: string; destination: string; parish: string; duration: string; category: string
  price: number; unit: string; tierMax: number | null; description: string; highlights: string[]; tags: string[]
  image: string; video: string | null; mobileVideo: string | null; poster: string | null; price4?: number | null
}

export const ZONES: Zone[] = transfers.zones
export const DESTINATIONS: Destination[] = transfers.destinations
export const CHEAPEST_ONE_WAY: number = transfers.cheapestOneWay
/** The bio coupon: value in USD, validity in days. Minted by netlify/lib/coupon.mts. */
export const COUPON = { value: offer.value as number, days: offer.days as number }
export const ROUND_TRIP_PCT = Math.round(transfers.roundTripDiscount * 100)
export const TOURS: Tour[] = toursJson.tours

export const zoneByCode = (code: string) => ZONES.find((z) => z.code === code)

/** Quick picks: the resorts guests actually search and book, in that order. */
export const QUICK_PICK_IDS = [
  'sandals-negril', 'beaches-negril', 'riu-ocho-rios', 'samsara-cliff-negril', 'royalton-negril',
  'grand-palladium-lucea', 'excellence-oyster-bay', 'iberostar-rose-hall', 'sandals-ochi', 'azul-beach-negril',
]

export const money = (n: number) => `$${n.toLocaleString('en-US')}`

/** Outbound link to the shop, tagged so the booking attributes to this page. */
export function out(path: string, content: string, extra: Record<string, string> = {}): string {
  const u = new URL(path, SITE)
  u.searchParams.set('utm_source', 'bio')
  u.searchParams.set('utm_medium', 'bio')
  u.searchParams.set('utm_campaign', 'bio_page')
  u.searchParams.set('utm_content', content)
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v)
  return u.toString()
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const STOP = new Set(['the', 'hotel', 'resort', 'resorts', 'and', 'spa', 'beach', 'jamaica', 'villa', 'villas', 'suites', 'inn', 'by', 'at', 'of', 'in'])

type Indexed = { d: Destination; hay: string; strong: string[] }
let INDEX: Indexed[] | null = null
function index(): Indexed[] {
  if (INDEX) return INDEX
  INDEX = DESTINATIONS.map((d) => {
    const strong = fold(d.name).split(' ').filter(Boolean)
    const hay = fold([d.name, d.town ?? '', d.parish ?? '', d.id.replace(/-/g, ' ')].join(' '))
    return { d, hay, strong }
  })
  return INDEX
}

/** Forgiving hotel search: every typed word must start a word somewhere in name, town or parish. */
export function search(query: string, limit = 8): Destination[] {
  const q = fold(query)
  if (!q) return QUICK_PICK_IDS.map((id) => DESTINATIONS.find((d) => d.id === id)).filter(Boolean).slice(0, limit) as Destination[]
  const words = q.split(' ').filter((w) => w && !STOP.has(w))
  const tokens = words.length ? words : q.split(' ')
  const scored: { d: Destination; s: number }[] = []
  for (const { d, hay, strong } of index()) {
    let s = 0
    let ok = true
    for (const t of tokens) {
      const inName = strong.some((w) => w.startsWith(t))
      const inHay = hay.split(' ').some((w) => w.startsWith(t)) || (t.length >= 4 && hay.includes(t))
      if (!inName && !inHay) { ok = false; break }
      s += inName ? 3 : 1
      if (strong[0]?.startsWith(t)) s += 2
    }
    if (ok) scored.push({ d, s: s + (d.popular ? 1 : 0) })
  }
  return scored.sort((a, b) => b.s - a.s || a.d.name.localeCompare(b.d.name)).slice(0, limit).map((x) => x.d)
}

export const byId = (id: string) => DESTINATIONS.find((d) => d.id === id)
