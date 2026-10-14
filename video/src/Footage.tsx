// One footage shot: the captured webm between two marks. A span longer than
// its budget is time-lapsed — and says so on screen, with the real time it
// covers, because every generation in the film is real and the waits are
// shortened, not faked. Before a capture exists, the same length is a slate.
import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion'
import { color, font, halftone, shadow } from './theme'
import { FPS, type ResolvedShot } from './timeline'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

export const Footage: React.FC<{ shot: ResolvedShot; src: string | null }> = ({ shot, src }) => {
  const frame = useCurrentFrame()
  const fade = interpolate(frame, [0, 8, shot.durationInFrames - 8, shot.durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  if (shot.kind !== 'footage') return null
  if (!src || shot.missing) return <Slate label={shot.label} seconds={shot.durationInFrames / FPS} />
  const rate = shot.playbackRate ?? 1
  const lapse = rate >= 1.5
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <OffthreadVideo
        src={staticFile(src)}
        trimBefore={shot.trimBefore}
        trimAfter={shot.trimAfter}
        playbackRate={rate}
        muted
        style={{ width: '100%', height: '100%', opacity: fade }}
      />
      {lapse ? (
        <div
          style={{
            position: 'absolute',
            top: 36,
            right: 40,
            padding: '10px 18px',
            background: color.ink,
            color: color.paper,
            fontFamily: font.body,
            fontSize: 26,
            borderRadius: 4,
            boxShadow: shadow.md,
            opacity: fade * 0.92,
            display: 'flex',
            gap: 14,
            alignItems: 'baseline',
          }}
        >
          <span style={{ fontWeight: 700 }}>{rate >= 10 ? Math.round(rate) : rate.toFixed(1)}×</span>
          <span style={{ opacity: 0.8 }}>{clock(shot.realSeconds ?? 0)} of real time, sped up</span>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

/** Where footage will go: what it shows and how long it holds. */
export const Slate: React.FC<{ label: string; seconds: number }> = ({ label, seconds }) => (
  <AbsoluteFill
    style={{
      background: `${halftone.sketch}, ${color.surface}`,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 18,
      fontFamily: font.body,
      color: color.neutral700,
    }}
  >
    <div style={{ fontFamily: font.heading, fontWeight: font.headingWeight, fontSize: 72, color: color.ink }}>{label}</div>
    <div style={{ fontSize: 30 }}>Footage from the capture · {seconds.toFixed(1)} s</div>
  </AbsoluteFill>
)
