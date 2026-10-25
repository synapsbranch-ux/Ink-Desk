// What I learned (6-ship): the learner's own last words, shown as the voice
// says them, over the one thing the project set out to prove. The locked
// sheet beside one panel drawn from it, a thin rule between them and the
// Locked stamp pressed once more — the evidence — and under it the learner's
// three lines building up, each a verbatim fragment of video/narration.md
// arriving with the voice: "one sheet, one DNA text, every request." in
// three pieces, then "The flipped workflow? Worth teaching.", then "An honest
// proof of concept, not a guarantee." — which stays until the beat ends.
// Laid out from the pictures' real shapes, like the money shot.
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import { Hanko } from './pieces/Hanko'
import { contain, type Box } from './pieces/layout'
import { designFrame, LEAVE, SETTLE, tween } from './pieces/motion'
import { Paper } from './pieces/Paper'
import { useAspects } from './pieces/useAspects'
import { Words } from './pieces/Words'
import { color, font, shadow } from './theme'
import { FPS, type MoneyShotStills } from './timeline'

/** Designed at 15 s, the beat's length (src/cut.ts): a design frame is a frame. The first ~9 sit under the ink wipe. */
const DESIGN = 15 * FPS
const at = (seconds: number) => Math.round(seconds * FPS)

const T = {
  kicker: 10,
  reference: 22,
  panel: 50,
  divider: 40,
  stamp: 84,
  labels: 76,
  /** The pictures lift in the last half second; the learner's last line stays. */
  out: DESIGN - 15,
}

// The learner's words (video/narration.md › learned), verbatim, in the pieces
// the voice says them — beat seconds: the voice starts 0.4 s in, and these are
// the measured times of the recorded clip plus that lead.
const LINES: { pieces: { text: string; from: number }[] }[] = [
  { pieces: [{ text: 'one sheet,', from: 4.8 }, { text: 'one DNA text,', from: 5.7 }, { text: 'every request.', from: 7.2 }] },
  { pieces: [{ text: 'The flipped workflow?', from: 8.8 }, { text: 'Worth teaching.', from: 10.3 }] },
  { pieces: [{ text: 'An honest proof of concept,', from: 11.6 }, { text: 'not a guarantee.', from: 13.6 }] },
]

// Two pictures side by side, the rule between them, above the three lines —
// all of it above the caption band (the bottom 180 px).
const STAGE: Box = { x: 160, y: 180, w: 1600, h: 350 }
const GAP = 120
const LABEL_TOP = STAGE.y + STAGE.h + 26
const LINES_TOP = 612
const LINE_SIZE = 58
const LINE_GAP = 12

