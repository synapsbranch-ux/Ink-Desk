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
import { store } from '../store'
import type { Project } from '../types'
import { authMode } from './config'

/** The one answer for a project that is not the caller's — word for word what a missing one says. */
export const NO_SUCH_PROJECT = 'There is no such project.'
export const NO_SUCH_IMAGE = 'There is no such image.'
export const NO_SUCH_JOB = 'There is no such job.'

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
