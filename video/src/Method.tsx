// How it was made (the method beat): the project was planned before it was
// built, under the hackathon's learn skill pack. Two movements. First the
// chain — six steps, 1-start to 6-ship, each with what it produced — arrives
// across the desk one step at a time, then lifts away. Then the record: the
// three documents slide in as sheets of paper, the build checklist ticks its
// 23 slices one after another, and the real git log types itself in; one
// line under them, stamped Verified, and a quieter note on Revisions. The
// narration says the rest; the words on screen are few, and none of them is
// a provider's or a brand's name.
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { Hanko } from './pieces/Hanko'
import { designFrame, INK_EASE, LEAVE, SETTLE, stampLand, tween } from './pieces/motion'
import { Paper } from './pieces/Paper'
import { Words } from './pieces/Words'
import { color, font, halftone, shadow } from './theme'

/** Designed at 22 s; the first ~9 frames sit under the ink wipe. */
const DESIGN = 660

// When things happen, in design frames.
const T = {
  kicker: 10,
  title: 16,
  chain: 56, // the first step; the others follow by STEP_STAGGER
  chainNote: 196,
  chainOut: 262, // the chain lifts away…
  record: 292, // …and the record takes the desk
  sheets: 302, // the first sheet; the others follow by SHEET_STAGGER
  ticks: 318, // the first tick; the others follow by TICK_STAGGER
  log: 352, // the first commit; the others follow by LOG_STAGGER
  line: 478,
  stamp: 532,
  note: 560,
  out: DESIGN - 18, // the last 0.6 s
}
const STEP_STAGGER = 24
const SHEET_STAGGER = 28
const TICK_STAGGER = 6
const LOG_STAGGER = 13

// The chain: what each step of the skill pack produced.
const STEPS = [
  { n: '1', name: 'start', made: 'the learner profile' },
  { n: '2', name: 'scope', made: 'scope.md' },
  { n: '3', name: 'prd', made: 'prd.md' },
  { n: '4', name: 'spec', made: 'spec.md' },
  { n: '5', name: 'build', made: '23 slices, verified' },
  { n: '6', name: 'ship', made: 'this video' },
]
const STEP_W = 230
const STEP_H = 150
const ARROW_W = 74
const CHAIN_TOP = 392

// The record: the three documents, as they are named in devpost/.
const SHEETS = [
  { file: 'scope.md', line: 'the idea, cut to a proof of concept' },
  { file: 'prd.md', line: 'every behavior, state and edge case' },
  { file: 'spec.md', line: 'the stack, the data, the files' },
]
// The 23 slices of devpost/checklist.md, each by its short name.
const SLICES = [
  'providers answer',
  'the kernel test',
  'the studio, a pitch',
  'two locked sheets',
  'the page inks in',
  'redraw and versions',
  'the page exports',
  'the dashboard',
  'text never dark',
  'the library',
  'the Director',
  'the chapter reads',
  'cloud storage',
  'the video project',
  'freeze and film',
  'the foundation',
  'motion kernel test',
  'queue and worker',
  'accounts, ownership',
  'limits, kill switch',
  'sharing, settings',
  'animate a page',
  'responsive, the audit',
]
// Real commits, newest first, as `git log --oneline` prints them; a long
// subject is cut by the column, never rewritten.
const GIT_LOG = [
  { hash: 'f5a5354', subject: '5-build complete: v3 final review confirmed by the learner' },
  { hash: '6ad81bf', subject: 'Freeze v3: responsive, the after-audit, the judge account, README (slice 23 checked by the learner)' },
  { hash: '28d4509', subject: 'Sharing, reports and settings: share links, the admin list, export and account deletion (slice 21 checked by the learner)' },
  { hash: 'bab6b5b', subject: 'Limits: quotas, rate limits, spend reservation and the kill switch; generation opens (slice 20 checked by the learner)' },
  { hash: 'f867d6e', subject: 'Motion kernel test: two methods, three shots, the learner’s verdict (slice 17 checked by the learner)' },
  { hash: '80132c1', subject: '23 (WIP): the review’s fixes — 9 confirmed findings, each reproduced first' },
  { hash: 'b151320', subject: '18 (WIP): the review’s fixes — 22 confirmed findings, each reproduced first and held by check:queue' },
]

