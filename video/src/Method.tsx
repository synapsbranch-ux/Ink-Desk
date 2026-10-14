// How it was made (scope.md > The Demo Video (v2)): the project was planned
// before it was built. Three sheets of paper slide onto the desk one after
// another — the scope, the PRD and the spec, each with its one line — then
// the build in one sentence, stamped Verified, and a quieter note on how v1
// and v2 live in the same documents. Everything lifts away at the end. The
// narration says the rest; the words on screen are few.
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { Hanko } from './pieces/Hanko'
import { designFrame, INK_EASE, LEAVE, SETTLE, tween } from './pieces/motion'
import { Paper } from './pieces/Paper'
import { Words } from './pieces/Words'
import { color, font, halftone, shadow } from './theme'

/** Designed at 14 s; the first ~9 frames sit under the ink wipe. */
const DESIGN = 420

// When things happen, in design frames.
const T = {
  kicker: 10,
  title: 16,
  sheets: 60, // the first sheet; the others follow by SHEET_STAGGER
  line: 196,
  stamp: 246,
  note: 272,
  out: DESIGN - 18, // the last 0.6 s
}
const SHEET_STAGGER = 34

const SHEETS = [
  { file: 'scope.md', line: 'the idea, cut to a proof of concept', tilt: -1.6 },
  { file: 'prd.md', line: 'every behavior, state and edge case', tilt: 1.1 },
  { file: 'spec.md', line: 'the stack, the data, the files', tilt: -0.7 },
]

// The desk: everything sits above the caption band (the bottom 180 px).
const SHEET_W = 500
const SHEET_H = 272
const SHEET_GAP = 52
const SHEETS_TOP = 336
const LINE_TOP = 678
const NOTE_TOP = 790

const Sheet: React.FC<{ file: string; line: string; tilt: number; local: number }> = ({ file, line, tilt, local }) => {
  // Slid in from the right and a touch below, settling flat with its own slight tilt.
  const arrive = tween(local, [0, 26], [0, 1], SETTLE)
  const rule = tween(local, [8, 30], [0, 1], INK_EASE)
  const text = tween(local, [14, 30], [0, 1], SETTLE)
  return (
    <div
      style={{
        position: 'relative',
        width: SHEET_W,
        height: SHEET_H,
        background: color.neutral100,
        border: `2px solid ${color.ink}`,
        boxShadow: shadow.md,
        overflow: 'hidden',
        opacity: arrive,
        transform: `translate(${(1 - arrive) * 140}px, ${(1 - arrive) * 36}px) rotate(${tilt + (1 - arrive) * 5}deg)`,
      }}
    >
      {/* A faint screen of tone in the sheet's lower corner. */}
      <AbsoluteFill
        style={{
          background: halftone.dotsFine,
          opacity: 0.22,
          maskImage: 'radial-gradient(ellipse 70% 70% at 100% 100%, #000 0, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 100% 100%, #000 0, transparent 70%)',
        }}
      />
      <div style={{ position: 'absolute', left: 36, right: 36, top: 34 }}>
        <div
          style={{
            fontFamily: font.body,
            fontSize: 22,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            color: color.neutral700,
            opacity: text,
          }}
        >
          {file}
        </div>
        {/* A thin ink rule under the file name, drawn left to right. */}
        <div style={{ marginTop: 16, height: 1.5, width: `${rule * 100}%`, background: color.ink }} />
        <div
          style={{
            marginTop: 26,
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
          {line}
        </div>
      </div>
    </div>
  )
}

export const Method: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const f = designFrame(useCurrentFrame(), durationInFrames, DESIGN)
  const kickerIn = tween(f, [T.kicker, T.kicker + 14], [0, 1], SETTLE)
  const noteIn = tween(f, [T.note, T.note + 16], [0, 1], SETTLE)
  const out = tween(f, [T.out, DESIGN - 1], [0, 1], LEAVE)

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

        {/* The three sheets, one after another. */}
        <div style={{ position: 'absolute', top: SHEETS_TOP, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: SHEET_GAP }}>
          {SHEETS.map((s, i) => (
            <Sheet key={s.file} file={s.file} line={s.line} tilt={s.tilt} local={f - T.sheets - i * SHEET_STAGGER} />
          ))}
        </div>

        {/* The build, in one line, stamped. */}
        <div style={{ position: 'absolute', top: LINE_TOP, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Words
              text="Slice by slice, each verified and committed"
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
            <Hanko label="Verified" local={f - T.stamp} size={30} rotate={-9} style={{ top: -48, right: -196 }} />
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
            fontSize: 24,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: color.neutral600,
            opacity: noteIn,
            transform: `translateY(${(1 - noteIn) * 10}px)`,
          }}
        >
          v1 tagged · v2 revised in the same documents
        </div>
      </AbsoluteFill>
    </Paper>
  )
}
