// How it was made (6-ship): the project was planned before it was built, with
// the hackathon's Learn Skill Pack — one skill per step, 1-start → 2-scope →
// 3-prd → 4-spec → 5-build → 6-ship. The six steps stand in a row like a
// chapter's kickers; as each real document arrives on the desk its step
// lights: the scope, the PRD and the spec (stills of the real files in
// devpost/, capture/docs.mts), then the build checklist with its ticked boxes
// and the repository's own commit log. Each sheet takes the stage, then joins
// the pile of what came before. The build in one line, stamped Verified; the
// last step lights for this film; everything lifts away. The narration says
// the rest; the words on screen are few, and none of them is a product's name.
import { AbsoluteFill, Easing, Img, staticFile, useCurrentFrame } from 'remotion'
import { Hanko } from './pieces/Hanko'
import { designFrame, INK_EASE, LEAVE, SETTLE, tween } from './pieces/motion'
import { Paper } from './pieces/Paper'
import { Words } from './pieces/Words'
import type { DocsStills } from './props'
import { color, font, halftone, shadow } from './theme'

/** Designed at 22 s; the first ~9 frames sit under the ink wipe. */
const DESIGN = 660

/** The six skills, in the order they are run. */
export const STEPS = ['1-start', '2-scope', '3-prd', '4-spec', '5-build', '6-ship'] as const

type SheetKey = 'scope' | 'prd' | 'spec' | 'checklist' | 'log'
type SheetSpec = { key: SheetKey; file: string; line: string; step: number; tilt: number }

/** The five sheets, in the order they arrive: the step each belongs to, and its one line. */
const SHEETS: SheetSpec[] = [
  { key: 'scope', file: 'devpost/scope.md', line: 'the idea, cut to a proof of concept', step: 1, tilt: -1.4 },
  { key: 'prd', file: 'devpost/prd.md', line: 'every behavior, state and edge case', step: 2, tilt: 1.1 },
  { key: 'spec', file: 'devpost/spec.md', line: 'the stack, the data, the files', step: 3, tilt: -0.8 },
  { key: 'checklist', file: 'devpost/checklist.md', line: 'twenty-three slices, each ticked by hand', step: 4, tilt: 0.9 },
  { key: 'log', file: 'git log', line: 'each verified, then committed', step: 4, tilt: -0.6 },
]

// When things happen, in design frames.
const T = {
  kicker: 10,
  title: 16,
  chain: 48, // the six steps arrive, staggered
  sheet: 96, // the first sheet; the others follow by SHEET_EVERY
  line: 556, // the build in one line
  stamp: 594,
  ship: 572, // the sixth step lights: this film
  out: DESIGN - 18, // the last 0.6 s
}
const SHEET_EVERY = 92
const CHAIN_STAGGER = 7
const ARRIVE = 26
const TO_PILE = 30

// The desk: the title, the chain of steps, the stage and the pile, the
// sheet's label, the closing line — everything above the caption band (the
// bottom 180 px), and the sheet on stage clear of the chain even as it
// arrives (it slides in from 40 px below its place).
const CHAIN_TOP = 236
/** The sheet on stage, 16:10 like the stills. */
const SHEET_W = 600
const SHEET_H = 375
const STAGE = { cx: 1160, cy: 506 }
/** The pile of what came before: the same sheets, small, at the left. */
const PILE = { cx: 310, cy: 506, scale: 0.44 }
const LABEL_TOP = 708
const LINE_TOP = 770

const GLIDE = Easing.bezier(0.65, 0, 0.35, 1)

