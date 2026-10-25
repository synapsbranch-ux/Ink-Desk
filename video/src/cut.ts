// The edit — the v3 film: eleven spoken beats and a mute final card, under
// three minutes. One segment per beat; its id is the section of narration.md
// spoken over it (the final card has none: nothing is said over it). Seconds
// are budgets: footage that runs longer is time-lapsed to fit, shorter plays
// as is. Change the beats here; the check (`npm run check:demo-timeline`)
// holds the total at 173 s, under the hackathon's three minutes, and holds
// every section of narration.md to its beat's word budget.
//
//   intro 14 · signin 10 · project 10 · library 20 · director 16 · pages 22 ·
//   moneyshot 12 · reader 12 · share 10 · method 22 · learned 15 · outro 10 (mute)  = 173 s
//
// The word budgets those seconds give (src/script.ts wordBudget), quoted in
// narration.md: 28 · 19 · 19 · 41 · 33 · 46 · 24 · 24 · 19 · 46 · 30.
import type { Segment } from './timeline'

export const CUT: Segment[] = [
  {
    id: 'intro',
    label: 'Problem and audience',
    shots: [{ kind: 'intro', seconds: 14 }],
  },
  {
    id: 'signin',
    label: 'Sign in, the empty desk',
    shots: [{ kind: 'footage', from: 'sign-in', to: 'dashboard', seconds: 10, label: 'Sign in' }],
  },
  {
    id: 'project',
    label: 'New project, its style, the studio',
    shots: [{ kind: 'footage', from: 'dashboard', to: 'project-created', seconds: 10, label: 'New project and its style' }],
  },
  {
    id: 'library',
    label: 'Scenario and library, import and lock',
    shots: [
      { kind: 'section', title: 'Your story, your character', kicker: 'One', seconds: 2.5 },
      { kind: 'footage', from: 'project-created', to: 'scenario-ready', seconds: 4.5, label: 'The scenario' },
      { kind: 'footage', from: 'library-open', to: 'cast-locked', seconds: 13, label: 'Import, read, lock' },
    ],
  },
  {
    id: 'director',
    label: 'The Director plans the chapter',
    shots: [
      { kind: 'section', title: 'The Director plans the chapter', kicker: 'Two', seconds: 2.5 },
      { kind: 'footage', from: 'director-open', to: 'pages-queued', seconds: 13.5, label: 'Plan and estimate' },
    ],
  },
  {
    id: 'pages',
    label: 'Pages ink in, bubble edit, redraw',
    shots: [
      { kind: 'section', title: 'Every panel, the same face', kicker: 'Three', seconds: 2.5 },
      { kind: 'footage', from: 'pages-queued', to: 'page1-inked', seconds: 8, label: 'Page 1 inks in' },
      { kind: 'footage', from: 'page1-inked', to: 'redraw-done', seconds: 7.5, label: 'Bubble and redraw' },
      { kind: 'footage', from: 'redraw-done', to: 'chapter-inked', seconds: 4, label: 'The rest of the chapter' },
    ],
  },
  {
    id: 'moneyshot',
    label: 'The money shot',
    shots: [{ kind: 'moneyshot', seconds: 12 }],
  },
  {
    id: 'reader',
    label: 'Reader and PDF export',
    shots: [
      { kind: 'section', title: 'Read it, bind it', kicker: 'Four', seconds: 2.5 },
      { kind: 'footage', from: 'reader-open', to: 'pdf-exported', seconds: 9.5, label: 'Reader and PDF' },
    ],
  },
  {
    id: 'share',
    label: 'Share publicly, the public page',
    shots: [{ kind: 'footage', from: 'share-open', to: 'share-public', seconds: 10, label: 'Share publicly' }],
  },
  {
    id: 'method',
    label: 'How it was made: planned before built',
    shots: [{ kind: 'method', seconds: 22 }],
  },
  {
    id: 'learned',
    label: 'What I learned — the last words',
    shots: [{ kind: 'learned', seconds: 15 }],
  },
  {
    id: 'outro',
    label: 'The final card, mute',
    mute: true,
    shots: [{ kind: 'outro', seconds: 10 }],
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
  { id: 'library', label: 'Section card', shots: [beat('library').shots[0]] },
  beat('moneyshot'),
  beat('method'),
  beat('learned'),
  beat('outro'),
]
