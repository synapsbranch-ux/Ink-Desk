// What prepare.mts hands the compositions (out/props.json). Everything the
// render needs is decided in Node first; the compositions only draw it.
import type { CaptionCue } from './script'
import type { MoneyShotStills, ResolvedPlan } from './timeline'

export type NarrationClip = { segmentId: string; src: string; startFrame: number; seconds: number }

/**
 * Stills of the real planning documents and the build record, for the method
 * beat — written by capture/docs.mts to public/capture/docs/docs.json. Every
 * path is under video/public. Free to make, offline, from the files in devpost/
 * and the repository's own history.
 */
export type DocsStills = {
  capturedAt: string
  /** The HTML companions of scope.md, prd.md and spec.md: the top of each page at the docs viewport, and the whole page. */
  scope: { top: string; full: string }
  prd: { top: string; full: string }
  spec: { top: string; full: string }
  /** The build checklist: every slice with its ticked box, the v3 slices with their lines, and the Final Review lines. */
  checklist: { slices: string; v3: string; review: string }
  /** The repository's recent commits, terminal-styled (product names shown as their roles). */
  log: string
  /** The six skills of the hackathon's Learn Skill Pack, as a listing. */
  skills: string
}

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
  /** The method beat's documents, or null until `npm run video:docs` has made them (a draft line). */
  docs: DocsStills | null
  /** Anything not final yet. Non-empty → the render carries a DRAFT stamp. */
  draft: string[]
}
