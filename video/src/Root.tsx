import { Composition, Folder } from 'remotion'
import { CUT, MOTION_PREVIEW } from './cut'
import { Demo, type FullProps } from './Demo'
import { InkWipe } from './InkWipe'
import { Intro } from './Intro'
import { Learned } from './Learned'
import { Method } from './Method'
import { MoneyShot } from './MoneyShot'
import { Outro } from './Outro'
import { Section } from './Section'
import { loadFonts } from './theme'
import { FPS, HEIGHT, resolvePlan, WIDTH, type MoneyShotStills } from './timeline'

loadFonts()

// Real props always come from prepare.mts (`--props=out/props.json`); these
// defaults only let a composition open before anything has been prepared.
const STAND_IN_STILLS: MoneyShotStills = {
  title: 'Return to Sender',
  character: { name: 'Kaito Mori', reference: 'placeholder/sheet-b22b9b91-b855-46df-b214-8d88bee9deb3.png', source: 'sheet' },
  panels: [
    { src: 'placeholder/panel-d8521f25-c110-4fd0-b744-fd71aad7cf15.png', page: 1, panel: 1 },
    { src: 'placeholder/panel-b06aea54-3251-4f05-a3c6-dd27bda440f6.png', page: 1, panel: 3 },
  ],
  cover: null,
}
const plan = resolvePlan(CUT, [], false)
const motionPlan = resolvePlan(MOTION_PREVIEW, [], false)
const DEFAULTS: FullProps = {
  plan,
  captions: [],
  narration: [],
  music: null,
  footage: null,
  stills: STAND_IN_STILLS,
  stillsArePlaceholder: true,
  draft: ['Not prepared — run through `npm run render` or `npm run studio`.'],
  motion: { plan: motionPlan, captions: [] },
}

const seconds = (s: number) => Math.round(s * FPS)
const base = { fps: FPS, width: WIDTH, height: HEIGHT } as const

export const Root: React.FC = () => (
  <>
    <Composition
      id="Demo"
      component={Demo}
      defaultProps={DEFAULTS}
      durationInFrames={plan.durationInFrames}
      calculateMetadata={({ props }) => ({ durationInFrames: props.plan.durationInFrames })}
      {...base}
    />
    <Composition
      id="Motion"
      component={Demo}
      defaultProps={{ ...DEFAULTS, preview: true }}
      durationInFrames={motionPlan.durationInFrames}
      calculateMetadata={({ props }) => ({ durationInFrames: props.motion.plan.durationInFrames })}
      {...base}
    />
    <Folder name="Pieces">
      <Composition id="Intro" component={Intro} defaultProps={{ durationInFrames: seconds(14) }} durationInFrames={seconds(14)} {...base} />
      <Composition
        id="Section"
        component={Section}
        defaultProps={{ title: 'The Director plans the chapter', kicker: 'Three', durationInFrames: seconds(2.5) }}
        durationInFrames={seconds(2.5)}
        {...base}
      />
      <Composition
        id="MoneyShot"
        component={MoneyShot}
        defaultProps={{ stills: STAND_IN_STILLS, placeholder: true, durationInFrames: seconds(12) }}
        durationInFrames={seconds(12)}
        {...base}
      />
      <Composition id="Method" component={Method} defaultProps={{ durationInFrames: seconds(22) }} durationInFrames={seconds(22)} {...base} />
      <Composition
        id="Learned"
        component={Learned}
        defaultProps={{ stills: STAND_IN_STILLS, placeholder: true, durationInFrames: seconds(15) }}
        durationInFrames={seconds(15)}
        {...base}
      />
      <Composition id="Outro" component={Outro} defaultProps={{ durationInFrames: seconds(10) }} durationInFrames={seconds(10)} {...base} />
      <Composition id="InkWipe" component={InkWipe} defaultProps={{ durationInFrames: 18 }} durationInFrames={18} {...base} />
    </Folder>
  </>
)
