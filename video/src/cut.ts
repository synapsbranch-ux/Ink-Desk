// The edit — scope.md > The Demo Video (v2), "Structure (≈ 2:50)". One segment
// per beat; its id is the section of narration.md spoken over it. Seconds are
// budgets: footage that runs longer is time-lapsed to fit, shorter plays as
// is. Change the beats here; the check (`npm run check:demo-timeline`) holds
// the total under three minutes.
import type { Segment } from './timeline'

export const CUT: Segment[] = [
  {
    id: 'intro',
    label: 'Problem and audience',
    shots: [{ kind: 'intro', seconds: 20 }],
  },
  {
    id: 'dashboard',
    label: 'Dashboard, new project, style',
    shots: [
      { kind: 'section', title: 'A desk for every project', kicker: 'One', seconds: 2.5 },
      { kind: 'footage', from: 'dashboard', to: 'project-created', seconds: 17.5, label: 'New project and its style' },
    ],
  },
  {
    id: 'library',
    label: 'Scenario and library, import and lock',
    shots: [
      { kind: 'section', title: 'Your story, your character', kicker: 'Two', seconds: 2.5 },
      { kind: 'footage', from: 'project-created', to: 'scenario-ready', seconds: 6, label: 'The scenario' },
      { kind: 'footage', from: 'library-open', to: 'cast-locked', seconds: 21.5, label: 'Import, read, lock' },
    ],
  },
  {
    id: 'director',
    label: 'The Director plans the chapter',
    shots: [
      { kind: 'section', title: 'The Director plans the chapter', kicker: 'Three', seconds: 2.5 },
      { kind: 'footage', from: 'director-open', to: 'pages-queued', seconds: 22.5, label: 'Plan and estimate' },
    ],
  },
  {
    id: 'pages',
    label: 'Pages ink in, bubble edit, redraw',
    shots: [
      { kind: 'section', title: 'Every panel, the same face', kicker: 'Four', seconds: 2.5 },
      { kind: 'footage', from: 'pages-queued', to: 'page1-inked', seconds: 12, label: 'Page 1 inks in' },
      { kind: 'footage', from: 'page1-inked', to: 'redraw-done', seconds: 14, label: 'Bubble and redraw' },
      { kind: 'footage', from: 'redraw-done', to: 'chapter-inked', seconds: 6.5, label: 'The rest of the chapter' },
    ],
  },
  {
    id: 'moneyshot',
    label: 'The money shot',
    shots: [{ kind: 'moneyshot', seconds: 15 }],
  },
  {
    id: 'reader',
    label: 'Reader and PDF export',
    shots: [
      { kind: 'section', title: 'Read it, bind it', kicker: 'Five', seconds: 2.5 },
      { kind: 'footage', from: 'reader-open', to: 'pdf-exported', seconds: 12.5, label: 'Reader and PDF' },
    ],
  },
  {
    id: 'outro',
    label: 'What I learned, and the outro',
    shots: [{ kind: 'outro', seconds: 10 }],
  },
]

/** The short motion-design preview (`npm run video:render:motion`). */
export const MOTION_PREVIEW: Segment[] = [
  CUT[0],
  { id: 'dashboard', label: 'Section card', shots: [CUT[1].shots[0]] },
  CUT[5],
  CUT[7],
]
