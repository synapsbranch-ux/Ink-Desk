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
// `voices` (slice 22) are the voices the lead and the counterpart speak in when
// a character has none of its own yet (`voiceFor` in `lib/video/plan.ts`): one
// of the twelve premade voices, or none (the studio picks by the character's
// look). A voice already chosen for a character is never changed by this.
//
// The PUT body is the form, strictly: both fields, and optionally `voices`,
// nothing else. `voices` is a patch — a part that is absent is left as it was,
// `null` clears it, a voice name sets it — so a save of the style and direction
// alone never drops a voice. Saving the same body twice leaves the same values
// (only `updatedAt` moves). Server only; the page and the route share this
// module so they cannot disagree.
import 'server-only'
import { z } from './zod'
import { store } from './store'
import type { UserSettings } from './share/types'
import { isStylePresetId, STYLE_PRESET_IDS, type StylePresetId } from './styles'
import { isVoiceName, VOICES, type VoiceName } from './video/plan'

/** The two directions a manga can open in. A manhwa scrolls vertically whatever this says. */
export const READING_DIRECTIONS = ['rtl', 'ltr'] as const
export type ReadingDirection = (typeof READING_DIRECTIONS)[number]

/** What a person with no record reads as: no style preference, and manga's own right-to-left. */
export const DEFAULT_READING_DIRECTION: ReadingDirection = 'rtl'

/** The sentence a bad body gets — one for unreadable JSON and a wrong shape alike, as the routes answer. */
export const DEFAULTS_UNREADABLE = 'Pick a style (or none), a reading direction and, if you like, a voice for each of your two characters, then save again.'

/** A few hundred bytes is a whole body; this is far over it and far under a flood. */
export const DEFAULTS_BODY_LIMIT_BYTES = 2 * 1024

/** The voices a person sets: a premade voice's name, `null` to clear it, absent to leave it. Nothing else — a voice is never a free string. */
const VoicePick = z.enum(VOICES).nullable().optional()

/**
 * The Defaults form, strictly: a known style or `null` (no preference), a
 * direction, and optionally the two voices. No other key is accepted, so a body
 * can never reach the user id or the clock.
 */
export const DefaultsSchema = z
  .object({
    defaultStyle: z.enum(STYLE_PRESET_IDS).nullable(),
    readingDirection: z.enum(READING_DIRECTIONS),
    voices: z.object({ lead: VoicePick, counterpart: VoicePick }).strict().optional(),
  })
  .strict()
export type DefaultsInput = z.infer<typeof DefaultsSchema>

/** What the browser is given: the values and when they were last saved (null until the first save). A voice not chosen is `null`. */
export type SettingsView = {
  defaultStyle: StylePresetId | null
  readingDirection: ReadingDirection
  voices: { lead: VoiceName | null; counterpart: VoiceName | null }
  updatedAt: string | null
}

/** The voices as stored, each only if it is still a voice this build offers (a retired one reads as none). */
function voicesOf(record: UserSettings | null): SettingsView['voices'] {
  const lead = record?.voices?.lead
  const counterpart = record?.voices?.counterpart
  return { lead: isVoiceName(lead) ? lead : null, counterpart: isVoiceName(counterpart) ? counterpart : null }
}

function viewOf(record: UserSettings | null): SettingsView {
  if (!record) return { defaultStyle: null, readingDirection: DEFAULT_READING_DIRECTION, voices: { lead: null, counterpart: null }, updatedAt: null }
  return {
    defaultStyle: record.defaultStyle && isStylePresetId(record.defaultStyle) ? record.defaultStyle : null,
    readingDirection: record.readingDirection === 'ltr' ? 'ltr' : 'rtl',
    voices: voicesOf(record),
    updatedAt: record.updatedAt,
  }
}

/** The person's defaults, with the studio's own where they have none. */
export async function readSettings(userId: string): Promise<SettingsView> {
  return viewOf(await store.settings.get(userId))
}

/**
 * Save the form. `voices` is a patch over what is stored (absent keeps, `null` clears, a name sets); a stored voice
 * this build no longer offers is dropped on the way. `updatedAt` is stamped now. Returns what a read would now return.
 */
export async function writeSettings(userId: string, input: DefaultsInput, now: Date = new Date()): Promise<SettingsView> {
  const existing = await store.settings.get(userId)
  const before = voicesOf(existing)
  const pick = (patch: VoiceName | null | undefined, kept: VoiceName | null): VoiceName | null => (patch === undefined ? kept : patch)
  const lead = pick(input.voices?.lead, before.lead)
  const counterpart = pick(input.voices?.counterpart, before.counterpart)
  const next: UserSettings = {
    userId,
    defaultStyle: input.defaultStyle,
    readingDirection: input.readingDirection,
    ...(lead || counterpart ? { voices: { ...(lead ? { lead } : {}), ...(counterpart ? { counterpart } : {}) } } : {}),
    updatedAt: now.toISOString(),
  }
  await store.settings.put(next)
  return viewOf(next)
}
