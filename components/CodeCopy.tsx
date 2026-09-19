'use client'

import { useEffect, useRef, useState } from 'react'
import { outbound } from '@/lib/analytics'

/**
 * The code, big, with one button that puts it on the clipboard. Shown the
 * moment the email is accepted, so nobody has to open their inbox to book.
 * Where the clipboard is unavailable (an old in-app browser), the code is
 * selected instead so a long press copies it.
 */
export default function CodeCopy({ code, place }: { code: string; place: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle')
  const codeRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (state === 'idle') return
    const t = window.setTimeout(() => setState('idle'), 2400)
    return () => window.clearTimeout(t)
  }, [state])

  const copy = async () => {
    outbound(`${place}_copy_code`)
    try {
      await navigator.clipboard.writeText(code)
      setState('copied')
    } catch {
      const el = codeRef.current
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r) }
      setState('select')
    }
  }

  return (
    <div className="codecopy">
      <span className="codecopy-code" ref={codeRef}>{code}</span>
      <button type="button" className="codecopy-btn" onClick={copy} aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'select' ? 'Selected, long press to copy' : 'Copy code'}
      </button>
    </div>
  )
}
