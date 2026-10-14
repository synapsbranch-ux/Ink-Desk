// The logo lockup for the intro and the outro: the mark comes down like a
// hanko seal — lifted and soft, then pressed, a ring of ink dots spreading
// from the impression — and the wordmark is inked in beside it, left to
// right, the blur clearing as it goes.
import { Img, staticFile } from 'remotion'
import { brand, color, font, shadow } from '../theme'
import { INK_EASE, stampLand, tween } from './motion'

const SEAL_FRAMES = 16

/** The ring the press sends out: an even screen of ink dots, never red, gone within half a second. */
const InkRing: React.FC<{ local: number; size: number }> = ({ local, size }) => {
  const spread = tween(local, [0, 18], [0.64, 1], INK_EASE)
  const fade = tween(local, [0, 3, 18], [0, 0.5, 0])
  if (fade <= 0) return null
  const dots = 56
  return (
    <svg
      width={size * 2}
      height={size * 2}
      viewBox="-1 -1 2 2"
      style={{ position: 'absolute', left: -size / 2, top: -size / 2, opacity: fade, pointerEvents: 'none' }}
    >
      {Array.from({ length: dots }, (_, i) => {
        const a = (i / dots) * Math.PI * 2
        return <circle key={i} cx={Math.cos(a) * spread} cy={Math.sin(a) * spread} r={0.014 * (1.3 - spread * 0.5)} fill={color.ink} />
      })}
    </svg>
  )
}

export const Seal: React.FC<{ local: number; size: number }> = ({ local, size }) => {
  if (local < 0) return <div style={{ width: size, height: size }} />
  const { scale, opacity, landed } = stampLand(local, SEAL_FRAMES)
  // A seal held above the paper casts a wide soft shadow; pressed, it is tight.
  const lift = tween(local, [0, SEAL_FRAMES * 0.6], [1, 0])
  const tilt = tween(local, [0, SEAL_FRAMES * 0.6], [-5, 0])
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {landed ? <InkRing local={local - SEAL_FRAMES * 0.6} size={size} /> : null}
      <Img
        src={staticFile(brand.mark)}
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.2,
          transform: `rotate(${tilt}deg) scale(${scale})`,
          opacity,
          boxShadow: lift > 0.02 ? `0 ${30 * lift}px ${60 * lift}px rgba(45, 43, 43, ${0.25 * lift})` : shadow.md,
        }}
      />
    </div>
  )
}

/** The wordmark, inked in from the left. `local` counts from the start of the stroke. */
export const Wordmark: React.FC<{ local: number; size: number; style?: React.CSSProperties }> = ({ local, size, style }) => {
  const p = tween(local, [0, 26], [0, 1], INK_EASE)
  return (
    <div
      style={{
        fontFamily: font.heading,
        fontWeight: font.headingWeight,
        fontSize: size,
        lineHeight: 1,
        color: color.ink,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
        // A little room so the clip never trims a descender or the k's arm.
        padding: `0 ${size * 0.06}px ${size * 0.12}px`,
        clipPath: `inset(-20% ${(1 - p) * 100}% -20% 0)`,
        filter: p < 0.99 ? `blur(${(1 - p) * 4}px)` : undefined,
        ...style,
      }}
    >
      Ink Desk
    </div>
  )
}
