// The one edit shape the browser sends to `POST /api/chapter` as you type and
// navigate, and the pure function that applies it. Shared by the client (so
// typing feels instant) and the server (which adds the gate checks on top).
import { clampBubble } from './bubble'
import { editCharacter, type CharacterEdit } from './cast'
import { Refused } from './errors'
import { applyCoverEdit, applyPlanEdit, type CoverEdit, type PlanEdit, type PlanLineEdit } from './plan'
import type { BubbleLayout, Chapter, Scenario, Station } from './types'

export type { CharacterEdit, CoverEdit, PlanEdit }

/** One edit to the scenario (slice 11). `saved: true` is "Use this scenario". */
export type ScenarioEdit = Partial<Omit<Scenario, 'saved'>> & { saved?: true }

/** One edit to a panel's lettering or display: the user's dialogue replaces
 *  Claude's, a placed bubble layout replaces the derived default (5b), and
 *  `version` steps the displayed version — the one on the page and in the
 *  export (6). */
export type PanelEdit = { dialogue?: string; bubble?: BubbleLayout; version?: number }

export type ChapterPatch = {
  station?: Station
  pitch?: { text?: string; genre?: string; tone?: string }
  synopsis?: { title?: string; body?: string; accepted?: boolean }
  /** Keyed by character id. */
  cast?: Record<string, CharacterEdit>
  /** Keyed by panel index, "0"–"3". */
  panels?: Record<string, PanelEdit>
  // --- slice 11 ---
  storyMode?: 'pitch' | 'scenario'
  scenario?: ScenarioEdit
  plan?: PlanEdit
  cover?: CoverEdit
  /** The page switcher: the project's open page. */
  page?: number
}

function mergeKeyed<E extends object>(a: Record<string, E> | undefined, b: Record<string, E> | undefined) {
  const out: Record<string, E> = { ...a }
  for (const [key, edit] of Object.entries(b ?? {})) out[key] = { ...out[key], ...edit }
  return out
}

export function mergePatch(a: ChapterPatch, b: ChapterPatch): ChapterPatch {
  return {
    ...a,
    ...b,
    pitch: a.pitch || b.pitch ? { ...a.pitch, ...b.pitch } : undefined,
    synopsis: a.synopsis || b.synopsis ? { ...a.synopsis, ...b.synopsis } : undefined,
    cast: a.cast || b.cast ? mergeKeyed(a.cast, b.cast) : undefined,
    panels: a.panels || b.panels ? mergeKeyed(a.panels, b.panels) : undefined,
    scenario: a.scenario || b.scenario ? { ...a.scenario, ...b.scenario } : undefined,
    plan: a.plan || b.plan ? mergePlan(a.plan ?? {}, b.plan ?? {}) : undefined,
    cover: a.cover || b.cover ? { ...a.cover, ...b.cover } : undefined,
  }
}

function mergePlan(a: PlanEdit, b: PlanEdit): PlanEdit {
  const pages: Record<string, Record<string, PlanLineEdit>> = { ...a.pages }
  for (const [p, lines] of Object.entries(b.pages ?? {})) pages[p] = mergeKeyed(pages[p], lines)
  return { ...a, ...b, pages: a.pages || b.pages ? pages : undefined }
}

export const STORY_FROZEN =
  'This chapter’s cast and page were built from the accepted synopsis. Start a new chapter to tell a different story.'

export const SCENARIO_FROZEN =
  'This project’s cast was built from the saved scenario, so its words are frozen. Start a new project to tell a different story.'

/**
 * Once the cast exists the story is frozen on *every* write path, not only
 * `POST /api/synopsis` — at the slice 6 checkpoint a stale tab's debounced
 * pitch edit walked through this patch route and orphaned the desk (slice 7's
 * fix). A new story goes through the confirmed door: a new project.
 *
 * Slice 11 adds the scenario: its text, notes, the mode and the save are
 * frozen with the cast; a saved scenario's words are frozen at the save, as
 * an accepted synopsis is. The ticked references only feed the plan, so they
 * stay editable until the plan is written.
 */
