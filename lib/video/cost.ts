// What a trailer costs, before it is made (v3, slice 22). Pure and client-safe:
// the Animate station, the hold the limits layer takes, the worker and
// `check:video` all run this arithmetic. See `devpost/spec.md > Verified for v3`
// and `> Production Models (v3)`.
//
// OpenRouter bills Seedance by video tokens: tokens = W × H × seconds × 24 / 1024,
// at a price per million tokens that depends on the model (checked against the
// listing's own per-second prices, and against the six clips of slice 17, which
// billed $0.7623 for 5 s against a formula of $0.756 — 0.8% apart). A square
// shot renders at 960×960 at 720p, not 720×720 (measured 2026-10-14), so it
// costs the same per second as a wide one.
import type { ShotAspect } from './types'

/** $ per million video tokens, without audio (a shot is always asked for with `generate_audio: false`). */
export const USD_PER_MTOKEN: Record<string, number> = {
  'bytedance/seedance-2.0': 7.0,
  'bytedance/seedance-2.0-fast': 4.2,
}

/** A model this table does not know is priced as the dearest, so an estimate is never optimistic by accident. */
const UNKNOWN_MODEL_USD_PER_MTOKEN = Math.max(...Object.values(USD_PER_MTOKEN))

/** A voice line: ElevenLabs v4 through OpenRouter, $ per character. */
export const TTS_USD_PER_CHAR = 0.00004
/** One Lyria clip (about 30 s). */
export const MUSIC_USD = 0.04
/** The hold is taken a little over the formula: the six measured clips billed 0.8% over it. `settle` replaces it with the provider's own figure. */
export const HOLD_MARGIN = 1.03

/** The pixel size Seedance renders a ratio at. 720p is measured; 480p follows the same rule (a square is 4/3 of the resolution on a side). */
export function renderDims(aspect: ShotAspect, resolution: string): { w: number; h: number } {
  const h = Number.parseInt(resolution, 10)
  const base = Number.isFinite(h) && h > 0 ? h : 720
  return aspect === '1:1' ? { w: Math.round((base * 4) / 3), h: Math.round((base * 4) / 3) } : { w: Math.round((base * 16) / 9), h: base }
}

/** OpenRouter's formula for Seedance. */
export const videoTokens = (dims: { w: number; h: number }, seconds: number): number => (dims.w * dims.h * seconds * 24) / 1024

export function usdPerMToken(model: string, resolution: string): number {
  void resolution // 480p and 720p cost the same per token
  return USD_PER_MTOKEN[model] ?? UNKNOWN_MODEL_USD_PER_MTOKEN
}

/** One shot at the formula's price (no margin). */
export function shotUsd(model: string, resolution: string, aspect: ShotAspect, seconds: number): number {
  return (videoTokens(renderDims(aspect, resolution), seconds) * usdPerMToken(model, resolution)) / 1e6
}

export type CostInput = {
  model: string
  resolution: string
  shots: readonly { aspect: ShotAspect; seconds: number }[]
  speechChars: number
  /** Is the music clip part of this spend? A retry of one shot has none. */
  music: boolean
}

/** What to hold for this much work: shots at the formula, voices at their price, the music clip, all over by `HOLD_MARGIN`. Rounded to the micro-dollar. */
export function estimateUsd(input: CostInput): number {
  const shots = input.shots.reduce((sum, s) => sum + shotUsd(input.model, input.resolution, s.aspect, s.seconds), 0)
  const speech = input.speechChars * TTS_USD_PER_CHAR
  const total = (shots + speech + (input.music ? MUSIC_USD : 0)) * HOLD_MARGIN
  return Math.round(total * 1e6) / 1e6
}
