// Moves the repository's generated media into the buckets (v3, slice 16), with
// a sha256 manifest, and checks every object after upload. See `devpost/spec.md
// > Store v3 — Mongo and the Buckets (v3)` (the `archive/…` keys) and
// `devpost/checklist.md > Slices > 16`.
//
//   INKDESK_MEDIA_TARGET_CONFIRMED=yes npx tsx --env-file=.env scripts/move-media-to-bucket.mts [--include-tracked] [--yes] [--root <dir>]
//
// What it uploads:
//   always             the ignored media — video/out, video/public/capture, out/responsive,
//                      video/public/narration, video/public/music/track.mp3,
//                      video/public/placeholder — to the OUTPUTS bucket, under
//                      <prefix>archive/video/…
//   --include-tracked  also data/images, data/kernel-test and data/filming-* to
//                      the PROJECT-FILES bucket, under <prefix>archive/data/…
//
// <prefix> is S3_KEY_PREFIX (default `inkdesk/`), as the store uses it: never
// the root of a bucket that may be shared (SEC-13).
//
// Safe by default:
//   • It refuses to run at all unless INKDESK_MEDIA_TARGET_CONFIRMED=yes — the
//     bucket variables in a shell can belong to another app, and an upload
//     cannot be taken back. Set it only once the buckets are confirmed as Ink
//     Desk's.
//   • Without --yes it is a dry run: it lists every file, its key, its size and
//     its bucket, and touches nothing.
//   • With --yes it uploads each file (skipping one already there with the
//     same size and sha256), then HEADs every object and compares its size and
//     sha256 to the file, and writes data/MEDIA-MANIFEST.json (key, sha256,
//     bytes, and the bucket's role — `outputs` or `project-files`, never its
//     name: data/ is committed to a public repository). Any mismatch fails the run.
//   • It never deletes or untracks anything, here or in the bucket. Untracking
//     data/ from git afterwards is the learner's decision.
//
// The buckets come from `lib/config.ts`, with the learner's names mapped
// (S3_BUCKET_PROJECT_FILES, S3_BUCKET_COMPILE_OUTPUTS, …); no database is needed.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const rootAt = args.indexOf('--root')
const root = rootAt >= 0 && args[rootAt + 1] ? args[rootAt + 1] : join(dirname(fileURLToPath(import.meta.url)), '..')
const upload = flag('--yes')
const includeTracked = flag('--include-tracked')

if (process.env.INKDESK_MEDIA_TARGET_CONFIRMED !== 'yes') {
  console.error(
    'This script uploads into the buckets your S3_* variables name, and an upload can’t be taken back. Confirm they are Ink Desk’s own, then run it again with INKDESK_MEDIA_TARGET_CONFIRMED=yes.'
  )
  process.exit(2)
}

const { ConfigError, bucketSettings } = await import('../lib/config')
let settings: import('../lib/config').BucketSettings
try {
  settings = bucketSettings()
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : 'The bucket settings couldn’t be read.')
  process.exit(2)
}

// --- What goes where ------------------------------------------------------------

/** Ignored by git: the demo video's footage, voice, music and render, and the responsive check's screenshots. */
const IGNORED = ['video/out', 'video/public/capture', 'video/public/narration', 'video/public/music/track.mp3', 'video/public/placeholder', 'out/responsive']

/** Tracked in git today: the generated art and the kernel test. Only with --include-tracked. */
async function trackedSources(): Promise<string[]> {
  const data = join(root, 'data')
  const filming = existsSync(data) ? (await readdir(data)).filter((name) => name.startsWith('filming-')).map((name) => `data/${name}`) : []
  return ['data/images', 'data/kernel-test', ...filming.sort()]
}

/** Which bucket, by its part in the studio — what the manifest records. */
type Role = 'outputs' | 'project-files'

type Item = { file: string; key: string; bucket: string; role: Role; bytes: number }

