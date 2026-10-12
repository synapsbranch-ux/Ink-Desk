// The pencil-sketch placeholder: the halftone sketch surface with its slow
// shimmer, a dotted silhouette standing where the framing line will put the
// character, and the per-panel label. `still` stops the shimmer when nothing
// is being drawn. The new visual state from `devpost/prd.md > Look and Feel`.
import type { PanelSlot } from '@/lib/prompts'

type Props = {
  slot: PanelSlot
  label: string
  /** Nothing is being drawn: no shimmer. */
  still: boolean
  /** The label is a failure sentence, not a wait. */
  failed?: boolean
}

export function PencilPlaceholder({ slot, label, still, failed = false }: Props) {
  return (
    <div className={`pencil sketch${still ? ' is-still' : ''}${failed ? ' is-failed' : ''}`} aria-hidden="true">
      <svg className={`pencil-figure is-${slot.stance}`} viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet">
        <circle cx="50" cy="24" r="15" />
        <path d="M12 100 C12 70 28 56 50 56 C72 56 88 70 88 100" />
      </svg>
      {label && <span className="pencil-label">{label}</span>}
    </div>
  )
}
