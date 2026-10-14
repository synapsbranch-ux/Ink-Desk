// The intro — problem and audience (scope.md > The Demo Video (v2)). The seal
// lands, the name is inked beside it; then the problem in pictures: a strip
// of four panels where the same character's face drifts, and the same strip
// redrawn with one face kept in every panel. The narration carries the
// explanation, so the words on screen are few and large.
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { InkIn } from './pieces/InkIn'
import { Hanko } from './pieces/Hanko'
import { Seal, Wordmark } from './pieces/Lockup'
import { MangaFace, REFERENCE_FACE, type FaceTraits } from './pieces/MangaFace'
import { designFrame, LEAVE, SETTLE, tween } from './pieces/motion'
import { Paper } from './pieces/Paper'
import { Words } from './pieces/Words'
import { color, font, halftone } from './theme'

/** The intro is timed at 20 s and stretched to whatever the edit gives it. */
const DESIGN = 600

// When things happen, in design frames.
const T = {
  seal: 12,
  wordmark: 34,
  tagline: 64,
  lockupOut: 124,
  strip: 142,
  ink: 152, // first panel's ink; the others follow by INK_STAGGER
  lineA1: 166,
  lineA2: 226,
  lineAOut: 318,
  stamp: 336,
  reink: 352,
  lineB1: 350,
  lineB2: 392,
  out: 566,
}
const INK_STAGGER = 22

const PANEL_W = 360
const PANEL_H = 420
const GAP = 28

type PanelLook = {
  /** Screen tone behind the figure. */
  ground: string
  /** Where the camera sits in this panel. */
  framing: React.CSSProperties
  drift: FaceTraits
  locked: FaceTraits
}

const PANELS: PanelLook[] = [
  {
    ground: `${halftone.dots}, ${color.paper}`,
    framing: { width: '112%', left: '-6%', bottom: -8 },
    drift: REFERENCE_FACE,
    locked: REFERENCE_FACE,
  },
  {
    // A close-up on speed lines — the mockup's loader screen.
    ground: `repeating-conic-gradient(from 0deg at 50% 38%, rgba(32, 31, 29, 0.5) 0deg 0.8deg, transparent 0.8deg 6deg), ${color.paper}`,
    framing: { width: '170%', left: '-35%', top: -150 },
    drift: { ...REFERENCE_FACE, hair: 'swept', mole: 'left', brow: 'raised', mouth: 'open' },
    locked: { ...REFERENCE_FACE, brow: 'raised', mouth: 'open' },
  },
  {
    ground: `${halftone.bands}, ${color.surface}`,
    framing: { width: '118%', left: '-12%', bottom: -30, transform: 'rotate(-5deg)' },
    drift: { ...REFERENCE_FACE, hair: 'crop', hairTone: 'grey', eye: 'narrow', jaw: 7, mole: null, brow: 'stern', mouth: 'set' },
    locked: { ...REFERENCE_FACE, brow: 'stern', mouth: 'set' },
  },
  {
    ground: `${halftone.sketch}, ${color.paper}`,
    framing: { width: '130%', left: '-4%', bottom: -60 },
    drift: { ...REFERENCE_FACE, hair: 'long', eye: 'wide', jaw: -3, mole: null, mouth: 'smile' },
    locked: { ...REFERENCE_FACE, mouth: 'smile' },
  },
]

const Figure: React.FC<{ traits: FaceTraits; look: PanelLook; pencil?: boolean }> = ({ traits, look, pencil }) => (
  <AbsoluteFill style={{ background: pencil ? `${halftone.sketch}, ${color.neutral200}` : look.ground }}>
    <MangaFace
      traits={traits}
      style={{
        position: 'absolute',
        ...look.framing,
        ...(pencil ? { opacity: 0.32, filter: 'grayscale(1) blur(0.5px)' } : null),
      }}
    />
  </AbsoluteFill>
)

