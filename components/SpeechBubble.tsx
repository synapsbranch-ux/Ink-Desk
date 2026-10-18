'use client'

// The speech bubble as real manga lettering: an SVG rounded oval with a
// smooth two-curve tail (geometry in `lib/bubble.ts`), ink outline, white
// fill — click the text to edit it in place in Comic Neue, drag the body to
// move, pull a corner to resize (react-rnd), and drag the tail tip to point
// at the speaker. The placed layout is committed as percentages of the panel
// (`Panel.bubble`), so a reload and the slice 7 export reproduce it exactly;
// untouched bubbles keep the derived-corner default. Never drawn by the
// image model — `devpost/scope.md > Lettering`; editable since slice 5b —
// `devpost/prd.md > Changes Since Approval`.
//
// v3 (slice 23): the lettering is sized from the panel and stepped down until
// it fits its bubble (`components/bubble-fit.ts`), so it is never cut off on a
// small panel. On a touch screen nothing drags: the bubble is one button that
// opens the edit sheet (`components/BubbleEditSheet.tsx`), which saves through
// the same `onEdit` as the drag and the in-place edit — its words and place as
// one edit, so the reply to one save can't put the old words back on screen.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Rnd } from 'react-rnd'
import { BubbleEditSheet, sameLayout } from '@/components/BubbleEditSheet'
import { useCoarsePointer, useLetteringFit } from '@/components/bubble-fit'
import { bubbleLayout, clampBubble, tailPath } from '@/lib/bubble'
import type { PanelEdit } from '@/lib/patch'
import type { BubbleLayout, Panel } from '@/lib/types'

type Props = {
  panel: Pick<Panel, 'index' | 'camera' | 'bubble' | 'dialogue'>
  /** Over a pencil placeholder, before the art has inked in. */
  faint: boolean
  /** A new place, new words, or both at once: one save. */
  onEdit: (edit: Pick<PanelEdit, 'bubble' | 'dialogue'>) => void
}

const HANDLE_CLASSES = {
  topLeft: 'bubble-resize',
  topRight: 'bubble-resize',
  bottomLeft: 'bubble-resize',
  bottomRight: 'bubble-resize',
}
const CORNERS_ONLY = {
  top: false,
  right: false,
  bottom: false,
  left: false,
  topLeft: true,
  topRight: true,
  bottomLeft: true,
  bottomRight: true,
}

