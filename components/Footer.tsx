'use client'

import { out } from '@/lib/data'
import { SOCIALS } from '@/lib/socials'
import { outbound } from '@/lib/analytics'

export default function Footer() {
  return (
    <footer className="footer on-dark">
      <div className="container">
        <nav className="footer-row" aria-label="Site">
          <img src="/media/logo-dark.svg" alt="MAPL Tours Jamaica" width={95} height={34} />
          <a href={out('/transfers', 'footer_transfers')}>Airport transfers</a>
          <a href={out('/explore', 'footer_tours')}>Tours</a>
          <a href={out('/gifts', 'footer_gifts')}>Gift cards</a>
          <a href={out('/contact', 'footer_contact')}>Contact</a>
        </nav>
        <ul className="footer-social" aria-label="MAPL Tours Jamaica on social media">
          {SOCIALS.map((s) => (
            <li key={s.label}>
              <a href={s.href} rel="noopener noreferrer" target="_blank" aria-label={`MAPL Tours Jamaica on ${s.label}`} onClick={() => outbound(`footer_${s.label.toLowerCase()}`)}>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width={22} height={22}><path d={s.d} /></svg>
                <span>{s.label}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="footer-small">
          MAPL Tours Jamaica. Private airport transfers from Sangster International (MBJ) and tours across Jamaica. Prices in USD. <a href={out('/terms', 'footer_terms')}>Terms</a> <span aria-hidden="true">·</span> <a href={out('/privacy', 'footer_privacy')}>Privacy</a>
        </p>
      </div>
    </footer>
  )
}
