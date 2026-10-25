// The edit — the learner's brief for the v3 film (6-ship): the real app end
// to end on the live studio, how it was built with the hackathon's Learn
// Skill Pack, and what the learner learned. Twelve beats, 168 s (2:48).
// One segment per beat; its id is the section of narration.md spoken over
// it (the outro is silent: a title card, no section). Seconds are budgets:
// footage that runs longer is time-lapsed to fit, shorter plays as is. Change
// the beats here; the check (`npm run check:demo-timeline`) holds the total
// at 168 s, under the hackathon's three minutes.
//
//   intro 14 · signin 10 · project 10 · library 20 · director 16 · pages 22 ·
//   moneyshot 12 · reader 12 · share 10 · method 23 · learned 15 · outro 4 = 168 s
//
// A footage shot names its marks for both capture paths (src/timeline.ts
// MARKS): a fresh project generated on camera, or a finished chapter walked
// with `--project <id>`. Where the two paths name the same moment
// differently the shot lists both, the first the capture has winning; a shot
// whose marks are in neither is a slate until it is filmed.
import type { Segment } from './timeline'

export const CUT: Segment[] = [
  {
    id: 'intro',
    label: 'Problem and audience',
    shots: [{ kind: 'intro', seconds: 14 }],
  },
  {
    id: 'signin',
    label: 'Sign in to the studio',
    // The sign-in card is the first thing after the intro: no chapter card here.
    shots: [{ kind: 'footage', from: 'sign-in', to: 'signed-in', seconds: 10, label: 'Sign in' }],
  },
  {
    id: 'project',
    label: 'The desk, and a project',
    shots: [
      { kind: 'section', title: 'A desk for every project', kicker: 'One', seconds: 2.5 },
      { kind: 'footage', from: ['signed-in', 'dashboard'], to: ['project-open', 'project-created'], seconds: 7.5, label: 'The desk, and a project' },
    ],
  },
  {
    id: 'library',
    label: 'The scenario, the library and the locked cast',
    shots: [
      { kind: 'section', title: 'Your story, your character', kicker: 'Two', seconds: 2.5 },
      { kind: 'footage', from: ['project-open', 'project-created'], to: ['scenario-shown', 'scenario-ready'], seconds: 5, label: 'The scenario' },
      { kind: 'footage', from: ['scenario-shown', 'library-open'], to: ['library-shown', 'cast-locked'], seconds: 12.5, label: 'The locked cast and its DNA' },
    ],
  },
  {
    id: 'director',
    label: "The Director's plan and its estimate",
    shots: [
      { kind: 'section', title: 'The Director plans the chapter', kicker: 'Three', seconds: 2.5 },
      { kind: 'footage', from: ['library-shown', 'director-open'], to: ['director-shown', 'pages-queued'], seconds: 13.5, label: 'The plan and the estimate' },
    ],
  },
  {
    id: 'pages',
    label: 'Pages ink in, a bubble edit',
    shots: [
      { kind: 'section', title: 'Every panel, the same face', kicker: 'Four', seconds: 2.5 },
      { kind: 'footage', from: ['director-shown', 'pages-queued'], to: ['pages-shown', 'page1-inked'], seconds: 8, label: 'Page 1 inks in' },
      { kind: 'footage', from: ['pages-shown', 'page1-inked'], to: 'bubble-edited', seconds: 5.5, label: 'A bubble, retyped' },
      // Fresh: the redraw and the rest of the chapter (the redraw alone on --short); seeded: the other pages, each inking in.
      { kind: 'footage', from: 'bubble-edited', to: ['chapter-inked', 'chapter-shown', 'redraw-done'], seconds: 6, label: 'The rest of the chapter' },
    ],
  },
  {
    id: 'moneyshot',
    label: 'The money shot',
    shots: [{ kind: 'moneyshot', seconds: 12 }],
  },
  {
    id: 'reader',
    label: 'The reader and the PDF export',
    shots: [
      { kind: 'section', title: 'Read it, bind it', kicker: 'Five', seconds: 2.5 },
      { kind: 'footage', from: 'reader-open', to: 'pdf-exported', seconds: 9.5, label: 'The reader and the PDF' },
    ],
  },
  {
    id: 'share',
    label: 'A public link, opened signed out',
    shots: [
      { kind: 'footage', from: 'pdf-exported', to: 'share-link', seconds: 5, label: 'Share publicly' },
      { kind: 'footage', from: 'share-link', to: 'share-opened', seconds: 5, label: 'The public page, signed out' },
    ],
  },
  {
    id: 'method',
    label: 'How it was built: the Learn Skill Pack, step by step',
    shots: [{ kind: 'method', seconds: 23 }], // 23: the learner's method lines run 21.6 s
  },
  {
    id: 'learned',
    label: 'What I learned, and how the skill helped',
    shots: [{ kind: 'learned', seconds: 15 }],
  },
  {
    id: 'outro',
    label: 'The outro — a title card, no words',
    silent: true,
    shots: [{ kind: 'outro', seconds: 4 }],
  },
]

/** A beat of the edit by its id — the order may change; the ids do not. */
export function beat(id: string): Segment {
  const seg = CUT.find((s) => s.id === id)
  if (!seg) throw new Error(`The edit has no beat "${id}".`)
  return seg
}

/** The short motion-design preview (`npm run video:render:motion`): every motion piece, no footage. */
export const MOTION_PREVIEW: Segment[] = [
  beat('intro'),
  { id: 'project', label: 'Section card', shots: [beat('project').shots[0]] },
  beat('moneyshot'),
  beat('method'),
  beat('learned'),
  beat('outro'),
]
