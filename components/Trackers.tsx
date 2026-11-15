'use client'

import { useEffect, useRef, useState } from 'react'
import { setTagsRunning, startTrackers, trackingAllowed } from '@/lib/analytics'
import { afterLoadAndIdle, type ScheduleWindow } from '@/lib/trackers.mts'
import { browserOptedOut, onConsentPromptRequest, setConsent, watchConsent } from '@/lib/consent-browser.mts'
import type { ConsentAnswer, ConsentDecision } from '@/lib/consent.mts'
import ConsentPrompt, { type ConsentPromptMode } from './ConsentPrompt'

/**
 * GA4 + Meta pixel (lib/trackers.mts), started only when tracking is
 * allowed, after the load event and once the main thread is idle
 * (afterLoadAndIdle), so on a slow connection the page's own images and
 * clips are never behind 240 KB of tag scripts. A visitor who asks for the
 * code before then starts them from lead() instead; they start once either
 * way (one init, one PageView).
 *
 * Since Nov 14 2026 a visitor in the UK, the EU or the EEA gets neither
 * until they say yes to the cookie question (lib/consent.mts holds the rule,
 * ConsentPrompt asks it). This component waits for that answer ('wait'
 * starts nothing), shows the question, and is where a yes starts the tags
 * and a later no switches them off. lib/consent-browser.mts keeps the
 * decision current (at load, on an answer, when the tab is looked at again)
 * and is the one that looks the country up.
 */
export default function Trackers() {
  // 'wait' until the visitor has been placed: the server render and the first
  // client render agree on it, and nothing starts while it stands.
  const [decision, setDecision] = useState<ConsentDecision>('wait')
  // Opened by the visitor from the footer's "Cookie preferences": 0 when it
  // was not, and one more each time it is, so a second press brings the
  // keyboard to the card again.
  const [request, setRequest] = useState(0)
  // The button that opened it, so the keyboard goes back there when the card is put away.
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const watch = watchConsent(setDecision)
    const offOpen = onConsentPromptRequest((from) => {
      opener.current = from
      setRequest((n) => n + 1)
    })
    return () => { watch.stop(); offOpen() }
  }, [])

  useEffect(() => {
    // An answer that stopped being yes (here, in another tab, on
    // mapltours.com, or because it lapsed): the tags, if they are on the
    // page, are switched off where they stand. No reload: this page has no
    // tag that cannot be stopped, and the visitor keeps what they were doing.
    if (decision !== 'allow') {
      if (decision !== 'wait') setTagsRunning(false)
      return
    }
    setTagsRunning(true)
    // trackingAllowed asks the same rule again, with the host and the
    // browser's own signals, and so does startTrackers when the idle moment
    // comes: an answer that changed in between is the one that counts.
    if (!trackingAllowed()) return
    return afterLoadAndIdle(window as unknown as ScheduleWindow, () => startTrackers())
  }, [decision])

  /** Put away a card the visitor opened, and give the keyboard back to the button that opened it, without moving the page. */
  const close = () => {
    setRequest(0)
    const back = opener.current
    opener.current = null
    if (back && document.contains(back)) back.focus({ preventScroll: true })
  }

  const answer = (a: ConsentAnswer) => {
    // Before the answer is recorded, because recording a no clears the tags'
    // cookies: a tag still running would write them straight back.
    if (a === 'no') setTagsRunning(false)
    setConsent(a)
    close()
  }

  const mode: ConsentPromptMode | null = request > 0
    ? (browserOptedOut() ? 'browser' : decision === 'allow' ? 'on' : decision === 'deny' ? 'off' : 'ask')
    : decision === 'ask' ? 'ask' : null

  return mode ? <ConsentPrompt mode={mode} requested={request} onAnswer={answer} onClose={close} /> : null
}
