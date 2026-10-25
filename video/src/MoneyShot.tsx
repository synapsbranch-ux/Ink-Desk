// The money shot (scope.md > The Demo Video (v2)): the character's reference
// beside the panels it was drawn into — the proof, in one frame, that the
// face held. The reference arrives and is stamped Locked; it steps aside;
// the panels ink in from pencil one after another, as they do in the app,
// each labelled with its page and panel; the cover last; then the camera
// pulls back for one line. Laid out from the pictures' real shapes, so two
// panels and no cover (the stand-in) and eight panels and a cover (the film)
// both fill the frame.
import { AbsoluteFill, Easing, Img, staticFile, useCurrentFrame } from 'remotion'
import { Hanko } from './pieces/Hanko'
import { InkIn, PencilFilter, pencilStyle } from './pieces/InkIn'
import { contain, justify, type Box } from './pieces/layout'
import { designFrame, INK_FRAMES, LEAVE, SETTLE, tween } from './pieces/motion'
import { Paper } from './pieces/Paper'
import { useAspects } from './pieces/useAspects'
import { Words } from './pieces/Words'
import { color, font, halftone, shadow } from './theme'
import type { MoneyShotStills } from './timeline'

/** Designed at 15 s (12 s in the v3 film, stretched to fit); the first ~9 frames sit under the ink wipe. */
const DESIGN = 450

// When things happen, in design frames.
const T = {
  title: 10,
  reference: 14,
  stamp: 46,
  glide: [74, 108] as const,
  panels: 104, // first panel's ink; the rest spread over PANEL_WINDOW
  pullBack: [338, 372] as const,
  line: 352,
  out: 428,
}
const PANEL_WINDOW = 150

// The stage, above the caption band (bottom 180 px stay clear).
// The running head sits low enough to clear the DRAFT stamp a draft carries.
const STAGE: Box = { x: 80, y: 168, w: 1760, h: 624 }
const COLUMN_GAP = 64
const GUTTER = 22
const LABEL_SPACE = 92
/** The closing line needs the art to end above this. */
const LINE_ROOM_TOP = 744

const GLIDE = Easing.bezier(0.65, 0, 0.35, 1)

type Placed = { src: string; box: Box; label: string; start: number }

function stage(stills: MoneyShotStills, aspects: number[]) {
  const [refAspect, ...rest] = aspects
  const panelAspects = rest.slice(0, stills.panels.length)
  const coverAspect = stills.cover ? rest[stills.panels.length] : null
  const crowded = stills.panels.length > 3 || coverAspect !== null
  // The reference column narrows when the panels need the room; a tall
  // upload takes only the width it needs.
  const columnW = crowded ? 540 : 640
  const fitted = contain(refAspect, { x: STAGE.x, y: STAGE.y, w: columnW, h: STAGE.h - LABEL_SPACE })
  const reference = { ...fitted, x: STAGE.x }
  const coverW = coverAspect === null ? 0 : Math.min(STAGE.h * coverAspect, 460)
  const coverGap = coverAspect === null ? 0 : GUTTER * 1.6
  const left = STAGE.x + reference.w + COLUMN_GAP
  const right = STAGE.x + STAGE.w - coverW - coverGap
  let panels = justify(panelAspects, { x: left, y: STAGE.y, w: right - left, h: STAGE.h }, GUTTER)
  // Pull the panels in against the reference, the cover in against them, and
  // centre the whole spread — no dead gutter when the panels run narrow.
  const blockX = Math.min(...panels.map((b) => b.x))
  const blockRight = Math.max(...panels.map((b) => b.x + b.w)) - (blockX - left)
  panels = panels.map((b) => ({ ...b, x: b.x - (blockX - left) }))
  let cover: Box | null = coverAspect === null ? null : contain(coverAspect, { x: blockRight + coverGap, y: STAGE.y, w: coverW, h: STAGE.h })
  const spreadRight = cover ? cover.x + cover.w : blockRight
  const dx = (STAGE.x + STAGE.w - spreadRight) / 2
  panels = panels.map((b) => ({ ...b, x: b.x + dx }))
  if (cover) cover = { ...cover, x: cover.x + dx }
  // Line the reference up with the middle of the art beside it.
  const top = Math.min(...panels.map((b) => b.y), cover ? cover.y : Infinity)
  const bottom = Math.max(...panels.map((b) => b.y + b.h), cover ? cover.y + cover.h : -Infinity)
  const mid = (top + bottom) / 2
  const refY = Math.max(STAGE.y, Math.min(mid - (reference.h + LABEL_SPACE) / 2, STAGE.y + STAGE.h - reference.h - LABEL_SPACE))
  return {
    reference: { ...reference, x: reference.x + dx, y: refY },
    panels,
    cover,
    divider: STAGE.x + reference.w + COLUMN_GAP / 2 + dx,
    top,
    bottom,
  }
}

