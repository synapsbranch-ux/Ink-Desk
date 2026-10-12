// The one edit shape the browser sends to `POST /api/chapter` as you type and
// navigate, and the pure function that applies it. Shared by the client (so
// typing feels instant) and the server (which adds the gate checks on top).
import type { Chapter, Character, Station } from './types'

export type CharacterPatch = {
  id: string
  name?: string
  role?: string
  traits?: string[]
  look?: string
  locked?: true
}

export type ChapterPatch = {
  station?: Station
  pitch?: { text?: string; genre?: string; tone?: string }
  synopsis?: { title?: string; body?: string; accepted?: boolean }
  character?: CharacterPatch
}

export function mergePatch(a: ChapterPatch, b: ChapterPatch): ChapterPatch {
  return {
    ...a,
    ...b,
    pitch: a.pitch || b.pitch ? { ...a.pitch, ...b.pitch } : undefined,
    synopsis: a.synopsis || b.synopsis ? { ...a.synopsis, ...b.synopsis } : undefined,
    // Character edits merge only within one card; switching cards mid-debounce
    // sends the first card's edit rather than folding the two together.
    character:
      a.character && b.character && a.character.id === b.character.id
        ? { ...a.character, ...b.character }
        : (b.character ?? a.character),
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

  if (patch.character) {
    const { id, ...fields } = patch.character
    next = { ...next, cast: next.cast.map((c) => (c.id === id ? applyToCharacter(c, fields) : c)) }
  }

  return next
}

/**
 * Editing the look description clears the DNA, so the next Draw sheet rewrites
 * it rather than drawing new words from an old description —
 * `devpost/prd.md > Cast — Model Sheets` step 5. The sheet image stays on
 * screen until it is redrawn; it is only a claim about the *old* description,
 * and dropping it would leave the card emptier than the user asked for.
 */
function applyToCharacter(character: Character, fields: Omit<CharacterPatch, 'id'>): Character {
  const next = { ...character, ...fields }
  if (fields.look !== undefined && fields.look !== character.look) next.dna = null
  return next
}
