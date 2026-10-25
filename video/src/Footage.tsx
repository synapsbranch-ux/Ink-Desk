// One footage shot: the captured footage between two marks. A span longer than
// its budget is time-lapsed — and says so on screen, with the real time it
// covers, because every generation in the film is real and the waits are
// shortened, not faked. Before a capture exists, the same length is a slate.
import { AbsoluteFill, Freeze, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion'
import { color, font, halftone, shadow } from './theme'
import { FPS, type ResolvedShot } from './timeline'

const clock = (s: number) => {
  const r = Math.round(s)
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`
}

/** The first footage shot of a beat fades in from the paper its section card left. */
const FADE_IN_FRAMES = 8

export const Footage: React.FC<{ shot: ResolvedShot; src: string | null }> = ({ shot, src }) => {
  const frame = useCurrentFrame()
  if (shot.kind !== 'footage') return null
  if (!src || shot.missing) return <Slate label={shot.label} seconds={shot.durationInFrames / FPS} />
  // Footage that follows footage cuts straight in, and no shot fades out: its
  // closing frame — the lock, the export done, the redrawn panel — is the
  // point of the shot, and the beat's ink wipe covers the last cut anyway.
  const fade = shot.cutIn
    ? 1
    : interpolate(frame, [0, FADE_IN_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const rate = shot.playbackRate ?? 1
  // Every speed-up is labelled, however small: the film never speeds up real
  // footage without saying so.
  const lapse = rate > 1.01
  // A span shorter than its budget plays at real speed, then holds its last
  // frame so the beat keeps its length; a time-lapse lands early and holds too.
  const play = shot.playFrames ?? shot.durationInFrames
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      {frame < play ? (
        <OffthreadVideo
          src={staticFile(src)}
          trimBefore={shot.trimBefore}
          trimAfter={shot.trimAfter}
          playbackRate={rate}
          muted
          style={{ width: '100%', height: '100%', opacity: fade }}
        />
      ) : (
        // The hold shows the closing mark's own frame — the first one where
        // its moment is on screen (the export done, the studio open).
        <Freeze frame={0}>
          <OffthreadVideo
            src={staticFile(src)}
            trimBefore={shot.trimAfter}
            trimAfter={(shot.trimAfter ?? 0) + 1}
            muted
            style={{ width: '100%', height: '100%', opacity: fade }}
          />
        </Freeze>
      )}
      {lapse ? (
        <div
          style={{
            // In the right gutter under the studio's rail. The content column
            // ends at x ≈ 1580 whether the page is scrolled or not, the
            // header's own controls sit above y 50 and the rail above y 125,
            // so this corner is paper in every station — the DNA on the
            // card, the panel plan and the cost readout stay in view.
            position: 'absolute',
            top: 148,
            right: 32,
            width: 248,
            padding: '10px 16px',
            background: color.ink,
            color: color.paper,
            fontFamily: font.body,
            borderRadius: 4,
            boxShadow: shadow.md,
            opacity: fade * 0.92,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 30, lineHeight: 1.1 }}>
            {rate >= 10 ? Math.round(rate) : rate.toFixed(rate < 2 ? 2 : 1)}×
          </span>
          <span style={{ fontSize: 20, lineHeight: 1.25, opacity: 0.8 }}>{clock(shot.realSeconds ?? 0)} of real time, sped up</span>
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
