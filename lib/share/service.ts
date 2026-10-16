// Sharing, the owner's side (v3, slice 21): publish a manga, update what was
// published, take it down, and list what a person has out. The routes call this
// after they have proved the project (or the share) is the caller's; nothing
// here checks who is asking.
//
// A share is a snapshot (`lib/share/snapshot.ts`) addressed by a token: 128
// random bits, written in base62 (22 characters), minted once and never
// reused — a revoked token stays dead, and publishing the project again makes a
// NEW address. There is at most one ACTIVE share per project and `create` is
// idempotent: a second click, a second tab or a retry gets the share that
// already exists, and the store's atomic `create` settles two that race.
//
// `ShareView` is what the owner's screens are given: the link, the title, how
// many pages, and `stale` — the project has changed since the snapshot. It never
// carries the snapshot itself. `stale` is a comparison of what a reader would
// see, not of timestamps (`snapshotsDiffer`), so reading, walking between
// stations or a failed generation does not nag the owner to update.
// Server only.
import 'server-only'
import { randomBytes } from 'node:crypto'
import { owns } from '../auth/access'
import { readBytes } from '../body'
import { Refused } from '../errors'
import { store } from '../store'
import type { Project } from '../types'
import { buildMangaSnapshot, NothingReadable, publicManga, snapshotsDiffer } from './snapshot'
import type { ShareRecord, ShareView } from './types'
import { sharePath, shareUrl } from './url'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** 128 random bits in base62: uniform (a big integer divided down, not a byte folded), 22 characters. */
export function newShareToken(): string {
  let n = BigInt(`0x${randomBytes(16).toString('hex')}`)
  const base = BigInt(62)
  const zero = BigInt(0)
  let out = ''
  while (n > zero) {
    out = BASE62[Number(n % base)] + out
    n /= base
  }
  return out.padStart(22, '0')
}

export const NOT_SHARED = 'This project isn’t shared yet. Share it first, then update it.'
const EMPTY_BODY = 'That request couldn’t be read.'

/**
 * The owner's share routes take no input: they act on the project in the
 * address. An empty body or `{}` is fine; anything else is the route's "couldn't
 * be read" 400, strictly, and the body is read under a 1 KB cap — never more.
 */
export async function assertNoInput(req: Request): Promise<void> {
  const bytes = await readBytes(req, 1024, { unreadable: EMPTY_BODY, tooLarge: EMPTY_BODY })
  if (bytes.byteLength === 0) return
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Refused(EMPTY_BODY, 400)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.keys(parsed).length > 0) throw new Refused(EMPTY_BODY, 400)
}

/** What the owner's screens are given of a share. `stale` is computed by the caller, who has the project (or not). */
export function viewOf(share: ShareRecord, origin: string, stale: boolean): ShareView {
  const snapshot = share.snapshot
  const manga = snapshot?.kind === 'manga' ? publicManga(snapshot) : null
  return {
    token: share.token,
    url: shareUrl(origin, share.token),
    path: sharePath(share.token),
    kind: share.kind,
    title: manga?.title ?? (snapshot?.kind === 'video' ? snapshot.title : 'Untitled chapter'),
    projectId: share.projectId,
    cover: manga ? (manga.cover?.imageId ?? null) : snapshot?.kind === 'video' ? snapshot.posterImageId : null,
    pages: manga ? manga.pages.length : 0,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    stale,
  }
}

/** Has the project changed, as a reader would see it, since this share was taken? A project that can't be read is not called stale. */
async function staleOf(share: ShareRecord, project?: Project): Promise<boolean> {
  if (share.kind !== 'manga' || share.projectId === null) return false
  const published = publicManga(share.snapshot)
  if (!published) return false
  let current: Project
  try {
    current = project ?? (await store.readProject(share.projectId))
  } catch {
    return false
  }
  try {
    return snapshotsDiffer(published, buildMangaSnapshot(current, new Date()))
  } catch (err) {
    // Nothing readable any more (a cover redrawn into nothing, a page cleared) is a change; any other failure is not ours to guess at.
    return err instanceof NothingReadable
  }
}

/** The project's active share as the caller's view of it, or null. A share left on the project by an earlier owner is not the caller's to see. */
export async function shareViewOfProject(userId: string, project: Project, origin: string): Promise<ShareView | null> {
  const share = await store.shares.activeForProject(project.id)
  if (!share || !owns(userId, share.ownerId)) return null
  return viewOf(share, origin, await staleOf(share, project))
}

/**
 * Publish (idempotent): the project's active share if it has one, else a new
 * snapshot under a new token. Throws `NothingReadable` (409) when there is
 * nothing to publish. An active share that an EARLIER owner left on a project
 * that has since been claimed is taken down first — the new owner chose nothing
 * about it.
 */
export async function createShare(userId: string, project: Project, origin: string): Promise<ShareView> {
  const existing = await store.shares.activeForProject(project.id)
  if (existing && owns(userId, existing.ownerId)) return viewOf(existing, origin, await staleOf(existing, project))
  if (existing) await store.shares.revoke(existing.token, new Date().toISOString())

  const now = new Date().toISOString()
  const snapshot = buildMangaSnapshot(project, now)
  const { share } = await store.shares.create({
    token: newShareToken(),
    ownerId: userId,
    kind: 'manga',
    projectId: project.id,
    videoId: null,
    snapshot,
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  })
  // `created: false` means another click won the race: its share is the one, and it is just as fresh.
  return viewOf(share, origin, false)
}

/** Update share: replace the active share's snapshot with the project as it stands now. 409 when it has none to update. */
export async function refreshShare(userId: string, project: Project, origin: string): Promise<ShareView> {
  const existing = await store.shares.activeForProject(project.id)
  if (!existing || !owns(userId, existing.ownerId)) throw new Refused(NOT_SHARED, 409)
  const now = new Date().toISOString()
  const snapshot = buildMangaSnapshot(project, now)
  const share = await store.shares.refresh(existing.token, snapshot, now)
  if (!share) throw new Refused(NOT_SHARED, 409) // unpublished in the meantime: a revoked address is never brought back
  return viewOf(share, origin, false)
}

/** Unpublish the project's active share, if it has one (idempotent). */
export async function unpublishProject(userId: string, project: Project): Promise<void> {
  const share = await store.shares.activeForProject(project.id)
  if (share && owns(userId, share.ownerId)) await store.shares.revoke(share.token, new Date().toISOString())
}

/** Unpublish by token. The caller has proved the share is theirs (`ownedShare`); a second unpublish is not an error. */
export async function unpublishToken(token: string): Promise<void> {
  await store.shares.revoke(token, new Date().toISOString())
}

/** Everything the person has published, newest first (Settings › Sharing). */
export async function listShareViews(userId: string, origin: string): Promise<ShareView[]> {
  const shares = await store.shares.listActiveOf(userId)
  return Promise.all(shares.map(async (share) => viewOf(share, origin, await staleOf(share))))
}
