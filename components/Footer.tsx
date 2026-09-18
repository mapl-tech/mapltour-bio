import { out } from '@/lib/data'

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
          <a href="https://www.instagram.com/mapltoursjamaica" rel="noopener noreferrer" target="_blank">Instagram</a>
          <a href="https://www.tiktok.com/@mapltoursjamaica" rel="noopener noreferrer" target="_blank">TikTok</a>
        </nav>
        <p className="footer-small">
          MAPL Tours Jamaica. Private airport transfers from Sangster International (MBJ) and tours across Jamaica. Prices in USD per vehicle. <a href={out('/terms', 'footer_terms')}>Terms</a> <span aria-hidden="true">·</span> <a href={out('/privacy', 'footer_privacy')}>Privacy</a>
        </p>
      </div>
    </footer>
  )
}
