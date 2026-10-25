// Where an account's files live in the outputs store, and the limits on them
// (v3, slice 21). Plain names and numbers, shared by the export, the deletion and
// the three routes that tell the person where they stand — so the key a zip is
// written under, the folder the deletion empties and the folder the download
// reads are one spelling, here.
//
//   exports/<ownerId>/<jobId>.zip    the person's latest export (only one is kept)
//   videos/<ownerId>/…               rendered trailers (slice 22 fills it)
import { isOutputKey } from '../store/local'

/** The most an export may hold before it is refused: images are streamed one at a time, but the zip itself is built on disk and kept. */
export const EXPORT_CAP_BYTES = 400 * 1024 * 1024

/** What the person is told when a desk is too big for one zip. */
export const EXPORT_TOO_BIG =
  'Your desk is larger than the studio can pack into one download (400 MB). Nothing was changed. Download your pages from the Reader, one project at a time, and try again.'

/** Can this owner id be a folder name in the outputs store? Better Auth's ids and the test users' ids can; anything else could never have stored a file there. */
export const hasOutputFolder = (ownerId: string): boolean => isOutputKey(ownerId)

export const exportFolder = (ownerId: string): string => `exports/${ownerId}/`
export const exportKeyOf = (ownerId: string, jobId: string): string => `exports/${ownerId}/${jobId}.zip`
export const videoFolder = (ownerId: string): string => `videos/${ownerId}/`

/** The job id a stored export's key names, or null for a key that is not an export's. */
export function jobIdOfExport(ownerId: string, key: string): string | null {
  const folder = exportFolder(ownerId)
  if (!key.startsWith(folder) || !key.endsWith('.zip')) return null
  const id = key.slice(folder.length, -'.zip'.length)
  return id.length > 0 && !id.includes('/') ? id : null
}
