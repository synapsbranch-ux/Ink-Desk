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
// whose marks are in neither is a slate until it is filmed. Within a beat the
// long waits get the short shots and the actions the long ones, so the waits
// compress harder and the actions breathe: a split shot's seeded fallback
// goes to the shot whose content the seeded walk has, and the other shot is
// a slate on that path (the seeded recorder writes no mark between them).
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
      { kind: 'footage', from: ['project-open', 'project-created'], to: ['scenario-shown', 'scenario-ready'], seconds: 2.5, label: 'The scenario' },
      // Fresh: the cast proposed, the picture imported, its DNA written (a 16 s wait, compressed hard), landing on the sheet
      // and its DNA as the voice ends "…my own drawing becomes the sheet." (≈ 41.6 s), so the DNA line plays over the DNA on the card…
      { kind: 'footage', from: 'library-open', to: 'import-done', seconds: 2.5, label: 'The library, and the import' },
      // …then the DNA read, the lock, the second sheet drawn, both locked (a minute, time-lapsed). Seeded: the locked cards and the DNA, shown.
      { kind: 'footage', from: ['import-done', 'scenario-shown'], to: ['cast-locked', 'library-shown'], seconds: 12.5, label: 'The DNA, and the lock' },
    ],
  },
  {
    id: 'director',
    label: "The Director's plan and its estimate",
    shots: [
      { kind: 'section', title: 'The Director plans the chapter', kicker: 'Three', seconds: 2.5 },
      // Fresh: the estimate, then the Director thinking (28 s, compressed hard).
      { kind: 'footage', from: 'director-open', to: 'plan-ready', seconds: 4, label: 'The estimate, and the Director thinking' },
      // The plan, at real speed, then Generate all. Seeded: the plan and its estimate, shown.
      { kind: 'footage', from: ['plan-ready', 'library-shown'], to: ['pages-queued', 'director-shown'], seconds: 9.5, label: 'The plan' },
    ],
  },
  {
    id: 'pages',
    label: 'Pages ink in, a bubble edit',
    shots: [
      { kind: 'section', title: 'Every panel, the same face', kicker: 'Four', seconds: 2.5 },
      { kind: 'footage', from: ['director-shown', 'pages-queued'], to: ['pages-shown', 'page1-inked'], seconds: 10, label: 'Page 1 inks in' },
      // Placed so the typing is on screen while the voice says "I retype one." (≈ 85.5–86.9 s): the typing sits 2.7–6 s into the span.
      { kind: 'footage', from: ['pages-shown', 'page1-inked'], to: 'bubble-edited', seconds: 5.5, label: 'A bubble, retyped' },
      // Fresh only: the redraw (a 2-minute wait, compressed hardest) landing on the redrawn panel.
      { kind: 'footage', from: 'bubble-edited', to: 'redraw-done', seconds: 1.5, label: 'The redraw' },
      // Fresh: the other pages complete, and the cover. Seeded: the other pages, each shown inked in.
      { kind: 'footage', from: ['redraw-done', 'bubble-edited'], to: ['chapter-inked', 'chapter-shown'], seconds: 2.5, label: 'The rest of the chapter' },
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
      { kind: 'footage', from: 'pdf-exported', to: 'share-link', seconds: 2.5, label: 'Share publicly' },
      { kind: 'footage', from: 'share-link', to: 'share-opened', seconds: 2, label: 'The link, copied and opened' },
      // At real speed (the capture's 5.5 s of it), then held: the public page and its Report control.
      { kind: 'footage', from: 'share-opened', to: 'end', seconds: 5.5, label: 'The public page, signed out' },
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
