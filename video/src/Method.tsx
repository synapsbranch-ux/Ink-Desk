// How it was made (6-ship): the project was planned before it was built, with
// the hackathon's Learn Skill Pack — one skill per step, 1-start → 2-scope →
// 3-prd → 4-spec → 5-build → 6-ship. The six steps stand in a row like a
// chapter's kickers, and the beat moves with the learner's own three
// sentences, each shown under the stage, verbatim, as the voice says it:
//
//   1 · planned before built    the skills listing, then the scope, the PRD
//                               and the spec take the stage in turn as the
//                               voice names them, each lighting its step
//   2 · slice by slice          5-build lit; the ticked checklist and the
//                               repository's own log side by side, stamped
//                               Verified as the voice says "checked hands-on"
//   3 · revised in the open     the checklist's Revisions and the scope's
//                               Changes Since Approval, with the record's
//                               dates in a strip; 6-ship lights for this film
//
// Every sheet is a still of the real file (capture/docs.mts); each joins the
// pile of what came before when the next arrives; everything lifts away at
// the end. The quotes on screen are the learner's, verbatim; everything else
// is a title, a step label or a file's name — none of it a product's name.
import { AbsoluteFill, Easing, Img, staticFile, useCurrentFrame } from 'remotion'
import { Hanko } from './pieces/Hanko'
import { designFrame, INK_EASE, LEAVE, SETTLE, tween } from './pieces/motion'
import { Paper } from './pieces/Paper'
import { Words } from './pieces/Words'
import type { DocsStills } from './props'
import { color, font, halftone, shadow } from './theme'
import { FPS } from './timeline'

/** Designed at 23 s, the beat's length (src/cut.ts): a design frame is a frame. The first ~9 sit under the ink wipe. */
const DESIGN = 23 * FPS
const at = (seconds: number) => Math.round(seconds * FPS)

/** The six skills, in the order they are run. */
export const STEPS = ['1-start', '2-scope', '3-prd', '4-spec', '5-build', '6-ship'] as const
/** What each step produced, one line under its kicker — facts of the record, not the learner's copy. */
const STEP_MADE = ['the interview', 'scope.md', 'prd.md', 'spec.md', '23 slices, checked', 'this film'] as const

// The learner's three sentences (video/narration.md › method), character for
// character (the enclosing quote marks are the only addition), and when the
// voice says them: it starts 0.4 s into the beat (NARRATION_LEAD), and these
// are the measured times of the recorded clip plus that lead. A sentence
// arrives a word at a time, paced so its last word lands as the voice ends
// it (`said`), and leaves as a whole (`to`) before the next one enters — two
// sentences are never on the band at once. The burned-in captions change
// sentence at 9.3 and 15.57 s; the band follows them within a few frames.
const SAID = [
  { text: '“Under the hackathon\'s Learn Skill Pack, the AI interviewed me before any code: scope, PRD, spec, each approved.”', from: 0.5, said: 9.3, to: 9.1 },
  { text: '“Then 23 slices, each verified by a check script, committed, and checked hands-on.”', from: 9.5, said: 15.3, to: 15.3 },
  { text: '“Every mid-build change sits in Revisions, in my words, so docs and code never drift.”', from: 15.7, said: 22.0, to: Infinity },
] as const
/** A sentence's whole-line fade, in frames (its `to` → gone). */
const SAID_FADE = 8

/**
 * The three movements' titles, one at a time where the chapter card's title
 * sits. Each leaves word by word (Words: 12 frames + 2 per word) and is gone
 * before the next arrives: 8.8 → 9.33 before 9.4, 15.3 → 15.83 before 15.9.
 */
const TITLES = [
  { text: 'Planned before built', from: 0.53, to: 8.8 },
  { text: 'Slice by slice', from: 9.4, to: 15.3 },
  { text: 'The plan revised in the open', from: 15.9, to: Infinity },
] as const

type SheetKey = 'skills' | 'scope' | 'prd' | 'spec' | 'checklist' | 'log' | 'revisions' | 'changes'
type Slot = 'solo' | 'left' | 'right'
type SheetSpec = {
  key: SheetKey
  /** The file's name, under the sheet. */
  file: string
  /** The step it belongs to (lights when it arrives). */
  step: number
  tilt: number
  slot: Slot
  /** Beat seconds: when it takes the stage, and when it leaves for the pile. */
  from: number
  to: number
}

