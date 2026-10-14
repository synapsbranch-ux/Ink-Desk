// The studio for one project. A Server Component: it checks the project
// exists (a bad or unknown id is the not-found page, never a blank studio)
// and hands the id to the client studio, which does everything else through
// `/api/projects/<id>`. `params` is a Promise in this Next version — see
// `devpost/spec.md > Routing and the Dashboard (v2)`.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Studio } from '@/components/Studio'
import { configSentence, ProviderError, Refused } from '@/lib/errors'
import { store } from '@/lib/store'
import { isProjectId } from '@/lib/store/local'

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!isProjectId(projectId)) notFound()
  try {
    await store.readProject(projectId)
  } catch (err) {
    if (err instanceof Refused && err.status === 404) notFound()
    // A project that can't be read (CR-14) and a storage that can't be reached
    // are different problems from a project that isn't there, and must not
    // read as one: each gets its sentence and one way back. The store already
    // logged the corrupt project's cause; production names no variables (SEC-11).
    let heading: string
    let sentence: string
    if (err instanceof Refused) {
      heading = 'This project can’t be opened.'
      sentence = err.message
    } else if (err instanceof ProviderError && err.kind === 'config') {
      console.error(`[studio] ${err.message}`, err.cause ?? '')
      heading = 'The desk can’t be reached.'
      sentence = configSentence(err)
    } else {
      throw err
    }
    return (
      <div className="studio">
        <div className="studio-opening">
          <div className="not-found">
            <p className="eyebrow">Ink Desk</p>
            <h1>{heading}</h1>
            <p className="notice" role="status">
              {sentence}
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
