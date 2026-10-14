// STUB — replaced by the motion design.
import { AbsoluteFill } from 'remotion'
import type { MoneyShotStills } from './timeline'
import { color } from './theme'

export const MoneyShot: React.FC<{ stills: MoneyShotStills; placeholder: boolean; durationInFrames: number }> = () => (
  <AbsoluteFill style={{ background: color.paper }} />
)