/** A finished picture over its pencil, framed in ink like a panel on the page. */
const Framed: React.FC<{ src: string; box: Box; local: number; label: string; labelAt: number }> = ({ src, box, local, label, labelAt }) => {
  const appear = tween(local, [-14, 0], [0, 1], SETTLE)
  const tag = tween(labelAt, [0, 10], [0, 1], SETTLE)
  const small = box.h < 260
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 16}px)`,
        border: `2px solid ${color.ink}`,
        background: color.neutral100,
        overflow: 'hidden',
      }}
    >
      <InkIn
        local={local}
        under={
          <AbsoluteFill style={{ background: `${halftone.sketch}, ${color.neutral200}` }}>
            <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'contain', ...pencilStyle }} />
          </AbsoluteFill>
        }
      >
        <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'contain', background: color.neutral100 }} />
      </InkIn>
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          padding: small ? '3px 9px 4px' : '5px 12px 6px',
          background: 'rgba(32, 31, 29, 0.86)',
          color: color.paper,
          fontFamily: font.body,
          fontSize: small ? 16 : 20,
          letterSpacing: '0.04em',
          opacity: tag,
          transform: `translateY(${(1 - tag) * 100}%)`,
        }}
      >
        {label}
      </div>
    </div>
  )
}

export const MoneyShot: React.FC<{ stills: MoneyShotStills; placeholder: boolean; durationInFrames: number }> = ({
  stills,
  placeholder,
  durationInFrames,
}) => {
  const f = designFrame(useCurrentFrame(), durationInFrames, DESIGN)
  const panels = stills.panels.slice(0, 8)
  const paths = [stills.character.reference, ...panels.map((p) => p.src), ...(stills.cover ? [stills.cover] : [])]
  const aspects = useAspects(paths)
  if (!aspects) return <Paper />

  const layout = stage({ ...stills, panels }, aspects)

  // Panels share a fixed window, so eight ink in briskly and two take their time.
  // Panels, then the cover, one after another — the cover always inks last.
  const items = panels.length + (stills.cover ? 1 : 0)
  const stagger = items > 1 ? Math.min(30, (PANEL_WINDOW - INK_FRAMES) / (items - 1)) : 0
  const placed: Placed[] = panels.map((p, i) => ({
    src: p.src,
    box: layout.panels[i],
    label: `Page ${p.page} · Panel ${p.panel}`,
    start: T.panels + i * stagger,
  }))
  const coverStart = T.panels + panels.length * stagger
  if (stills.cover && layout.cover) placed.push({ src: stills.cover, box: layout.cover, label: 'Cover', start: coverStart })

  // The reference first takes the stage, larger and centred, then steps aside.
  const ref = layout.reference
  const big = 1.45
  const startX = STAGE.x + STAGE.w / 2 - (ref.w * big) / 2
  const startY = STAGE.y + (STAGE.h - ref.h * big) / 2 - 10
  const g = tween(f, [...T.glide], [0, 1], GLIDE)
  const refScale = big + (1 - big) * g
  const refDx = (startX - ref.x) * (1 - g)
  const refDy = (startY - ref.y) * (1 - g)
  const refIn = tween(f, [T.reference, T.reference + 20], [0, 1], SETTLE)

  // The camera pulls back just enough to make room for the closing line —
  // a touch even when the art already fits, so the frame still breathes.
  const contentBottom = Math.max(layout.bottom, layout.reference.y + layout.reference.h + LABEL_SPACE)
  const pulledBack = Math.min(0.96, (LINE_ROOM_TOP - STAGE.y) / (contentBottom - STAGE.y))
  const pull = tween(f, [...T.pullBack], [1, pulledBack], GLIDE)
  const out = tween(f, [T.out, DESIGN - 1], [0, 1], LEAVE)
  const labelIn = tween(f, [T.glide[1] - 6, T.glide[1] + 12], [0, 1], SETTLE)
  const dividerIn = tween(f, [T.glide[1] - 10, T.glide[1] + 24], [0, 1], SETTLE)
  const artBottom = STAGE.y + (contentBottom - STAGE.y) * pulledBack

  return (
    <Paper>
      <PencilFilter />
      <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-24 * out}px)` }}>
        {/* The project, as a running head. */}
        <div
          style={{
            position: 'absolute',
            top: 84,
            left: STAGE.x,
            right: STAGE.x,
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            opacity: tween(f, [T.title, T.title + 16], [0, 1]),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
            <span style={{ fontFamily: font.body, fontSize: 20, letterSpacing: '0.3em', textTransform: 'uppercase', color: color.neutral600 }}>
              The same face
            </span>
            <span style={{ width: 40, height: 1, background: color.neutral400, alignSelf: 'center' }} />
            <span style={{ fontFamily: font.heading, fontStyle: 'italic', fontWeight: 500, fontSize: 38, color: color.ink }}>{stills.title}</span>
          </div>
          {placeholder ? (
            <span style={{ fontFamily: font.body, fontStyle: 'italic', fontSize: 20, color: color.neutral600 }}>Stand-in art: the v1 desk</span>
          ) : null}
        </div>

        <AbsoluteFill style={{ transform: `scale(${pull})`, transformOrigin: `${STAGE.x + STAGE.w / 2}px ${STAGE.y}px` }}>
          {/* A hairline between the reference and what was drawn from it. */}
          <div
            style={{
              position: 'absolute',
              left: layout.divider,
              top: layout.top + 12,
              width: 1,
              height: (layout.bottom - layout.top - 24) * dividerIn,
              background: color.divider,
            }}
          />

          {placed.map((p, i) => (
            <Framed key={i} src={p.src} box={p.box} local={f - p.start} label={p.label} labelAt={f - p.start - INK_FRAMES + 4} />
          ))}

          {/* The reference, last so the stamp and the glide sit above the panels. */}
          <div
            style={{
              position: 'absolute',
              left: ref.x,
              top: ref.y,
              width: ref.w,
              transformOrigin: '0 0',
              transform: `translate(${refDx}px, ${refDy + (1 - refIn) * 30}px) scale(${refScale})`,
              opacity: refIn,
            }}
          >
            <div
              style={{
                position: 'relative',
                width: ref.w,
                height: ref.h,
                border: `2px solid ${color.ink}`,
                background: color.neutral100,
                boxShadow: shadow.lg,
              }}
            >
              <Img src={staticFile(stills.character.reference)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              <Hanko label="Locked" local={f - T.stamp} size={36} solid style={{ top: -24, right: -30 }} />
            </div>
            <div style={{ marginTop: 18, opacity: labelIn, transform: `translateY(${(1 - labelIn) * 10}px)` }}>
              <div style={{ fontFamily: font.heading, fontWeight: font.headingWeight, fontSize: 42, lineHeight: 1.05, color: color.ink }}>
                {stills.character.name}
              </div>
              <div style={{ marginTop: 6, fontFamily: font.body, fontStyle: 'italic', fontSize: 22, color: color.neutral700 }}>
                {stills.character.source === 'upload' ? 'Imported reference' : 'Character sheet'}
              </div>
            </div>
          </div>
        </AbsoluteFill>

        {/* The closing line, in the room the pull-back made. */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: Math.min(artBottom + 44, 772) }}>
          <Words
            text="One face. Every *panel.*"
            frame={f}
            enterAt={T.line}
            stagger={6}
            style={{ fontFamily: font.heading, fontWeight: font.headingWeight, fontSize: 92, lineHeight: 1, color: color.ink }}
          />
        </div>
      </AbsoluteFill>
    </Paper>
  )
}
