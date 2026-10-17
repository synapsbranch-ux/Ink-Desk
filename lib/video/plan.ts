// The trailer's plan (v3, slice 22): what Confirm commits to, worked out from a
// finished page before anything is spent. Pure and client-safe — the Animate
// station shows it as the estimate, the animate route pins it on the video
// record, the worker animates exactly it, and `check:video` asserts it.
// See `devpost/spec.md > Animate a Page (v3)`.
//
// The numbers that must be known BEFORE the first paid call all come from the
// text alone: a shot's length is `clamp(ceil(speech + 1 s), 4, 5)` where the
// speech is estimated from its characters (the real clip is measured when it
// exists, and the assembly fits it into the shot), so the quota, the hold and
// the estimate are exact figures from the moment of Confirm and never move.
import { bubbleLayout } from '../bubble'
import { PANEL_LAYOUT } from '../prompts'
import { currentImageId } from '../script'
import type { Character, Panel } from '../types'
import { estimateUsd } from './cost'
import {
  INTRO_SECONDS,
  OUTRO_MIN_SECONDS,
  SHOT_MAX_SECONDS,
  SHOT_MIN_SECONDS,
  TRAILER_MIN_SECONDS,
  type MotionMethod,
  type ShotAspect,
  type TrailerLine,
  type TrailerPlan,
  type TrailerShot,
} from './types'

/** A spoken line is cut here for the trailer (the reader still shows the whole line): a shot is 4–5 s long. */
export const MAX_LINE_CHARS = 160
/** How fast a voice speaks, in characters a second — ElevenLabs reads English at about 14–16. */
export const SPEECH_CHARS_PER_SECOND = 15
/** The pause a shot keeps around its line: the bubble arrives a moment after the cut, the line ends before the next. */
export const SHOT_LEAD_IN_SECONDS = 0.4
export const SHOT_TAIL_SECONDS = 0.6

/** ElevenLabs' premade voices (`video/narrate.mts`); the settings picker offers these. */
export const VOICES = ['george', 'adam', 'brian', 'daniel', 'roger', 'bill', 'charlie', 'will', 'sarah', 'alice', 'bella', 'jessica'] as const
export type VoiceName = (typeof VOICES)[number]
const MALE_VOICES: readonly VoiceName[] = ['george', 'adam', 'brian', 'daniel', 'roger', 'bill', 'charlie', 'will']
const FEMALE_VOICES: readonly VoiceName[] = ['sarah', 'alice', 'bella', 'jessica']

export const isVoiceName = (value: unknown): value is VoiceName => typeof value === 'string' && (VOICES as readonly string[]).includes(value)

/** A page is ready to animate when it has its four panels and each one has a picture to start from. */
export function pageIsComplete(panels: readonly Panel[] | null | undefined): panels is Panel[] {
  if (!panels || panels.length !== 4) return false
  return panels.every((p) => p.status === 'done' && currentImageId(p) !== null)
}

/** The ratio a panel is sent to Seedance at: the layout's wide panels are 3:2 (cropped to 16:9), its squares 1:1. */
export function aspectOfPanel(index: number): ShotAspect {
  return PANEL_LAYOUT[index]?.shape === 'square' ? '1:1' : '16:9'
}

