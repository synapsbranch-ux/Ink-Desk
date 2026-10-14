// The cut between beats: an ink wash that floods the frame through a halftone
// edge and drains away the same way — the dots growing from a fine screen to
// solid black, like tone laid on a page. Clear at the first and last frame,
// solid black over the middle, so the cut happens under the ink.
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion'
import { tween } from './pieces/motion'
import { color } from './theme'
import { HEIGHT, WIDTH } from './timeline'

/** The halftone screen: a 45° lattice, coarse enough to read as dots on camera. */
const CELL = 26
/** Large enough that neighbouring dots overlap into solid ink at full tone. */
const MAX_R = CELL * 0.74
/** How far the tone ramps from clear to solid. */
const RAMP = 460
/** The edge leans, the way a brush stroke would cross the page. */
const LEAN = 0.38

// The lattice, built once: 45° rotated points covering the frame.
const DOTS: { x: number; y: number }[] = (() => {
  const out: { x: number; y: number }[] = []
  const c = Math.SQRT1_2
  const reach = Math.ceil((WIDTH + HEIGHT) / CELL)
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const u = i * CELL
      const v = j * CELL
      const x = WIDTH / 2 + (u - v) * c
      const y = HEIGHT / 2 + (u + v) * c
      if (x > -CELL && x < WIDTH + CELL && y > -CELL && y < HEIGHT + CELL) out.push({ x, y })
    }
  }
  return out
})()

// Where along the leaning axis a point sits; the edge sweeps along this.
const along = (x: number, y: number) => x + (y - HEIGHT / 2) * LEAN
const MIN_ALONG = -(HEIGHT / 2) * LEAN - CELL
const MAX_ALONG = WIDTH + (HEIGHT / 2) * LEAN + CELL

const FLOOD = Easing.bezier(0.45, 0, 0.7, 1)
const DRAIN = Easing.bezier(0.3, 0, 0.55, 1)

export const InkWipe: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame()
  const last = Math.max(1, durationInFrames - 1)
  const t = frame / last
  // The flood's leading edge crosses the frame in the first ~45%; the drain's
  // trailing edge follows it out in the last ~45%. In between: solid ink.
  const lead = tween(t, [0, 0.45], [MIN_ALONG, MAX_ALONG + RAMP], FLOOD)
  const trail = tween(t, [0.55, 1], [MIN_ALONG - RAMP, MAX_ALONG], DRAIN)
  if (t <= 0 || t >= 1) return null
  const coverage = (x: number, y: number) => {
    const a = along(x, y)
    return Math.max(0, Math.min(1, (lead - a) / RAMP, (a - trail) / RAMP))
  }
  if (lead >= MAX_ALONG + RAMP && trail <= MIN_ALONG - RAMP) return <AbsoluteFill style={{ background: color.ink }} />
  return (
    <AbsoluteFill>
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {DOTS.map((d, i) => {
          const c = coverage(d.x, d.y)
          if (c <= 0.004) return null
          // Area follows coverage, so the ramp reads as an even tone gradient.
          return <circle key={i} cx={d.x} cy={d.y} r={MAX_R * Math.sqrt(c)} fill={color.ink} />
        })}
      </svg>
    </AbsoluteFill>
  )
}
