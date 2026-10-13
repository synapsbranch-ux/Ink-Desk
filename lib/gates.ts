// Which stations are open, derived from the chapter — never stored, so it
// cannot drift from the thing it describes.
// See `devpost/spec.md > Components > Station Rail` and
// `devpost/prd.md > Screens and Layout`.
import { storyReady } from './story'
import type { Chapter, Station } from './types'

export type Gate = { open: boolean; hint: string | null }
export type Gates = Record<Station, Gate>

export function gates(chapter: Chapter): Gates {
  // An accepted synopsis (Pitch) or a saved scenario (Scenario) opens the Library.
  const ready = storyReady(chapter)
  const readyHint = chapter.storyMode === 'scenario' ? 'Save the scenario first.' : 'Accept a synopsis first.'

  const cast = chapter.cast
  const unlocked = cast.filter((c) => !c.locked)
  const bothLocked = cast.length === 2 && unlocked.length === 0
  const storyboardHint =
    cast.length === 2 && unlocked.length === 1
      ? `Lock ${unlocked[0].name}’s sheet first.`
      : 'Lock both model sheets first.'

  // The Page station opens on a plan (slice 11) — or, for a page scripted
  // before the Director existed (the migrated v1 desk), on its script.
  const pageOpen = bothLocked && (chapter.plan !== null || chapter.script !== null)
  const pageHint = bothLocked ? 'Write the chapter plan in the Director first.' : storyboardHint

  const panels = chapter.script ?? []
  // "Has art" is having at least one version. A redraw in progress keeps its
  // current art on screen, so it must not close the reader again.
  const firstBlank = panels.find((p) => p.versions.length === 0)
  const allDrawn = panels.length === 4 && !firstBlank
  const readerHint = firstBlank ? `Finish panel ${firstBlank.index + 1} first.` : 'Ink all four panels first.'

  return {
    story: { open: true, hint: null },
    cast: { open: ready, hint: ready ? null : readyHint },
    director: { open: bothLocked, hint: bothLocked ? null : storyboardHint },
    storyboard: { open: pageOpen, hint: pageOpen ? null : pageHint },
    reader: { open: allDrawn, hint: allDrawn ? null : readerHint },
  }
}
