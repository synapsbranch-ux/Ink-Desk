// What I learned — the last spoken beat: the locked sheet beside one panel
// drawn from it, the kernel in a single quiet frame after the money shot's
// spread. The reference arrives and is stamped Locked; a hairline is ruled
// beside it; the panel inks in from its own pencil; each gets its label; one
// honest line closes under them. The narration says the rest, and the mute
// final card follows.
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import { Hanko } from './pieces/Hanko'
import { InkIn, PencilFilter, pencilStyle } from './pieces/InkIn'
import { contain, type Box } from './pieces/layout'
import { designFrame, INK_FRAMES, LEAVE, SETTLE, tween } from './pieces/motion'
import { Paper } from './pieces/Paper'
import { useAspects } from './pieces/useAspects'
import { Words } from './pieces/Words'
import { color, font, halftone, shadow } from './theme'
import type { MoneyShotStills } from './timeline'

/** Designed at 15 s; the first ~9 frames sit under the ink wipe. */
const DESIGN = 450

// When things happen, in design frames.
const T = {
  kicker: 10,
  title: 16,
  reference: 30,
  stamp: 64,
  divider: 84,
  panel: 98, // the panel's ink
  line: 290,
  out: 428,
}

// The stage sits under the title and above the closing line; the caption
// band (the bottom 180 px) stays clear.
const STAGE: Box = { x: 200, y: 250, w: 1520, h: 430 }
const GAP = 140
const LABEL_H = 72
const LINE_TOP = 752

const Label: React.FC<{ name: string; note: string; box: Box; at: number }> = ({ name, note, box, at }) => {
  const show = tween(at, [0, 14], [0, 1], SETTLE)
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y + box.h + 16,
        width: box.w,
        opacity: show,
        transform: `translateY(${(1 - show) * 10}px)`,
      }}
    >
      <div style={{ fontFamily: font.heading, fontWeight: font.headingWeight, fontSize: 36, lineHeight: 1.05, color: color.ink }}>{name}</div>
      <div style={{ marginTop: 4, fontFamily: font.body, fontStyle: 'italic', fontSize: 21, color: color.neutral700 }}>{note}</div>
    </div>
  )
}

export const Learned: React.FC<{ stills: MoneyShotStills; placeholder: boolean; durationInFrames: number }> = ({
  stills,
  placeholder,
  durationInFrames,
}) => {
  const f = designFrame(useCurrentFrame(), durationInFrames, DESIGN)
  const panel = stills.panels[0] ?? null
  const aspects = useAspects([stills.character.reference, ...(panel ? [panel.src] : [])])
  if (!aspects) return <Paper />
  const [refAspect, panelAspect] = aspects

  // Two columns, each picture contained in its own and set on one baseline.
  const columnW = (STAGE.w - GAP) / 2
  const baseline = STAGE.y + STAGE.h - LABEL_H
  const column = (i: number): Box => ({ x: STAGE.x + i * (columnW + GAP), y: STAGE.y, w: columnW, h: baseline - STAGE.y })
  const onBaseline = (b: Box): Box => ({ ...b, y: baseline - b.h })
  const ref = onBaseline(contain(refAspect, column(0)))
  const art = panel ? onBaseline(contain(panelAspect ?? 1.5, column(1))) : null

  const kickerIn = tween(f, [T.kicker, T.kicker + 14], [0, 1], SETTLE)
  const refIn = tween(f, [T.reference, T.reference + 22], [0, 1], SETTLE)
  const dividerIn = tween(f, [T.divider, T.divider + 30], [0, 1], SETTLE)
  const artIn = tween(f, [T.panel - 12, T.panel], [0, 1], SETTLE)
  const out = tween(f, [T.out, DESIGN - 1], [0, 1], LEAVE)
  const dividerX = STAGE.x + STAGE.w / 2

  return (
    <Paper tone={0.6}>
      <PencilFilter />
      <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-24 * out}px)` }}>
        {/* The kicker and the title, as the chapter cards set them. */}
        <div style={{ position: 'absolute', top: 96, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
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
            <span style={{ marginRight: '-0.34em' }}>What I learned</span>
            <span style={{ width: 56 * kickerIn, height: 1, background: color.neutral500 }} />
          </div>
          <Words
            text="One sheet. One DNA text. Every request."
            frame={f}
            enterAt={T.title}
            stagger={4}
            style={{ whiteSpace: 'nowrap', fontFamily: font.heading, fontWeight: font.headingWeight, fontSize: 72, lineHeight: 1.05, color: color.ink }}
          />
        </div>
        {placeholder ? (
          <div style={{ position: 'absolute', top: 40, right: 80, fontFamily: font.body, fontStyle: 'italic', fontSize: 20, color: color.neutral600, opacity: kickerIn }}>
            Stand-in art: the v1 desk
          </div>
        ) : null}

        {/* A hairline between the sheet and what was drawn from it. */}
        <div style={{ position: 'absolute', left: dividerX, top: STAGE.y + 12, width: 1, height: (baseline - STAGE.y - 24) * dividerIn, background: color.divider }} />

        {/* The locked sheet. */}
        <div
          style={{
            position: 'absolute',
            left: ref.x,
            top: ref.y,
            width: ref.w,
            height: ref.h,
            opacity: refIn,
            transform: `translateY(${(1 - refIn) * 30}px)`,
            border: `2px solid ${color.ink}`,
            background: color.neutral100,
            boxShadow: shadow.lg,
          }}
        >
          <Img src={staticFile(stills.character.reference)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          <Hanko label="Locked" local={f - T.stamp} size={36} solid style={{ top: -24, right: -30 }} />
        </div>
        <Label
          name={stills.character.name}
          note={stills.character.source === 'upload' ? 'My drawing, locked as the sheet' : 'The model sheet, locked'}
          box={ref}
          at={f - T.stamp - 10}
        />

        {/* The panel drawn from it, inked in over its own pencil. */}
        {panel && art ? (
          <>
            <div
              style={{
                position: 'absolute',
                left: art.x,
                top: art.y,
                width: art.w,
                height: art.h,
                opacity: artIn,
                transform: `translateY(${(1 - artIn) * 16}px)`,
                border: `2px solid ${color.ink}`,
                background: color.neutral100,
                overflow: 'hidden',
              }}
            >
              <InkIn
                local={f - T.panel}
                under={
                  <AbsoluteFill style={{ background: `${halftone.sketch}, ${color.neutral200}` }}>
                    <Img src={staticFile(panel.src)} style={{ width: '100%', height: '100%', objectFit: 'contain', ...pencilStyle }} />
                  </AbsoluteFill>
                }
              >
                <Img src={staticFile(panel.src)} style={{ width: '100%', height: '100%', objectFit: 'contain', background: color.neutral100 }} />
              </InkIn>
            </div>
            <Label name={`Page ${panel.page} · Panel ${panel.panel}`} note="Drawn from that sheet and its DNA" box={art} at={f - T.panel - INK_FRAMES + 4} />
          </>
        ) : null}

        {/* The closing line — the narration's last words. */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: LINE_TOP }}>
          <Words
            text="An *honest* proof of concept, not a guarantee."
            frame={f}
            enterAt={T.line}
            stagger={5}
            style={{ fontFamily: font.heading, fontWeight: font.headingWeight, fontSize: 64, lineHeight: 1, color: color.ink }}
          />
        </div>
      </AbsoluteFill>
    </Paper>
  )
}
