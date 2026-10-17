'use client'

// One shot of a trailer being made (v3, slice 22): a small card with the panel
// it animates, "Panel 2 · 4 s", where it stands in four plain words — Waiting
// its turn, Animating, Done, Didn’t finish — and, for a shot that failed, the
// sentence the server wrote and a Try again button. The four cards sit side by
// side while the trailer is made, and each moves on its own: a failed shot never
// stops the others, and trying one again re-makes only that one.
//
// The state is words as well as a tint, and an animating shot carries a bar that
// does not pretend to know its progress (it stands still under reduced motion).
// Try again is a spending button like the picture buttons: it is shut — with the
// reason beside it, visible on a phone — while anything in the trailer still
// runs, when the server says this shot cannot be re-made right now, and with the
// server's own sentence when today's video allowance (or the pause, or a rate
// wait) forbids it (`useSpend`). The card never shows a key, a provider's name or
// a raw error: `ShotView` carries only sentences. Implements `devpost/prd.md >
// Animate a Page (v3)`.
import { SpendNote, spendTitle } from '@/components/SpendNote'
import { useSpend } from '@/lib/limits/use-usage'
import type { ShotCardState, ShotView } from '@/lib/video/types'

const WORDS: Record<ShotCardState, string> = {
  queued: 'Waiting its turn',
  animating: 'Animating',
  done: 'Done',
  failed: 'Didn’t finish',
}

const WAIT_FOR_OTHERS = 'The trailer is still being made. Try this shot again when it has finished.'
const CANT_RETRY = 'This shot can’t be tried again just now.'

type Props = {
  shot: ShotView
  /** The panel's picture, or null when the plan had none to show. */
  imageSrc: string | null
  /** A trailer job is queued or running: nothing can be re-made until it ends. */
  running: boolean
  /** This shot's Try again is on the wire. */
  retrying: boolean
  /** Another shot's Try again is on the wire. */
  otherBusy: boolean
  onRetry: (panel: number) => void
}

export function ShotCard({ shot, imageSrc, running, retrying, otherBusy, onRetry }: Props) {
  const failed = shot.state === 'failed'
  // The same sentence the picture buttons give, from the same counters; it only matters on a failed shot.
  const spend = useSpend({ videoSeconds: shot.seconds })
  const reasonId = `shot-${shot.panel}-reason`
  const why = !failed
    ? null
    : running
      ? WAIT_FOR_OTHERS
      : spend.blocked
        ? spend.reason
        : !shot.canRetry
          ? CANT_RETRY
          : null
  const disabled = failed && (running || otherBusy || retrying || spend.blocked || !shot.canRetry)
  const n = shot.panel + 1

  return (
    <li className={`shot-card card is-${shot.state}`} aria-label={`Panel ${n}: ${WORDS[shot.state]}`}>
      <div className="shot-thumb">
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- the panel's picture, served by the project's own image route
          <img src={imageSrc} alt="" loading="lazy" />
        ) : (
          <span className="shot-thumb-label">No picture</span>
        )}
      </div>
      <div className="shot-body">
        <div className="shot-head">
          <span className="shot-name">
            Panel {n} · {shot.seconds} s
          </span>
          <span className={`tag shot-state ${shot.state === 'failed' ? 'tag-outline' : 'tag-neutral'}`}>{WORDS[shot.state]}</span>
        </div>
        {shot.state === 'animating' && (
          <>
            <span className="ink-bar shot-wait" aria-hidden="true">
              <span className="ink-bar-fill" />
            </span>
            <p className="shot-note">This usually takes a minute or two.</p>
          </>
        )}
        {failed && (
          <>
            <p className="shot-note is-failed">{shot.error ?? 'This shot didn’t finish.'}</p>
            <button
              type="button"
              className="btn btn-secondary shot-retry"
              disabled={disabled}
              aria-describedby={disabled && why ? reasonId : undefined}
              title={spendTitle(spend, undefined)}
              onClick={() => onRetry(shot.panel)}
            >
              {retrying ? 'Starting…' : 'Try again'}
            </button>
            {disabled && !retrying && !spend.blocked && why && (
              <p id={reasonId} className="shot-note">
                {why}
              </p>
            )}
            {!retrying && <SpendNote spend={spend} id={spend.blocked ? reasonId : undefined} />}
          </>
        )}
      </div>
    </li>
  )
}