const Picture: React.FC<{ src: string; box: Box; local: number; children?: React.ReactNode }> = ({ src, box, local, children }) => {
  const appear = tween(local, [0, 22], [0, 1], SETTLE)
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        border: `2px solid ${color.ink}`,
        background: color.neutral100,
        boxShadow: shadow.lg,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 18}px)`,
      }}
    >
      <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      {children}
    </div>
  )
}

export const Learned: React.FC<{ stills: MoneyShotStills; placeholder: boolean; durationInFrames: number }> = ({ stills, placeholder, durationInFrames }) => {
  const f = designFrame(useCurrentFrame(), durationInFrames, DESIGN)
  const panel = stills.panels[0] ?? null
  const paths = [stills.character.reference, ...(panel ? [panel.src] : [])]
  const aspects = useAspects(paths)
  if (!aspects) return <Paper tone={0.6} />

  const half = (STAGE.w - GAP) / 2
  const reference = contain(aspects[0], { x: STAGE.x, y: STAGE.y, w: half, h: STAGE.h })
  const drawn = panel ? contain(aspects[1], { x: STAGE.x + half + GAP, y: STAGE.y, w: half, h: STAGE.h }) : null
  // Each picture sits against the rule, not lost in its half.
  const refBox = { ...reference, x: STAGE.x + half - reference.w }
  const panelBox = drawn ? { ...drawn, x: STAGE.x + half + GAP } : null

  const kickerIn = tween(f, [T.kicker, T.kicker + 14], [0, 1], SETTLE)
  const dividerIn = tween(f, [T.divider, T.divider + 30], [0, 1], SETTLE)
  const labelsIn = tween(f, [T.labels, T.labels + 16], [0, 1], SETTLE)
  const out = tween(f, [T.out, DESIGN - 1], [0, 1], LEAVE)
  const label: React.CSSProperties = {
    position: 'absolute',
    top: LABEL_TOP,
    width: half,
    textAlign: 'center',
    fontFamily: font.body,
    fontSize: 22,
    letterSpacing: '0.26em',
    textTransform: 'uppercase',
    color: color.neutral700,
    opacity: labelsIn,
    transform: `translateY(${(1 - labelsIn) * 8}px)`,
  }

  return (
    <Paper tone={0.6}>
      {/* The evidence: the kicker, the sheet and the panel, lifting away at the very end. */}
      <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-24 * out}px)` }}>
        <div
          style={{
            position: 'absolute',
            top: 100,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
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
          <span style={{ marginRight: '-0.34em' }}>What I learned</span>
          <span style={{ width: 56 * kickerIn, height: 1, background: color.neutral500 }} />
        </div>

        {/* A hairline between the sheet and what was drawn from it. */}
        <div
          style={{
            position: 'absolute',
            left: STAGE.x + half + GAP / 2,
            top: STAGE.y + (STAGE.h * (1 - dividerIn)) / 2,
            width: 1,
            height: STAGE.h * dividerIn,
            background: color.divider,
          }}
        />

        <Picture src={stills.character.reference} box={refBox} local={f - T.reference}>
          <Hanko label="Locked" local={f - T.stamp} size={34} solid style={{ top: -22, right: -28 }} />
        </Picture>
        {panel && panelBox ? <Picture src={panel.src} box={panelBox} local={f - T.panel} /> : null}

        <div style={{ ...label, left: STAGE.x }}>{stills.character.source === 'upload' ? 'the sheet, imported and frozen' : 'the sheet, drawn once and frozen'}</div>
        {panel ? (
          <div style={{ ...label, left: STAGE.x + half + GAP }}>
            a panel drawn from it · page {panel.page}, panel {panel.panel}
          </div>
        ) : null}

        {placeholder ? (
          <div style={{ position: 'absolute', top: 60, right: 80, fontFamily: font.body, fontStyle: 'italic', fontSize: 20, color: color.neutral600, opacity: kickerIn }}>
            Stand-in art: the v1 desk
          </div>
        ) : null}
      </AbsoluteFill>

      {/* The learner's words, as the voice says them: each line builds up in pieces; an earlier line steps back when the next arrives; the last stays. */}
      <div style={{ position: 'absolute', top: LINES_TOP, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: LINE_GAP }}>
        {LINES.map((line, i) => {
          const next = LINES[i + 1]?.pieces[0]
          const back = next ? tween(f - at(next.from), [0, 16], [0, 1], SETTLE) : 0
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'center',
                columnGap: '0.26em',
                whiteSpace: 'nowrap',
                opacity: 1 - back * 0.58,
                transform: `scale(${1 - back * 0.06})`,
                transformOrigin: '50% 50%',
                fontFamily: font.heading,
                fontWeight: font.headingWeight,
                fontSize: LINE_SIZE,
                lineHeight: 1.15,
                color: color.ink,
              }}
            >
              {line.pieces.map((piece) => (
                <Words key={piece.text} text={piece.text} frame={f} enterAt={at(piece.from)} stagger={3} style={{ flexWrap: 'nowrap' }} />
              ))}
            </div>
          )
        })}
      </div>
    </Paper>
  )
}
