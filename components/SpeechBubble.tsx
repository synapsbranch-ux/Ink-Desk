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
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Rnd } from 'react-rnd'
import { bubbleLayout, clampBubble, tailPath } from '@/lib/bubble'
import type { BubbleLayout, Panel } from '@/lib/types'

type Props = {
  panel: Pick<Panel, 'index' | 'camera' | 'bubble' | 'dialogue'>
  /** Over a pencil placeholder, before the art has inked in. */
  faint: boolean
  onLayout: (layout: BubbleLayout) => void
  onDialogue: (dialogue: string) => void
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

export function SpeechBubble({ panel, faint, onLayout, onDialogue }: Props) {
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
    onLayout(clampBubble(next))
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

  return (
    <div ref={layerRef} className={`bubble-layer${faint ? ' is-faint' : ''}`}>
      {W > 0 && H > 0 && (
        <>
          <svg className="bubble-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <ellipse cx={l.x + l.w / 2} cy={l.y + l.h / 2} rx={l.w / 2} ry={l.h / 2} />
            <path d={tailPath(l)} />
          </svg>

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
            onDrag={(_e, d) => setLiveLayout({ ...base(), x: (d.x / W) * 100, y: (d.y / H) * 100 })}
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
                className="bubble-text"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                role="textbox"
                aria-label={`Panel ${panel.index + 1} dialogue — click to edit`}
                onBlur={(e) => {
                  const text = (e.currentTarget.textContent ?? '').trim()
                  if (text !== panel.dialogue) onDialogue(text)
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
    </div>
  )
}
