// The film: every resolved shot in its place, an ink wipe at each beat
// boundary, the narration clips, music if licensed, captions over everything,
// and a DRAFT stamp while anything is not final. `Motion` is the same
// component on the short motion-design preview.
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion'
import { Captions } from './Captions'
import { Footage } from './Footage'
import { InkWipe } from './InkWipe'
import { Intro } from './Intro'
import { Method } from './Method'
import { musicVolumeAt } from './mix'
import { MoneyShot } from './MoneyShot'
import { Outro } from './Outro'
import type { DemoProps } from './props'
import { Section } from './Section'
import { color, font } from './theme'
import type { ResolvedPlan, ResolvedShot } from './timeline'

export type FullProps = DemoProps & {
  motion: { plan: ResolvedPlan; captions: DemoProps['captions'] }
  preview?: boolean
}

const WIPE_FRAMES = 18

const ShotView: React.FC<{ shot: ResolvedShot; props: FullProps }> = ({ shot, props }) => {
  switch (shot.kind) {
    case 'intro':
      return <Intro durationInFrames={shot.durationInFrames} />
    case 'section':
      return <Section title={shot.title} kicker={shot.kicker} durationInFrames={shot.durationInFrames} />
    case 'footage':
      return <Footage shot={shot} src={props.footage} />
    case 'moneyshot':
      return <MoneyShot stills={props.stills} placeholder={props.stillsArePlaceholder} durationInFrames={shot.durationInFrames} />
    case 'method':
      return <Method durationInFrames={shot.durationInFrames} />
    case 'outro':
      return <Outro durationInFrames={shot.durationInFrames} />
  }
}

export const Demo: React.FC<FullProps> = (props) => {
  const plan = props.preview ? props.motion.plan : props.plan
  const captions = props.preview ? props.motion.captions : props.captions
  const shots = plan.segments.flatMap((s) => s.shots)
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      {shots.map((shot, i) => (
        <Sequence key={`shot-${i}`} from={shot.startFrame} durationInFrames={shot.durationInFrames} name={shotName(shot)}>
          <ShotView shot={shot} props={props} />
        </Sequence>
      ))}
      {plan.segments.slice(1).map((seg) => (
        <Sequence key={`wipe-${seg.id}`} from={seg.startFrame - WIPE_FRAMES / 2} durationInFrames={WIPE_FRAMES} name={`Wipe → ${seg.id}`}>
          <InkWipe durationInFrames={WIPE_FRAMES} />
        </Sequence>
      ))}
      {props.preview
        ? null
        : props.narration.map((clip) => {
            // A voice never runs into the next beat's: it stops at its own beat's end.
            const seg = plan.segments.find((g) => g.id === clip.segmentId)
            const end = seg ? seg.startFrame + seg.durationInFrames : plan.durationInFrames
            return (
              <Sequence
                key={`voice-${clip.segmentId}`}
                from={clip.startFrame}
                durationInFrames={Math.max(1, end - clip.startFrame)}
                name={`Voice: ${clip.segmentId}`}
              >
                <Audio src={staticFile(clip.src)} />
              </Sequence>
            )
          })}
      {props.music ? (
        // The track is composed to the film's length, so it is not looped. Its
        // level is a function of the frame: in over a second, ducked under
        // every narration clip, out over the last three seconds.
        <Audio
          src={staticFile(props.music.src)}
          volume={(frame) => musicVolumeAt(frame, props.preview ? [] : props.narration, plan.durationInFrames, props.music!.volume)}
          loop={false}
        />
      ) : null}
      <Captions cues={captions} />
      {props.draft.length ? <DraftStamp /> : null}
    </AbsoluteFill>
  )
}

const shotName = (shot: ResolvedShot) =>
  shot.kind === 'footage' ? `Footage: ${shot.label}` : shot.kind === 'section' ? `Section: ${shot.title}` : shot.kind

const DraftStamp: React.FC = () => (
  <div
    style={{
      // Bottom-left, above the captions: empty in the app's footage and in
      // every motion piece.
      position: 'absolute',
      bottom: 200,
      left: 32,
      padding: '4px 12px',
      border: `3px solid ${color.hanko}`,
      color: color.hanko,
      fontFamily: font.heading,
      fontWeight: 700,
      fontSize: 28,
      letterSpacing: 4,
      transform: 'rotate(-4deg)',
      opacity: 0.85,
    }}
  >
    DRAFT
  </div>
)
