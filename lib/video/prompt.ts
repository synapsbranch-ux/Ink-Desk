// The motion prompt (v3, slice 22): the words a shot is animated from. Pure and
// client-safe, and deterministic — the same panel gives the same prompt, with no
// second call to Claude — so the wording that was verified stays the wording that
// is sent. It is the slice 17 prompt (`scripts/kernel-test.mjs > motionPrompt`,
// `MOTION_STYLE`, `MOTION_NO_TEXT`, measured against Seedance 2.0 on three shots)
// with the one character and the one look it was written for made general:
// "his" becomes "the character's", and the style line comes from the project's
// frozen style preset.
//
// Two ways to hand Seedance a panel, and only the lead-in and the way the images
// travel differ (`lib/video/seedance.ts`):
//   A — the panel is the first frame (`frame_images`): "begin exactly on it".
//   B — the panel is the first reference and the character's sheet the second
//       (`input_references`): "begin on the first, match the second".
// Which is the default is still PROVISIONAL (`videoSettings().method`, one env
// var), pending the learner's verdict on `data/kernel-test/motion/`.
import { STYLE_PRESETS } from '../styles'
import type { MotionMethod, TrailerShot } from './types'

/**
 * Verified wording for the black-and-white preset (kept to the letter). For any
 * other preset the same sentence is built around that preset's own rules.
 */
const MOTION_STYLE_MANGA_BW =
  'Keep the exact black-and-white manga ink style of the opening image for the whole shot: screentone shading, confident inked linework, no colour, no 3D or photoreal rendering, no change of style.'

/** The image prompts end with a no-text rule of their own; the shot's is said once, below, in the verified words. */
const IMAGE_NO_TEXT = /ABSOLUTELY NO TEXT[^.]*\./g

export const MOTION_NO_TEXT = 'No text, no speech bubbles, no captions, no sound-effect lettering and no watermark anywhere in the shot.'

/** The style sentence for a project's preset rules (`lib/styles.ts`). */
export function motionStyle(styleRules: string): string {
  const rules = styleRules.trim()
  if (rules === STYLE_PRESETS['manga-bw'].rules) return MOTION_STYLE_MANGA_BW
  const look = rules.replace(IMAGE_NO_TEXT, '').replace(/\s+/g, ' ').trim()
  if (look === '') return 'Keep the exact style of the opening image for the whole shot, with no 3D or photoreal rendering and no change of style.'
  return `Keep the exact style of the opening image for the whole shot (${look}), with no 3D or photoreal rendering and no change of style.`
}

export type MotionPromptInput = {
  method: MotionMethod
  /** The shot's length; Seedance is asked for the same number. */
  seconds: number
  shot: Pick<TrailerShot, 'camera' | 'action' | 'background'>
  /** The character's locked DNA, verbatim — the same text the panel was drawn from. */
  dna: string
  /** The project's frozen style preset rules (`styleRules(project.style)`). */
  styleRules: string
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

export function motionPrompt(input: MotionPromptInput): string {
  const seconds = Math.round(input.seconds)
  const panel = input.styleRules.trim() === STYLE_PRESETS['manga-bw'].rules ? 'manga panel' : 'comic panel'
  const lead =
    input.method === 'A'
      ? [`Animate this ${panel} into one continuous ${seconds}-second shot.`, 'The attached image is the first frame: begin exactly on it, then let it move.']
      : [
          `One continuous ${seconds}-second animated shot of a single character.`,
          'The first reference image is the opening frame of the shot: begin exactly on that composition, with the character, framing and background as drawn.',
          'The second reference image is the character model sheet: the character’s face, hair, eyes, distinguishing marks and outfit match it in every frame, from the first frame to the last.',
        ]
  const background = oneLine(input.shot.background)
  return [
    ...lead,
    '',
    `Camera: ${oneLine(input.shot.camera)}`,
    `Action: ${oneLine(input.shot.action)}`,
    ...(background ? [`Background: ${background}`] : []),
    '',
    'The character’s fixed appearance, which does not change at any point in the shot:',
    oneLine(input.dna),
    '',
    motionStyle(input.styleRules),
    MOTION_NO_TEXT,
  ].join('\n')
}
