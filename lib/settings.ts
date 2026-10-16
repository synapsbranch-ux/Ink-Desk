// A person's defaults (v3, slice 21): the style New project starts on and the
// direction the reader opens a manga in. One small record per person
// (`store.settings`), read by Settings › Defaults, by the dashboard (to
// preselect the style) and by the project page (to open the reader the way
// they like). Nothing here is a secret and nothing here spends.
//
// What a stranger's record means: a person who has never saved anything has no
// record, and reads as "no style preference, right to left" — exactly how the
// studio behaved before Settings existed. A record that names a style this
// build no longer knows reads as no preference too, so a retired preset can
// never preselect something New project cannot make.
//
// `voices` is RESERVED for slice 22 (Animate: one voice per character type).
// It is kept on the record and carried through every write, so a value a later
// slice stores is never dropped by a save of the two fields below — but it has
// no screen and no route yet, and the Defaults page says so.
//
// The PUT body is the whole form, strictly: both fields, nothing else. Saving
// the same body twice leaves the same values (only `updatedAt` moves). Server
// only; the page and the route share this module so they cannot disagree.
import 'server-only'
import { z } from 'zod'
import { store } from './store'
import type { UserSettings } from './share/types'
import { isStylePresetId, STYLE_PRESET_IDS, type StylePresetId } from './styles'

/** The two directions a manga can open in. A manhwa scrolls vertically whatever this says. */
export const READING_DIRECTIONS = ['rtl', 'ltr'] as const
export type ReadingDirection = (typeof READING_DIRECTIONS)[number]

/** What a person with no record reads as: no style preference, and manga's own right-to-left. */
export const DEFAULT_READING_DIRECTION: ReadingDirection = 'rtl'

/** The sentence a bad body gets — one for unreadable JSON and a wrong shape alike, as the routes answer. */
export const DEFAULTS_UNREADABLE = 'Pick a style (or none) and a reading direction, then save again.'

/** A few hundred bytes is a whole body; this is far over it and far under a flood. */
export const DEFAULTS_BODY_LIMIT_BYTES = 2 * 1024

/**
 * The Defaults form, strictly: a known style or `null` (no preference), and a
 * direction. No other key is accepted, so a body can never reach `voices`, the
 * user id or the clock.
 */
export const DefaultsSchema = z
  .object({
    defaultStyle: z.enum(STYLE_PRESET_IDS).nullable(),
    readingDirection: z.enum(READING_DIRECTIONS),
  })
  .strict()
export type DefaultsInput = z.infer<typeof DefaultsSchema>

/** What the browser is given: the two values and when they were last saved (null until the first save). */
export type SettingsView = {
  defaultStyle: StylePresetId | null
  readingDirection: ReadingDirection
  updatedAt: string | null
}

function viewOf(record: UserSettings | null): SettingsView {
  if (!record) return { defaultStyle: null, readingDirection: DEFAULT_READING_DIRECTION, updatedAt: null }
  return {
    defaultStyle: record.defaultStyle && isStylePresetId(record.defaultStyle) ? record.defaultStyle : null,
    readingDirection: record.readingDirection === 'ltr' ? 'ltr' : 'rtl',
    updatedAt: record.updatedAt,
  }
}

/** The person's defaults, with the studio's own where they have none. */
export async function readSettings(userId: string): Promise<SettingsView> {
  return viewOf(await store.settings.get(userId))
}

/**
 * Save the two fields. The reserved `voices` is read back and carried through
 * untouched; `updatedAt` is stamped now. Returns what a read would now return.
 */
export async function writeSettings(userId: string, input: DefaultsInput, now: Date = new Date()): Promise<SettingsView> {
  const existing = await store.settings.get(userId)
  const next: UserSettings = {
    userId,
    defaultStyle: input.defaultStyle,
    readingDirection: input.readingDirection,
    ...(existing?.voices ? { voices: existing.voices } : {}),
    updatedAt: now.toISOString(),
  }
  await store.settings.put(next)
  return viewOf(next)
}