const Panel: React.FC<{ index: number; f: number }> = ({ index, f }) => {
  const look = PANELS[index]
  const appear = f - T.strip - index * 6
  const frameIn = tween(appear, [0, 16], [0, 1], SETTLE)
  const inkLocal = f - T.ink - index * INK_STAGGER
  // The first panel is the reference: it is stamped, never redrawn.
  const reinkLocal = index === 0 ? -1 : f - T.reink - (index - 1) * INK_STAGGER
  const drifted = (
    <InkIn local={inkLocal} under={<Figure traits={look.drift} look={look} pencil />}>
      <Figure traits={look.drift} look={look} />
    </InkIn>
  )
  return (
    <div style={{ position: 'relative', width: PANEL_W, opacity: frameIn, transform: `translateY(${(1 - frameIn) * 24}px)` }}>
      <div
        style={{
          position: 'relative',
          width: PANEL_W,
          height: PANEL_H,
          overflow: 'hidden',
          border: `3px solid ${color.ink}`,
          background: color.neutral100,
        }}
      >
        {index === 0 ? (
          drifted
        ) : (
          <InkIn local={reinkLocal} under={drifted}>
            <Figure traits={look.locked} look={look} />
          </InkIn>
        )}
      </div>
      <div
        style={{
          marginTop: 14,
          fontFamily: font.body,
          fontSize: 20,
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: color.neutral600,
          textAlign: 'center',
        }}
      >
        Panel {index + 1}
      </div>
      {index === 0 ? <Hanko label="Locked" local={f - T.stamp} size={40} rotate={-8} solid style={{ top: PANEL_H - 62, left: -44 }} /> : null}
    </div>
  )
}

const headline: React.CSSProperties = {
  fontFamily: font.heading,
  fontWeight: font.headingWeight,
  fontSize: 96,
  lineHeight: 1.05,
  color: color.ink,
}

export const Intro: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const f = designFrame(useCurrentFrame(), durationInFrames, DESIGN)

  const lockupOut = tween(f, [T.lockupOut, T.lockupOut + 18], [0, 1], LEAVE)
  const stripOut = tween(f, [T.out, DESIGN], [0, 1], LEAVE)

  return (
    <Paper>
      {/* Beat one: the seal and the name. */}
      {f < T.lockupOut + 20 ? (
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            paddingBottom: 120,
            opacity: 1 - lockupOut,
            transform: `translateY(${-40 * lockupOut}px) scale(${1 - 0.04 * lockupOut})`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 56 }}>
            <Seal local={f - T.seal} size={230} />
            <Wordmark local={f - T.wordmark} size={190} />
          </div>
          <Words
            text="A manga studio on your desk."
            frame={f}
            enterAt={T.tagline}
            stagger={4}
            style={{ marginTop: 34, fontFamily: font.body, fontStyle: 'italic', fontSize: 44, color: color.neutral700 }}
          />
        </AbsoluteFill>
      ) : null}

      {/* Beat two: the problem, then the promise. */}
      {f >= T.strip - 2 ? (
        <AbsoluteFill style={{ opacity: 1 - stripOut, transform: `translateY(${-30 * stripOut}px)` }}>
          <div style={{ position: 'absolute', top: 110, left: 0, right: 0, height: 220 }}>
            {f < T.lineAOut + 40 ? (
              <AbsoluteFill style={{ justifyContent: 'center' }}>
                <Words text="Panel by panel," frame={f} enterAt={T.lineA1} exitAt={T.lineAOut} style={headline} />
                <Words text="the face *drifts.*" frame={f} enterAt={T.lineA2} exitAt={T.lineAOut + 6} style={headline} />
              </AbsoluteFill>
            ) : null}
            {f >= T.lineB1 - 2 ? (
              <AbsoluteFill style={{ justifyContent: 'center' }}>
                <Words text="Ink Desk keeps *one* *face*" frame={f} enterAt={T.lineB1} style={headline} />
                <Words text="in every panel." frame={f} enterAt={T.lineB2} style={headline} />
              </AbsoluteFill>
            ) : null}
          </div>
          <div style={{ position: 'absolute', top: 384, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: GAP }}>
            {PANELS.map((_, i) => (
              <Panel key={i} index={i} f={f} />
            ))}
          </div>
        </AbsoluteFill>
      ) : null}
    </Paper>
  )
}
