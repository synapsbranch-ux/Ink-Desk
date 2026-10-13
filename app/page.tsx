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

export default async function DeskPage() {
  await connection()
  const { problem } = await migrateLegacy()
  const projects = await listProjects()
  return <Dashboard projects={projects} notice={problem} />
}
