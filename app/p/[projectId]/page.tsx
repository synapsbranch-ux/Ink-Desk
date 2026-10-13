// The studio for one project. A Server Component: it checks the project
// exists (a bad or unknown id is the not-found page, never a blank studio)
// and hands the id to the client studio, which does everything else through
// `/api/projects/<id>`. `params` is a Promise in this Next version — see
// `devpost/spec.md > Routing and the Dashboard (v2)`.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Studio } from '@/components/Studio'
import { ProviderError, Refused } from '@/lib/errors'
import { store } from '@/lib/store'
import { isProjectId } from '@/lib/store/local'

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!isProjectId(projectId)) notFound()
  try {
    await store.readProject(projectId)
  } catch (err) {
    if (err instanceof Refused && err.status === 404) notFound()
    // A storage that can't be reached is a different problem from a project
    // that isn't there, and must not read as one: its sentence, one way back.
    if (!(err instanceof ProviderError && err.kind === 'config')) throw err
    console.error(`[studio] ${err.message}`, err.cause ?? '')
    return (
      <div className="studio">
        <div className="studio-opening">
          <div className="not-found">
            <p className="eyebrow">Ink Desk</p>
            <h1>The desk can’t be reached.</h1>
            <p className="notice" role="status">
              {err.message}
            </p>
            <p>
              <Link className="btn btn-primary" href="/">
                ← Back to the desk
              </Link>
            </p>
          </div>
        </div>
      </div>
    )
  }
  return <Studio projectId={projectId} />
}
