// What a spend is expected to cost, before it is made (v3, slice 20) — the
// figure `reserve` holds against the caps until the provider's real
// `usage.cost` replaces it. Server only.
//
// Images are priced by `lib/cost.ts` at the quality the studio is configured to
// draw them at (IMAGE_SHEET_QUALITY for a sheet, IMAGE_PANEL_QUALITY for a panel
// and the cover), so the estimate follows the `.env` switch. A text call is held
// at a small flat figure: the measured cost of a synopsis is about $0.004, so
// two cents is generous, and `settle` lowers it to the meter's own number.
import 'server-only'
import { perImage } from '../cost'
import { imageConfig } from '../image-provider'
import type { JobKind } from '../queue/jobs'
import { MIN_SPEND_MICROS, type Units } from './rules'

/**
 * The least any action that spends is held for. The studio counts itself
 * paused when even this does not fit under the cap (so a cap of $0.01 pauses
 * everything at once, before anyone clicks), and every estimate below is at
 * least this.
 */
export const MIN_SPEND_USD = MIN_SPEND_MICROS / 1e6

/** The text calls that stay in the request (they return a draft the person is waiting on), and what each is held for. */
export const TEXT_ESTIMATE_USD = {
  synopsis: 0.02,
  cast: 0.02,
  reroll: 0.02,
  rewrite: 0.02,
  plan: 0.03,
  script: 0.02,
  import: 0.02,
} as const satisfies Record<string, number>
export type TextKind = keyof typeof TEXT_ESTIMATE_USD

/** One picture of this kind, at the configured quality — never less than the floor. */
export function imageEstimateUsd(kind: 'sheet' | 'panel' | 'cover'): number {
  const cfg = imageConfig()
  const quality = kind === 'sheet' ? cfg.sheetQuality : cfg.panelQuality
  return Math.max(MIN_SPEND_USD, perImage(quality).usd)
}

/** What a job of this kind uses and is held for, or null for a kind that spends nothing here yet (the video and audio kinds arrive with slice 22). */
export function jobSpend(kind: JobKind): { units: Units; usd: number } | null {
  switch (kind) {
    case 'sheet':
    case 'panel':
    case 'cover':
      return { units: { image: 1 }, usd: imageEstimateUsd(kind) }
    default:
      return null
  }
}
