// The deletion of an account (v3, slice 21): one idempotent job, also run by the
// `user.deleted` webhook. A person who leaves takes everything with them — their
// projects and every picture in them, their videos, their shared links and the
// reports about them, their queued work, their export files, their counters and
// their settings — and the studio keeps nothing of theirs but a tombstone on
// their account record (so a late `user.created` can never bring them back) and
// the studio-wide spend totals, which hold no names.
//
// THE ORDER (the slice 21 contract), and why:
//   1  mark the account deleted       the record loses its email at once; nothing can revive it
//   2  cancel their other work        through `endJob`, so every hold is released; a worker
//                                     mid-draw finds its project gone and ends calmly (`inkPanel`
//                                     answers a vanished project with `skipped`)
//   3  delete the Clerk user          (clerk mode) ends their sessions: nothing new is made while
//                                     the data goes. Already gone is success; any other answer throws
//   4  remove the data               shares (revoked first, so the public page dies at once) and the
//                                     reports about them; every project's pictures, then the project
//                                     — a project too damaged to read is removed anyway, with
//                                     what can be found; every job's stored picture, then the job
//                                     record; videos; the exports and videos folders; settings
//   5  remove the counters            quota / spend / request windows (never the studio's totals)
//   6  verify                         re-list everything by owner; if anything is left, cancel and
//                                     sweep again, a few times; if it is STILL there the job ends
//                                     `failed` with a sentence and its record stays for the status route
//   7  the job's own record           deleted by the processor on `done` (`forgetDeletion`)
//
// Every step is safe to repeat and every loop is bounded, so a crash after any step — or two runs at
// once, or a retry — converges on the same empty place. Anything that is a store failing THROWS (the
// queue retries); only a leftover after the verification is an outcome.
//
// Known limit, documented rather than hidden: a picture in the bucket that no record names (a crash
// between the upload and the attach, or a project whose copies were both unreadable) cannot be found
// by owner and may remain. It names no one, and the bucket's lifecycle rules are the backstop.
//
// TESTING SEAM: `DeletionDeps` is dependency injection, not a flag. Production passes `productionDeps()`;
// the check passes a fake Clerk, and an `afterStep` that throws to stand in for a crash. Nothing in
// production reads an environment variable to decide any of it.
import 'server-only'
import { projectImageIds } from '../auth/access'
import { authMode } from '../auth/config'
import { Refused } from '../errors'
import { endJob } from '../queue/ending'
import { LOCAL_OWNER, NO_ACCOUNT_TO_DELETE, finish, type JobRecord } from '../queue/jobs'
import type { Outcome } from '../queue/run'
import { store } from '../store'
import { deleteClerkUser } from './clerk'
import { purgeCounters } from './counters'
import { exportFolder, hasOutputFolder, videoFolder } from './keys'

/** The order the steps run in; `afterStep` is told each one as it completes. */
export const DELETION_STEPS = ['marked', 'cancelled', 'clerk', 'shares', 'projects', 'jobs', 'videos', 'outputs', 'settings', 'counters', 'verified'] as const
export type DeletionStep = (typeof DELETION_STEPS)[number]

export type DeletionDeps = {
  /** Ends the person's sign-in; null where there is no Clerk to ask (every mode but `clerk`). */
  clerk: { deleteUser(userId: string): Promise<void> } | null
  /** Removes their counters and windows; how many keys went. */
  purgeCounters(userId: string): Promise<number>
  now(): Date
  /** Told after each step; the check throws from here to stand in for a crash. Production leaves it out. */
  afterStep?: (step: DeletionStep) => void | Promise<void>
}

export function productionDeps(): DeletionDeps {
  return { clerk: authMode() === 'clerk' ? { deleteUser: deleteClerkUser } : null, purgeCounters, now: () => new Date() }
}

/** What the person is told when the sweep ended with something still there. */
export const DELETION_INCOMPLETE = 'The deletion stopped before everything was removed. Nothing is lost by trying again: it picks up where it left off.'
const CANCELLED = 'This account was deleted.'

/** How many times a list is re-read before the loop gives up (each pass removes at least one record). */
const MAX_PASSES = 200
/** How many times the verification sweeps again before it fails the job. */
const MAX_VERIFY_ROUNDS = 3
const PAGE = 200

export async function deleteAccount(job: JobRecord, deps: DeletionDeps = productionDeps()): Promise<Outcome> {
  const owner = job.ownerId
  // The door (`enqueueAccountJob`) and the processor refuse this already; a sweep of `local` would be the whole desk.
  if (owner === LOCAL_OWNER) return { outcome: 'refused', error: NO_ACCOUNT_TO_DELETE }
  const step = async (name: DeletionStep) => {
    await deps.afterStep?.(name)
  }

  // 1. The record first: the email goes now, and a late `user.created` finds the tombstone.
  if (!(await store.users.get(owner))?.deletedAt) await store.users.markDeleted(owner)
  await step('marked')

  // 2. Their other work stops, with its holds released.
  await cancelOtherWork(owner, job.id, deps)
  await step('cancelled')

  // 3. Their sign-in ends, so nothing new can be made.
  if (deps.clerk) await deps.clerk.deleteUser(owner)
  await step('clerk')

  // 4. The data.
  await removeData(owner, job.id, deps, step)

  // 5. The counters.
  await deps.purgeCounters(owner)
  await step('counters')

  // 6. Verify, and sweep again if anything is left.
  for (let round = 1; ; round++) {
    const left = await leftovers(owner, job.id)
    if (left.length === 0) break
    if (round > MAX_VERIFY_ROUNDS) {
      console.error(`[account] deletion of ${owner} left ${left.join(', ')} after ${MAX_VERIFY_ROUNDS} sweeps`)
      return { outcome: 'failed', error: DELETION_INCOMPLETE }
    }
    console.warn(`[account] deletion of ${owner} found ${left.join(', ')} left; sweeping again (${round}/${MAX_VERIFY_ROUNDS})`)
    await cancelOtherWork(owner, job.id, deps)
    await removeData(owner, job.id, deps)
    await deps.purgeCounters(owner)
  }
  await step('verified')
  return { outcome: 'done' }
}

