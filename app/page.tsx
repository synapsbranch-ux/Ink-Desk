// The desk: every project, and the door to a new one. A Server Component
// that reads `data/projects` on every request — `connection()` keeps it from
// being prerendered with a stale list, since reading the disk is not a
// request-time API on its own. The first read migrates a v1 desk into a
// project; a v1 file that can't be read is left alone and named in one
// sentence. See `devpost/prd.md > Dashboard` and
// `devpost/spec.md > Routing and the Dashboard (v2)`.
import { connection } from 'next/server'
import { Dashboard } from '@/components/Dashboard'
import { listProjects, migrateLegacy } from '@/lib/chapter'
import { configSentence, ProviderError } from '@/lib/errors'

export default async function DeskPage() {
  await connection()
  let problem: string | null
  let projects: Awaited<ReturnType<typeof listProjects>>
  try {
    problem = (await migrateLegacy()).problem
    projects = await listProjects()
  } catch (err) {
    // A storage that can't be reached (cloud mode without its settings, a
    // MongoDB that refuses this machine) opens an empty desk with its one
    // sentence, never a stack trace.
    if (!(err instanceof ProviderError && err.kind === 'config')) throw err
    console.error(`[desk] ${err.message}`, err.cause ?? '')
    problem = configSentence(err) // production names no variables (SEC-11)
    projects = []
  }
  // The panel quality is the server's setting; the dialog only prices it.
  return <Dashboard projects={projects} notice={problem} panelQuality={process.env.IMAGE_PANEL_QUALITY ?? 'low'} />
}
