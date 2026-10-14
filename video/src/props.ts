// What prepare.mts hands the compositions (out/props.json). Everything the
// render needs is decided in Node first; the compositions only draw it.
import type { CaptionCue } from './script'
import type { MoneyShotStills, ResolvedPlan } from './timeline'

export type NarrationClip = { segmentId: string; src: string; startFrame: number; seconds: number }

export type DemoProps = {
  plan: ResolvedPlan
  captions: CaptionCue[]
  narration: NarrationClip[]
  /** Path under video/public, or null for no music. Royalty-free only, with its licence file. */
  music: { src: string; volume: number } | null
  /** Path under video/public of the captured footage, or null before a capture. */
  footage: string | null
  stills: MoneyShotStills
  /** True when the stills are the committed desk's art, not this capture's. */
  stillsArePlaceholder: boolean
  /** Anything not final yet. Non-empty → the render carries a DRAFT stamp. */
  draft: string[]
}
