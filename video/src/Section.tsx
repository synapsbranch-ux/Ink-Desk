// STUB — replaced by the motion design.
import { AbsoluteFill } from 'remotion'
import { color } from './theme'

export const Section: React.FC<{ title: string; kicker: string; durationInFrames: number }> = ({ title }) => (
  <AbsoluteFill style={{ background: color.paper }}>{title}</AbsoluteFill>
)
