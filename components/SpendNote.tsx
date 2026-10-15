// The reason a spending button is shut, as one calm sentence beside it
// (v3, slice 20): visible without hover — a phone has none — and read out when
// it appears. The sentence comes from `spendBlock`, so every screen says the
// same thing, with the reset time. Nothing renders while the button is open.
// See `devpost/prd.md > Limits and Usage (v3)` and `> Responsive (v3)`.
import type { SpendBlock } from '@/lib/limits/button'

type Props = {
  spend: Pick<SpendBlock, 'blocked' | 'reason'>
  /** Stable id a button can point to with `aria-describedby`. */
  id?: string
  className?: string
}

export function SpendNote({ spend, id, className = '' }: Props) {
  if (!spend.blocked || !spend.reason) return null
  return (
    <p id={id} className={`spend-note ${className}`.trim()} role="status">
      {spend.reason}
    </p>
  )
}

/** A button's `title` while blocked: the reason; else its own help text. */
export function spendTitle(spend: Pick<SpendBlock, 'blocked' | 'reason'>, otherwise: string | undefined): string | undefined {
  return spend.blocked && spend.reason ? spend.reason : otherwise
}
