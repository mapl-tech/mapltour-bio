import Hero from '@/components/Hero'
import Finder from '@/components/Finder'
import Proof from '@/components/Proof'
import Zones from '@/components/Zones'
import Recent from '@/components/Recent'
import Tours from '@/components/Tours'
import Faq from '@/components/Faq'
import Guides from '@/components/Guides'
import Capture from '@/components/Capture'
import Footer from '@/components/Footer'
import StickyBar from '@/components/StickyBar'
import Reveal from '@/components/Reveal'
import { DESTINATIONS, CHEAPEST_ONE_WAY, SITE } from '@/lib/data'

const ld = {
  '@context': 'https://schema.org',
  '@type': 'TaxiService',
  name: 'MAPL Tours Jamaica',
  url: 'https://bio.mapltours.com',
  sameAs: [SITE, 'https://www.instagram.com/mapltoursjamaica', 'https://www.tiktok.com/@mapltoursjamaica'],
  areaServed: 'Jamaica',
  provider: { '@type': 'LocalBusiness', name: 'MAPL Tours Jamaica', url: SITE },
  description: `Private airport transfers from Sangster International (MBJ) to ${DESTINATIONS.length} resorts, from $${CHEAPEST_ONE_WAY} one way per vehicle, and private tours across Jamaica.`,
}

export default function Page() {
  return (
    <>
      <Hero />
      <main>
        <Finder />
        <Proof />
        <Zones />
        <Recent />
        <Tours />
        <Capture />
        <Faq />
        <Guides />
      </main>
      <Footer />
      <StickyBar />
      <Reveal />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
    </>
  )
}
