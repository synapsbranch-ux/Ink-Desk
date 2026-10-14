// The app's ink-in (globals.css `ink-in`), frame by frame: the finished art
// wipes down over its pencil, the blur clearing as the edge passes. `under`
// is what shows before the ink arrives — the pencil, or an older drawing
// being redrawn.
import { AbsoluteFill } from 'remotion'
import { INK_EASE, INK_FRAMES, tween } from './motion'

export const InkIn: React.FC<{
  /** Frames since the ink started; negative shows only `under`. */
  local: number
  under: React.ReactNode
  children: React.ReactNode
  frames?: number
}> = ({ local, under, children, frames = INK_FRAMES }) => {
  const p = tween(local, [0, frames], [0, 1], INK_EASE)
  return (
    <AbsoluteFill>
      {p < 1 ? <AbsoluteFill>{under}</AbsoluteFill> : null}
      {p > 0 ? (
        <AbsoluteFill
          style={{
            clipPath: p < 1 ? `inset(0 0 ${(1 - p) * 100}% 0)` : undefined,
            filter: p < 1 ? `blur(${(1 - p) * 3}px)` : undefined,
          }}
        >
          {children}
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  )
}

/**
 * The pencil pass of a finished picture: its edges traced out of the art
 * itself (an edge-finding convolution, inverted), so the sketch under the ink
 * is this panel's own drawing, not a generic placeholder. Render
 * <PencilFilter /> once on the page that uses it.
 */
export const PENCIL_FILTER_ID = 'inkdesk-pencil'

export const PencilFilter: React.FC = () => (
  <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
    <filter id={PENCIL_FILTER_ID} colorInterpolationFilters="sRGB">
      <feColorMatrix type="saturate" values="0" />
      {/* Soften first, so screen tone and film grain do not trace as noise. */}
      <feGaussianBlur stdDeviation={0.7} />
      <feConvolveMatrix order={3} kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha />
      <feComponentTransfer>
        <feFuncR type="linear" slope={-2.4} intercept={1} />
        <feFuncG type="linear" slope={-2.4} intercept={1} />
        <feFuncB type="linear" slope={-2.4} intercept={1} />
      </feComponentTransfer>
    </filter>
  </svg>
)

export const pencilStyle: React.CSSProperties = {
  filter: `url(#${PENCIL_FILTER_ID})`,
  mixBlendMode: 'multiply',
  opacity: 0.75,
}
