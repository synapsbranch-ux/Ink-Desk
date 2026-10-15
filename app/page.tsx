// The desk: the signed-in person's projects, and the door to a new one. A
// Server Component that reads the store on every request — `connection()`
// keeps it from being prerendered with a stale list, since reading the disk is
// not a request-time API on its own. Since slice 19 it asks who is looking
// first (signed out in clerk mode → sign-in) and lists only that person's
// projects; the one-time v1 migration runs only on a desk without accounts.
// See `devpost/prd.md > Dashboard`, `> Accounts and Sign-in (v3)` and
// `devpost/spec.md > Routing and the Dashboard (v2)`.
import { connection } from 'next/server'
import { AuthControls } from '@/components/AuthControls'
import { Dashboard } from '@/components/Dashboard'
import { DeskNotice } from '@/components/DeskNotice'
import { pageUser, SIGNED_OUT_SENTENCE } from '@/components/page-user'
import { authMode } from '@/lib/auth/config'
import { listProjects, migrateLegacy } from '@/lib/chapter'
import { configSentence, ProviderError } from '@/lib/errors'

export default async function DeskPage() {
  await connection()
  const userId = await pageUser()
  if (!userId) return <DeskNotice heading="Sign in to use the studio." sentence={SIGNED_OUT_SENTENCE} back={false} />
  let problem: string | null = null
  let projects: Awaited<ReturnType<typeof listProjects>>
  try {
    // The v1 desk belonged to its one person; with accounts on, nobody inherits it by opening the desk.
    if (authMode() === 'off') problem = (await migrateLegacy()).problem
    projects = await listProjects(userId)
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
  return (
    <Dashboard
      projects={projects}
      notice={problem}
      panelQuality={process.env.IMAGE_PANEL_QUALITY ?? 'low'}
      account={<AuthControls />}
    />
  )
}
