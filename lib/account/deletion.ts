// The deletion of an account (v3, slice 21): one idempotent job, also run by the
// `user.deleted` webhook. A person who leaves takes everything with them — their
// projects and every picture in them, their videos, their shared links and the
// reports about them, their queued work, their export files, their counters and
// their settings — and the studio keeps nothing of theirs but a tombstone on
// their account record (so a late `user.created` can never bring them back) and
// the studio-wide spend totals, which hold no names.
//
// THE ORDER (the slice 21 contract), and why:
//   0  check Clerk can be asked      in clerk mode the worker needs CLERK_SECRET_KEY; without it the job
//                                     ends `failed` at once, with nothing changed
//   1  mark the account deleted       the record loses its email at once; nothing can revive it; their
//                                     active shares are revoked, so a public page dies now, whatever Clerk does
//   2  cancel their other work        through `endJob`, so every hold is released (a trailer's is
//                                     settled at what it billed and has at the providers, so the
//                                     studio's day still counts it); a worker mid-draw finds its
//                                     project gone and ends calmly (`inkPanel` answers a vanished
//                                     project with `skipped`), and a trailer's run sends nothing new
//                                     and removes whatever files it keeps after its record is gone
//   3  remove the data               shares (already revoked in step 1) and the reports about
//                                     them; every project's pictures, then the project
//                                     — a project too damaged to read is removed anyway, with
//                                     what can be found; every job's stored picture (and its
//                                     hold, if it still has one), then the job record; videos;
//                                     the exports and videos folders; settings
//   4  remove the counters            quota / spend / request windows (never the studio's totals)
//   5  verify                         re-list everything by owner; if anything is left, cancel and
//                                     sweep again, a few times; if it is STILL there the job ends
//                                     `failed` with a sentence and its record stays for the status route
//   6  delete the Clerk user          (clerk mode) LAST: their sign-in lasts until the data is gone, so
//                                     a deletion that cannot finish leaves them able to sign in, see
//                                     the sentence and try again (once Clerk's user is gone nobody can
//                                     ask for the status or press the button). Already gone is success;
//                                     any other answer throws
//   7  verify again                   what they made while their sign-in lasted is swept before `done`
//   8  the job's own record           deleted by the processor on `done` (`forgetDeletion`)
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
import { settleEnded } from '../limits/jobs'
import { LOCAL_OWNER, NO_ACCOUNT_TO_DELETE, finish, isActive, reservationOf, type JobRecord } from '../queue/jobs'
import type { Outcome } from '../queue/run'
import { revokeShare } from '../share/pins'
import { store } from '../store'
import { clerkNotReady, deleteClerkUser } from './clerk'
import { purgeCounters } from './counters'
import { exportFolder, hasOutputFolder, videoFolder } from './keys'

/** The order the steps run in; `afterStep` is told each one as it completes. */
export const DELETION_STEPS = ['marked', 'cancelled', 'shares', 'projects', 'jobs', 'videos', 'outputs', 'settings', 'counters', 'verified', 'clerk'] as const
export type DeletionStep = (typeof DELETION_STEPS)[number]

export type DeletionDeps = {
  /** Ends the person's sign-in; null where there is no Clerk to ask (every mode but `clerk`). */
  clerk: { deleteUser(userId: string): Promise<void>; /** Why Clerk cannot be asked (a missing secret), or null; asked before anything is changed. */ ready?(): string | null } | null
  /** Removes their counters and windows; how many keys went. */
  purgeCounters(userId: string): Promise<number>
  now(): Date
  /** Told after each step; the check throws from here to stand in for a crash. Production leaves it out. */
  afterStep?: (step: DeletionStep) => void | Promise<void>
}

export function productionDeps(): DeletionDeps {
  return { clerk: authMode() === 'clerk' ? { deleteUser: deleteClerkUser, ready: clerkNotReady } : null, purgeCounters, now: () => new Date() }
}

/** What the person is told when the sweep ended with something still there. */
export const DELETION_INCOMPLETE = 'The deletion stopped before everything was removed. Nothing is lost by trying again: it picks up where it left off.'
const CANCELLED = 'This account was deleted.'
/** What the person is told when the worker has no way to end their sign-in: nothing was touched, and it ends at once rather than retrying a thing that cannot work. */
export const DELETION_NOT_SET_UP = 'Deleting an account is not set up on this server yet, so nothing was changed. Please try again later.'

/** How many times a list is re-read before the loop gives up (each pass removes at least one record). */
const MAX_PASSES = 200
/** How many times the verification sweeps again before it fails the job. */
const MAX_VERIFY_ROUNDS = 3
const PAGE = 200

export async function deleteAccount(job: JobRecord, deps: DeletionDeps = productionDeps()): Promise<Outcome> {
  const owner = job.ownerId
  // The door (`enqueueAccountJob`) and the processor refuse this already; a sweep of `local` would be the whole desk.
  if (owner === LOCAL_OWNER) return { outcome: 'refused', error: NO_ACCOUNT_TO_DELETE }
  // Before anything is changed: a worker that cannot ask Clerk would drop the email and stop the person's work, then fail on every retry.
  const notReady = deps.clerk?.ready?.()
  if (notReady) {
    console.error(`[account] deletion of ${owner} was not started: ${notReady}`)
    return { outcome: 'failed', error: DELETION_NOT_SET_UP }
  }
  const step = async (name: DeletionStep) => {
    await deps.afterStep?.(name)
  }

  // 1. The record first: the email goes now, and a late `user.created` finds the tombstone.
  if (!(await store.users.get(owner))?.deletedAt) await store.users.markDeleted(owner)
  // Their public links die with the press of the button, not after Clerk answers: a slow or failing Clerk must not keep a page live.
  await revokeShares(owner, deps)
  await step('marked')

  // 2. Their other work stops, with its holds released.
  await cancelOtherWork(owner, job.id, deps)
  await step('cancelled')

  // 3. The data.
  await removeData(owner, job.id, deps, step)

  // 4. The counters.
  await deps.purgeCounters(owner)
  await step('counters')

  // 5. Verify, and sweep again if anything is left.
  if (!(await verified(owner, job.id, deps))) return { outcome: 'failed', error: DELETION_INCOMPLETE }
  await step('verified')

  // 6. Their sign-in ends last: until the data is gone they can still sign in to see a deletion that did not finish, and try again.
  if (deps.clerk) await deps.clerk.deleteUser(owner)
  await step('clerk')

  // 7. Whatever they made while that lasted (a second tab) goes too.
  if (!(await verified(owner, job.id, deps))) return { outcome: 'failed', error: DELETION_INCOMPLETE }
  return { outcome: 'done' }
}

