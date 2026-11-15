'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { out } from '@/lib/data'
import type { ConsentAnswer } from '@/lib/consent.mts'

/**
 * What the card is showing:
 *  - 'ask': the visitor is in the UK, the EU or the EEA and has not answered;
 *  - 'on' / 'off': opened from the footer's "Cookie preferences" by somebody
 *    whose cookies are on or off now, to change their mind;
 *  - 'browser': opened from the footer by somebody whose browser sends Do Not
 *    Track or Global Privacy Control, which nothing here can override.
 */
export type ConsentPromptMode = 'ask' | 'on' | 'off' | 'browser'

/** The question, in one place so the test can hold it to the same words every time. */
export const CONSENT_QUESTION = 'Can we use cookies from Google, Meta and Hotjar to see how people use the site, measure our ads, and show our ads to people who have visited? You get your code either way.'

/**
 * The cookie question (owner, Nov 14 2026). The same card mapltours.com
 * shows, and one answer serves both sites (lib/consent.mts), which is why it
 * names Hotjar although this page does not load it: a yes here turns it on
 * over there. A small card at the TOP of the page, under the logo and the
 * "Price my ride" button, over the hero's picture (on a short screen, over
 * that row itself): never over the email field or the button that sends the
 * code, and never at the bottom, where the offer bar sits. It belongs to
 * the top of the page and not to the screen: it scrolls away with the page,
 * so a visitor who reads on without answering never has it over the price
 * finder they are typing in or the code they were just given.
 *
 * Honest by construction, and it has to stay that way:
 *  - two answers of the same size, weight and colour, side by side, "No
 *    thanks" first; neither is a link, neither is pre-chosen;
 *  - nothing measures or advertises until "Yes" is tapped, so ignoring the
 *    card is a no;
 *  - the sentence says who and what for (measuring the site and our ads,
 *    and showing our ads to people who have visited: a yes covers all three,
 *    because the tags do all three), and that the code comes either way;
 *  - when the page puts it up by itself it does not take the keyboard's
 *    focus or trap it: it is a region a visitor can answer or leave.
 *
 * Rendered into #consent-root, the first element of <body> (app/layout.tsx),
 * so a keyboard or screen-reader user meets it before the page. That is the
 * right place when the page asks, and the wrong one when the visitor opens
 * it from the footer, a whole page away: then (`requested`) the card is
 * pinned to the screen where they are, takes the focus, has a Close of its
 * own (looking is not answering), Escape puts it away too, and Trackers
 * hands the focus back to the button that opened it.
 */
export default function ConsentPrompt({ mode, requested, onAnswer, onClose }: {
  mode: ConsentPromptMode
  /**
   * 0 when the page is asking. Otherwise the visitor opened it (the footer's
   * "Cookie preferences"), and this counts the times, so that pressing the
   * button again brings the keyboard back to the card.
   */
  requested: number
  onAnswer: (answer: ConsentAnswer) => void
  onClose: () => void
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const card = useRef<HTMLElement>(null)
  useEffect(() => { setRoot(document.getElementById('consent-root')) }, [])
  useEffect(() => { if (requested > 0 && root) card.current?.focus() }, [requested, root])
  if (!root) return null

  return createPortal(
    <section
      ref={card}
      className="consent"
      data-consent-prompt=""
      data-requested={requested > 0 ? 'true' : undefined}
      aria-label="Cookie choice"
      tabIndex={-1}
      onKeyDown={requested > 0 ? (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } } : undefined}
    >
      {requested > 0 && mode !== 'browser' && (
        <button type="button" className="consent-close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false">
            <path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {mode === 'browser' ? (
        <>
          <p className="consent-text">Measurement and advertising cookies are off, because your browser asks sites not to track you. There is nothing to choose here.</p>
          <div className="consent-actions">
            <button type="button" className="consent-btn" onClick={onClose}>Close</button>
          </div>
        </>
      ) : (
        <>
          <p className="consent-text">
            {CONSENT_QUESTION}
            {mode === 'on' && <> They are on now.</>}
            {mode === 'off' && <> They are off now.</>}
            {' '}<a href={out('/privacy', 'cookie_privacy')}>Privacy Policy</a>
          </p>
          <div className="consent-actions">
            <button type="button" className="consent-btn" onClick={() => onAnswer('no')}>No thanks</button>
            <button type="button" className="consent-btn" onClick={() => onAnswer('yes')}>Yes, that’s fine</button>
          </div>
        </>
      )}
    </section>,
    root,
  )
}