// The record's three columns, above the closing line; the caption band (the
// bottom 180 px) stays clear.
const COLUMNS_X = 100
const COLUMNS_W = 1720
const COLUMN_GAP = 41
const COLUMN_W = (COLUMNS_W - 2 * COLUMN_GAP) / 3
const HEADER_TOP = 290
const CONTENT_TOP = 334
const CONTENT_H = 408
const LINE_TOP = 768
const NOTE_TOP = 852

const smallCaps: React.CSSProperties = {
  fontFamily: font.body,
  fontSize: 20,
  letterSpacing: '0.3em',
  textTransform: 'uppercase',
  color: color.neutral700,
}

/** One step of the chain, slid in from the right and settling flat; its arrow draws in after it. */
const Step: React.FC<{ step: (typeof STEPS)[number]; local: number; last: boolean }> = ({ step, local, last }) => {
  const arrive = tween(local, [0, 22], [0, 1], SETTLE)
  const arrow = tween(local, [14, 30], [0, 1], INK_EASE)
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div
        style={{
          position: 'relative',
          width: STEP_W,
          height: STEP_H,
          background: color.neutral100,
          border: `2px solid ${color.ink}`,
          boxShadow: shadow.md,
          opacity: arrive,
          transform: `translate(${(1 - arrive) * 90}px, ${(1 - arrive) * 24}px)`,
        }}
      >
        <div style={{ position: 'absolute', left: 22, right: 22, top: 18, display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontFamily: font.heading, fontWeight: font.headingWeight, fontSize: 60, lineHeight: 1, color: color.ink }}>{step.n}</span>
          <span style={{ ...smallCaps, fontSize: 22, color: color.neutral800 }}>{step.name}</span>
        </div>
        <div style={{ position: 'absolute', left: 22, right: 22, top: 92, height: 1.5, background: color.ink, width: `${arrive * (STEP_W - 44)}px` }} />
        <div style={{ position: 'absolute', left: 22, right: 22, top: 104, fontFamily: font.heading, fontStyle: 'italic', fontWeight: 500, fontSize: 26, lineHeight: 1.15, color: color.ink }}>
          {step.made}
        </div>
      </div>
      {last ? null : (
        <div style={{ width: ARROW_W, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width={ARROW_W - 16} height="18" viewBox={`0 0 ${ARROW_W - 16} 18`} style={{ overflow: 'visible' }}>
            <line x1="0" y1="9" x2={(ARROW_W - 24) * arrow} y2="9" stroke={color.ink} strokeWidth="2" />
            {arrow > 0.95 ? <path d={`M${ARROW_W - 30} 2 L${ARROW_W - 22} 9 L${ARROW_W - 30} 16`} fill="none" stroke={color.ink} strokeWidth="2" /> : null}
          </svg>
        </div>
      )}
    </div>
  )
}

/** A document as a sheet of paper, slid onto the desk. */
const Sheet: React.FC<{ file: string; line: string; local: number; tilt: number }> = ({ file, line, local, tilt }) => {
  const arrive = tween(local, [0, 24], [0, 1], SETTLE)
  const rule = tween(local, [8, 28], [0, 1], INK_EASE)
  return (
    <div
      style={{
        position: 'relative',
        width: 500,
        height: 124,
        background: color.neutral100,
        border: `2px solid ${color.ink}`,
        boxShadow: shadow.md,
        overflow: 'hidden',
        opacity: arrive,
        transform: `translate(${(1 - arrive) * 120}px, ${(1 - arrive) * 24}px) rotate(${tilt + (1 - arrive) * 4}deg)`,
      }}
    >
      <AbsoluteFill
        style={{
          background: halftone.dotsFine,
          opacity: 0.22,
          maskImage: 'radial-gradient(ellipse 70% 70% at 100% 100%, #000 0, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 100% 100%, #000 0, transparent 70%)',
        }}
      />
      <div style={{ position: 'absolute', left: 28, right: 28, top: 20 }}>
        <div style={{ ...smallCaps, fontSize: 19 }}>{file}</div>
        <div style={{ marginTop: 10, height: 1.5, width: `${rule * 100}%`, background: color.ink }} />
        <div style={{ marginTop: 12, fontFamily: font.heading, fontStyle: 'italic', fontWeight: 500, fontSize: 28, lineHeight: 1.15, color: color.ink }}>{line}</div>
      </div>
    </div>
  )
}

/** One slice of the checklist: its box, then the tick pressed into it. */
const Tick: React.FC<{ n: number; name: string; local: number }> = ({ n, name, local }) => {
  const { scale, opacity } = stampLand(Math.max(-1, local), 10)
  const done = local >= 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 34 }}>
      <div style={{ position: 'relative', width: 20, height: 20, border: `2px solid ${color.ink}`, background: color.neutral100, flex: 'none' }}>
        {done ? (
          <svg width="20" height="20" viewBox="0 0 20 20" style={{ position: 'absolute', left: -2, top: -4, transform: `scale(${scale})`, opacity, transformOrigin: '50% 50%' }}>
            <path d="M3 10.5 L8 15 L17.5 4" fill="none" stroke={color.hanko} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </div>
      <div style={{ fontFamily: font.body, fontSize: 18, color: done ? color.ink : color.neutral600, whiteSpace: 'nowrap' }}>
        <span style={{ color: color.neutral600 }}>{n}</span>
        <span style={{ color: color.neutral500 }}> · </span>
        {name}
      </div>
    </div>
  )
}

