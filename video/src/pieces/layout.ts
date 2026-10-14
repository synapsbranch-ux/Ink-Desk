// Laying out an unknown number of pictures of mixed shapes so they fill a
// region as fully as they can: justified rows, in reading order, the way a
// manga page is cut into tiers. Pure — no Remotion, no DOM.

export type Box = { x: number; y: number; w: number; h: number }

/** Every way to cut n items, in order, into `rows` non-empty tiers. */
function partitions(n: number, rows: number): number[][] {
  if (rows === 1) return [[n]]
  const out: number[][] = []
  for (let first = 1; first <= n - rows + 1; first++) {
    for (const rest of partitions(n - first, rows - 1)) out.push([first, ...rest])
  }
  return out
}

/**
 * Boxes for pictures of the given aspects (width / height) inside a region,
 * centred, never larger than the region, `gap` apart. Chooses the tiering
 * that covers the most area, with a nudge towards tiers of similar height so
 * no row of slivers sits under a row of giants.
 */
export function justify(aspects: number[], region: Box, gap: number, maxRows = 4): Box[] {
  const n = aspects.length
  if (n === 0) return []
  let best: { score: number; boxes: Box[] } | null = null
  for (let rows = 1; rows <= Math.min(n, maxRows); rows++) {
    for (const cut of partitions(n, rows)) {
      // Each tier at the height that makes it exactly the region's width…
      const tiers: { items: number[]; h: number }[] = []
      let i = 0
      for (const k of cut) {
        const items = aspects.slice(i, i + k).map((_, j) => i + j)
        const sum = items.reduce((s, idx) => s + aspects[idx], 0)
        tiers.push({ items, h: (region.w - gap * (k - 1)) / sum })
        i += k
      }
      // …then all of them shrunk together if the stack is too tall.
      const stack = tiers.reduce((s, t) => s + t.h, 0)
      const scale = Math.min(1, (region.h - gap * (rows - 1)) / stack)
      const heights = tiers.map((t) => t.h * scale)
      const total = heights.reduce((s, h) => s + h, 0) + gap * (rows - 1)
      const boxes: Box[] = new Array(n)
      let y = region.y + (region.h - total) / 2
      tiers.forEach((t, r) => {
        const h = heights[r]
        const rowW = t.items.reduce((s, idx) => s + aspects[idx] * h, 0) + gap * (t.items.length - 1)
        let x = region.x + (region.w - rowW) / 2
        for (const idx of t.items) {
          const w = aspects[idx] * h
          boxes[idx] = { x, y, w, h }
          x += w + gap
        }
        y += h + gap
      })
      const area = boxes.reduce((s, b) => s + b.w * b.h, 0)
      const evenness = Math.min(...heights) / Math.max(...heights)
      const score = area * Math.pow(evenness, 0.35)
      if (!best || score > best.score) best = { score, boxes }
    }
  }
  return best!.boxes
}

/** The largest box of `aspect` that fits inside `region`, centred. */
export function contain(aspect: number, region: Box): Box {
  const w = Math.min(region.w, region.h * aspect)
  const h = w / aspect
  return { x: region.x + (region.w - w) / 2, y: region.y + (region.h - h) / 2, w, h }
}
