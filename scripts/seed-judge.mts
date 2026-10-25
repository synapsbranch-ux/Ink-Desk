// Give the judges' demo account a finished chapter — and, with `--with-trailer`,
// its trailer — for $0 (v3, slice 23). Nothing is drawn or animated again: one
// finished project is COPIED from its owner to the judge's account, through the
// store's own interfaces, under new ids, so the original stays its owner's and is
// never written.
//
//   npx tsx scripts/seed-judge.mts --from <projectId> --to <accountId> [--with-trailer] [--data-dir data] [--dry-run]
//
// What is copied: the project (its story, library, chapter, plan, cover and
// pages, its usage readout) with a NEW project id and owner `--to`, and every
// picture it holds — character sheets, every panel and cover version, every
// upload on the shelf — each stored again under a NEW image id (an asset's id is
// its picture's id, as when it was uploaded). Ids that live only inside the
// project (the chapter, the characters) are kept: nothing outside a project reads
// them without its project id. With `--with-trailer`, the project's latest
// finished trailer: a NEW video record for `--to` on the copy, its plan's
// pictures pointed at the copy's, and every file it names (final.mp4,
// poster.jpg, captions.vtt, the shots, voices and music) copied under
// `videos/<to>/<new id>/` — the folder the judge's account deletion empties.
//
// What is NEVER copied: a share link, a report, a job, a spend or quota counter,
// a person's settings. The copy is the judge's like anything they made: their
// account deletion removes it, its pictures and its files, and leaves the source.
//
// Idempotent: the new ids are derived from the source's and `--to` (a uuid from a
// sha256), so a second run finds the earlier copy by its id and changes nothing.
// A copy is marked `copiedFrom: { by: 'seed-judge', at }` and nothing more: the
// source's ids would show in the judge's data export, and the derived id already
// says which copy it is; `--with-trailer` on a later run
// adds only the trailer. The project record is written LAST, after every picture,
// and a run that fails deletes the pictures it stored, so a half copy is never
// found as a whole one. `--dry-run` says what would be copied and writes nothing.
//
// On the local store by default (`--data-dir`, else INKDESK_DATA_DIR, else
// `data`). With INKDESK_STORAGE=cloud it reads and writes MongoDB and the buckets
// — and refuses unless INKDESK_JUDGE_CONFIRMED=yes, because the database this
// environment points at may belong to another app. See
// `devpost/spec.md > Data Access and Ownership (v3)`; `npm run check:judge` holds it.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { parseArgs } from 'node:util'
import { ACCOUNT_ID } from '../lib/auth/config'
import type { BlobKind } from '../lib/store'
import type { VideoRecord } from '../lib/share/types'
import type { Project } from '../lib/types'

const USAGE = 'Usage: npx tsx scripts/seed-judge.mts --from <projectId> --to <accountId> [--with-trailer] [--data-dir data] [--dry-run]'

/** An account id (`lib/auth/config.ts > ACCOUNT_ID`) — the only owner a copy may be given. */
const OWNER = ACCOUNT_ID

/** That a record is a copy, kept on it (the stores keep a record whole). Never the source's ids: the judge's
 *  data export holds the project as stored, and the derived id alone finds the copy again. */
type Provenance = { copiedFrom: { by: 'seed-judge'; at: string } }
type CopiedProject = Project & Provenance
type CopiedVideo = VideoRecord & Provenance

function fail(sentence: string): never {
  console.error(sentence)
  process.exit(1)
}

/** A refusal once the store is open: thrown, so the run's cleanup still happens, and said as a sentence. */
class Stop extends Error {}
function stop(sentence: string): never {
  throw new Stop(sentence)
}