/** The words a panel's line is spoken as: trimmed, one line, cut at a word. Empty means the panel has none. */
export function spokenText(dialogue: string): string {
  const text = dialogue.replace(/\s+/g, ' ').trim()
  if (text.length <= MAX_LINE_CHARS) return text
  const cut = text.slice(0, MAX_LINE_CHARS - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > MAX_LINE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export const estimateSpeechSeconds = (text: string): number => text.length / SPEECH_CHARS_PER_SECOND

/** A shot's length: its speech and a second to breathe, whole seconds, between Seedance's shortest (4) and the longest the trailer allows (5). */
export function shotSecondsFor(text: string): number {
  const wanted = Math.ceil(estimateSpeechSeconds(text) + 1)
  return Math.min(SHOT_MAX_SECONDS, Math.max(SHOT_MIN_SECONDS, wanted))
}

/** When the bubble comes on and goes off, in seconds from the start of its shot. */
export function lineWindow(shotSeconds: number): { on: number; off: number } {
  return { on: SHOT_LEAD_IN_SECONDS, off: Math.max(SHOT_LEAD_IN_SECONDS + 1, shotSeconds - 0.2) }
}

/**
 * The voice a character speaks in, chosen once and kept: the character's own
 * (`Character.voice`) if it has one, else the person's default for that part
 * (`UserSettings.voices` — the lead is `cast[0]`, the counterpart `cast[1]`),
 * else a premade voice picked by the look the DNA describes — a different one
 * for each of the two, so a conversation is never one voice answering itself.
 */
export function voiceFor(character: Pick<Character, 'voice' | 'dna' | 'look'>, castIndex: number, defaults: { lead?: string; counterpart?: string } = {}): VoiceName {
  if (isVoiceName(character.voice)) return character.voice
  const preferred = castIndex === 0 ? defaults.lead : defaults.counterpart
  if (isVoiceName(preferred)) return preferred
  const text = `${character.dna ?? ''} ${character.look ?? ''}`.toLowerCase()
  const female = /\b(female|woman|girl|she|her)\b/.test(text)
  const male = /\b(male|man|boy|he|his|him)\b/.test(text)
  const pool = female && !male ? FEMALE_VOICES : male && !female ? MALE_VOICES : castIndex === 0 ? MALE_VOICES : FEMALE_VOICES
  return pool[Math.max(0, castIndex) % pool.length]
}

export type PlanInput = {
  title: string
  page: number
  panels: readonly Panel[]
  /** The project's locked cast, lead first. */
  characters: readonly Pick<Character, 'id' | 'name' | 'voice' | 'dna' | 'look'>[]
  voices?: { lead?: string; counterpart?: string }
  model: string
  resolution: string
  method: MotionMethod
}

/** Throws a plain Error naming the first thing wrong; the route turns it into the finish-this-page sentence. */
export function planTrailer(input: PlanInput): TrailerPlan {
  if (!pageIsComplete(input.panels)) throw new Error('the page is not complete')
  const shots: TrailerShot[] = input.panels.map((panel, i) => {
    const imageId = currentImageId(panel)
    if (!imageId) throw new Error(`panel ${i + 1} has no picture`)
    const castIndex = input.characters.findIndex((c) => c.id === panel.characterId)
    const character = castIndex >= 0 ? input.characters[castIndex] : null
    const text = spokenText(panel.dialogue)
    const line: TrailerLine | null =
      text === ''
        ? null
        : {
            panel: panel.index,
            characterId: character?.id ?? null,
            speaker: character?.name ?? null,
            text,
            voice: character ? voiceFor(character, castIndex, input.voices) : voiceFor({ voice: undefined, dna: null, look: '' }, 0, input.voices),
            chars: text.length,
            bubble: bubbleLayout(panel),
          }
    return {
      panel: panel.index,
      imageId,
      characterId: panel.characterId,
      aspect: aspectOfPanel(panel.index),
      seconds: shotSecondsFor(text),
      camera: panel.camera,
      action: panel.action,
      background: panel.background,
      line,
    }
  })
  const shotSeconds = shots.reduce((sum, s) => sum + s.seconds, 0)
  const outroSeconds = Math.max(OUTRO_MIN_SECONDS, TRAILER_MIN_SECONDS - INTRO_SECONDS - shotSeconds)
  return {
    title: input.title,
    page: input.page,
    model: input.model,
    resolution: input.resolution,
    method: input.method,
    shots,
    shotSeconds,
    introSeconds: INTRO_SECONDS,
    outroSeconds,
    runSeconds: INTRO_SECONDS + shotSeconds + outroSeconds,
    speechChars: shots.reduce((sum, s) => sum + (s.line?.chars ?? 0), 0),
  }
}

/** The dollar figure the hold is taken at for the whole plan (or for the shots named, a retry — which has no music and no voices to remake). */
export function planUsd(plan: TrailerPlan, only?: readonly number[]): number {
  const shots = only ? plan.shots.filter((s) => only.includes(s.panel)) : plan.shots
  return estimateUsd({ model: plan.model, resolution: plan.resolution, shots, speechChars: only ? 0 : plan.speechChars, music: !only })
}

/** What the plan uses of today's quota — the figures `reserve` is asked for. */
export function planUses(plan: TrailerPlan, only?: readonly number[]): { videoSeconds: number; audioChars: number } {
  const shots = only ? plan.shots.filter((s) => only.includes(s.panel)) : plan.shots
  return { videoSeconds: shots.reduce((sum, s) => sum + s.seconds, 0), audioChars: only ? 0 : plan.speechChars }
}
