// Speech-bubble geometry, pure and shared: the derived default layout, the
// clamp every stored layout passes through, and the SVG paths the bubble is
// drawn with. The browser renders these paths as SVG; the slice 7 export can
// feed the identical strings to `new Path2D()` so the PNG composites exactly
// the same shapes. See `devpost/spec.md > Components > Speech Bubble` and
// `devpost/prd.md > Changes Since Approval > Speech bubbles`.
//
// Shared with the browser, so no Node imports.
import type { PanelStance } from './prompts'
import { PANEL_LAYOUT } from './prompts'
import { bubbleCorner } from './script'
import type { BubbleLayout, Panel } from './types'

/** Where the figure stands per stance, in % of the panel — the speed lines'
 *  convergence point and the direction a default tail points. */
export const FIGURE_CENTRE: Record<PanelStance, [number, number]> = {
  left: [21, 56],
  right: [79, 56],
  medium: [50, 52],
  close: [50, 48],
}

/** Keeps a layout inside the panel and above a readable minimum. Applied on
 *  both sides of the wire, so a bad drag can never persist. */
export function clampBubble(l: BubbleLayout): BubbleLayout {
  const w = Math.min(70, Math.max(16, l.w))
  const h = Math.min(60, Math.max(12, l.h))
  const x = Math.min(100 - w, Math.max(0, l.x))
  const y = Math.min(100 - h, Math.max(0, l.y))
  const tailX = Math.min(100, Math.max(0, l.tailX))
  const tailY = Math.min(100, Math.max(0, l.tailY))
  const r = (n: number) => Math.round(n * 10) / 10
  return { x: r(x), y: r(y), w: r(w), h: r(h), tailX: r(tailX), tailY: r(tailY) }
}

/**
 * The derived default, used until the user touches the bubble: the corner
 * `bubbleCorner` picks (the side the figure leaves free), with the tail
 * reaching from the bubble toward the figure.
 */
export function defaultBubble(panel: Pick<Panel, 'index' | 'camera'>): BubbleLayout {
  const corner = bubbleCorner(panel)
  const w = 34
  const h = PANEL_LAYOUT[panel.index].shape === 'wide' ? 30 : 26
  const x = corner.endsWith('left') ? 4 : 100 - 4 - w
  const y = corner.startsWith('top') ? 5 : 100 - 7 - h
  const [fx, fy] = FIGURE_CENTRE[PANEL_LAYOUT[panel.index].stance]
  const cx = x + w / 2
  const edgeY = corner.startsWith('top') ? y + h : y
  return clampBubble({
    x,
    y,
    w,
    h,
    tailX: cx + (fx - cx) * 0.45,
    tailY: edgeY + (fy - edgeY) * 0.45,
  })
}

/** The stored layout if the user has placed one, else the derived default. */
export function bubbleLayout(panel: Pick<Panel, 'index' | 'camera' | 'bubble'>): BubbleLayout {
  return panel.bubble ? clampBubble(panel.bubble) : defaultBubble(panel)
}

/**
 * The tail: two curved sides from the bubble's rim to the tip, as one open
 * SVG path. Filled white it closes itself and covers the rim's ink where it
 * joins; stroked it draws only the two sides — a clean manga tail, not a CSS
 * box corner. Coordinates are % of the panel (the SVG uses a 0–100 viewBox).
 */
export function tailPath(l: BubbleLayout): string {
  const cx = l.x + l.w / 2
  const cy = l.y + l.h / 2
  const rx = l.w / 2
  const ry = l.h / 2
  // Parametric angle on the ellipse toward the tip, and the two base points
  // either side of it, pulled slightly inside so the fill overlaps the rim.
  const theta = Math.atan2((l.tailY - cy) / ry, (l.tailX - cx) / rx)
  const spread = 0.42
  const ax = cx + rx * Math.cos(theta - spread) * 0.96
  const ay = cy + ry * Math.sin(theta - spread) * 0.96
  const bx = cx + rx * Math.cos(theta + spread) * 0.96
  const by = cy + ry * Math.sin(theta + spread) * 0.96
  // Control points lean the curve to one side for a drawn-by-hand horn.
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  const dx = l.tailX - mx
  const dy = l.tailY - my
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len
  const py = dx / len
  const bend = Math.min(4, len * 0.18)
  const c1x = ax + dx * 0.45 + px * bend
  const c1y = ay + dy * 0.45 + py * bend
  const c2x = bx + dx * 0.45 + px * bend
  const c2y = by + dy * 0.45 + py * bend
  const r = (n: number) => Math.round(n * 100) / 100
  return `M ${r(ax)} ${r(ay)} Q ${r(c1x)} ${r(c1y)} ${r(l.tailX)} ${r(l.tailY)} Q ${r(c2x)} ${r(c2y)} ${r(bx)} ${r(by)}`
}
