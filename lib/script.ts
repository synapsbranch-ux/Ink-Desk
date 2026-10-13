// The page script and the four panels, as pure functions over the chapter.
// Each mutation is applied inside `update()` by a route handler or the panel
// job, so the rules here run against the freshest chapter. The derived bits
// (the placeholder label, the bubble corner) live here too, so the browser
// computes them from the same source the server writes.
// See `devpost/spec.md > Components > Page Script`, `> Storyboard Station and
// Panel` and `> Speech Bubble`.
//
// Shared with the browser, so no Node imports.
import { Refused } from './errors'
import { PANEL_LAYOUT } from './prompts'
import type { PageScriptOutput } from './schemas'
import type { Chapter, Character, Panel, PanelStatus } from './types'

/**
 * The two locked characters in page order — lead, counterpart. Refuses, with
 * the rail's own hint, unless both are locked with a DNA/sheet pair.
 */
export function lockedPair(chapter: Chapter): [Character, Character] {
  const cast = chapter.cast
  if (cast.length !== 2) throw new Refused('Propose the cast first.')
  const unlocked = cast.filter((c) => !c.locked)
  if (unlocked.length === 1) throw new Refused(`Lock ${unlocked[0].name}’s sheet first.`)
  if (unlocked.length > 1) throw new Refused('Lock both model sheets first.')
  for (const c of cast) {
    if (!c.dna || !c.sheetImageId) throw new Refused(`${c.name} is locked without a sheet. Reload the page.`)
  }
  return [cast[0], cast[1]]
}

/** Claude's four lines become the script — once. The slot decides the character; the schema already agreed. */
export function newScript(chapter: Chapter, out: PageScriptOutput): Chapter {
  if (chapter.script) throw new Refused('The page script is already written.')
  const pair = lockedPair(chapter)
  const lines = [out.panel1, out.panel2, out.panel3, out.panel4]
  const script: Panel[] = PANEL_LAYOUT.map((slot, i) => {
    const line = lines[i]
    const expected = pair[slot.cast].id
    if (line.characterId !== expected) {
      // Impossible past the schema; kept so a schema edit cannot silently break the page.
      throw new Error(`panel ${i + 1} names ${line.characterId}; the layout puts ${expected} there`)
    }
    return {
      index: slot.index,
      characterId: expected,
      action: line.action.trim(),
      camera: line.camera.trim(),
      background: line.background.trim(),
      dialogue: line.dialogue.trim(),
      versions: [],
      currentVersion: 0,
      status: 'empty',
      startedAt: null,
      startedByRun: null,
    }
  })
  return { ...chapter, script }
}

export function findPanel(chapter: Chapter, index: number): Panel {
  const panel = chapter.script?.[index]
  if (!panel) throw new Refused(chapter.script ? 'There is no such panel.' : 'Write the page script first.', 404)
  return panel
}

function replacePanel(chapter: Chapter, index: number, next: Panel): Chapter {
  return { ...chapter, script: (chapter.script ?? []).map((p) => (p.index === index ? next : p)) }
}

/**
 * A generation starts: the panel reads `inking`, stamped with when and by
 * which server process, for the slice 6 timeout and restart fallbacks. A
 * panel already inking, or whose character is not locked with a sheet, is
 * refused — the job then exits without drawing anything.
 */
export function markInking(chapter: Chapter, index: number, runId: string, now = new Date()): Chapter {
  const panel = findPanel(chapter, index)
  if (panel.status === 'inking') throw new Refused(`Panel ${index + 1} is already inking.`)
  const character = chapter.cast.find((c) => c.id === panel.characterId)
  if (!character?.locked || !character.dna || !character.sheetImageId) {
    throw new Refused(`Panel ${index + 1}’s character isn’t locked with a sheet.`)
  }
  return replacePanel(chapter, index, {
    ...panel,
    status: 'inking',
    startedAt: now.toISOString(),
    startedByRun: runId,
  })
}

/** A panel keeps at most this many versions — `prd.md > Storyboard`:
 *  "three keeps it simple". A fourth redraw drops the oldest. */
export const MAX_PANEL_VERSIONS = 3

/** The art landed: a new version, newest last and the one on the page; past
 *  three, the oldest is dropped. The bubble and dialogue live on the panel,
 *  not the version, so a redraw never touches the lettering. */
export function attachPanelVersion(chapter: Chapter, index: number, imageId: string, now = new Date()): Chapter {
  const panel = findPanel(chapter, index)
  const versions = [...panel.versions, { imageId, createdAt: now.toISOString() }].slice(-MAX_PANEL_VERSIONS)
  return replacePanel(chapter, index, {
    ...panel,
    versions,
    currentVersion: versions.length - 1,
    status: 'done',
    startedAt: null,
    startedByRun: null,
  })
}

/** The art did not land. Recorded honestly; Try again and Rewrite repair it. */
export function markFailed(chapter: Chapter, index: number, status: 'failed' | 'refused'): Chapter {
  const panel = findPanel(chapter, index)
  return replacePanel(chapter, index, { ...panel, status, startedAt: null, startedByRun: null })
}

/** Rewrite panel: Claude's calmer visuals land on the panel. The dialogue,
 *  bubble, versions and status are untouched — a refusal is a wording
 *  problem, and only the wording changes. */
export function applyRewrite(
  chapter: Chapter,
  index: number,
  visuals: { action: string; camera: string; background: string }
): Chapter {
  const panel = findPanel(chapter, index)
  return replacePanel(chapter, index, {
    ...panel,
    action: visuals.action.trim(),
    camera: visuals.camera.trim(),
    background: visuals.background.trim(),
  })
}

export function currentImageId(panel: Panel): string | null {
  return panel.versions[panel.currentVersion]?.imageId ?? null
}

/** The placeholder's label. Empty while a panel is inked. */
export function panelLabel(panel: Pick<Panel, 'index' | 'status'>): string {
  const n = panel.index + 1
  const labels: Record<PanelStatus, string> = {
    empty: `Pencilling panel ${n}…`,
    inking: `Inking panel ${n}…`,
    done: '',
    failed: `Panel ${n} didn’t come back, the studio is busy.`,
    refused: `Panel ${n} couldn’t be drawn as written.`,
  }
  return labels[panel.status]
}

export type BubbleCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const LOOKING_DOWN = /high angle|overhead|bird|from above|looking down|top-down/i

/**
 * Where the speech bubble sits — derived, never authored. The bubble goes to
 * the side the figure leaves free (the layout fixes where they stand) and
 * drops to the bottom when the camera looks down on them, since the head then
 * sits high in the frame.
 */
export function bubbleCorner(panel: Pick<Panel, 'index' | 'camera'>): BubbleCorner {
  const stance = PANEL_LAYOUT[panel.index].stance
  const side = stance === 'left' || stance === 'close' ? 'right' : 'left'
  const level = LOOKING_DOWN.test(panel.camera) ? 'bottom' : 'top'
  return `${level}-${side}`
}
