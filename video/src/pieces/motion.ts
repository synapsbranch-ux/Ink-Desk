// Shared timing for the motion pieces. Every value here is a pure function of
// the frame, because Remotion renders frame by frame in any order — a CSS
// animation or a timer would show a different moment on every render.
import { Easing, interpolate } from 'remotion'
import { INK_SPEED_SECONDS } from '../theme'
import { FPS } from '../timeline'

export const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** interpolate, clamped at both ends — what nearly every tween here wants. */
export const tween = (frame: number, input: number[], output: number[], easing?: (t: number) => number) =>
  interpolate(frame, input, output, { ...CLAMP, easing })

/** The app's ink-in curve (globals.css `ink-in`, cubic-bezier(0.6, 0, 0.3, 1)). */
export const INK_EASE = Easing.bezier(0.6, 0, 0.3, 1)
/** A soft arrival for type and frames: quick to start, long to settle. */
export const SETTLE = Easing.bezier(0.16, 1, 0.3, 1)
/** A calm departure. */
export const LEAVE = Easing.bezier(0.5, 0, 0.75, 0)

/** --ink-speed, in frames. */
export const INK_FRAMES = Math.round(INK_SPEED_SECONDS * FPS)

/**
 * Each piece is designed at its default length and stretched to whatever the
 * edit gives it, so a 15 s money shot cut to 12 s keeps its shape — and its
 * exit — instead of being chopped off.
 */
export const designFrame = (frame: number, durationInFrames: number, designLength: number) =>
  (frame * designLength) / Math.max(1, durationInFrames)

/**
 * The hanko landing, after globals.css `stamp-land` (0.45 s,
 * cubic-bezier(0.2, 0.9, 0.3, 1.2)): it comes down from 1.8× and bites
 * slightly past its size before settling.
 */
export const stampLand = (local: number, frames = 14) => {
  const hit = frames * 0.6
  const scale =
    local < hit
      ? tween(local, [0, hit], [1.8, 0.96], Easing.bezier(0.55, 0, 0.9, 0.6))
      : tween(local, [hit, frames], [0.96, 1], SETTLE)
  const opacity = tween(local, [0, hit * 0.7], [0, 1])
  return { scale, opacity, landed: local >= hit }
}

/** 0 → 1 → 0 over a piece's life: in over `inFrames`, out over the last `outFrames`. */
export const lifeOpacity = (frame: number, durationInFrames: number, inFrames: number, outFrames: number) =>
  Math.min(tween(frame, [0, inFrames], [0, 1]), tween(frame, [durationInFrames - outFrames, durationInFrames], [1, 0]))
