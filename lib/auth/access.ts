// Ownership (v3, slice 19): every record a route touches is checked against
// the signed-in caller before anything is read from the body or asked of a
// provider. Anything the caller does not own answers exactly like something
// that does not exist — the same sentence, the same 404 — so ids cannot be
// probed (SEC-01, SEC-06). See `devpost/spec.md > Data Access and Ownership (v3)`.
//
// A project written before accounts has no `ownerId`; it counts as `local`'s,
// and `local` is only ever the caller on a desk running with
// `INKDESK_AUTH=off`. `scripts/claim-projects.mts` hands such projects to a
// real account.
//
// Server only (SEC-15).
import 'server-only'
import { Refused } from '../errors'
import { LOCAL_OWNER, type JobRecord } from '../queue/jobs'
import type { ShareRecord, VideoRecord } from '../share/types'
import { store } from '../store'
import type { Project } from '../types'
import { authMode } from './config'

/** The one answer for a project that is not the caller's — word for word what a missing one says. */
export const NO_SUCH_PROJECT = 'There is no such project.'
export const NO_SUCH_IMAGE = 'There is no such image.'
export const NO_SUCH_JOB = 'There is no such job.'
/** A share that is unknown, someone else's, or (for the owner's own operations) no longer published. */
export const NO_SUCH_SHARE = 'There is no such share.'
/** A trailer that is unknown, malformed or someone else's — one sentence for all three (slice 22). */
export const NO_SUCH_VIDEO = 'There is no such video.'

/** Does `userId` own a record whose owner is `ownerId` (absent = `local`)? `local` owns nothing once accounts are on. */
export function owns(userId: string, ownerId: string | null | undefined): boolean {
  const owner = ownerId ?? LOCAL_OWNER
  if (owner === LOCAL_OWNER && authMode() !== 'off') return false
  return owner === userId
}

/** The caller's project, or the 404 a missing project gets. */
export async function ownedProject(userId: string, id: string): Promise<Project> {
  let project: Project
  try {
    project = await store.readProject(id) // a missing or malformed id is already this 404
  } catch (err) {
    // A project that can't be read (CR-14) is its owner's to hear about, and
    // nobody else's: to anyone else it is the missing project's 404, or the
    // different answer would show that it exists (S19-BYP-1).
    if (err instanceof Refused && err.status !== 404 && !owns(userId, await store.projectOwner(id))) throw new Refused(NO_SUCH_PROJECT, 404)
    throw err
  }
  if (!owns(userId, project.ownerId)) throw new Refused(NO_SUCH_PROJECT, 404)
  return project
}

/**
 * The caller's project as the light poll sees it: its stamp (`ownerId`, `updatedAt`), checked the way
 * `ownedProject` checks the whole project — someone else's, a missing one and a malformed id are the
 * same 404 — without ever reading the project itself (CR-8: the studio asks this every second and a half).
 */
export async function ownedProjectStamp(userId: string, id: string): Promise<{ ownerId: string; updatedAt: string }> {
  const stamp = await store.projectStamp(id)
  if (!stamp || !owns(userId, stamp.ownerId)) throw new Refused(NO_SUCH_PROJECT, 404)
  return stamp
}

/**
 * Every image id a project holds: character sheets (drawn or imported), every
 * panel version on every page, every cover version, every upload on the shelf.
 * A dropped version's picture is deleted (CR-16), so it is not here either.
 */
export function projectImageIds(project: Project): Set<string> {
  const ids = new Set<string>()
  for (const character of project.library.characters) if (character.sheetImageId) ids.add(character.sheetImageId)
  for (const asset of project.library.assets) ids.add(asset.blobId)
  for (const chapter of project.chapters) {
    for (const version of chapter.cover?.versions ?? []) ids.add(version.imageId)
    for (const page of chapter.pages) for (const panel of page.panels) for (const version of panel.versions) ids.add(version.imageId)
  }
  return ids
}

/** A 404 unless this project holds the image — owning one project never opens another project's pictures. */
export function assertImageInProject(project: Project, imageId: string): void {
  if (!projectImageIds(project).has(imageId)) throw new Refused(NO_SUCH_IMAGE, 404)
}

/** The caller's job record, or the 404 a missing one gets. */
export async function ownedJob(userId: string, jobId: string): Promise<JobRecord> {
  const job = await store.jobs.getJob(jobId)
  if (!job || !owns(userId, job.ownerId)) throw new Refused(NO_SUCH_JOB, 404)
  return job
}

/**
 * The caller's share, or the 404 an unknown one gets (slice 21) — for the OWNER's
 * routes (`DELETE /api/shares/[token]`, Update share, Settings › Sharing). It
 * answers 404 with the very same sentence for a token that does not exist, one
 * that is someone else's, and one that is the caller's own but no longer
 * published: a revoked share is dead for good and shows nowhere, so the owner's
 * operations (refresh, unpublish) apply to an ACTIVE share only. A route that
 * must stay idempotent — unpublishing twice is not an error — passes
 * `{ includeRevoked: true }` and gets the revoked record (its snapshot is null)
 * back for the caller's own token, and still 404 for anyone else's.
 *
 * The PUBLIC routes (`/s/[token]`, `/api/s/[token]/*`) are the other way round:
 * they take no session and read `store.shares.get` themselves, answering the
 * same 404 for unknown and revoked tokens alike.
 */
export async function ownedShare(userId: string, token: string, opts: { includeRevoked?: boolean } = {}): Promise<ShareRecord> {
  const share = await store.shares.get(token)
  if (!share || !owns(userId, share.ownerId)) throw new Refused(NO_SUCH_SHARE, 404)
  if (share.revokedAt !== null && !opts.includeRevoked) throw new Refused(NO_SUCH_SHARE, 404)
  return share
}

/** What a trailer's id looks like: the uuid the animate route makes, and nothing a path or a query could be hidden in. */
const VIDEO_ID = /^[A-Za-z0-9_-]{8,64}$/

/**
 * The caller's trailer, or the 404 a missing one gets (slice 22). Someone else's, an unknown id and a malformed one
 * are the same sentence and the same status, so ids cannot be probed — and, as for a project, this runs before a
 * body is read, a file is opened or a provider is asked for anything. The record is returned as stored: the routes
 * decide what of it a browser may see (`viewOfVideo`).
 */
export async function ownedVideo(userId: string, videoId: string): Promise<VideoRecord> {
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) throw new Refused(NO_SUCH_VIDEO, 404)
  const video = await store.videos.get(videoId)
  if (!video || !owns(userId, video.ownerId)) throw new Refused(NO_SUCH_VIDEO, 404)
  return video
}
