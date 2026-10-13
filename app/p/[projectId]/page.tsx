// The studio for one project. A Server Component: it checks the project
// exists (a bad or unknown id is the not-found page, never a blank studio)
// and hands the id to the client studio, which does everything else through
// `/api/projects/<id>`. `params` is a Promise in this Next version — see
// `devpost/spec.md > Routing and the Dashboard (v2)`.
import { notFound } from 'next/navigation'
import { Studio } from '@/components/Studio'
import { Refused } from '@/lib/errors'
import { store } from '@/lib/store'
import { isProjectId } from '@/lib/store/local'

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!isProjectId(projectId)) notFound()
  let exists = false
  try {
    await store.readProject(projectId)
    exists = true
  } catch (err) {
    // Only a project that isn't there is the not-found page; a storage that
    // can't be reached is a different problem and must not read as one.
    if (!(err instanceof Refused && err.status === 404)) throw err
    exists = false
  }
  if (!exists) notFound()
  return <Studio projectId={projectId} />
}
