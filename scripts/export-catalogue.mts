/**
 * Re-export data/tours.json and data/transfers.json from the main site's
 * catalogue, so this page never types a price of its own.
 *
 * Run it from the MAIN repo, which has the TypeScript loader and the catalogue:
 *
 *   cd ../mapltours && npx tsx ../mapl-bio/scripts/export-catalogue.mts          # writes both files
 *   cd ../mapltours && npx tsx ../mapl-bio/scripts/export-catalogue.mts --check  # writes nothing, exits 1 if they are stale
 *
 * It reads the main repo's working tree, so run it on a clean checkout of
 * what is live (the catalogue's own defaults; a rate saved at
 * /admin/tour-rates reaches the main site through its deploy snapshot, and
 * would need that snapshot here too).
 *
 * What it keeps from the files already here: which tours are on the page and
 * their order, each tour's clips and poster, and each hotel's town. Everything
 * else is rebuilt: titles, places, durations, descriptions, what is included,
 * every price and what it covers.
 *
 * A tour's `price` is what one guest's party starts at: the catalogue's own
 * headline (tourPrice for one). `from` is true when it depends on the pickup
 * area, so the card says "From"; `group` is true when that one price covers
 * the whole party up to `tierMax`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAIN = path.resolve(HERE, '../../mapltours')
const TOURS_FILE = path.resolve(HERE, '../data/tours.json')
const TRANSFERS_FILE = path.resolve(HERE, '../data/transfers.json')

const cat = await import(path.join(MAIN, 'lib/experiences.ts'))
const air = await import(path.join(MAIN, 'lib/airport-transfers.ts'))

type OldTour = { slug: string; order: number; video: string | null; mobileVideo: string | null; poster: string | null }
type OldDest = { id: string; town: string | null }

const check = process.argv.includes('--check')
const oldTours = JSON.parse(readFileSync(TOURS_FILE, 'utf8')) as { generatedAt: string; tours: OldTour[] }
const oldTransfers = JSON.parse(readFileSync(TRANSFERS_FILE, 'utf8')) as { generatedAt: string; destinations: OldDest[] }

// ── tours ──
const tours = oldTours.tours.map((old) => {
  const e = cat.experiences.find((x: { title: string }) => cat.getSlug(x) === old.slug)
  if (!e) throw new Error(`"${old.slug}" is on this page but no longer in the main catalogue. Remove it from data/tours.json or fix the slug.`)
  const p = e.pricing
  const group = p.mode === 'group' && !p.perPersonAddon
  return {
    slug: old.slug,
    title: e.title,
    destination: e.destination,
    parish: e.parish,
    duration: e.duration,
    category: e.category,
    price: e.price,
    unit: cat.priceUnitLabel(p),
    tierMax: p.mode === 'group' ? p.tierMax : null,
    description: e.description,
    highlights: e.highlights ?? [],
    tags: e.tags,
    image: e.image,
    video: old.video,
    mobileVideo: old.mobileVideo,
    poster: old.poster,
    included: e.included ?? [],
    order: old.order,
    // What four people pay, from the cheapest pickup area for a tour priced by area.
    price4: cat.tourPrice(p, 4),
    from: cat.isZonePriced(p),
    group,
  }
})

// ── transfers ──
const townOf = new Map(oldTransfers.destinations.map((d) => [d.id, d.town]))
const fare = (id: string, trip: 'one_way' | 'round_trip', pax?: number): number => {
  const v = air.getTransferPrice(id, trip, pax)
  if (typeof v !== 'number') throw new Error(`No ${trip} fare for ${id}`)
  return v
}
// The order already on this page is kept (the finder breaks ties by it); a
// hotel new to the catalogue goes to the end, and one that left it drops out.
type CatDest = { id: string; name: string; parish?: string; zone: string; reopens?: string }
const place = new Map(oldTransfers.destinations.map((d, i) => [d.id, i]))
const ordered: CatDest[] = [...(air.DESTINATIONS as CatDest[])].sort((a, b) => (place.get(a.id) ?? Infinity) - (place.get(b.id) ?? Infinity))
const destinations = ordered.map((d) => ({
  id: d.id,
  name: d.name,
  town: townOf.get(d.id) ?? null,
  parish: d.parish ?? null,
  zone: d.zone,
  ow: fare(d.id, 'one_way'),
  rt: fare(d.id, 'round_trip'),
  // The label as the catalogue holds it. lib/data.ts drops it once the date has passed.
  reopening: d.reopens ?? null,
  popular: air.POPULAR_DESTINATION_IDS.includes(d.id),
  big: [5, 6, 7].map((n) => [fare(d.id, 'one_way', n), fare(d.id, 'round_trip', n)]),
}))
const zones = Object.keys(air.ZONES).map((code) => {
  const info = air.ZONES[code]
  const ow = air.zonePriceRange(code, 'one_way')
  const rt = air.zonePriceRange(code, 'round_trip')
  return { code, label: info.label, duration: info.duration, count: destinations.filter((d: { zone: string }) => d.zone === code).length, owMin: ow.min, owMax: ow.max, rtMin: rt.min }
})
const transfers = {
  zones,
  destinations,
  roundTripDiscount: air.ROUND_TRIP_DISCOUNT,
  cheapestOneWay: Math.min(...destinations.map((d: { ow: number }) => d.ow)),
}

// ── compare, report, write ──
const strip = (o: Record<string, unknown>) => { const { generatedAt: _drop, ...rest } = o; return rest }
const sameTours = JSON.stringify(strip(oldTours as unknown as Record<string, unknown>)) === JSON.stringify({ tours })
const sameTransfers = JSON.stringify(strip(oldTransfers as unknown as Record<string, unknown>)) === JSON.stringify(transfers)

const was = new Map((oldTours.tours as unknown as Record<string, unknown>[]).map((t) => [t.slug as string, t]))
for (const t of tours as unknown as Record<string, unknown>[]) {
  const o = was.get(t.slug as string) ?? {}
  const moved = Object.keys(t).filter((k) => JSON.stringify(o[k]) !== JSON.stringify(t[k]))
  if (moved.length) console.log(`${t.slug}: ${moved.map((k) => `${k} ${JSON.stringify(o[k])} -> ${JSON.stringify(t[k])}`).join('; ')}`)
}
console.log(sameTours ? 'tours: up to date' : 'tours: changed')
console.log(sameTransfers ? 'transfers: up to date' : 'transfers: changed')

if (check) process.exit(sameTours && sameTransfers ? 0 : 1)
const generatedAt = new Date().toISOString()
if (!sameTours) writeFileSync(TOURS_FILE, `${JSON.stringify({ generatedAt, tours }, null, 1)}\n`)
if (!sameTransfers) writeFileSync(TRANSFERS_FILE, `${JSON.stringify({ generatedAt, ...transfers }, null, 1)}\n`)