let args
try {
  args = parseArgs({
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      'with-trailer': { type: 'boolean', default: false },
      'data-dir': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  }).values
} catch (err) {
  fail(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`)
}

const from = args.from ?? ''
const to = args.to ?? ''
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(from)) fail(`--from must be a project id.\n${USAGE}`)
if (!OWNER.test(to)) fail(`--to must be an account id (as Settings › Account and judge:account print it, or user_… in test mode).\n${USAGE}`)
const withTrailer = args['with-trailer'] === true
const dryRun = args['dry-run'] === true

const env = process.env as Record<string, string | undefined>
const cloud = (env.INKDESK_STORAGE ?? '').trim() === 'cloud'
if (cloud) {
  if (args['data-dir']) fail('--data-dir is for the local store; INKDESK_STORAGE=cloud copies in MongoDB and the buckets.')
  if (env.INKDESK_JUDGE_CONFIRMED !== 'yes') {
    fail(
      'INKDESK_STORAGE=cloud would copy a project in the MongoDB that DB_URL (or MONGODB_URI) points at, and its pictures in the buckets, which may be another app’s. ' +
        'Check that they are Ink Desk’s own, then run again with INKDESK_JUDGE_CONFIRMED=yes.'
    )
  }
} else if (args['data-dir']) {
  env.INKDESK_DATA_DIR = args['data-dir'] // read by the store at load: set before the import below
}

// Imported after the environment is settled, because the store reads it at load.
const { store } = await import('../lib/store')
const { Refused } = await import('../lib/errors')
const { LOCAL_OWNER } = await import('../lib/queue/jobs')
const { projectImageIds } = await import('../lib/auth/access')
const { videoKeys } = await import('../lib/video/record')

/** A uuid-shaped id derived from `parts`: the same source and target always name the same copy. */
function derivedId(...parts: string[]): string {
  const h = createHash('sha256').update(['inkdesk', 'seed-judge', 'v1', ...parts].join('\n')).digest()
  h[6] = (h[6] & 0x0f) | 0x50 // version 5 (name-based)
  h[8] = (h[8] & 0x3f) | 0x80 // RFC 4122 variant
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

const BLOB_KINDS: readonly BlobKind[] = ['sheet', 'panel', 'cover', 'asset']
const kindOf = (imageId: string): BlobKind => BLOB_KINDS.find((k) => imageId.startsWith(`${k}-`)) ?? 'asset'
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const label = (p: { id: string; title: string }) => `${p.id}  “${p.title}”`

/** The copy of `source` for `to`: new id, new owner, every picture id through `map`, no claim on a job, provenance recorded. */
function copyOf(source: Project, newId: string, map: Map<string, string>, now: string): CopiedProject {
  const img = (id: string) => map.get(id) ?? id // every id a project holds is in the map (projectImageIds)
  const settle = <T extends { versions: { imageId: string }[]; status: string; startedAt: string | null; startedByRun: string | null }>(x: T): T => ({
    ...x,
    versions: x.versions.map((v) => ({ ...v, imageId: img(v.imageId) })),
    // A picture "inking" is a claim by one of the source's jobs; the copy has no job, so it is what it holds.
    status: x.status === 'inking' ? (x.versions.length > 0 ? 'done' : 'empty') : x.status,
    startedAt: null,
    startedByRun: null,
  })
  const rest: Partial<CopiedProject> = { ...source }
  delete rest.migratedFrom // the v1 desk's mark belongs to the original
  delete rest.copiedFrom
  return {
    ...(rest as Project),
    id: newId,
    ownerId: to,
    story: {
      ...source.story,
      scenario: source.story.scenario ? { ...source.story.scenario, referenceAssetIds: source.story.scenario.referenceAssetIds.map(img) } : null,
    },
    library: {
      characters: source.library.characters.map((c) => ({ ...c, sheetImageId: c.sheetImageId ? img(c.sheetImageId) : null })),
      assets: source.library.assets.map((a) => ({ ...a, id: img(a.id), blobId: img(a.blobId) })),
    },
    chapters: source.chapters.map((chapter) => ({
      ...chapter,
      cover: chapter.cover ? settle(chapter.cover) : null,
      pages: chapter.pages.map((page) => ({ ...page, panels: page.panels.map((panel) => settle(panel)) })),
    })),
    createdAt: now,
    updatedAt: now,
    copiedFrom: { by: 'seed-judge', at: now },
  }
}

const sourceFolder = (v: VideoRecord) => videoKeys(v.ownerId, v.id).folder

/** Where a file of the source trailer goes in the copy's folder (same name under it). */
function keyIn(source: VideoRecord, targetFolder: string, key: string): string {
  const folder = sourceFolder(source)
  return targetFolder + (key.startsWith(folder) ? key.slice(folder.length) : `extra/${key.slice(key.lastIndexOf('/') + 1)}`)
}

/** Every file a trailer record names, by key. */
function filesOf(v: VideoRecord): string[] {
  const keys = [v.finalKey, v.posterKey, v.captionsKey, ...v.shots.map((s) => s.blobKey), ...v.speech.map((s) => s.blobKey), v.music.blobKey]
  return [...new Set(keys.filter((k): k is string => typeof k === 'string' && k.length > 0))]
}

let exitCode = 0
const stored: string[] = [] // pictures this run stored, deleted again if it fails before the project is written
let trailerFolder: string | null = null // the trailer folder this run is filling, emptied again if it fails before the record is written
let trailerHeld = false // the target holds the trailer's copy (made now, or found)
try {
  // --- The source ---------------------------------------------------------------------
  const source = await store.readProject(from).catch((err: unknown) => {
    if (err instanceof Refused) stop(`There is no project ${from} that can be read on this ${cloud ? 'database' : 'desk'} (${err.message})`)
    throw err
  })
  const sourceOwner = source.ownerId ?? LOCAL_OWNER
  if (sourceOwner === to) stop(`${label(source)} already belongs to ${to}; there is nothing to copy.`)
  const account = await store.users.get(to)
  if (account?.deletedAt) stop(`${to} is a deleted account; nothing was copied.`)
  const pages = source.chapters.flatMap((c) => c.pages)
  const inked = pages.filter((p) => p.panels.length > 0 && p.panels.every((panel) => panel.versions.length > 0)).length
  console.log(`From  ${label(source)} — owner ${sourceOwner}, ${inked} of ${pages.length} page(s) complete`)
  console.log(`To    ${to}${account ? '' : ' — no account record yet (it is written when the account is made); the copy waits for them'}`)
  if (inked < pages.length) console.log('      note: not every page is complete; the copy shows the chapter as it stands')

  // --- The project and its pictures ---------------------------------------------------
  const copyId = derivedId('project', source.id, to)
  const images = [...projectImageIds(source)].sort()
  let copy: Project | null = null
  const existingOwner = await store.projectOwner(copyId)
  if (existingOwner !== null) {
    // The id is derived from this source and this target, so the target's project under it is this copy.
    if (existingOwner !== to) stop(`Project ${copyId} exists and is not this copy; nothing was changed.`)
    const found = await store.readProject(copyId)
    copy = found
    console.log(`  already copied   ${label(found)} — nothing changed`)
  } else {
    // Read every picture first: a source with a missing picture is refused before anything is written.
    const blobs: { id: string; bytes: Buffer; mediaType: string }[] = []
    let total = 0
    for (const id of images) {
      const blob = await store.getBlob(id)
      if (!blob) stop(`Picture ${id} of ${label(source)} is missing from the store; nothing was copied.`)
      blobs.push({ id, ...blob })
      total += blob.bytes.length
    }
    if (dryRun) {
      console.log(`  would copy       ${label(source)} → project ${copyId} for ${to}`)
      console.log(`                   ${blobs.length} picture(s), ${mb(total)}, each under a new id`)
    } else {
      const map = new Map<string, string>()
      for (const blob of blobs) {
        const newId = await store.putBlob(blob.bytes, blob.mediaType, kindOf(blob.id))
        stored.push(newId)
        map.set(blob.id, newId)
      }
      const made = copyOf(source, copyId, map, new Date().toISOString())
      try {
        await store.createProject(made)
        stored.length = 0 // the project names them now: they are the copy's
        copy = await store.readProject(copyId)
        console.log(`  copied           ${label(source)} → ${label(made)} for ${to}`)
        console.log(`                   ${blobs.length} picture(s), ${mb(total)}, each under a new id`)
      } catch (err) {
        // Another run made it a moment ago: that one is the copy, and these pictures are let go.
        if (!(err instanceof Refused) || (await store.projectOwner(copyId)) !== to) throw err
        copy = await store.readProject(copyId)
        console.log(`  already copied   ${label(copy)} — another run made it just now; nothing changed`)
      }
    }
  }

  // --- The trailer --------------------------------------------------------------------
  if (withTrailer) {
    const trailer = (await store.videos.listOf(sourceOwner)).find((v) => v.projectId === source.id && v.status === 'done' && v.finalKey && v.posterKey) // newest first
    if (!trailer) {
      console.log(`  no trailer       ${label(source)} has no finished trailer${dryRun ? '' : '; only the chapter was copied'}`)
      exitCode = 1
    } else {
      const videoId = derivedId('video', trailer.id, to)
      const existing = (await store.videos.get(videoId)) as CopiedVideo | null
      const files = filesOf(trailer)
      if (existing) {
        if (existing.ownerId !== to || existing.projectId !== copyId) stop(`Video ${videoId} exists and is not this copy; nothing was changed.`)
        console.log(`  already copied   trailer ${trailer.id} → ${videoId} — nothing changed`)
        trailerHeld = true
      } else if (dryRun || !copy) {
        console.log(`  would copy       trailer ${trailer.id} (${trailer.seconds} s, page ${trailer.page + 1}) → ${videoId}, ${files.length} file(s)`)
      } else {
        const folder = videoKeys(to, videoId).folder
        trailerFolder = folder
        const moved = new Map<string, string>()
        let total = 0
        for (const key of files) {
          const blob = await store.outputs.open(key)
          if (!blob) {
            if (key === trailer.finalKey || key === trailer.posterKey) stop(`The trailer’s ${key.slice(key.lastIndexOf('/') + 1)} is missing; the trailer was not copied.`)
            continue // a part the finished film no longer needs: the copy names none
          }
          const dst = keyIn(trailer, folder, key)
          const { bytes } = await store.outputs.put(dst, Readable.fromWeb(blob.body as never) as AsyncIterable<Uint8Array>, blob.mediaType)
          moved.set(key, dst)
          total += bytes
        }
        const k = (key: string | null) => (key ? (moved.get(key) ?? null) : null)
        // The plan's pictures are the copy's: a shot card is served under the copy's own image route. Found by where the
        // picture sits in the source; one the source has let go since is the copy's current picture of that panel.
        const target = copy
        const pictureFor = (s: { imageId: string; panel: number }) => {
          const where = findImage(source, s.imageId)
          return (where && copiedImageAt(target, where)) ?? currentPicture(target, trailer.page, s.panel) ?? s.imageId
        }
        const now = new Date().toISOString()
        const record: CopiedVideo = {
          ...trailer,
          id: videoId,
          ownerId: to,
          projectId: copy.id,
          finalKey: k(trailer.finalKey),
          posterKey: k(trailer.posterKey),
          captionsKey: k(trailer.captionsKey),
          rev: 0,
          createdAt: now,
          updatedAt: now,
          plan: { ...trailer.plan, shots: trailer.plan.shots.map((s) => ({ ...s, imageId: pictureFor(s) })) },
          shots: trailer.shots.map((s) => ({ ...s, providerJobId: null, blobKey: k(s.blobKey) })),
          speech: trailer.speech.map((s) => ({ ...s, blobKey: k(s.blobKey) })),
          music: { ...trailer.music, blobKey: k(trailer.music.blobKey) },
          copiedFrom: { by: 'seed-judge', at: now },
        }
        await store.videos.put(record)
        trailerFolder = null
        trailerHeld = true
        console.log(`  copied           trailer ${trailer.id} → ${videoId} for ${to}: ${moved.size} file(s), ${mb(total)}`)
      }
    }
  }

  if (dryRun) console.log(`\nDry run: nothing was written.`)
  else console.log(`\n${to} holds ${copy ? label(copy) : 'no copy'}${trailerHeld ? ' and its trailer' : ''}. The source was not written.`)
} catch (err) {
  // A refusal is its sentence; the store's own sentences name settings, never their values.
  console.error(err instanceof Error ? err.message : String(err))
  exitCode = 1
} finally {
  // A run that failed half way takes back what it stored, so nothing is left that no record names.
  for (const id of stored) await store.deleteBlob(id).catch(() => {})
  if (trailerFolder) await store.outputs.deletePrefix(trailerFolder).catch(() => {})
  if (cloud) await (await import('../lib/store/cloud')).closeCloud()
}
process.exit(exitCode)

// --- Where a picture sits, to find its counterpart in the copy ---------------------------------

type Where = { kind: 'sheet'; character: number } | { kind: 'asset'; asset: number } | { kind: 'cover'; chapter: number; version: number } | { kind: 'panel'; chapter: number; page: number; panel: number; version: number }

function findImage(p: Project, id: string): Where | null {
  const c = p.library.characters.findIndex((x) => x.sheetImageId === id)
  if (c >= 0) return { kind: 'sheet', character: c }
  const a = p.library.assets.findIndex((x) => x.blobId === id)
  if (a >= 0) return { kind: 'asset', asset: a }
  for (const [ci, chapter] of p.chapters.entries()) {
    const v = chapter.cover?.versions.findIndex((x) => x.imageId === id) ?? -1
    if (v >= 0) return { kind: 'cover', chapter: ci, version: v }
    for (const [pi, page] of chapter.pages.entries()) {
      for (const [ni, panel] of page.panels.entries()) {
        const pv = panel.versions.findIndex((x) => x.imageId === id)
        if (pv >= 0) return { kind: 'panel', chapter: ci, page: pi, panel: ni, version: pv }
      }
    }
  }
  return null
}

function copiedImageAt(p: Project, w: Where): string | null {
  switch (w.kind) {
    case 'sheet':
      return p.library.characters[w.character]?.sheetImageId ?? null
    case 'asset':
      return p.library.assets[w.asset]?.blobId ?? null
    case 'cover':
      return p.chapters[w.chapter]?.cover?.versions[w.version]?.imageId ?? null
    case 'panel':
      return p.chapters[w.chapter]?.pages[w.page]?.panels[w.panel]?.versions[w.version]?.imageId ?? null
  }
}

/** The copy's current picture of a panel — for a trailer shot whose pinned picture the source has since let go. */
function currentPicture(p: Project, page: number, panel: number): string | null {
  const x = p.chapters[0]?.pages[page]?.panels.find((q) => q.index === panel)
  return x ? (x.versions[x.currentVersion]?.imageId ?? null) : null
}
