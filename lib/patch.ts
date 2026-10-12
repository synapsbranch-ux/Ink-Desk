// The one edit shape the browser sends to `POST /api/chapter` as you type and
// navigate, and the pure function that applies it. Shared by the client (so
// typing feels instant) and the server (which adds the gate checks on top).
import { editCharacter, type CharacterEdit } from './cast'
import type { Chapter, Station } from './types'

export type { CharacterEdit }

export type ChapterPatch = {
  station?: Station
  pitch?: { text?: string; genre?: string; tone?: string }
  synopsis?: { title?: string; body?: string; accepted?: boolean }
  /** Keyed by character id. */
  cast?: Record<string, CharacterEdit>
}

function mergeCast(a: ChapterPatch['cast'], b: ChapterPatch['cast']): Record<string, CharacterEdit> {
  const out: Record<string, CharacterEdit> = { ...a }
  for (const [id, edit] of Object.entries(b ?? {})) out[id] = { ...out[id], ...edit }
  return out
}

export function mergePatch(a: ChapterPatch, b: ChapterPatch): ChapterPatch {
  return {
    ...a,
    ...b,
    pitch: a.pitch || b.pitch ? { ...a.pitch, ...b.pitch } : undefined,
    synopsis: a.synopsis || b.synopsis ? { ...a.synopsis, ...b.synopsis } : undefined,
    cast: a.cast || b.cast ? mergeCast(a.cast, b.cast) : undefined,
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

  return next
}
