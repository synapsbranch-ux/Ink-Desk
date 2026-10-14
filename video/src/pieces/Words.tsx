// Kinetic type: a line that arrives a word at a time, each word rising out of
// a soft blur the way wet ink sharpens, and leaves the same way. Words wrapped
// in *asterisks* are set in italic — the one emphasis the type allows itself.
import { tween, LEAVE, SETTLE } from './motion'

export const Words: React.FC<{
  text: string
  /** Frames since the piece began. */
  frame: number
  enterAt: number
  /** Omit to stay. */
  exitAt?: number
  stagger?: number
  style?: React.CSSProperties
}> = ({ text, frame, enterAt, exitAt, stagger = 5, style }) => {
  const words = text.split(' ')
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.26em', ...style }}>
      {words.map((raw, i) => {
        const italic = raw.startsWith('*')
        const word = raw.replace(/\*/g, '')
        const t = frame - enterAt - i * stagger
        const rise = tween(t, [0, 18], [0.42, 0], SETTLE)
        const blur = tween(t, [0, 14], [8, 0], SETTLE)
        let opacity = tween(t, [0, 12], [0, 1])
        let lift = 0
        if (exitAt !== undefined) {
          const o = frame - exitAt - i * Math.round(stagger / 2)
          opacity *= tween(o, [0, 12], [1, 0], LEAVE)
          lift = tween(o, [0, 12], [0, -0.3], LEAVE)
        }
        return (
          <span
            key={`${i}-${word}`}
            style={{
              display: 'inline-block',
              fontStyle: italic ? 'italic' : undefined,
              transform: `translateY(${rise + lift}em)`,
              filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
              opacity,
            }}
          >
            {word}
          </span>
        )
      })}
    </div>
  )
}
