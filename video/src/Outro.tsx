// The outro: the seal pressed once more, the name inked under it, and one
// closing line — set like a colophon on the last page. A halo of tone
// gathers behind the mark, and at the end everything lifts off the paper.
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { Seal, Wordmark } from './pieces/Lockup'
import { designFrame, INK_EASE, LEAVE, tween } from './pieces/motion'
import { Paper } from './pieces/Paper'
import { Words } from './pieces/Words'
import { color, font, halftone } from './theme'

/** Designed at 10 s; the first ~9 frames sit under the ink wipe. */
const DESIGN = 300

const T = {
  halo: 8,
  seal: 18,
  wordmark: 44,
  rule: 76,
  line: 92,
  out: 258,
}

export const Outro: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const f = designFrame(useCurrentFrame(), durationInFrames, DESIGN)
  const halo = tween(f, [T.halo, T.halo + 60], [0, 1], INK_EASE)
  const rule = tween(f, [T.rule, T.rule + 24], [0, 1], INK_EASE)
  const out = tween(f, [T.out, DESIGN - 2], [0, 1], LEAVE)

  return (
    <Paper tone={0.7}>
      {/* The halo: a dot screen fading out from behind the seal. */}
      <AbsoluteFill
        style={{
          background: halftone.dotsFine,
          opacity: 0.3 * halo * (1 - out),
          maskImage: `radial-gradient(circle at 50% 27%, #000 0, rgba(0, 0, 0, 0.4) ${8 + 10 * halo}%, transparent ${14 + 22 * halo}%)`,
          WebkitMaskImage: `radial-gradient(circle at 50% 27%, #000 0, rgba(0, 0, 0, 0.4) ${8 + 10 * halo}%, transparent ${14 + 22 * halo}%)`,
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          // The block sits in the frame above the caption band.
          paddingBottom: 180,
          opacity: 1 - out,
          transform: `translateY(${-30 * out}px)`,
        }}
      >
        <Seal local={f - T.seal} size={190} />
        <Wordmark local={f - T.wordmark} size={150} style={{ marginTop: 34 }} />
        <div style={{ marginTop: 22, width: 120 * rule, height: 1, background: color.neutral500 }} />
        <Words
          text="Bring your story. Keep your character."
          frame={f}
          enterAt={T.line}
          stagger={4}
          style={{ marginTop: 30, fontFamily: font.body, fontStyle: 'italic', fontSize: 46, color: color.neutral800 }}
        />
      </AbsoluteFill>
    </Paper>
  )
}