/** A commit line, typed into the log. */
const Commit: React.FC<{ hash: string; subject: string; local: number; width: number }> = ({ hash, subject, local, width }) => {
  const show = tween(local, [0, 12], [0, 1], SETTLE)
  return (
    <div
      style={{
        width,
        height: 52,
        display: 'flex',
        alignItems: 'baseline',
        gap: 14,
        opacity: show,
        transform: `translateY(${(1 - show) * 8}px)`,
        fontFamily: font.body,
        fontSize: 18,
        color: color.ink,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      <span style={{ color: color.hanko, letterSpacing: '0.04em', flex: 'none' }}>{hash}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{subject}</span>
    </div>
  )
}

export const Method: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const f = designFrame(useCurrentFrame(), durationInFrames, DESIGN)
  const kickerIn = tween(f, [T.kicker, T.kicker + 14], [0, 1], SETTLE)
  const chainNote = tween(f, [T.chainNote, T.chainNote + 16], [0, 1], SETTLE)
  const chainOut = tween(f, [T.chainOut, T.chainOut + 22], [0, 1], LEAVE)
  const recordIn = tween(f, [T.record, T.record + 16], [0, 1], SETTLE)
  const noteIn = tween(f, [T.note, T.note + 16], [0, 1], SETTLE)
  const out = tween(f, [T.out, DESIGN - 1], [0, 1], LEAVE)
  const columnX = (i: number) => COLUMNS_X + i * (COLUMN_W + COLUMN_GAP)

  return (
    <Paper tone={0.6}>
      <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-28 * out}px)` }}>
        {/* The kicker and the title, set as a chapter card sets them. */}
        <div style={{ position: 'absolute', top: 108, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
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
            <span style={{ marginRight: '-0.34em' }}>How it was made</span>
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
              fontSize: 100,
              lineHeight: 1.05,
              color: color.ink,
            }}
          />
        </div>

        {/* First movement: the chain, 1-start to 6-ship, with what each step produced. */}
        <AbsoluteFill style={{ opacity: 1 - chainOut, transform: `translateY(${-24 * chainOut}px)` }}>
          <div style={{ position: 'absolute', top: CHAIN_TOP, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
            {STEPS.map((s, i) => (
              <Step key={s.name} step={s} local={f - T.chain - i * STEP_STAGGER} last={i === STEPS.length - 1} />
            ))}
          </div>
          <div
            style={{
              position: 'absolute',
              top: CHAIN_TOP + STEP_H + 64,
              left: 0,
              right: 0,
              textAlign: 'center',
              ...smallCaps,
              fontSize: 24,
              letterSpacing: '0.22em',
              color: color.neutral600,
              opacity: chainNote,
              transform: `translateY(${(1 - chainNote) * 10}px)`,
            }}
          >
            each step approved before the next · no code before the spec
          </div>
        </AbsoluteFill>

        {/* Second movement: the record — the documents, the checklist, the git log. */}
        <AbsoluteFill style={{ opacity: recordIn }}>
          {['The documents', 'The checklist · 23 slices', 'The git log'].map((h, i) => (
            <div key={h} style={{ position: 'absolute', top: HEADER_TOP, left: columnX(i), width: COLUMN_W, ...smallCaps, opacity: recordIn, transform: `translateY(${(1 - recordIn) * 8}px)` }}>
              {h}
              <div style={{ marginTop: 10, height: 1, width: `${recordIn * 100}%`, background: color.neutral500 }} />
            </div>
          ))}

          {/* The three documents. */}
          <div style={{ position: 'absolute', top: CONTENT_TOP, left: columnX(0), width: COLUMN_W, height: CONTENT_H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between' }}>
            {SHEETS.map((s, i) => (
              <Sheet key={s.file} file={s.file} line={s.line} tilt={[-1.2, 0.8, -0.6][i]} local={f - T.sheets - i * SHEET_STAGGER} />
            ))}
          </div>

          {/* The checklist, twelve and eleven, ticked in order. */}
          <div style={{ position: 'absolute', top: CONTENT_TOP, left: columnX(1), width: COLUMN_W, height: CONTENT_H, display: 'flex', gap: 18 }}>
            {[SLICES.slice(0, 12), SLICES.slice(12)].map((half, c) => (
              <div key={c} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {half.map((name, i) => {
                  const n = c * 12 + i + 1
                  return <Tick key={n} n={n} name={name} local={f - T.ticks - (n - 1) * TICK_STAGGER} />
                })}
              </div>
            ))}
          </div>

          {/* The git log, newest first. */}
          <div style={{ position: 'absolute', top: CONTENT_TOP, left: columnX(2), width: COLUMN_W, height: CONTENT_H, display: 'flex', flexDirection: 'column', gap: 0 }}>
            {GIT_LOG.map((c, i) => (
              <Commit key={c.hash} hash={c.hash} subject={c.subject} width={COLUMN_W} local={f - T.log - i * LOG_STAGGER} />
            ))}
          </div>

          {/* The build, in one line, stamped. */}
          <div style={{ position: 'absolute', top: LINE_TOP, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Words
                text="23 slices, each verified and committed"
                frame={f}
                enterAt={T.line}
                stagger={4}
                style={{
                  whiteSpace: 'nowrap',
                  fontFamily: font.heading,
                  fontWeight: font.headingWeight,
                  fontSize: 56,
                  lineHeight: 1.1,
                  color: color.ink,
                }}
              />
              <Hanko label="Verified" local={f - T.stamp} size={28} rotate={-9} style={{ top: 4, right: -214 }} />
            </div>
          </div>

          {/* A quieter note. */}
          <div
            style={{
              position: 'absolute',
              top: NOTE_TOP,
              left: 0,
              right: 0,
              textAlign: 'center',
              fontFamily: font.body,
              fontSize: 22,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: color.neutral600,
              opacity: noteIn,
              transform: `translateY(${(1 - noteIn) * 10}px)`,
            }}
          >
            every change recorded in Revisions · v1, v2 and v3 in the same documents
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </Paper>
  )
}
