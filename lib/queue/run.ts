// What a job hands the work it runs (v3, slice 18). Kept apart from the queue
// so `panels.ts`, `director.ts` and `sheet.ts` can take a run without
// importing the machinery that calls them. Server only.
import { randomUUID } from 'node:crypto'
import type { JobPayload } from './jobs'

export type JobRun = {
  /** The claim this run holds on whatever it draws: stamped on the panel, checked when the picture lands. */
  jobId: string
  /** A previous run of this very job already put the picture in the bucket under this id — attach it, never draw again. */
  resultImageId: string | null
  /** What the provider billed for that picture (to count it once when it is attached). */
  costUsd: number
  /** The picture is in the bucket: save its id and cost on the job record BEFORE attaching it, so a crash from here on repeats nothing. */
  checkpoint(imageId: string, costUsd: number | null): Promise<void>
  /** Change what the job will do if it runs again (a sheet whose words are saved becomes `reuseDna`). */
  patchPayload(patch: Partial<JobPayload>): Promise<void>
}

/** A run with no job behind it — a direct call from a check or a script. It claims under a fresh id and records nothing. */
export function adhocRun(jobId: string = randomUUID()): JobRun {
  return { jobId, resultImageId: null, costUsd: 0, checkpoint: async () => {}, patchPayload: async () => {} }
}

/** What a piece of work reports back to the job that ran it. It never throws: a failure is an outcome. */
export type Outcome = {
  outcome: 'done' | 'failed' | 'refused' | 'skipped'
  /** The sentence for a failed one. */
  error?: string
  costUsd?: number
}