export function SpeechBubble({ panel, faint, onEdit }: Props) {
  // The layer fills the panel; everything is a percentage of it. react-rnd
  // works in pixels, so the layer is measured and kept fresh on resize.
  const layerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = layerRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // While a drag, resize or tail pull is in flight the live layout follows
  // the pointer; letting go commits it to the desk. The ref mirrors the
  // state so pointer handlers never read a stale layout.
  const [live, setLive] = useState<BubbleLayout | null>(null)
  const liveRef = useRef<BubbleLayout | null>(null)
  const setLiveLayout = (next: BubbleLayout | null) => {
    liveRef.current = next
    setLive(next)
  }
  const stored = bubbleLayout(panel)
  const l = live ?? stored
  const base = () => liveRef.current ?? bubbleLayout(panel)
  const commit = (next: BubbleLayout) => {
    setLiveLayout(null)
    onEdit({ bubble: clampBubble(next) })
  }

  // The tail tip: one small handle, pointer-captured so the pull keeps
  // tracking outside the dot, clamped to the panel by the shared clamp.
  const tailAt = (e: ReactPointerEvent) => {
    const rect = layerRef.current!.getBoundingClientRect()
    return {
      tailX: ((e.clientX - rect.left) / rect.width) * 100,
      tailY: ((e.clientY - rect.top) / rect.height) * 100,
    }
  }

  const W = size?.w ?? 0
  const H = size?.h ?? 0

  // Touch: a tap opens the sheet; while it is open the panel shows its draft.
  const touch = useCoarsePointer()
  const [editing, setEditing] = useState(false)
  const [draftWords, setDraftWords] = useState<string | null>(null)
  const words = draftWords ?? panel.dialogue
  const tapRef = useRef<HTMLButtonElement>(null)
  const aligned = useRef(false)
  const closeSheet = () => {
    setEditing(false)
    setDraftWords(null)
    aligned.current = false
  }

  // While the sheet is open the bubble itself stays in view above it: on open the
  // panel's top goes to the top of the screen, unless that leaves the bubble under
  // the sheet (a tablet in landscape); then, as it moves, the page follows it.
  useEffect(() => {
    if (!editing) return
    const bubble = tapRef.current
    const sheet = document.querySelector('.bubble-sheet')
    const frame = bubble?.closest('.panel')
    if (!bubble || !sheet || !frame) return
    const gap = 8
    const b = bubble.getBoundingClientRect()
    const room = sheet.getBoundingClientRect().top - gap
    let by = aligned.current ? 0 : frame.getBoundingClientRect().top
    aligned.current = true
    if (b.bottom - by > room) by = b.bottom - room
    if (b.top - by < gap) by = b.top - gap
    if (Math.abs(by) >= 1) window.scrollBy({ top: by, behavior: 'smooth' })
  }, [editing, l.x, l.y, l.w, l.h])

  // The lettering fits its box whenever the box or the words change.
  const textRef = useRef<HTMLSpanElement>(null)
  const refit = useLetteringFit(textRef, [words, l.w, l.h, W, H, touch])

  // Text box inside the oval: the wrap's 11% / 14% insets, the export's too.
  const bw = (l.w / 100) * W
  const bh = (l.h / 100) * H

  return (
    <div ref={layerRef} className={`bubble-layer${faint ? ' is-faint' : ''}`}>
      {W > 0 && H > 0 && (
        <>
          <svg className="bubble-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <ellipse cx={l.x + l.w / 2} cy={l.y + l.h / 2} rx={l.w / 2} ry={l.h / 2} />
            <path d={tailPath(l)} />
          </svg>

          {touch ? (
            // One target over the whole bubble (never under 44 px), the words
            // inside it; the pencil mark says it can be edited.
            <button
              ref={tapRef}
              type="button"
              className="bubble-tap"
              style={{
                left: `${l.x + l.w / 2}%`,
                top: `${l.y + l.h / 2}%`,
                width: Math.max(bw, 44),
                height: Math.max(bh, 44),
              }}
              aria-label={`Edit panel ${panel.index + 1}’s bubble: “${words}”`}
              aria-haspopup="dialog"
              aria-expanded={editing}
              onClick={() => setEditing(true)}
            >
              <span className="bubble-text-wrap" style={{ width: bw * 0.72, height: bh * 0.78 }}>
                <span key={`${panel.index}-${words}`} ref={textRef} className="bubble-text">
                  {words}
                </span>
              </span>
              <svg className="bubble-edit-mark" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3.5 10.5 10 4l2 2-6.5 6.5H3.5z" />
              </svg>
            </button>
          ) : (
            <>
              <Rnd
                className="bubble-rnd"
                bounds="parent"
                position={{ x: (l.x / 100) * W, y: (l.y / 100) * H }}
                size={{ width: (l.w / 100) * W, height: (l.h / 100) * H }}
                minWidth={W * 0.16}
                minHeight={H * 0.12}
                dragHandleClassName="bubble-drag"
                enableResizing={CORNERS_ONLY}
                resizeHandleClasses={HANDLE_CLASSES}
                onDrag={(_e, d) =>
                  setLiveLayout({
                    ...base(),
                    x: (d.x / W) * 100,
                    y: (d.y / H) * 100,
                  })
                }
                onDragStop={(_e, d) => commit({ ...base(), x: (d.x / W) * 100, y: (d.y / H) * 100 })}
                onResize={(_e, _dir, el, _delta, pos) =>
                  setLiveLayout({
                    ...base(),
                    x: (pos.x / W) * 100,
                    y: (pos.y / H) * 100,
                    w: (el.offsetWidth / W) * 100,
                    h: (el.offsetHeight / H) * 100,
                  })
                }
                onResizeStop={(_e, _dir, el, _delta, pos) =>
                  commit({
                    ...base(),
                    x: (pos.x / W) * 100,
                    y: (pos.y / H) * 100,
                    w: (el.offsetWidth / W) * 100,
                    h: (el.offsetHeight / H) * 100,
                  })
                }
              >
                <div className="bubble-drag" title="Drag to move the bubble" />
                <div className="bubble-text-wrap">
                  <span
                    key={`${panel.index}-${panel.dialogue}`}
                    ref={textRef}
                    className="bubble-text"
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    role="textbox"
                    aria-label={`Panel ${panel.index + 1} dialogue — click to edit`}
                    onInput={refit}
                    onBlur={(e) => {
                      const text = (e.currentTarget.textContent ?? '').trim()
                      if (text !== panel.dialogue) onEdit({ dialogue: text })
                    }}
                  >
                    {panel.dialogue}
                  </span>
                </div>
              </Rnd>

              <button
                type="button"
                className="bubble-tail-handle"
                style={{ left: `${l.tailX}%`, top: `${l.tailY}%` }}
                aria-label="Drag to point the tail at the speaker"
                title="Drag to point the tail at the speaker"
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.currentTarget.setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => {
                  if (e.buttons !== 1) return
                  setLiveLayout({ ...base(), ...tailAt(e) })
                }}
                onPointerUp={(e) => commit({ ...base(), ...tailAt(e) })}
              />
            </>
          )}
          {editing && (
            <BubbleEditSheet
              panelNumber={panel.index + 1}
              layout={stored}
              dialogue={panel.dialogue}
              onPreview={(layout, text) => {
                setLiveLayout(layout)
                setDraftWords(text)
              }}
              onDone={(layout, text) => {
                closeSheet()
                setLiveLayout(null)
                const edit: Pick<PanelEdit, 'bubble' | 'dialogue'> = {}
                if (!sameLayout(layout, stored)) edit.bubble = clampBubble(layout)
                if (text !== panel.dialogue) edit.dialogue = text
                if (edit.bubble || edit.dialogue !== undefined) onEdit(edit)
              }}
              onCancel={() => {
                closeSheet()
                setLiveLayout(null)
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