export function assertStoryEditable(chapter: Chapter, patch: ChapterPatch): void {
  const built = chapter.cast.length > 0
  if ((patch.pitch || patch.synopsis) && built) throw new Refused(STORY_FROZEN)
  const s = patch.scenario
  const words = s && (s.text !== undefined || s.notes !== undefined || s.saved !== undefined)
  if ((words || patch.storyMode !== undefined) && built) throw new Refused(SCENARIO_FROZEN)
  if (patch.storyMode !== undefined && patch.storyMode !== chapter.storyMode) {
    if (chapter.synopsis?.accepted || chapter.scenario?.saved) {
      throw new Refused('The story is already settled, so the mode can’t change. Start a new project to tell it the other way.')
    }
  }
  if (s && (s.text !== undefined || s.notes !== undefined) && chapter.scenario?.saved) {
    throw new Refused('The scenario is saved — its words are what the cast is built from. Start a new project to change them.')
  }
  if (s?.saved && !(s.text ?? chapter.scenario?.text ?? '').trim()) throw new Refused('Write or paste a scenario before saving it.')
  if (s?.referenceAssetIds !== undefined) {
    if (chapter.plan) throw new Refused('The chapter plan is written — the references it read are fixed. Start a new project to plan with others.')
    for (const id of s.referenceAssetIds) {
      if (!chapter.assets.some((a) => a.id === id)) throw new Refused('That reference isn’t on this project’s shelf.', 404)
    }
  }
}

/** The page switcher's rule: a page the chapter has. */
export function assertPageExists(chapter: Chapter, page: number): void {
  if (!Number.isInteger(page) || page < 0 || page >= chapter.pageCount) throw new Refused('There is no such page.', 404)
}

export function applyPatch(chapter: Chapter, patch: ChapterPatch): Chapter {
  let next = chapter

  if (patch.station) next = { ...next, station: patch.station }

  if (patch.pitch) next = { ...next, pitch: { ...next.pitch, ...patch.pitch } }

  if (patch.storyMode) next = { ...next, storyMode: patch.storyMode }

  if (patch.scenario) {
    const base = next.scenario ?? { text: '', notes: '', referenceAssetIds: [], saved: false }
    const s = patch.scenario
    // A saved scenario's words don't move (the server refuses; here they are ignored).
    const words = base.saved ? {} : { ...(s.text !== undefined && { text: s.text }), ...(s.notes !== undefined && { notes: s.notes }) }
    next = {
      ...next,
      scenario: {
        ...base,
        ...words,
        ...(s.referenceAssetIds !== undefined && { referenceAssetIds: [...new Set(s.referenceAssetIds)] }),
        ...(s.saved && { saved: true }),
      },
    }
  }

  if (patch.plan) next = applyPlanEdit(next, patch.plan)

  if (patch.cover) next = applyCoverEdit(next, patch.cover)

  if (patch.page !== undefined) {
    next = { ...next, openPage: Math.min(Math.max(0, Math.trunc(patch.page)), Math.max(0, next.pageCount - 1)) }
  }

  if (patch.synopsis) {
    const s = patch.synopsis
    if (next.synopsis) {
      next = { ...next, synopsis: { ...next.synopsis, ...s } }
    } else if (s.title !== undefined && s.body !== undefined) {
      next = { ...next, synopsis: { title: s.title, body: s.body, accepted: s.accepted ?? false } }
    }
    // An edit to a synopsis that doesn't exist yet is ignored.
  }

  if (patch.cast) {
    const edits = patch.cast
    // An edit to a character that was rerolled away is ignored, the same way.
    next = { ...next, cast: next.cast.map((c) => (edits[c.id] ? editCharacter(c, edits[c.id]) : c)) }
  }

  if (patch.panels && next.script) {
    // An edit before the script exists is ignored here; the server refuses it
    // outright (`app/api/chapter/route.ts`), so it can't land silently.
    const edits = patch.panels
    next = {
      ...next,
      script: next.script.map((p) => {
        const e = edits[p.index]
        if (!e) return p
        let out = p
        if (e.dialogue !== undefined) out = { ...out, dialogue: e.dialogue }
        if (e.bubble !== undefined) out = { ...out, bubble: clampBubble(e.bubble) }
        if (e.version !== undefined && out.versions.length > 0) {
          const v = Math.min(out.versions.length - 1, Math.max(0, Math.trunc(e.version)))
          out = { ...out, currentVersion: v }
        }
        return out
      }),
    }
  }

  return next
}
