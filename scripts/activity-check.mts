// The studio's reading of the queue is pure, so it is checked directly
// (slice 18): which card, panel and cover is being drawn, the sentence for a
// failed sheet, when the studio polls, and the calm line for a queue that is
// down. A reply without `activity` keeps the last one; a blank panel nothing
// is drawing is not "in flight" (CR-9). Run with `npm run check:activity`.
import assert from 'node:assert/strict'
import {
  activeJobs,
  anyActive,
  coverJob,
  deskInking,
  failedPanelSentence,
  failedSheetJobs,
  failedSheetSentence,
  inFlight,
  isIdleBlank,
  mergeActivity,
  pageJobCount,
  panelJob,
  pollWanted,
  queueNotice,
  sheetJob,
} from '../lib/activity'
import { BUSY, type Activity, type JobView } from '../lib/queue/jobs'

let n = 0
const job = (patch: Partial<JobView> & Pick<JobView, 'kind'>): JobView => ({
  id: `job-${++n}`,
  status: 'queued',
  outcome: null,
  error: null,
  target: {},
  updatedAt: new Date(Date.UTC(2026, 9, 14, 12, 0, n)).toISOString(),
  ...patch,
})
const ok = { mode: 'bullmq', state: 'ok', message: null } as const
const act = (...jobs: JobView[]): Activity => ({ jobs, queue: ok })

const sheet = (characterId: string, reuseDna: boolean, status: JobView['status'] = 'running') =>
  job({ kind: 'sheet', status, target: { characterId, reuseDna } })
const panel = (pageIndex: number, index: number, status: JobView['status'] = 'queued') =>
  job({ kind: 'panel', status, target: { chapterId: 'c1', pageIndex, index } })

// --- Nothing known: every question has a calm answer -------------------------------

assert.deepEqual(activeJobs(undefined), [])
assert.equal(anyActive(undefined), false)
assert.equal(sheetJob(undefined, 'a'), null)
assert.equal(failedSheetSentence(undefined, 'a'), null)
assert.equal(panelJob(undefined, 0, 0), null)
assert.equal(pageJobCount(undefined, 0), 0)
assert.equal(failedPanelSentence(undefined, 0, 0), null)
assert.equal(coverJob(undefined), null)
assert.equal(queueNotice(undefined), null)
assert.equal(pollWanted(null, undefined), false)

// --- Merge: a reply without activity keeps the previous one ------------------------

const first = act(sheet('a', false))
assert.equal(mergeActivity(first, undefined), first)
assert.equal(mergeActivity(undefined, undefined), undefined)
const second = act()
assert.equal(mergeActivity(first, second), second, 'an empty activity is still news: nothing is drawing')

// --- Sheets: drawing vs redrawing, per character -----------------------------------

const a = act(sheet('lead', false), sheet('other', true, 'queued'))
assert.equal(anyActive(a), true)
assert.equal(sheetJob(a, 'lead')?.busy, 'drawing')
assert.equal(sheetJob(a, 'other')?.busy, 'redrawing')
assert.equal(sheetJob(a, 'other')?.job.status, 'queued')
assert.equal(sheetJob(a, 'nobody'), null)

// --- A failed sheet: its sentence, until a new draw starts or the user moves on ----

const failedJob = job({
  kind: 'sheet',
  status: 'failed',
  outcome: 'failed',
  error: 'The sheet didn’t come back. Try again.',
  target: { characterId: 'lead', reuseDna: false },
})
const failed = act(failedJob)
assert.equal(anyActive(failed), false, 'a failed job is not active')
assert.equal(sheetJob(failed, 'lead'), null)
assert.equal(failedSheetSentence(failed, 'lead'), 'The sheet didn’t come back. Try again.')
assert.equal(failedSheetSentence(failed, 'other'), null, 'another card does not carry it')
assert.deepEqual(
  failedSheetJobs(failed, 'lead').map((j) => j.id),
  [failedJob.id]
)
// Dismissed (the user started a new draw): the sentence is gone for good.
assert.equal(failedSheetSentence(failed, 'lead', [failedJob.id]), null)
// A new draw in flight hides the old sentence even before it is dismissed.
const retry = act(failedJob, sheet('lead', false, 'queued'))
assert.equal(failedSheetSentence(retry, 'lead'), null)
assert.equal(sheetJob(retry, 'lead')?.busy, 'drawing')
// A failed job with no sentence says nothing; the newest sentence wins.
const silent = job({ kind: 'sheet', status: 'failed', outcome: 'failed', error: null, target: { characterId: 'lead' } })
assert.equal(failedSheetSentence(act(silent), 'lead'), null)
const older = job({ kind: 'sheet', status: 'failed', outcome: 'failed', error: 'older', target: { characterId: 'lead' }, updatedAt: '2026-10-14T10:00:00.000Z' })
const newer = job({ kind: 'sheet', status: 'failed', outcome: 'failed', error: 'newer', target: { characterId: 'lead' }, updatedAt: '2026-10-14T11:00:00.000Z' })
assert.equal(failedSheetSentence(act(older, newer), 'lead'), 'newer')
assert.equal(failedSheetSentence(act(newer, older), 'lead'), 'newer')

// --- Panels: a job decides, 'empty' alone does not ---------------------------------

