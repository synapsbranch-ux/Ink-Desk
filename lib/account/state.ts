// Where a person's export and deletion stand (v3, slice 21) — read from the job
// records and the outputs store, never remembered by the page, so a reload, a
// second tab and a worker that restarted all tell the same story. The three
// account routes answer with these. Server only.
//
//   export    none     nothing asked for, nothing kept
//             working  a job is queued or running
//             ready    the latest zip is in the outputs store (`bytes`, `readyAt`)
//             failed   the newest attempt failed and no newer zip stands (the sentence)
//   deletion  none     nothing under way
//             working  the job is queued or running
//             failed   it stopped before the end; running it again picks up where it left off
//             done     the account's record carries its tombstone and no job is left
//             (the job's own record is deleted on success, so `done` is read from the tombstone)
import 'server-only'
import { Refused } from '../errors'
import { activeJob } from '../queue/enqueue'
import { SHOW_FAILED_MS, deleteAccountKey, exportKey } from '../queue/jobs'
import { readBytes } from '../body'
import { store } from '../store'
import { exportFolder, hasOutputFolder, jobIdOfExport } from './keys'

export type ExportView = {
  state: 'none' | 'working' | 'ready' | 'failed'
  jobId?: string
  readyAt?: string
  bytes?: number
  error?: string
}

export type DeleteView = { state: 'none' | 'working' | 'done' | 'failed'; error?: string }

export const EXPORT_FAILED = 'The export didn’t finish. Nothing was changed; try again in a moment.'
export const DELETE_FAILED = 'The deletion stopped before it finished. Nothing is lost by trying again: it picks up where it left off.'

/** A stored export: its key, the job that made it, its size and when it was written. */
export type StoredExport = { key: string; jobId: string; bytes: number; modifiedAt: string }

/** The person's newest export in the outputs store, or null. Only `<job>.zip` keys count. */
export async function latestExport(ownerId: string): Promise<StoredExport | null> {
  if (!hasOutputFolder(ownerId)) return null
  const found = await store.outputs.list(exportFolder(ownerId))
  let best: StoredExport | null = null
  for (const item of found) {
    const jobId = jobIdOfExport(ownerId, item.key)
    if (jobId === null) continue
    if (best === null || item.modifiedAt > best.modifiedAt) best = { key: item.key, jobId, bytes: item.bytes, modifiedAt: item.modifiedAt }
  }
  return best
}

export async function exportState(ownerId: string): Promise<ExportView> {
  const key = exportKey(ownerId)
  const running = await activeJob(key)
  if (running) return { state: 'working', jobId: running.id }

  const zip = await latestExport(ownerId)
  const [last] = await store.jobs.listJobs({ ownerId, key, limit: 1 })
  if (last?.status === 'failed' && last.outcome !== 'cancelled') {
    const finishedAt = last.finishedAt ?? last.updatedAt
    // A failure is told while it is news, or while there is no older export to fall back to.
    const news = Date.now() - Date.parse(finishedAt) < SHOW_FAILED_MS
    if (!zip || (finishedAt > zip.modifiedAt && news)) return { state: 'failed', error: last.error ?? EXPORT_FAILED }
  }
  if (zip) return { state: 'ready', jobId: zip.jobId, readyAt: zip.modifiedAt, bytes: zip.bytes }
  return { state: 'none' }
}

export async function deleteState(ownerId: string): Promise<DeleteView> {
  const key = deleteAccountKey(ownerId)
  if (await activeJob(key)) return { state: 'working' }
  const [last] = await store.jobs.listJobs({ ownerId, key, limit: 1 })
  if (last?.status === 'failed' && last.outcome !== 'cancelled') return { state: 'failed', error: last.error ?? DELETE_FAILED }
  if (last?.status === 'done') return { state: 'done' }
  // The finished job deletes its own record: the account's tombstone is what is left to say it happened.
  if ((await store.users.get(ownerId))?.deletedAt) return { state: 'done' }
  return { state: 'none' }
}

const NO_INPUT = 'This takes no input.'

/**
 * These two writes take no input: the caller is the whole request. An empty
 * body, or `{}`, is fine; anything else is the route's 400, and the body is read
 * under a 1 KB cap — never more.
 */
export async function assertNoInput(req: Request): Promise<void> {
  const bytes = await readBytes(req, 1024, { unreadable: NO_INPUT, tooLarge: NO_INPUT })
  if (bytes.byteLength === 0) return
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Refused(NO_INPUT, 400)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.keys(parsed).length > 0) throw new Refused(NO_INPUT, 400)
}
