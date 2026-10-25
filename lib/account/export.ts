// The export of a person's data (v3, slice 21): one zip, built on disk, put in the
// outputs store and handed back by `GET /api/settings/export/download`. Runs on the
// account queue (`lib/queue/processors.ts` → `lib/account/index.ts`); see
// `devpost/spec.md > Settings, Usage, Terms and Privacy (v3)`.
//
//   account.json                    id, email, createdAt — nothing else of the account
//   settings.json                   the saved defaults (empty when none were saved)
//   shares.json                     the active shares' tokens, addresses and titles
//   manifest.json                   what is in the zip, and anything that could not be (a picture
//                                   that was missing, a project that could not be read)
//   projects/<slug>-<id>/project.json        the project as stored, with `ownerId` removed
//   projects/<slug>-<id>/images/<imageId>    every picture the project holds, as stored
//
// How it is built, and why:
//   • the archive goes to a temp file in `os.tmpdir()` and is put in the store by path,
//     so neither the archive nor the pictures are ever whole in memory; the temp file is
//     removed in a `finally`, whatever happens;
//   • pictures are streamed one at a time (`ZipBuilder`), counted against a cap of
//     `EXPORT_CAP_BYTES`; past it the job ends `failed` with a calm sentence;
//   • a picture the store no longer has is noted in the manifest, not a reason to fail —
//     the person still gets everything that exists;
//   • only the LATEST export is kept: once the new zip is stored, every older key under
//     `exports/<owner>/` is deleted;
//   • an account deleted while this runs gets nothing: the tombstone is checked before the
//     put and after it, and a zip that landed is removed again.
// A store that fails mid-way throws (the queue retries; the key is the job's own, so a re-run
// overwrites the same object); the job's own results — too big, account gone — are outcomes.
import 'server-only'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm, stat } from 'node:fs/promises'
import { projectImageIds } from '../auth/access'
import { Refused } from '../errors'
import type { JobRecord } from '../queue/jobs'
import type { Outcome } from '../queue/run'
import { store } from '../store'
import { isImageId, mediaTypeOf } from '../store/local'
import type { Project } from '../types'
import { EXPORT_CAP_BYTES, EXPORT_TOO_BIG, exportFolder, exportKeyOf, hasOutputFolder } from './keys'
import { TooLarge, ZipBuilder } from './zip'

/** Said when the account was deleted while its export was being made. */
export const EXPORT_ACCOUNT_GONE = 'This account has been deleted, so there is nothing to export.'
const NO_FOLDER = 'This account can’t keep an export. Nothing was changed.'

/** What the check (and only the check) may change: the cap, the temp folder, the clock. */
export type ExportOptions = { capBytes?: number; tmpDir?: string; now?: () => Date }

type Missing = { project: string; imageId: string; why: string }
type Skipped = { project: string; why: string }

const EXT_BY_TYPE: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** `a-title-for-a-folder`: lowercase letters and digits joined by dashes, at most 40 characters. */
export function slugOf(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // the accents NFKD split off
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || 'project'
}

/** The file name a picture gets in the zip: its id, with the extension its media type names when the id lacks one. */
export function imageFileName(imageId: string, mediaType: string): string {
  const ext = EXT_BY_TYPE[mediaType] ?? mediaTypeOf(imageId).split('/')[1] ?? 'bin'
  return imageId.toLowerCase().endsWith(`.${ext}`) ? imageId : `${imageId}.${ext}`
}

const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')

/**
 * The sign-in email of an account whose studio record holds none (made on the sign-up page, so unverified): Privacy
 * says the email is kept and the export gives it back. Only with real sign-in; null when it cannot be read.
 */
async function signInEmailOf(ownerId: string): Promise<string | null> {
  try {
    const { signInOn } = await import('../auth/config')
    if (!signInOn()) return null
    const { signInEmail } = await import('../auth/server')
    return await signInEmail(ownerId)
  } catch {
    return null
  }
}

async function accountGone(ownerId: string): Promise<boolean> {
  return Boolean((await store.users.get(ownerId))?.deletedAt)
}

