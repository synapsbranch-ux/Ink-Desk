// The pictures a live share still lists (v3, slice 21). A snapshot holds picture
// ids, not copies, and a project keeps only its last three versions of a panel
// or the cover: a redraw that pushes the oldest out deletes its picture (CR-16),
// and without this the share would keep listing an id that is no longer in the
// bucket — a blank panel on a public page, though "later edits do not change
// what a link shows until the owner updates it". So a share PINS what it lists:
//   • `landImage` deletes no dropped picture the project's active share lists
//     (`pinnedPictures`);
//   • when the share lets go — Update share, unpublish, the admin's takedown, a
//     deleted account — the pictures it was the last to hold are deleted then
//     (`releasePictures`, `revokeShare`).
// A crash between the write and the delete leaves a picture nothing names, the
// same limit as a crash after a draw (see the slice contract). Server only.
import 'server-only'
import { projectImageIds } from '../auth/access'
import { Refused } from '../errors'
import { store } from '../store'
import { publicManga, snapshotImageIds } from './snapshot'
import type { ShareRecord } from './types'

/** The picture ids a share's snapshot lists; none for a revoked share or one that is not a manga. */
export function pinnedBy(share: ShareRecord | null): Set<string> {
  const manga = share ? publicManga(share.snapshot) : null
  return manga ? snapshotImageIds(manga) : new Set()
}

/** What a redraw must not delete: every picture the project's active share lists. */
export async function pinnedPictures(projectId: string): Promise<Set<string>> {
  return pinnedBy(await store.shares.activeForProject(projectId))
}

/**
 * A share has let go of `ids` (a snapshot replaced, revoked or deleted): delete the ones nothing holds now — not in `keep`
 * (the snapshot that replaced it), not in the project's own pages. A project that is gone holds nothing; one that cannot be
 * read right now is not guessed at (the pictures stay), and nothing here throws.
 */
export async function releasePictures(ids: Iterable<string>, projectId: string | null, keep: ReadonlySet<string> = new Set()): Promise<void> {
  const loose = [...ids].filter((id) => !keep.has(id))
  if (loose.length === 0) return
  let held = new Set<string>()
  if (projectId !== null) {
    try {
      held = projectImageIds(await store.readProject(projectId))
    } catch (err) {
      // Only "there is no such project" (a 404) means gone; a project that exists but is damaged (a 500) still names its pictures.
      if (!(err instanceof Refused && err.status === 404)) return void console.warn(`[share] kept ${loose.length} picture(s) a share let go of; the project could not be read:`, err)
    }
  }
  for (const id of loose) {
    if (held.has(id)) continue
    await store.deleteBlob(id).catch((e: unknown) => console.warn(`[share] could not delete ${id}:`, e))
  }
}

/** Revoke a share and release the pictures only it still held. The snapshot is read first: a revoke drops it. */
export async function revokeShare(share: ShareRecord, now: string): Promise<void> {
  const pinned = pinnedBy(share)
  await store.shares.revoke(share.token, now)
  await releasePictures(pinned, share.projectId)
}
