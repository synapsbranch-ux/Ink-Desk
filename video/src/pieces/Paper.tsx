// The ground every motion piece stands on: the app's paper, with a halftone
// screen gathering at the corners like the tone a letterer lays on a page —
// the mockup's dot screen, masked so the centre stays clean for type.
import { AbsoluteFill } from 'remotion'
import { color, halftone } from '../theme'

export const Paper: React.FC<{ tone?: number; children?: React.ReactNode }> = ({ tone = 1, children }) => (
  <AbsoluteFill style={{ background: color.paper }}>
    <AbsoluteFill
      style={{
        background: halftone.dots,
        opacity: 0.55 * tone,
        maskImage: 'radial-gradient(ellipse 75% 70% at 50% 45%, transparent 55%, #000 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 75% 70% at 50% 45%, transparent 55%, #000 100%)',
      }}
    />
    {children}
  </AbsoluteFill>
)
