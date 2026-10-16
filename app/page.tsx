// The desk: the signed-in person's projects, and the door to a new one. A
// Server Component that reads the store on every request — `connection()`
// keeps it from being prerendered with a stale list, since reading the disk is
// not a request-time API on its own. Since slice 19 it asks who is looking
// first (signed out in clerk mode → sign-in) and lists only that person's
// projects; the one-time v1 migration runs only on a desk without accounts.
//
// Slice 21 (Dashboard v3) adds three small reads beside the projects, each
// only DECORATION of the desk — so none of them can take it down:
//   · which projects have an active public share (the "Shared" tag; ids only,
//     the card never shows or manages the link — that lives in the Reader and
//     in Settings),
//   · the person's videos, only while `VIDEO_ENABLED` is true (slice 22 fills
//     the store; the poster has no route yet, so `posterUrl` is null and
//     `progress` is null), newest first,
//   · their saved default style, which New project preselects.
// A read that fails is logged (its message, never a secret) and the desk opens
// as it did before that feature existed.
// See `devpost/prd.md > Dashboard`, `> Dashboard (v3)`, `> Accounts and
// Sign-in (v3)` and `devpost/spec.md > Routing and the Dashboard (v2)`.
import { connection } from 'next/server'
import { AuthControls } from '@/components/AuthControls'
import { Dashboard } from '@/components/Dashboard'
import { DeskNotice } from '@/components/DeskNotice'
import { pageUser, SIGNED_OUT_SENTENCE } from '@/components/page-user'
import { authMode } from '@/lib/auth/config'
import { listProjects, migrateLegacy } from '@/lib/chapter'
import { videoEnabled } from '@/lib/config'
import { configSentence, ProviderError } from '@/lib/errors'
import { readSettings } from '@/lib/settings'
import type { VideoSummary } from '@/lib/share/types'
import { store } from '@/lib/store'

/** A decorative read that fails is a missing tag, not a missing desk. */
async function orElse<T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch (err) {
    console.error(`[desk] ${what} could not be read: ${err instanceof Error ? err.message : 'unknown error'}`)
    return fallback
  }
}

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

  const withVideo = videoEnabled()
  const [shares, videoRecords, settings] = await Promise.all([
    orElse('the active shares', () => store.shares.listActiveOf(userId), []),
    withVideo ? orElse('the videos', () => store.videos.listOf(userId), []) : Promise.resolve([]),
    orElse('the saved defaults', () => readSettings(userId), null),
  ])
  const sharedProjectIds = shares.flatMap((s) => (s.kind === 'manga' && s.projectId ? [s.projectId] : []))
  // Newest first, whatever order the store lists them in. The poster has no
  // route until slice 22, and a running video reports no progress yet.
  const videos: VideoSummary[] | undefined = withVideo
    ? [...videoRecords]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((v) => ({
          id: v.id,
          projectId: v.projectId,
          page: v.page,
          status: v.status,
          seconds: v.seconds,
          createdAt: v.createdAt,
          posterUrl: null,
          progress: null,
        }))
    : undefined

  // The panel quality is the server's setting; the dialog only prices it.
  return (
    <Dashboard
      projects={projects}
      notice={problem}
      panelQuality={process.env.IMAGE_PANEL_QUALITY ?? 'low'}
      account={<AuthControls />}
      sharedProjectIds={sharedProjectIds}
      videos={videos}
      defaultStyle={settings?.defaultStyle ?? null}
    />
  )
}