/** Every regular file under `source` (a file or a folder); links are not followed. */
async function filesUnder(source: string): Promise<string[]> {
  const full = join(root, source)
  if (!existsSync(full)) return []
  const info = await lstat(full)
  if (info.isFile()) return [full]
  if (!info.isDirectory()) return []
  const out: string[] = []
  for (const entry of (await readdir(full, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store') continue
    if (entry.isDirectory()) out.push(...(await filesUnder(join(source, entry.name))))
    else if (entry.isFile()) out.push(join(full, entry.name))
  }
  return out
}

async function plan(): Promise<{ items: Item[]; absent: string[] }> {
  const groups: { sources: string[]; bucket: string; role: Role }[] = [{ sources: IGNORED, bucket: settings.outputsBucket, role: 'outputs' }]
  if (includeTracked) groups.push({ sources: await trackedSources(), bucket: settings.projectFilesBucket, role: 'project-files' })
  const items: Item[] = []
  const absent: string[] = []
  for (const { sources, bucket, role } of groups) {
    for (const source of sources) {
      const files = await filesUnder(source)
      if (files.length === 0) absent.push(source)
      for (const file of files) {
        const key = `${settings.keyPrefix}archive/${relative(root, file).split(sep).join('/')}`
        items.push({ file, key, bucket, role, bytes: (await lstat(file)).size })
      }
    }
  }
  return { items, absent }
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  json: 'application/json',
  html: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
}
const contentType = (file: string) => CONTENT_TYPES[file.slice(file.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

// --- The run --------------------------------------------------------------------

const { items, absent } = await plan()
const total = items.reduce((sum, item) => sum + item.bytes, 0)
console.log(`${upload ? 'Uploading' : 'Dry run — nothing is uploaded'}: ${items.length} files, ${mb(total)}`)
console.log(`  outputs bucket:       ${settings.outputsBucket}  ← the ignored video media and screenshots`)
console.log(`  project-files bucket: ${settings.projectFilesBucket}  ← ${includeTracked ? 'data/images, data/kernel-test, data/filming-*' : 'nothing (add --include-tracked for data/…)'}`)
for (const source of absent) console.log(`  --  ${source}: not here, skipped`)

if (!upload) {
  for (const item of items) console.log(`  ${item.bucket}/${item.key}  ${mb(item.bytes)}`)
  console.log('\nRun again with --yes to upload. Nothing is ever deleted or untracked.')
  process.exit(0)
}

const { HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3')
const { s3Client } = await import('../lib/store/cloud')
// A long request window: one file of footage can be a hundred megabytes.
const s3 = s3Client(settings, { connectionTimeout: 10_000, requestTimeout: 15 * 60_000, socketTimeout: 120_000 })

type Entry = { key: string; sha256: string; bytes: number; bucket: Role }

/** The object's size and recorded sha256, or null when it isn't there. */
async function head(bucket: string, key: string): Promise<{ bytes: number; sha256: string | undefined } | null> {
  try {
    const object = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { bytes: object.ContentLength ?? -1, sha256: object.Metadata?.sha256 }
  } catch (err) {
    if ((err as { name?: string }).name === 'NotFound') return null
    throw err
  }
}

const entries: Entry[] = []
const problems: string[] = []
let sent = 0
let kept = 0
for (const item of items) {
  // Read whole: the hash and the upload see the same bytes, and the SDK sends
  // a plain body with a known length.
  const bytes = await readFile(item.file)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const there = await head(item.bucket, item.key)
  const already = there !== null && there.bytes === bytes.length && there.sha256 === sha256
  if (already) {
    kept++
  } else {
    await s3.send(
      new PutObjectCommand({ Bucket: item.bucket, Key: item.key, Body: bytes, ContentLength: bytes.length, ContentType: contentType(item.file), Metadata: { sha256 } })
    )
    sent++
  }
  // Checked by HEAD whatever happened above: the size and the hash the bucket holds.
  const after = await head(item.bucket, item.key)
  if (!after) problems.push(`${item.key}: not in ${item.bucket} after upload`)
  else if (after.bytes !== bytes.length) problems.push(`${item.key}: ${after.bytes} bytes in the bucket, ${bytes.length} on disk`)
  else if (after.sha256 !== sha256) problems.push(`${item.key}: the bucket’s sha256 doesn’t match the file`)
  entries.push({ key: item.key, sha256, bytes: bytes.length, bucket: item.role })
  console.log(`  ${already ? 'kept' : 'sent'}  ${item.bucket}/${item.key}  ${mb(bytes.length)}`)
}
s3.destroy()

// The manifest keeps earlier runs' entries (say, data/ from an --include-tracked
// run) and replaces only what this run covered.
const manifestFile = join(root, 'data', 'MEDIA-MANIFEST.json')
let earlier: Entry[] = []
try {
  earlier = (JSON.parse(await readFile(manifestFile, 'utf8')) as { objects?: Entry[] }).objects ?? []
} catch {}
const covered = new Set(entries.map((entry) => `${entry.bucket}/${entry.key}`))
const objects = [...earlier.filter((entry) => !covered.has(`${entry.bucket}/${entry.key}`)), ...entries].sort((a, b) =>
  `${a.bucket}/${a.key}`.localeCompare(`${b.bucket}/${b.key}`)
)
await mkdir(dirname(manifestFile), { recursive: true })
await writeFile(manifestFile, JSON.stringify({ updatedAt: new Date().toISOString(), objects }, null, 2) + '\n')

console.log(`\n${sent} sent, ${kept} already there; ${entries.length} checked by HEAD. Manifest: ${relative(process.cwd(), manifestFile) || manifestFile}`)
if (problems.length > 0) {
  console.error(`\n${problems.length} object(s) don’t match their files:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('Every object matches its file. Nothing was deleted or untracked.')
