// The pencil-sketch placeholder: the halftone sketch surface, a dotted
// silhouette standing where the framing line will put the character, and —
// while art is actually being drawn — the mockup's manga speed lines
// radiating from the figure with the advancing stage line and elapsed time
// at their centre. `still` stops the shimmer when nothing is being drawn.
// The new visual state from `devpost/prd.md > Look and Feel`, made live in
// slice 5b.
import type { CSSProperties } from 'react'
import { GenerationStatus } from '@/components/GenerationStatus'
import { FIGURE_CENTRE } from '@/lib/bubble'
import type { PanelSlot } from '@/lib/prompts'
import { PANEL_STAGES } from '@/lib/stages'

type Props = {
  slot: PanelSlot
  label: string
  /** Nothing is being drawn: no shimmer. */
  still: boolean
  /** The label is a failure sentence, not a wait. */
  failed?: boolean
  /** Art is being drawn right now: speed lines, stage line, elapsed time. */
  generating?: boolean
  /** The server's clock for this generation, so a reload keeps the count. */
  startedAt?: string | null
}

export function PencilPlaceholder({ slot, label, still, failed = false, generating = false, startedAt = null }: Props) {
  const [cx, cy] = FIGURE_CENTRE[slot.stance]
  return (
    <div
      className={`pencil sketch${still ? ' is-still' : ''}${failed ? ' is-failed' : ''}${generating ? ' is-drawing' : ''}`}
      style={{ '--cx': `${cx}%`, '--cy': `${cy}%` } as CSSProperties}
      aria-hidden="true"
    >
      <svg className={`pencil-figure is-${slot.stance}`} viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet">
        <circle cx="50" cy="24" r="15" />
        <path d="M12 100 C12 70 28 56 50 56 C72 56 88 70 88 100" />
      </svg>
      {generating && <div className="speedlines" />}
      {generating ? (
        <GenerationStatus stages={PANEL_STAGES} startedAt={startedAt} />
      ) : (
        label && <span className="pencil-label">{label}</span>
      )}
    </div>
  )
}
