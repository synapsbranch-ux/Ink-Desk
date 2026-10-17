// The music's level under the trailer (v3, slice 22), ported from v2's
// `video/src/mix.ts > musicVolumeAt` so the trailer breathes exactly as the demo
// film does: a fade-in, a base level, a duck under every spoken line, and a
// fade-out at the end. Pure, so `check:video` can compare it with the original
// frame by frame.
//
// ffmpeg cannot be asked for "this function", so the gain is rendered as an
// envelope — a mono WAV whose sample value IS the gain at that instant — and the
// music is multiplied by it (`amultiply`). The duck is then exactly this
// function's, audible and testable, not an approximation in filter syntax.
//
// The constants are v2's, and so are its time units: `mix.ts` counts frames at
// 30 fps (`MIX_FPS`), so the fade-in is a second, the fade-out three, the duck
// ramps 0.4 s down and 0.6 s up whatever the trailer's own frame rate is.
import 'server-only'
import { writeFile } from 'node:fs/promises'

export const MIX_FPS = 30
/** The level between the voice's lines, and under a line — `video/src/mix.ts`. */
export const MUSIC_BASE = 0.3
export const MUSIC_DUCKED = 0.12
export const MUSIC_FADE_IN_FRAMES = 30
export const MUSIC_FADE_OUT_FRAMES = 90
export const DUCK_IN_FRAMES = 12
export const DUCK_OUT_FRAMES = 18

/** The envelope's sample rate: the audio's own, so no resampling can ring on a corner. */
export const ENVELOPE_RATE = 48000

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export type DuckWindow = { start: number; seconds: number }

/** How deep the duck is at `frame` (0..1): fully under any window, ramping at its edges. */
function duckAt(frame: number, windows: readonly DuckWindow[]): number {
  let duck = 0
  for (const w of windows) {
    const start = w.start * MIX_FPS
    const end = start + Math.round(w.seconds * MIX_FPS)
    const down = clamp01((frame - (start - DUCK_IN_FRAMES)) / DUCK_IN_FRAMES)
    const up = clamp01((end + DUCK_OUT_FRAMES - frame) / DUCK_OUT_FRAMES)
    duck = Math.max(duck, Math.min(down, up))
  }
  return duck
}

/**
 * The music's gain at `t` seconds of a film `totalSeconds` long, with the voice
 * speaking in `windows` (seconds on the film's clock). Equal to `musicVolumeAt`
 * at frame `t * 30` of a film of `totalSeconds * 30` frames.
 */
export function musicGainAt(t: number, windows: readonly DuckWindow[], totalSeconds: number): number {
  const frame = t * MIX_FPS
  const durationInFrames = Math.round(totalSeconds * MIX_FPS)
  const fadeIn = clamp01(frame / MUSIC_FADE_IN_FRAMES)
  const last = Math.max(1, durationInFrames - 1)
  const fadeOut = clamp01((last - frame) / Math.max(1, MUSIC_FADE_OUT_FRAMES - 1))
  const ducked = Math.min(MUSIC_DUCKED, MUSIC_BASE)
  const level = MUSIC_BASE + (ducked - MUSIC_BASE) * duckAt(frame, windows)
  return clamp01(level * fadeIn * fadeOut)
}

/** A mono 16-bit PCM WAV at `ENVELOPE_RATE`, `totalSeconds` long, each sample the gain at its instant (a value of 1.0 would be 32768, the gain never reaches it). */
export function envelopeWav(windows: readonly DuckWindow[], totalSeconds: number): Buffer {
  const samples = Math.max(1, Math.ceil(totalSeconds * ENVELOPE_RATE))
  const data = samples * 2
  const wav = Buffer.alloc(44 + data)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + data, 4)
  wav.write('WAVEfmt ', 8, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20) // PCM
  wav.writeUInt16LE(1, 22) // mono
  wav.writeUInt32LE(ENVELOPE_RATE, 24)
  wav.writeUInt32LE(ENVELOPE_RATE * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(data, 40)
  for (let i = 0; i < samples; i++) {
    const gain = musicGainAt(i / ENVELOPE_RATE, windows, totalSeconds)
    wav.writeInt16LE(Math.min(32767, Math.round(gain * 32768)), 44 + i * 2)
  }
  return wav
}

export async function writeGainEnvelope(destPath: string, windows: readonly DuckWindow[], totalSeconds: number): Promise<void> {
  await writeFile(destPath, envelopeWav(windows, totalSeconds))
}
