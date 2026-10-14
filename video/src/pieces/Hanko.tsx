// The Locked stamp, as the app draws it (globals.css `.stamp`): a red-bordered
// word in Cormorant capitals, tilted, multiplied into the paper beneath, and
// landing like a seal pressed by hand. The red lives here and on the logo.
import { color, font } from '../theme'
import { stampLand } from './motion'

export const Hanko: React.FC<{
  label: string
  /** Frames since the stamp started to come down; negative is not yet. */
  local: number
  size?: number
  rotate?: number
  /**
   * Pressed into the paper (multiply), as in the app — or, over busy art where
   * black would swallow the red, on its own slip of paper so it stays legible.
   */
  solid?: boolean
  style?: React.CSSProperties
}> = ({ label, local, size = 34, rotate = -7, solid = false, style }) => {
  if (local < 0) return null
  const { scale, opacity } = stampLand(local)
  return (
    <div
      style={{
        position: 'absolute',
        padding: `${size * 0.18}px ${size * 0.55}px ${size * 0.14}px`,
        border: `${Math.max(2, size * 0.09)}px solid ${color.hanko}`,
        borderRadius: size * 0.12,
        color: color.hanko,
        fontFamily: font.heading,
        fontWeight: font.headingWeight,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        mixBlendMode: solid ? undefined : 'multiply',
        background: solid ? 'rgba(252, 236, 234, 0.94)' : 'rgba(252, 236, 234, 0.55)',
        boxShadow: solid ? '0 2px 6px rgba(45, 43, 43, 0.18)' : undefined,
        transform: `rotate(${rotate}deg) scale(${scale})`,
        opacity,
        ...style,
      }}
    >
      {label}
    </div>
  )
}