/** Re-list everything of the owner's; while anything is left, cancel and sweep again (bounded). False when it is still there after that. */
async function verified(owner: string, selfId: string, deps: DeletionDeps): Promise<boolean> {
  for (let round = 1; ; round++) {
    const left = await leftovers(owner, selfId)
    if (left.length === 0) return true
    if (round > MAX_VERIFY_ROUNDS) {
      console.error(`[account] deletion of ${owner} left ${left.join(', ')} after ${MAX_VERIFY_ROUNDS} sweeps`)
      return false
    }
    console.warn(`[account] deletion of ${owner} found ${left.join(', ')} left; sweeping again (${round}/${MAX_VERIFY_ROUNDS})`)
    await cancelOtherWork(owner, selfId, deps)
    await removeData(owner, selfId, deps)
    await deps.purgeCounters(owner)
  }
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
  await removeJobs(owner, selfId, deps)
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

/** Revoke every active share of the owner (idempotent, and nothing to do with Clerk): the link is dead from here on. Returns their tokens. */
async function revokeShares(owner: string, deps: DeletionDeps): Promise<string[]> {
  const active = await store.shares.listActiveOf(owner)
  const now = deps.now().toISOString()
  // Through `revokeShare`: a picture only the link was still holding (a redraw dropped it from its panel) is deleted too, with no project record left to name it.
  for (const share of active) await revokeShare(share, now)
  return active.map((s) => s.token)
}

/**
 * The shares go first in the data and the active ones are revoked before anything is deleted (they already were, in
 * step 1; a share made since is caught here), so a crash can never leave a live page over a half-deleted desk.
 * Reports about a token go with it.
 */
async function removeShares(owner: string, deps: DeletionDeps): Promise<void> {
  const revoked = await revokeShares(owner, deps)
  if (revoked.length > 0) await store.reports.deleteForTokens(revoked)
  const all = await store.shares.deleteAllOf(owner)
  if (all.length > 0) await store.reports.deleteForTokens(all)
}

/**
 * Each project's pictures, then the project. One that cannot be read is removed all the same, with whatever can be found of it.
 * A worker cancelled in step 2 is not stopped, and may land a picture while the blobs go: the project is read again after
 * each round until nothing new is in it, and only then deleted (a picture landing after that finds no project and deletes itself).
 */
async function removeProjects(owner: string): Promise<void> {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const mine = await store.projectsOf(owner)
    if (mine.length === 0) return
    for (const { id } of mine) {
      const gone = new Set<string>()
      for (let round = 0; ; round++) {
        let images = new Set<string>()
        try {
          images = projectImageIds(await store.readProject(id))
        } catch (err) {
          // Gone already (404), or damaged beyond reading: there is no list to take pictures from, and the project still goes.
          // A store that is down is not a Refused, and is thrown for the queue to retry.
          if (!(err instanceof Refused)) throw err
        }
        const fresh = [...images].filter((imageId) => !gone.has(imageId))
        if (fresh.length === 0) break
        if (round >= MAX_PASSES) throw new Error(`could not empty project ${id}: pictures kept appearing`)
        for (const imageId of fresh) {
          await store.deleteBlob(imageId)
          gone.add(imageId)
        }
      }
      await store.deleteProject(id)
    }
  }
  throw new Error(`could not delete ${owner}’s projects: they kept appearing`)
}

/**
 * Every job's stored picture (one that was paid for and never attached), then the job's record; the deletion's own is the processor's to delete last.
 * A record is never deleted while it still holds quota or spend: a job made after the cancel is ended (`endJob` releases its hold), and an ended
 * one whose settle never ran is settled — a deleted record is one nothing could settle afterwards. A settle that could not land (the counters
 * are down) throws, so the queue tries the whole deletion again with the record still there.
 */
async function removeJobs(owner: string, selfId: string, deps: DeletionDeps): Promise<void> {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const others = (await store.jobs.listJobs({ ownerId: owner, limit: PAGE })).filter((j) => j.id !== selfId)
    if (others.length === 0) break
    for (const j of others) {
      if (isActive(j)) await endJob(j.id, (current) => (current.id === selfId || !isActive(current) ? null : finish(current, { outcome: 'cancelled', error: CANCELLED }, deps.now())))
      else await settleEnded(j)
      const current = (await store.jobs.getJob(j.id)) ?? j
      // `settleEnded` swallows a counter store that did not answer and leaves the record `held` for the sweep, which lists records:
      // deleting this one now would strand its estimate in the studio's totals. Throw instead — the queue retries with the record still here.
      if (reservationOf(current) === 'held') throw new Error(`could not settle the hold of job ${j.id} yet: the counters did not answer`)
      if (current.resultImageId) await store.deleteBlob(current.resultImageId)
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
