// The music under the voice, as a pure function of the frame — so the mix
// can be unit-checked (scripts/demo-timeline-check.mts) and Remotion can ask
// for any frame in any order. The track is composed to the film's length
// (video/music/compose.mts); this only shapes its level: a fade-in, a base
// level, a duck under every narration clip, and a fade-out at the end.
import type { NarrationClip } from './props'
import { FPS } from './timeline'

// Set against a voice leveled to −16 LUFS (narrate.mts) and a track around
// −14 LUFS: between the lines the music sits ≈ 8 dB under the voice's level,
// under a line ≈ 16 dB.
/** The level between the voice's lines — what prepare.mts puts in the props. */
export const MUSIC_BASE = 0.3
/** The level under a narration clip. */
export const MUSIC_DUCKED = 0.12
export const MUSIC_FADE_IN_FRAMES = 30
export const MUSIC_FADE_OUT_FRAMES = 90
/** The duck ramps down just before the voice starts, and back up after it ends. */
export const DUCK_IN_FRAMES = 12
export const DUCK_OUT_FRAMES = 18

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** 0 → 1 how deep the duck is at `frame`: fully under any clip, ramping at its edges. */
export function duckAt(frame: number, clips: readonly NarrationClip[]): number {
  let duck = 0
  for (const clip of clips) {
    const start = clip.startFrame
    const end = start + Math.round(clip.seconds * FPS)
    const down = clamp01((frame - (start - DUCK_IN_FRAMES)) / DUCK_IN_FRAMES)
    const up = clamp01((end + DUCK_OUT_FRAMES - frame) / DUCK_OUT_FRAMES)
    duck = Math.max(duck, Math.min(down, up))
  }
  return duck
}

/**
 * The music's volume at `frame` of a film `durationInFrames` long: 0 at the
 * first frame, up to `base` over MUSIC_FADE_IN_FRAMES, held at MUSIC_DUCKED
 * while a clip plays, and down to 0 at the last frame over the final
 * MUSIC_FADE_OUT_FRAMES.
 */
export function musicVolumeAt(frame: number, clips: readonly NarrationClip[], durationInFrames: number, base = MUSIC_BASE): number {
  const fadeIn = clamp01(frame / MUSIC_FADE_IN_FRAMES)
  const last = Math.max(1, durationInFrames - 1)
  const fadeOut = clamp01((last - frame) / Math.max(1, MUSIC_FADE_OUT_FRAMES - 1))
  const ducked = Math.min(MUSIC_DUCKED, base)
  const level = base + (ducked - base) * duckAt(frame, clips)
  return clamp01(level * fadeIn * fadeOut)
}
