// Which stations are open, derived from the chapter — never stored, so it
// cannot drift from the thing it describes.
// See `devpost/spec.md > Components > Station Rail` and
// `devpost/prd.md > Screens and Layout`.
import type { Chapter, Station } from './types'

export type Gate = { open: boolean; hint: string | null }
export type Gates = Record<Station, Gate>

export function gates(chapter: Chapter): Gates {
  const accepted = chapter.synopsis?.accepted === true

  const cast = chapter.cast
  const unlocked = cast.filter((c) => !c.locked)
  const bothLocked = cast.length === 2 && unlocked.length === 0
  const storyboardHint =
    cast.length === 2 && unlocked.length === 1
      ? `Lock ${unlocked[0].name}’s sheet first.`
      : 'Lock both model sheets first.'

  const panels = chapter.script ?? []
  // "Has art" is having at least one version. A redraw in progress keeps its
  // current art on screen, so it must not close the reader again.
  const firstBlank = panels.find((p) => p.versions.length === 0)
  const allDrawn = panels.length === 4 && !firstBlank
  const readerHint = firstBlank ? `Finish panel ${firstBlank.index + 1} first.` : 'Ink all four panels first.'

  return {
    story: { open: true, hint: null },
    cast: { open: accepted, hint: accepted ? null : 'Accept a synopsis first.' },
    storyboard: { open: bothLocked, hint: bothLocked ? null : storyboardHint },
    reader: { open: allDrawn, hint: allDrawn ? null : readerHint },
  }
}
