// The studio for one project. A Server Component: it asks who is looking
// (signed out in clerk mode → sign-in, slice 19), checks the project exists
// and is theirs — someone else's project is the same not-found page as a
// missing one, so an id cannot be probed — and hands the id to the client
// studio, which does everything else through `/api/projects/<id>`. `params`
// is a Promise in this Next version — see `devpost/spec.md > Routing and the
// Dashboard (v2)` and `> Data Access and Ownership (v3)`.
import { notFound } from 'next/navigation'
import { AuthControls } from '@/components/AuthControls'
import { DeskNotice } from '@/components/DeskNotice'
import { pageUser, SIGNED_OUT_SENTENCE } from '@/components/page-user'
import { Studio } from '@/components/Studio'
import { ownedProject } from '@/lib/auth/access'
import { configSentence, ProviderError, Refused } from '@/lib/errors'
import { isProjectId } from '@/lib/store/local'

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const userId = await pageUser()
  if (!userId) return <DeskNotice heading="Sign in to use the studio." sentence={SIGNED_OUT_SENTENCE} back={false} />
  if (!isProjectId(projectId)) notFound()
  try {
    await ownedProject(userId, projectId)
  } catch (err) {
    if (err instanceof Refused && err.status === 404) notFound()
    // A project that can't be read (CR-14) and a storage that can't be reached
    // are different problems from a project that isn't there, and must not
    // read as one: each gets its sentence and one way back. The store already
    // logged the corrupt project's cause; production names no variables (SEC-11).
    if (err instanceof Refused) return <DeskNotice heading="This project can’t be opened." sentence={err.message} />
    if (err instanceof ProviderError && err.kind === 'config') {
      console.error(`[studio] ${err.message}`, err.cause ?? '')
      return <DeskNotice heading="The desk can’t be reached." sentence={configSentence(err)} />
    }
    throw err
  }
  return <Studio projectId={projectId} account={<AuthControls />} />
}
