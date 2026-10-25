// Burned-in English captions — the narration's own words (src/script.ts).
// Lora on an ink band, two lines at most, the bottom of the frame kept for
// them in every composition.
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import type { CaptionCue } from './script'
import { color, font } from './theme'

export const CAPTION_SAFE_BOTTOM = 180
/** A cue fades in and out over at most this long (0.2 s). */
export const CUE_FADE_FRAMES = 6

export const Captions: React.FC<{ cues: readonly CaptionCue[] }> = ({ cues }) => {
  const frame = useCurrentFrame()
  const cue = cues.find((c) => frame >= c.startFrame && frame < c.endFrame)
  if (!cue) return null
  const local = frame - cue.startFrame
  const length = cue.endFrame - cue.startFrame
  // A very short cue gets a shorter fade (interpolate needs a rising range).
  const ramp = Math.min(CUE_FADE_FRAMES, Math.floor((length - 1) / 2))
  const opacity =
    ramp < 1
      ? 1
      : interpolate(local, [0, ramp, length - ramp, length], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
  return (
    // 44 px off the bottom: a two-line box (2 × 40 × 1.32 + 30 = 136 px) then
    // spans y 900–1036, inside the CAPTION_SAFE_BOTTOM band every composition keeps clear.
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 44, pointerEvents: 'none' }}>
      <div
        style={{
          maxWidth: 1320,
          padding: '14px 30px 16px',
          background: 'rgba(32, 31, 29, 0.86)',
          color: color.paper,
          fontFamily: font.body,
          fontSize: 40,
          lineHeight: 1.32,
          // Two lines break evenly, never a one-word second line; the words are untouched.
          textWrap: 'balance',
          textAlign: 'center',
          borderRadius: 6,
          opacity,
        }}
      >
        {cue.text}
      </div>
    </AbsoluteFill>
  )
}