/** The eight sheets, in the order they arrive — the voice's own order. */
const SHEETS: SheetSpec[] = [
  // 1 · "Under the hackathon's Learn Skill Pack, the AI interviewed me before any code: scope, PRD, spec"
  { key: 'skills', file: 'skills/ · the Learn Skill Pack', step: 0, tilt: -1.2, slot: 'solo', from: 1.5, to: 5.8 },
  // Each sheet is named by its document, not its path: the folder's name is the hackathon's, and the film shows no third party's.
  { key: 'scope', file: 'scope.md', step: 1, tilt: -1.4, slot: 'solo', from: 5.8, to: 6.5 },
  { key: 'prd', file: 'prd.md', step: 2, tilt: 1.1, slot: 'solo', from: 6.5, to: 8.1 },
  { key: 'spec', file: 'spec.md', step: 3, tilt: -0.8, slot: 'solo', from: 8.1, to: 9.3 },
  // 2 · "Then 23 slices, each verified by a check script, committed, and checked hands-on."
  { key: 'checklist', file: 'checklist.md', step: 4, tilt: 0.9, slot: 'left', from: 9.4, to: 15.8 },
  { key: 'log', file: 'git log', step: 4, tilt: -0.6, slot: 'right', from: 12.4, to: 15.8 },
  // 3 · "Every mid-build change sits in Revisions, in my words, so docs and code never drift."
  { key: 'revisions', file: 'checklist.md › Revisions', step: 4, tilt: -0.7, slot: 'left', from: 16.0, to: Infinity },
  { key: 'changes', file: 'scope.md › Changes Since Approval', step: 4, tilt: 0.8, slot: 'right', from: 18.7, to: Infinity },
]

// When the rest happens, in beat seconds.
const T = {
  kicker: 0.33,
  chain: 1.6, // the six steps arrive, staggered
  stamp: 14.5, // "checked hands-on"
  strip: 19.3, // the record's dates, under "so docs and code never drift"
  ship: 21.0, // the sixth step lights: this film
  out: 23 - 0.6, // the last 0.6 s
}
const CHAIN_STAGGER = 7
const ARRIVE = 20
const TO_PILE = 24

// The desk: the title, the chain of steps, the stage and the pile, each
// sheet's name under it, the learner's sentence — everything above the
// caption band (the bottom 180 px), and a sheet clear of the chain even as
// it arrives (it slides in from 40 px below its place).
const CHAIN_TOP = 236
/** Where a sheet sits on stage, 16:10 like the stills: alone, or one of a pair. */
const SLOTS: Record<Slot, { cx: number; cy: number; w: number; h: number }> = {
  solo: { cx: 1160, cy: 506, w: 600, h: 375 },
  left: { cx: 890, cy: 496, w: 540, h: 337.5 },
  right: { cx: 1470, cy: 496, w: 540, h: 337.5 },
}
/** The pile of what came before: the same sheets, small, at the left. */
const PILE = { cx: 310, cy: 506, w: 264 }
/** The strip of the record's dates (movement 3), and the learner's sentence under everything. */
const STRIP_TOP = 724
const SAID_TOP = 764
const SAID_HEIGHT = 100

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
  /** Anything pressed onto the paper (the Verified seal): it travels with the sheet, to the pile and all. */
  children?: React.ReactNode
}> = ({ spec, src, local, pileLocal, pileIndex, children }) => {
  if (local < 0) return null
  const slot = SLOTS[spec.slot]
  // Slid in from the right and a touch below, settling flat with its own slight tilt…
  const arrive = tween(local, [0, ARRIVE], [0, 1], SETTLE)
  // …then off to the pile: smaller, further left, a little more tilted, under the next sheet.
  const g = tween(pileLocal, [0, TO_PILE], [0, 1], GLIDE)
  const pileScale = PILE.w / slot.w
  const scale = 1 + (pileScale - 1) * g
  const cx = slot.cx + (PILE.cx + pileIndex * 14 - slot.cx) * g
  const cy = slot.cy + (PILE.cy + pileIndex * 10 - slot.cy) * g
  const rotate = spec.tilt + (1 - arrive) * 5 + (spec.tilt * 2.4 + pileIndex * 1.6) * g
  const rule = tween(local, [8, 30], [0, 1], INK_EASE)
  const text = tween(local, [14, 30], [0, 1], SETTLE)
  return (
    <div
      style={{
        position: 'absolute',
        left: cx - slot.w / 2 + (1 - arrive) * 160,
        top: cy - slot.h / 2 + (1 - arrive) * 40,
        width: slot.w,
        height: slot.h,
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
        // No still yet (prepare.mts says DRAFT): the step and the file's name on paper.
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
              {STEPS[spec.step]}
            </div>
            <div style={{ marginTop: 18, height: 1.5, width: `${rule * 100}%`, background: color.ink }} />
            <div
              style={{
                marginTop: 30,
                fontFamily: font.heading,
                fontStyle: 'italic',
                fontWeight: 500,
                fontSize: 40,
                lineHeight: 1.18,
                color: color.ink,
                opacity: text,
                transform: `translateY(${(1 - text) * 10}px)`,
              }}
            >
              {spec.file}
            </div>
          </div>
        </>
      )}
      {children}
    </div>
  )
}

