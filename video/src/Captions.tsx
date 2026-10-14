// Burned-in English captions — the narration's own words (src/script.ts).
// Lora on an ink band, two lines at most, the bottom of the frame kept for
// them in every composition.
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import type { CaptionCue } from './script'
import { color, font } from './theme'

export const CAPTION_SAFE_BOTTOM = 180

export const Captions: React.FC<{ cues: readonly CaptionCue[] }> = ({ cues }) => {
  const frame = useCurrentFrame()
  const cue = cues.find((c) => frame >= c.startFrame && frame < c.endFrame)
  if (!cue) return null
  const local = frame - cue.startFrame
  const length = cue.endFrame - cue.startFrame
  // A very short cue gets a shorter fade (interpolate needs a rising range).
  const ramp = Math.min(4, Math.floor((length - 1) / 2))
  const opacity =
    ramp < 1
      ? 1
      : interpolate(local, [0, ramp, length - ramp, length], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 56, pointerEvents: 'none' }}>
      <div
        style={{
          maxWidth: 1320,
          padding: '14px 30px 16px',
          background: 'rgba(32, 31, 29, 0.86)',
          color: color.paper,
          fontFamily: font.body,
          fontSize: 40,
          lineHeight: 1.32,
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
