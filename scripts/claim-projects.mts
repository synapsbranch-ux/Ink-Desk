// Hand projects made before accounts to one account (v3, slice 19): the
// migrated v1 desk and the filmed project go to the learner.
//
//   npx tsx scripts/claim-projects.mts --owner user_xxx [--data-dir data] [--project <id>] [--dry-run]
//
// A project with no owner (or `local`, the owner on a desk without accounts)
// gets `--owner`; a project that already has another owner is never changed.
// `--project` claims just that one; `--dry-run` lists what would change and
// writes nothing. Its job records move with it, so its queue counts against
// the new owner. A public share link it carried from before accounts is revoked.
//
// On the local store by default (`--data-dir`, else INKDESK_DATA_DIR, else
// `data`). With INKDESK_STORAGE=cloud it writes MongoDB — and refuses unless
// INKDESK_CLAIM_CONFIRMED=yes, because the database this environment points at
// may belong to another app. See `devpost/spec.md > Data Access and Ownership (v3)`.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import { parseArgs } from 'node:util'

const USAGE = 'Usage: npx tsx scripts/claim-projects.mts --owner user_xxx [--data-dir data] [--project <id>] [--dry-run]'

/** Clerk's user id shape — the only owner a claim may set. */
const OWNER = /^user_[A-Za-z0-9]{1,40}$/

function fail(sentence: string): never {
  console.error(sentence)
  process.exit(1)
}

let args
try {
  args = parseArgs({
    options: {
      owner: { type: 'string' },
      'data-dir': { type: 'string' },
      project: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  }).values
} catch (err) {
  fail(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`)
}

const owner = args.owner ?? ''
if (!OWNER.test(owner)) fail(`--owner must be a Clerk user id (user_…).\n${USAGE}`)
const dryRun = args['dry-run'] === true

const env = process.env as Record<string, string | undefined>
const cloud = (env.INKDESK_STORAGE ?? '').trim() === 'cloud'
if (cloud) {
  if (args['data-dir']) fail('--data-dir is for the local store; INKDESK_STORAGE=cloud claims in MongoDB.')
  if (env.INKDESK_CLAIM_CONFIRMED !== 'yes') {
    fail(
      'INKDESK_STORAGE=cloud would claim projects in the MongoDB that DB_URL (or MONGODB_URI) points at, which may be another app’s. ' +
        'Check that it is Ink Desk’s own database, then run again with INKDESK_CLAIM_CONFIRMED=yes.'
    )
  }
} else if (args['data-dir']) {
  env.INKDESK_DATA_DIR = args['data-dir'] // read by the store at load: set before the import below
}

// Imported after the environment is settled, because the store reads it at load.
const { store } = await import('../lib/store')
const { LOCAL_OWNER } = await import('../lib/queue/jobs')
const { Refused } = await import('../lib/errors')
const { revokeShare } = await import('../lib/share/pins')

let exitCode = 0
try {
  const all = await store.projectOwners()
  const chosen = args.project ? all.filter((p) => p.id === args.project) : all
  if (args.project && chosen.length === 0) fail(`There is no project ${args.project} on this ${cloud ? 'database' : 'desk'}.`)
  if (chosen.length === 0) console.log('No projects here.')

  let claimed = 0
  for (const project of chosen) {
    const label = `${project.id}  “${project.title}”`
    if (project.ownerId === owner) {
      console.log(`  already theirs   ${label}`)
      continue
    }
    if (project.ownerId !== null && project.ownerId !== LOCAL_OWNER) {
      console.log(`  left as it is    ${label} — it belongs to another account`)
      if (args.project) exitCode = 1
      continue
    }
    if (dryRun) {
      console.log(`  would claim      ${label}`)
      claimed++
      continue
    }
    try {
      const outcome = await store.claimProject(project.id, owner)
      console.log(`  ${outcome === 'claimed' ? 'claimed        ' : 'already theirs '}  ${label}`)
      if (outcome === 'claimed') claimed++
    } catch (err) {
      if (!(err instanceof Refused)) throw err
      console.log(`  left as it is    ${label} — ${err.message}`)
      if (args.project) exitCode = 1
      continue
    }
    // A public link made while the desk had no accounts (owner `local`) is taken down: its new owner could neither see nor unpublish it.
    const link = await store.shares.activeForProject(project.id)
    if (link && link.ownerId !== owner) {
      await revokeShare(link, new Date().toISOString())
      console.log(`  link taken down  ${label} — it was shared before the account owned it; share it again to publish`)
    }
    // Its job records follow it, so the per-person queue limits count them against the new owner.
    for (const job of await store.jobs.listJobs({ projectId: project.id, ownerId: LOCAL_OWNER, limit: 10_000 })) {
      await store.jobs.updateJob(job.id, (j) => (j.ownerId === LOCAL_OWNER ? { ...j, ownerId: owner } : null))
    }
  }
  console.log(dryRun ? `\nDry run: ${claimed} project(s) would go to ${owner}; nothing was written.` : `\n${claimed} project(s) now belong to ${owner}.`)
} catch (err) {
  // The store's own sentences name settings, never their values.
  console.error(err instanceof Error ? err.message : String(err))
  exitCode = 1
} finally {
  if (cloud) await (await import('../lib/store/cloud')).closeCloud()
}
process.exit(exitCode)
