// The Cast station's changes to the chapter, as pure functions over the
// `Character` shape. Each is applied inside `update()` by a route handler,
// so the rules here run against the freshest chapter and are what makes a
// locked card read-only on the server rather than only hidden in the UI.
// See `devpost/spec.md > Components > Cast Station and Character Card` and
// `devpost/prd.md > Cast — Model Sheets`.
//
// Shared with the browser through `lib/patch.ts` (for `editCharacter`), so
// no Node imports — `crypto.randomUUID()` is a global on both sides.
import { findAsset } from './assets'
import { Refused } from './errors'
import type { Chapter, Character } from './types'

/** What Claude proposes, and what the card edits. */
export type CharacterText = { name: string; role: string; traits: string[]; look: string }

/** One edit from a card. `locked: true` is the Lock click; there is no unlock. */
export type CharacterEdit = Partial<CharacterText> & { locked?: true }

function clean(p: CharacterText): CharacterText {
  return {
    name: p.name.trim(),
    role: p.role.trim(),
    traits: p.traits.map((t) => t.trim()).filter(Boolean),
    look: p.look.trim(),
  }
}

export function newCharacter(proposal: CharacterText): Character {
  return { id: crypto.randomUUID(), ...clean(proposal), dna: null, sheetImageId: null, locked: false }
}

export function findCharacter(chapter: Chapter, id: string): Character {
  const c = chapter.cast.find((x) => x.id === id)
  if (!c) throw new Refused('That character isn’t on the desk any more. Reload the page.', 404)
  return c
}

export function assertUnlocked(c: Character): Character {
  if (c.locked) throw new Refused(`${c.name} is locked. A locked sheet can’t be changed in this version.`)
  return c
}

/** Claude's two proposals become the cast — once. After that, Reroll. */
export function proposeCast(chapter: Chapter, first: CharacterText, second: CharacterText): Chapter {
  if (chapter.synopsis?.accepted !== true) throw new Refused('Accept a synopsis first.')
  if (chapter.cast.length > 0) throw new Refused('The cast is already proposed. Reroll a character instead.')
  return { ...chapter, cast: [newCharacter(first), newCharacter(second)] }
}

/**
 * Reroll: exactly one character replaced, the other left as the same object.
 * The id survives so the card keeps its place; DNA and sheet do not, because
 * they belonged to the old proposal.
 */
export function replaceCharacter(chapter: Chapter, id: string, proposal: CharacterText): Chapter {
  const current = assertUnlocked(findCharacter(chapter, id))
  const fresh: Character = { ...newCharacter(proposal), id: current.id }
  return { ...chapter, cast: chapter.cast.map((c) => (c === current ? fresh : c)) }
}

/**
 * A text edit from the card, applied the same way in the browser (instantly)
 * and on the server (inside the lock). A changed look retires the DNA: the
 * words no longer describe it, and the next draw writes it fresh. Name, role
 * and traits don't feed the picture, so they leave the DNA alone.
 */
export function editCharacter(c: Character, edit: CharacterEdit): Character {
  let next = c
  if (edit.name !== undefined) next = { ...next, name: edit.name }
  if (edit.role !== undefined) next = { ...next, role: edit.role }
  if (edit.traits !== undefined) next = { ...next, traits: edit.traits }
  if (edit.look !== undefined && edit.look !== next.look) next = { ...next, look: edit.look, dna: null }
  if (edit.locked === true) next = { ...next, locked: true }
  return next
}

/** The server's rules for the same edit. A locked card refuses everything. */
export function assertEditAllowed(c: Character, edit: CharacterEdit): void {
  assertUnlocked(c)
  if (edit.locked === true && !(c.dna && c.sheetImageId)) {
    throw new Refused(`Draw ${c.name}’s sheet before locking it.`)
  }
}

/** Step (a) of Draw sheet: the words, persisted before the picture is attempted. */
export function setDna(chapter: Chapter, id: string, dna: string): Chapter {
  assertUnlocked(findCharacter(chapter, id))
  return { ...chapter, cast: chapter.cast.map((c) => (c.id === id ? { ...c, dna } : c)) }
}

/**
 * Step (c): the picture, with the exact DNA it was drawn from. Written as a
 * pair on purpose — if the look was edited while the sheet drew, the DNA on
 * the card had been retired, and the pair that lands must still agree.
 */
export function attachSheet(chapter: Chapter, id: string, dna: string, imageId: string): Chapter {
  assertUnlocked(findCharacter(chapter, id))
  return {
    ...chapter,
    cast: chapter.cast.map((c) => {
      if (c.id !== id) return c
      // A drawn sheet replaces an imported one: the card is drawn again.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { source, ...drawn } = c
      return { ...drawn, dna, sheetImageId: imageId }
    }),
  }
}

/**
 * Import reference (v2, slice 10): the storyteller's own picture becomes this
 * character's sheet. The DNA is retired here and written next *from the
 * picture*, so the frozen pair still cannot contradict itself — the same
 * DNA-first argument as a drawn sheet, run the other way round. Lock then
 * applies the v1 rule unchanged: DNA and sheet both present.
 */
export function importSheet(chapter: Chapter, id: string, assetId: string): Chapter {
  assertUnlocked(findCharacter(chapter, id))
  const asset = findAsset(chapter, assetId)
  return {
    ...chapter,
    cast: chapter.cast.map((c) => (c.id === id ? { ...c, sheetImageId: asset.blobId, dna: null, source: 'imported' as const } : c)),
  }
}
