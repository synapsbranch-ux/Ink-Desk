// Dialogue lettering, overlaid by the app in Comic Neue and never drawn by
// the image model — `devpost/scope.md > Lettering`. The corner is derived
// from the panel by `bubbleCorner` in `lib/script.ts`, so Claude never
// returns coordinates. `faint` is the bubble over a pencil placeholder,
// before the art has inked in.
import type { BubbleCorner } from '@/lib/script'

type Props = { text: string; corner: BubbleCorner; faint: boolean }

export function SpeechBubble({ text, corner, faint }: Props) {
  if (!text) return null
  return <div className={`bubble is-${corner}${faint ? ' is-faint' : ''}`}>{text}</div>
}
