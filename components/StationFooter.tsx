'use client'

// Every station ends the same way: a sticky bar with one primary "Next"
// button that turns hanko red the moment its gate is met, and a sentence
// that always says why it is or isn't clickable. Added in slice 5b — the
// checkpoint verdict was that the way forward is invisible once the head
// scrolls away. Gates come in already derived, see `lib/gates.ts`.
// Slice 23: under 960 px the bar is a compact one, sticky on phones too; once
// the gate is met its sentence is kept for screen readers only, so the bar is
// one row — the reason a shut button is shut always stays on screen.
import type { Gate } from '@/lib/gates'

type Props = {
  gate: Gate
  /** The button text — "Next: Storyboard". */
  label: string
  /** The sentence shown once the gate is met. */
  ready: string
  /** A short countable state — "1 of 2 sheets locked". */
  progress?: string
  onGo: () => void
}

export function StationFooter({ gate, label, ready, progress, onGo }: Props) {
  return (
    <div className={`station-footer${gate.open ? ' is-open' : ''}`}>
      <div className="station-footer-status">
        {progress && <span className="footer-progress">{progress}</span>}
        <span className="helper footer-sentence" aria-live="polite">
          {gate.open ? ready : (gate.hint ?? 'Not open yet.')}
        </span>
      </div>
      <button type="button" className="btn btn-stamp btn-lg" onClick={onGo} disabled={!gate.open}>
        {label} →
      </button>
    </div>
  )
}
