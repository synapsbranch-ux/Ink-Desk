// What I learned (6-ship): a quiet card under the learner's own last words.
// The locked sheet beside one panel drawn from it — the one thing the project
// set out to prove — with a thin rule between them and the Locked stamp
// pressed once more. Nothing else: the narration carries the words, and the
// captions show them. Laid out from the pictures' real shapes, like the
// money shot.
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import { Hanko } from './pieces/Hanko'
import { contain, type Box } from './pieces/layout'
import { designFrame, LEAVE, SETTLE, tween } from './pieces/motion'
import { Paper } from './pieces/Paper'
import { useAspects } from './pieces/useAspects'
import { color, font, shadow } from './theme'
import type { MoneyShotStills } from './timeline'

/** Designed at 15 s; the first ~9 frames sit under the ink wipe. */
const DESIGN = 450

const T = {
  kicker: 10,
  reference: 22,
  panel: 50,
  divider: 40,
  stamp: 84,
  labels: 76,
  out: DESIGN - 20,
}

// Two pictures side by side above the caption band, the rule between them.
const STAGE: Box = { x: 160, y: 232, w: 1600, h: 500 }
const GAP = 120
const LABEL_TOP = STAGE.y + STAGE.h + 34

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
  const label = (text: string): React.CSSProperties => ({
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
    ...(text ? {} : {}),
  })

  return (
    <Paper tone={0.6}>
      <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-24 * out}px)` }}>
        <div
          style={{
            position: 'absolute',
            top: 118,
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

        <div style={{ ...label('a'), left: STAGE.x }}>{stills.character.source === 'upload' ? 'the sheet, imported and frozen' : 'the sheet, drawn once and frozen'}</div>
        {panel ? (
          <div style={{ ...label('b'), left: STAGE.x + half + GAP }}>
            a panel drawn from it · page {panel.page}, panel {panel.panel}
          </div>
        ) : null}

        {placeholder ? (
          <div style={{ position: 'absolute', top: 70, right: 80, fontFamily: font.body, fontStyle: 'italic', fontSize: 20, color: color.neutral600, opacity: kickerIn }}>
            Stand-in art: the v1 desk
          </div>
        ) : null}
      </AbsoluteFill>
    </Paper>
  )
}