const Sheet: React.FC<{
  spec: SheetSpec
  src: string | null
  /** Frames since the sheet started to arrive on stage; negative is not yet. */
  local: number
  /** Frames since it left for the pile; negative while it is on stage. */
  pileLocal: number
  /** Its place in the pile. */
  pileIndex: number
}> = ({ spec, src, local, pileLocal, pileIndex }) => {
  if (local < 0) return null
  // Slid in from the right and a touch below, settling flat with its own slight tilt…
  const arrive = tween(local, [0, ARRIVE], [0, 1], SETTLE)
  // …then off to the pile: smaller, further left, a little more tilted, under the next sheet.
  const g = tween(pileLocal, [0, TO_PILE], [0, 1], GLIDE)
  const scale = 1 + (PILE.scale - 1) * g
  const cx = STAGE.cx + (PILE.cx + pileIndex * 14 - STAGE.cx) * g
  const cy = STAGE.cy + (PILE.cy + pileIndex * 10 - STAGE.cy) * g
  const rotate = spec.tilt + (1 - arrive) * 5 + (spec.tilt * 2.4 + pileIndex * 1.6) * g
  const rule = tween(local, [8, 30], [0, 1], INK_EASE)
  const text = tween(local, [14, 30], [0, 1], SETTLE)
  return (
    <div
      style={{
        position: 'absolute',
        left: cx - SHEET_W / 2 + (1 - arrive) * 160,
        top: cy - SHEET_H / 2 + (1 - arrive) * 40,
        width: SHEET_W,
        height: SHEET_H,
        background: color.neutral100,
        border: `2px solid ${color.ink}`,
        boxShadow: g > 0.5 ? shadow.md : shadow.lg,
        overflow: 'hidden',
        opacity: arrive,
        transform: `scale(${scale}) rotate(${rotate}deg)`,
        transformOrigin: '50% 50%',
      }}
    >
      {src ? (
        // The real document, as its page opens: the top of it, at the stills' own 16:10.
        <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top left', display: 'block' }} />
      ) : (
        // No stills yet (prepare.mts says DRAFT): the file's name on paper, as the v2 sheets were.
        <>
          <AbsoluteFill
            style={{
              background: halftone.dotsFine,
              opacity: 0.22,
              maskImage: 'radial-gradient(ellipse 70% 70% at 100% 100%, #000 0, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 100% 100%, #000 0, transparent 70%)',
            }}
          />
          <div style={{ position: 'absolute', left: 40, right: 40, top: 44 }}>
            <div style={{ fontFamily: font.body, fontSize: 24, letterSpacing: '0.3em', textTransform: 'uppercase', color: color.neutral700, opacity: text }}>
              {spec.file}
            </div>
            <div style={{ marginTop: 18, height: 1.5, width: `${rule * 100}%`, background: color.ink }} />
            <div
              style={{
                marginTop: 30,
                fontFamily: font.heading,
                fontStyle: 'italic',
                fontWeight: 500,
                fontSize: 44,
                lineHeight: 1.18,
                color: color.ink,
                opacity: text,
                transform: `translateY(${(1 - text) * 10}px)`,
              }}
            >
              {spec.line}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** The six steps as kickers, the current one lit. */
const Chain: React.FC<{ f: number; current: number }> = ({ f, current }) => (
  <div style={{ position: 'absolute', top: CHAIN_TOP, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18 }}>
    {STEPS.map((step, i) => {
      const local = f - T.chain - i * CHAIN_STAGGER
      const arrive = tween(local, [0, 14], [0, 1], SETTLE)
      const lit = i === current
      return (
        <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 18, opacity: arrive, transform: `translateY(${(1 - arrive) * 10}px)` }}>
          {i > 0 ? <span style={{ width: 34, height: 1, background: color.neutral500, display: 'block' }} /> : null}
          <div style={{ position: 'relative', textAlign: 'center' }}>
            <span
              style={{
                fontFamily: font.body,
                fontSize: 24,
                fontWeight: lit ? 700 : 400,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                color: lit ? color.ink : color.neutral600,
                marginRight: '-0.3em',
                whiteSpace: 'nowrap',
              }}
            >
              {step}
            </span>
            {/* The seal's red marks the step the desk is on. */}
            <span
              style={{
                position: 'absolute',
                left: '50%',
                bottom: -14,
                width: 8,
                height: 8,
                marginLeft: -4,
                borderRadius: '50%',
                background: color.hanko,
                opacity: lit ? 1 : 0,
              }}
            />
          </div>
        </div>
      )
    })}
  </div>
)

const sheetSrc = (docs: DocsStills | null, key: SheetKey): string | null => {
  if (!docs) return null
  switch (key) {
    case 'scope':
      return docs.scope.top
    case 'prd':
      return docs.prd.top
    case 'spec':
      return docs.spec.top
    case 'checklist':
      return docs.checklist.slices
    case 'log':
      return docs.log
  }
}

export const Method: React.FC<{ docs: DocsStills | null; durationInFrames: number }> = ({ docs, durationInFrames }) => {
  const f = designFrame(useCurrentFrame(), durationInFrames, DESIGN)
  const kickerIn = tween(f, [T.kicker, T.kicker + 14], [0, 1], SETTLE)
  const out = tween(f, [T.out, DESIGN - 1], [0, 1], LEAVE)

  // Which sheet is on stage, and so which step is lit.
  const arrived = SHEETS.filter((_, i) => f >= T.sheet + i * SHEET_EVERY)
  const onStage = arrived.at(-1) ?? null
  const current = f >= T.ship ? 5 : onStage ? onStage.step : 0
  const labelIn = onStage ? tween(f - (T.sheet + (arrived.length - 1) * SHEET_EVERY), [10, 26], [0, 1], SETTLE) : 0
  const labelOut = tween(f, [T.line - 10, T.line + 6], [1, 0], LEAVE)

  return (
    <Paper tone={0.6}>
      <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-28 * out}px)` }}>
        {/* The kicker and the title, set as a chapter card sets them. */}
        <div style={{ position: 'absolute', top: 92, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              opacity: kickerIn,
              transform: `translateY(${(1 - kickerIn) * 12}px)`,
              fontFamily: font.body,
              fontSize: 24,
              letterSpacing: '0.34em',
              textTransform: 'uppercase',
              color: color.neutral700,
            }}
          >
            <span style={{ width: 56 * kickerIn, height: 1, background: color.neutral500 }} />
            <span style={{ marginRight: '-0.34em' }}>How it was made · the hackathon’s Learn Skill Pack</span>
            <span style={{ width: 56 * kickerIn, height: 1, background: color.neutral500 }} />
          </div>
          <Words
            text="Planned before built"
            frame={f}
            enterAt={T.title}
            stagger={4}
            style={{
              whiteSpace: 'nowrap',
              fontFamily: font.heading,
              fontWeight: font.headingWeight,
              fontSize: 86,
              lineHeight: 1.05,
              color: color.ink,
            }}
          />
        </div>

        <Chain f={f} current={current} />

        {/* The sheets: the pile first, so the one on stage is always on top. */}
        {SHEETS.map((spec, i) => {
          const at = T.sheet + i * SHEET_EVERY
          const next = i < SHEETS.length - 1 ? T.sheet + (i + 1) * SHEET_EVERY : Infinity
          return <Sheet key={spec.key} spec={spec} src={sheetSrc(docs, spec.key)} local={f - at} pileLocal={f - next} pileIndex={i} />
        })}

        {/* What is on stage, named under it. */}
        {onStage ? (
          <div
            style={{
              position: 'absolute',
              top: LABEL_TOP,
              left: STAGE.cx - SHEET_W / 2,
              width: SHEET_W,
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'center',
              gap: 16,
              opacity: labelIn * labelOut,
              transform: `translateY(${(1 - labelIn) * 8}px)`,
            }}
          >
            <span style={{ fontFamily: font.body, fontSize: 20, letterSpacing: '0.26em', textTransform: 'uppercase', color: color.neutral700 }}>{onStage.file}</span>
            <span style={{ width: 28, height: 1, background: color.neutral400, alignSelf: 'center' }} />
            <span style={{ fontFamily: font.heading, fontStyle: 'italic', fontWeight: 500, fontSize: 30, color: color.ink, whiteSpace: 'nowrap' }}>{onStage.line}</span>
          </div>
        ) : null}

        {/* The build, in one line, stamped. */}
        <div style={{ position: 'absolute', top: LINE_TOP, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Words
              text="23 slices · each verified and committed"
              frame={f}
              enterAt={T.line}
              stagger={4}
              style={{
                whiteSpace: 'nowrap',
                fontFamily: font.heading,
                fontWeight: font.headingWeight,
                fontSize: 60,
                lineHeight: 1.1,
                color: color.ink,
              }}
            />
            <Hanko label="Verified" local={f - T.stamp} size={30} rotate={-9} style={{ top: -46, right: -186 }} />
          </div>
        </div>
      </AbsoluteFill>
    </Paper>
  )
}