export async function makeExport(job: JobRecord, options: ExportOptions = {}): Promise<Outcome> {
  const owner = job.ownerId
  const now = options.now ?? (() => new Date())
  if (!hasOutputFolder(owner)) return { outcome: 'failed', error: NO_FOLDER }
  if (await accountGone(owner)) return { outcome: 'refused', error: EXPORT_ACCOUNT_GONE }

  const temp = join(options.tmpDir ?? tmpdir(), `inkdesk-export-${job.id}-${randomBytes(4).toString('hex')}.zip`)
  const zip = new ZipBuilder(temp, options.capBytes ?? EXPORT_CAP_BYTES, now())
  const key = exportKeyOf(owner, job.id)
  try {
    const missing: Missing[] = []
    const skipped: Skipped[] = []
    let projectCount = 0
    let imageCount = 0

    const user = await store.users.get(owner)
    zip.addBuffer('account.json', json({ id: owner, email: user?.email ? user.email : await signInEmailOf(owner), createdAt: user?.createdAt ?? null }))

    const saved = await store.settings.get(owner)
    zip.addBuffer('settings.json', json(saved ? { defaultStyle: saved.defaultStyle, readingDirection: saved.readingDirection, ...(saved.voices ? { voices: saved.voices } : {}), updatedAt: saved.updatedAt } : {}))

    const shares = await store.shares.listActiveOf(owner)
    zip.addBuffer(
      'shares.json',
      json({
        shares: shares.map((s) => ({
          token: s.token,
          path: `/s/${s.token}`,
          kind: s.kind,
          title: s.snapshot?.title ?? null,
          createdAt: s.createdAt,
        })),
      })
    )

    for (const { id } of await store.projectsOf(owner)) {
      let project: Project
      try {
        project = await store.readProject(id)
      } catch (err) {
        // Gone since the listing, or damaged beyond reading: the rest of the desk is still the person's to take.
        if (err instanceof Refused) {
          if (err.status !== 404) skipped.push({ project: id, why: 'its stored copy could not be read' })
          continue
        }
        throw err
      }
      const folder = `projects/${slugOf(project.title)}-${id}`
      const kept: Partial<Project> = { ...project }
      delete kept.ownerId // whose it is is the zip's owner; the file carries nothing that names an account
      zip.addBuffer(`${folder}/project.json`, json(kept))
      projectCount++

      for (const imageId of [...projectImageIds(project)].sort()) {
        if (!isImageId(imageId)) {
          missing.push({ project: id, imageId, why: 'not a stored picture' })
          continue
        }
        const blob = await store.openBlob(imageId)
        if (!blob) {
          missing.push({ project: id, imageId, why: 'the picture is no longer in the studio' })
          continue
        }
        await zip.addStream(`${folder}/images/${imageFileName(imageId, blob.mediaType)}`, blob.body, blob.bytes)
        imageCount++
      }
    }

    zip.addBuffer(
      'manifest.json',
      json({
        madeAt: now().toISOString(),
        projects: projectCount,
        images: imageCount,
        missingImages: missing,
        unreadableProjects: skipped,
        note:
          missing.length + skipped.length === 0
            ? 'Everything on your desk is in this zip.'
            : 'Everything that could be read is in this zip; what could not be is listed here.',
      })
    )
    await zip.finish()
    if ((await stat(temp)).size > (options.capBytes ?? EXPORT_CAP_BYTES)) throw new TooLarge()

    // The person may have left while this was being packed: nothing of theirs may be put in the store after that.
    if (await accountGone(owner)) return { outcome: 'refused', error: EXPORT_ACCOUNT_GONE }
    await store.outputs.put(key, temp, 'application/zip')
    if (await accountGone(owner)) {
      await store.outputs.delete(key)
      return { outcome: 'refused', error: EXPORT_ACCOUNT_GONE }
    }

    // Only the latest is kept.
    for (const old of await store.outputs.list(exportFolder(owner))) {
      if (old.key !== key) await store.outputs.delete(old.key)
    }
    console.log(`[export] ${job.id.slice(0, 8)} — ${projectCount} projects, ${imageCount} pictures, ${zip.bytes} bytes in`)
    return { outcome: 'done' }
  } catch (err) {
    zip.abort()
    if (err instanceof TooLarge) return { outcome: 'failed', error: EXPORT_TOO_BIG }
    throw err
  } finally {
    await rm(temp, { force: true })
  }
}