/** The six steps as kickers, the current one lit. */
const Chain: React.FC<{ f: number; current: number }> = ({ f, current }) => (
  <div style={{ position: 'absolute', top: CHAIN_TOP, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18 }}>
    {STEPS.map((step, i) => {
      const local = f - at(T.chain) - i * CHAIN_STAGGER
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
            <div
              style={{
                marginTop: 8,
                fontFamily: font.heading,
                fontStyle: 'italic',
                fontSize: 21,
                lineHeight: 1.1,
                color: lit ? color.ink : color.neutral600,
                whiteSpace: 'nowrap',
              }}
            >
              {STEP_MADE[i]}
            </div>
            {/* The seal's red marks the step the desk is on. */}
            <span
              style={{
                position: 'absolute',
                left: '50%',
                bottom: -16,
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

/** The record's dates, as a strip in the kicker's style: facts of devpost/, not the learner's copy. */
const VERSIONS = ['v1 · tagged 13 Oct', 'v2 · filmed 14 Oct', 'v3 · frozen 22 Oct', '6-ship · 25 Oct'] as const

const Strip: React.FC<{ f: number }> = ({ f }) => (
  <div style={{ position: 'absolute', top: STRIP_TOP, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
    {VERSIONS.map((v, i) => {
      const local = f - at(T.strip) - i * 4
      const arrive = tween(local, [0, 14], [0, 1], SETTLE)
      return (
        <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: arrive, transform: `translateY(${(1 - arrive) * 8}px)` }}>
          {i > 0 ? <span style={{ width: 28, height: 1, background: color.neutral500, display: 'block' }} /> : null}
          <span
            style={{
              fontFamily: font.body,
              fontSize: 20,
              fontWeight: i === VERSIONS.length - 1 ? 700 : 400,
              letterSpacing: '0.26em',
              textTransform: 'uppercase',
              color: i === VERSIONS.length - 1 ? color.ink : color.neutral700,
              marginRight: '-0.26em',
              whiteSpace: 'nowrap',
            }}
          >
            {v}
          </span>
        </div>
      )
    })}
  </div>
)

const sheetSrc = (docs: DocsStills | null, key: SheetKey): string | null => {
  if (!docs) return null
  switch (key) {
    case 'skills':
      return docs.skills
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
    case 'revisions':
      return docs.checklist.revisions
    case 'changes':
      return docs.scope.changes
  }
}

export const Method: React.FC<{ docs: DocsStills | null; durationInFrames: number }> = ({ docs, durationInFrames }) => {
  const f = designFrame(useCurrentFrame(), durationInFrames, DESIGN)
  const kickerIn = tween(f, [at(T.kicker), at(T.kicker) + 14], [0, 1], SETTLE)
  const out = tween(f, [at(T.out), DESIGN - 1], [0, 1], LEAVE)

  // Which sheets have arrived, and so which step is lit.
  const arrived = SHEETS.filter((s) => f >= at(s.from))
  const current = f >= at(T.ship) ? 5 : (arrived.at(-1)?.step ?? 0)

  return (
    <Paper tone={0.6}>
      <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-28 * out}px)` }}>
        {/* The kicker and the title, set as a chapter card sets them; the title changes with the movement. */}
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
          <div style={{ position: 'relative', width: '100%', height: 92 }}>
            {TITLES.map((t) => (
              <Words
                key={t.text}
                text={t.text}
                frame={f}
                enterAt={at(t.from)}
                exitAt={Number.isFinite(t.to) ? at(t.to) : undefined}
                stagger={4}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  whiteSpace: 'nowrap',
                  fontFamily: font.heading,
                  fontWeight: font.headingWeight,
                  fontSize: 86,
                  lineHeight: 1.05,
                  color: color.ink,
                }}
              />
            ))}
          </div>
        </div>

        <Chain f={f} current={current} />

        {/* The sheets: in order of arrival, so the one on stage is always over the pile. */}
        {SHEETS.map((spec, i) => (
          <Sheet key={spec.key} spec={spec} src={sheetSrc(docs, spec.key)} local={f - at(spec.from)} pileLocal={Number.isFinite(spec.to) ? f - at(spec.to) : -1} pileIndex={i}>
            {spec.key === 'checklist' ? (
              // "checked hands-on": the seal pressed on the checklist's own corner, so it glides to the pile with the paper
              // (on the paper sheet, not the log: multiply would drown in the terminal's dark). Far enough from the edge
              // that the paper does not clip it as it comes down at 1.8×.
              <Hanko label="Verified" local={f - at(T.stamp)} size={34} rotate={-9} style={{ left: SLOTS.left.w - 330, top: SLOTS.left.h - 96 }} />
            ) : null}
          </Sheet>
        ))}

        {/* Each sheet on stage, named under it by its file. */}
        {SHEETS.map((spec) => {
          const slot = SLOTS[spec.slot]
          const local = f - at(spec.from)
          if (local < 0) return null
          const labelIn = tween(local, [10, 26], [0, 1], SETTLE)
          const labelOut = Number.isFinite(spec.to) ? tween(f - at(spec.to), [0, 10], [1, 0], LEAVE) : 1
          return (
            <div
              key={`label-${spec.key}`}
              style={{
                position: 'absolute',
                top: slot.cy + slot.h / 2 + 14,
                left: slot.cx - slot.w / 2,
                width: slot.w,
                textAlign: 'center',
                fontFamily: font.body,
                fontSize: 18,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: color.neutral700,
                whiteSpace: 'nowrap',
                opacity: labelIn * labelOut,
                transform: `translateY(${(1 - labelIn) * 8}px)`,
              }}
            >
              {spec.file}
            </div>
          )
        })}

        <Strip f={f} />

        {/* The learner's sentence, verbatim, under the stage — one at a time, word by word at the voice's pace. */}
        <div style={{ position: 'absolute', top: SAID_TOP, left: 0, right: 0, height: SAID_HEIGHT, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {SAID.map((s) => {
            // Paced so the last word is in (its 12-frame fade done) as the voice ends the sentence.
            const words = s.text.split(' ').length
            const stagger = Math.max(3, Math.floor((at(s.said) - at(s.from) - 12) / Math.max(1, words - 1)))
            // The whole line fades at once: a word-by-word exit would still be leaving when the next sentence enters.
            const stay = Number.isFinite(s.to) ? tween(f, [at(s.to), at(s.to) + SAID_FADE], [1, 0], LEAVE) : 1
            if (f < at(s.from) || stay <= 0) return null
            return (
              <div
                key={s.text}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 1500,
                  opacity: stay,
                }}
              >
                <Words
                  text={s.text}
                  frame={f}
                  enterAt={at(s.from)}
                  stagger={stagger}
                  style={{
                    fontFamily: font.heading,
                    fontStyle: 'italic',
                    fontWeight: 500,
                    fontSize: 38,
                    lineHeight: 1.22,
                    color: color.ink,
                    textAlign: 'center',
                  }}
                />
              </div>
            )
          })}
        </div>
      </AbsoluteFill>
    </Paper>
  )
}
