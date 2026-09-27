import type { Metadata, Viewport } from 'next'
import { DM_Sans } from 'next/font/google'
import Trackers from '@/components/Trackers'
import { RAFT_SCRIPT } from '@/lib/giveaway.mts'
import { LANDING_SCRIPT } from '@/lib/landing.mts'
import './globals.css'

// Upright only: nothing on this page is italic, and the italic file would be
// 40 KB preloaded ahead of the hero for no visible gain.
const dmSans = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], display: 'swap', variable: '--font-dm-sans' })

export const metadata: Metadata = {
  metadataBase: new URL('https://bio.mapltours.com'),
  title: 'MAPL Tours Jamaica | Airport transfers and tours, one price for up to 4',
  description: 'Private airport transfers from Montego Bay (MBJ) to 199 resorts, priced before you book, and tours run by locals. 5% off your first tour or airport ride.',
  openGraph: {
    title: 'MAPL Tours Jamaica',
    description: 'Private airport transfers from MBJ, one flat price for up to 4 people. Tours run by locals. 5% off your first tour or airport ride, by email.',
    url: 'https://bio.mapltours.com',
    siteName: 'MAPL Tours Jamaica',
    images: [{ url: '/media/og.jpg', width: 1200, height: 630 }],
    type: 'website',
  },
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://bio.mapltours.com' },
}

export const viewport: Viewport = { themeColor: '#111110', width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable}>
      <head>
        {/* Marks the document as scripted before first paint, so the reveal
            animation only hides content when JS is there to show it again;
            and marks a raft-ad visit, so the hero shows the prize card from
            the first paint (lib/giveaway.mts); and lands every arrival at
            the top, where the code form is (lib/landing.mts). */}
        <script dangerouslySetInnerHTML={{ __html: `document.documentElement.classList.add('js');${LANDING_SCRIPT}${RAFT_SCRIPT}` }} />
      </head>
      <body>
        {children}
        <Trackers />
      </body>
    </html>
  )
}
