// The one edit shape the browser sends to `POST /api/chapter` as you type and
// navigate, and the pure function that applies it. Shared by the client (so
// typing feels instant) and the server (which adds the gate checks on top).
import { clampBubble } from './bubble'
import { editCharacter, type CharacterEdit } from './cast'
import type { BubbleLayout, Chapter, Station } from './types'

export type { CharacterEdit }

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
  }
}

export function applyPatch(chapter: Chapter, patch: ChapterPatch): Chapter {
  let next = chapter

  if (patch.station) next = { ...next, station: patch.station }

  if (patch.pitch) next = { ...next, pitch: { ...next.pitch, ...patch.pitch } }

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