const p = act(panel(0, 1), panel(0, 2, 'running'), panel(1, 3))
assert.equal(panelJob(p, 0, 1)?.status, 'queued')
assert.equal(panelJob(p, 0, 2)?.status, 'running')
assert.equal(panelJob(p, 0, 0), null)
assert.equal(panelJob(p, 1, 1), null, 'same slot, other page')
assert.equal(panelJob(p, 0, 1, 'c1')?.kind, 'panel')
assert.equal(panelJob(p, 0, 1, 'other-chapter'), null)
assert.equal(pageJobCount(p, 0), 2)
assert.equal(pageJobCount(p, 1), 1)
assert.equal(pageJobCount(p, 2), 0)
// A cover or a sheet job is not a panel job.
assert.equal(panelJob(act(job({ kind: 'cover', target: { chapterId: 'c1' } })), 0, 0), null)

// CR-9: a blank panel with no job is idle (its blank state + Generate), not "Pencilling…" for ever.
assert.equal(inFlight('empty', null), false)
assert.equal(isIdleBlank('empty', null), true)
assert.equal(inFlight('empty', panelJob(p, 0, 1)), true)
assert.equal(isIdleBlank('empty', panelJob(p, 0, 1)), false)
assert.equal(inFlight('inking', null), true, 'the desk saying inking still counts')
assert.equal(inFlight('done', panelJob(p, 0, 2)), true, 'a redraw queued over finished art')
assert.equal(inFlight('failed', panelJob(p, 0, 2)), true, 'Try again queued')
assert.equal(inFlight('done', null), false)
assert.equal(isIdleBlank('done', null), false)

// A blank panel whose job failed before it could be marked: the job's sentence, never an active job's.
const lost = job({ kind: 'panel', status: 'failed', outcome: 'abandoned', error: 'This one stopped before it finished. Try again.', target: { chapterId: 'c1', pageIndex: 0, index: 0 } })
assert.equal(failedPanelSentence(act(lost), 0, 0), 'This one stopped before it finished. Try again.')
assert.equal(failedPanelSentence(act(lost), 0, 1), null)
assert.equal(failedPanelSentence(act(lost, panel(0, 0)), 0, 0), null, 'a new job in flight hides it')

// --- The cover ---------------------------------------------------------------------

const cover = job({ kind: 'cover', target: { chapterId: 'c1' } })
assert.equal(coverJob(act(cover))?.id, cover.id)
assert.equal(coverJob(act(cover), 'c1')?.id, cover.id)
assert.equal(coverJob(act(cover), 'c2'), null)
assert.equal(coverJob(act(sheet('lead', false), panel(0, 0))), null)
assert.equal(coverJob(act({ ...cover, status: 'failed', error: 'x' })), null, 'a failed cover job is not active')

// --- Polling: only while something is happening ------------------------------------

const idleDesk = { script: null, pages: [{ index: 0, written: false, inked: 0, inking: 0, failed: 0, blank: 0, thumbnailImageId: null, panelImageIds: [] }], cover: null }
assert.equal(deskInking(idleDesk), false)
assert.equal(pollWanted(idleDesk, undefined), false, 'an idle finished project does not poll')
assert.equal(pollWanted(idleDesk, act()), false)
assert.equal(pollWanted(idleDesk, failed), false, 'a failed job alone is not a reason to poll')
assert.equal(pollWanted(idleDesk, a), true, 'an active job is')
assert.equal(pollWanted(null, a), true)
assert.equal(pollWanted(null, undefined), false)
const inkingPage = { ...idleDesk, pages: [{ ...idleDesk.pages[0], inking: 1 }] }
assert.equal(pollWanted(inkingPage, undefined), true, 'the desk saying a page is inking is')
const inkingCover = { ...idleDesk, cover: { brief: '', title: '', versions: [], currentVersion: 0, status: 'inking' as const, startedAt: null, startedByRun: null } }
assert.equal(pollWanted(inkingCover, undefined), true)
const emptyScript = {
  ...idleDesk,
  script: ([0, 1, 2, 3] as const).map((index) => ({
    index,
    characterId: 'lead',
    action: '',
    camera: '',
    background: '',
    dialogue: '',
    versions: [],
    currentVersion: 0,
    status: 'empty' as const,
    startedAt: null,
    startedByRun: null,
  })),
}
assert.equal(pollWanted(emptyScript, act()), false, 'blank panels with no job are not a reason to poll (CR-9)')
assert.equal(pollWanted(emptyScript, act(panel(0, 0))), true)

// --- The queue's own line ----------------------------------------------------------

assert.equal(queueNotice(act()), null)
assert.equal(queueNotice({ jobs: [], queue: { mode: 'inline', state: 'ok', message: null } }), null)
assert.equal(
  queueNotice({ jobs: [], queue: { mode: 'bullmq', state: 'busy', message: 'The studio is busy — try again in a few minutes.' } }),
  'The studio is busy — try again in a few minutes.'
)
assert.equal(queueNotice({ jobs: [], queue: { mode: 'bullmq', state: 'busy', message: null } }), BUSY, 'busy with no sentence still says something')
assert.match(
  queueNotice({ jobs: [], queue: { mode: 'bullmq', state: 'no-worker', message: null } }) ?? '',
  /drawing desk/
)
assert.equal(
  queueNotice({ jobs: [], queue: { mode: 'bullmq', state: 'no-worker', message: 'Drawing is slow to start.' } }),
  'Drawing is slow to start.'
)

console.log('  Activity check passed.')