// --- 2. Cancel ----------------------------------------------------------------------

/** End every other queued or running job of the owner as `cancelled`; `endJob` settles or releases whatever each held. */
async function cancelOtherWork(owner: string, selfId: string, deps: DeletionDeps): Promise<number> {
  let cancelled = 0
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const active = (await store.jobs.listJobs({ ownerId: owner, status: ['queued', 'running'], limit: PAGE })).filter((j) => j.id !== selfId)
    if (active.length === 0) return cancelled
    for (const j of active) {
      await endJob(j.id, (current) => (current.id === selfId ? null : finish(current, { outcome: 'cancelled', error: CANCELLED }, deps.now())))
      cancelled++
    }
  }
  throw new Error(`could not cancel ${owner}’s work: jobs kept appearing`)
}

// --- 4. The data --------------------------------------------------------------------

type Announce = (name: DeletionStep) => Promise<void>

async function removeData(owner: string, selfId: string, deps: DeletionDeps, announce?: Announce): Promise<void> {
  await removeShares(owner, deps)
  await announce?.('shares')
  await removeProjects(owner)
  await announce?.('projects')
  await removeJobs(owner, selfId)
  await announce?.('jobs')
  await removeVideos(owner)
  await announce?.('videos')
  if (hasOutputFolder(owner)) {
    await store.outputs.deletePrefix(exportFolder(owner))
    await store.outputs.deletePrefix(videoFolder(owner))
  }
  await announce?.('outputs')
  await store.settings.delete(owner)
  await announce?.('settings')
}

/**
 * The shares go first and the active ones are revoked before anything is deleted, so a link dies the moment the
 * deletion starts and a crash can never leave a live page over a half-deleted desk. Reports about a token go with it.
 */
async function removeShares(owner: string, deps: DeletionDeps): Promise<void> {
  const active = await store.shares.listActiveOf(owner)
  const now = deps.now().toISOString()
  for (const share of active) await store.shares.revoke(share.token, now)
  if (active.length > 0) await store.reports.deleteForTokens(active.map((s) => s.token))
  const all = await store.shares.deleteAllOf(owner)
  if (all.length > 0) await store.reports.deleteForTokens(all)
}

/** Each project's pictures, then the project. One that cannot be read is removed all the same, with whatever can be found of it. */
async function removeProjects(owner: string): Promise<void> {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const mine = await store.projectsOf(owner)
    if (mine.length === 0) return
    for (const { id } of mine) {
      let images = new Set<string>()
      try {
        images = projectImageIds(await store.readProject(id))
      } catch (err) {
        // Gone already (404), or damaged beyond reading: there is no list to take pictures from, and the project still goes.
        // A store that is down is not a Refused, and is thrown for the queue to retry.
        if (!(err instanceof Refused)) throw err
      }
      for (const imageId of images) await store.deleteBlob(imageId)
      await store.deleteProject(id)
    }
  }
  throw new Error(`could not delete ${owner}’s projects: they kept appearing`)
}

/** Every job's stored picture (one that was paid for and never attached), then the job's record; the deletion's own is the processor's to delete last. */
async function removeJobs(owner: string, selfId: string): Promise<void> {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const others = (await store.jobs.listJobs({ ownerId: owner, limit: PAGE })).filter((j) => j.id !== selfId)
    if (others.length === 0) break
    for (const j of others) {
      if (j.resultImageId) await store.deleteBlob(j.resultImageId)
      await store.jobs.deleteJob(j.id)
    }
  }
  await store.jobs.deleteJobsOf(owner, selfId)
}

async function removeVideos(owner: string): Promise<void> {
  for (const video of await store.videos.listOf(owner)) {
    for (const key of [video.posterKey, video.finalKey]) if (key) await store.outputs.delete(key)
  }
  await store.videos.deleteAllOf(owner)
}

// --- 6. Verify ----------------------------------------------------------------------

/** What of the owner's is still in the stores, by name; empty when nothing is. */
async function leftovers(owner: string, selfId: string): Promise<string[]> {
  const left: string[] = []
  if ((await store.projectsOf(owner)).length > 0) left.push('projects')
  if ((await store.jobs.listJobs({ ownerId: owner, limit: 2 })).some((j) => j.id !== selfId)) left.push('jobs')
  if ((await store.shares.listActiveOf(owner)).length > 0) left.push('shares')
  if ((await store.videos.listOf(owner)).length > 0) left.push('videos')
  if (hasOutputFolder(owner)) {
    if ((await store.outputs.list(exportFolder(owner))).length > 0) left.push('exports')
    if ((await store.outputs.list(videoFolder(owner))).length > 0) left.push('video files')
  }
  if (await store.settings.get(owner)) left.push('settings')
  return left
}
