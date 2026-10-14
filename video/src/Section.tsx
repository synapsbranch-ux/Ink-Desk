// A chapter card between beats: the title set inside a panel, the way a
// manga opens a chapter. The frame is ruled in, a band of tone washes across
// it, the kicker and the title arrive, and it all lifts away before the
// footage — every step measured against the card's own length.
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { designFrame, INK_EASE, LEAVE, SETTLE, tween } from './pieces/motion'
import { Paper } from './pieces/Paper'
import { Words } from './pieces/Words'
import { color, font, halftone } from './theme'

/** Designed at 2.5 s; the first ~9 frames sit under the ink wipe. */
const DESIGN = 75

const FRAME_W = 1480
const FRAME_H = 400
const TEXT_W = 1320
const PERIMETER = 2 * (FRAME_W + FRAME_H)

export const Section: React.FC<{ title: string; kicker: string; durationInFrames: number }> = ({ title, kicker, durationInFrames }) => {
  const f = designFrame(useCurrentFrame(), durationInFrames, DESIGN)

  const rule = tween(f, [6, 26], [0, 1], INK_EASE)
  const tone = tween(f, [12, 34], [0, 1], INK_EASE)
  const kickerIn = tween(f, [12, 26], [0, 1], SETTLE)
  const out = tween(f, [DESIGN - 15, DESIGN - 1], [0, 1], LEAVE)
  // One line, always: Cormorant runs about 0.44 em a character, so long
  // titles step down in size rather than break.
  const titleSize = Math.min(108, Math.max(72, TEXT_W / (title.length * 0.44)))

  return (
    <Paper tone={0.6}>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          // Centred on the frame above the caption band, not on the whole frame.
          justifyContent: 'center',
          paddingBottom: 140,
          opacity: 1 - out,
          transform: `translateY(${-28 * out}px)`,
        }}
      >
        <div style={{ position: 'relative', width: FRAME_W, height: FRAME_H }}>
          {/* The tone, laid from the right like a screen cut to the panel. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: halftone.dotsFine,
              opacity: 0.55,
              maskImage: 'linear-gradient(100deg, transparent 42%, rgba(0, 0, 0, 0.5) 70%, #000 100%)',
              WebkitMaskImage: 'linear-gradient(100deg, transparent 42%, rgba(0, 0, 0, 0.5) 70%, #000 100%)',
              clipPath: `inset(0 0 0 ${(1 - tone) * 100}%)`,
            }}
          />
          <svg width={FRAME_W} height={FRAME_H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            <rect
              x={1.5}
              y={1.5}
              width={FRAME_W - 3}
              height={FRAME_H - 3}
              fill="none"
              stroke={color.ink}
              strokeWidth={3}
              strokeDasharray={PERIMETER}
              strokeDashoffset={PERIMETER * (1 - rule)}
            />
          </svg>
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 26 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                opacity: kickerIn,
                transform: `translateY(${(1 - kickerIn) * 12}px)`,
                fontFamily: font.body,
                fontSize: 26,
                letterSpacing: '0.34em',
                textTransform: 'uppercase',
                color: color.neutral700,
              }}
            >
              <span style={{ width: 56 * kickerIn, height: 1, background: color.neutral500 }} />
              <span style={{ marginRight: '-0.34em' }}>{kicker}</span>
              <span style={{ width: 56 * kickerIn, height: 1, background: color.neutral500 }} />
            </div>
            <Words
              text={title}
              frame={f}
              enterAt={16}
              stagger={3}
              style={{
                maxWidth: TEXT_W,
                flexWrap: 'nowrap',
                whiteSpace: 'nowrap',
                fontFamily: font.heading,
                fontWeight: font.headingWeight,
                fontSize: titleSize,
                lineHeight: 1.05,
                color: color.ink,
                textAlign: 'center',
              }}
            />
          </AbsoluteFill>
        </div>
      </AbsoluteFill>
    </Paper>
  )
}
