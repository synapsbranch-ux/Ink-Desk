// The reports queue (v3, slice 21): what visitors have reported about shared
// pages, newest first, for the studio's admins (ADMIN_EMAILS) and nobody else.
//
// The first thing this page does is ask `requireAdminPage`, and for anyone who
// is not an admin — signed out, signed in, deleted — that is `notFound()`: the
// studio's own "no such page", the very page an unknown address gets, with the
// same 404 status. Nothing above that line renders, nothing is read from a store,
// and no part of the answer differs, so a stranger cannot learn that this page
// exists. (The proxy has already sent a signed-out visitor to sign-in in clerk
// mode, as for every page; the check here is the page's own, because a proxy
// redirect is only optimistic.) On a desk with sign-in off the single `local`
// owner is the admin, so the learner can see this while building.
//
// Nothing else is imported up here that belongs to the admin: the screen, its
// stylesheet and its client component load lazily AFTER the gate, and the title
// is set only for an admin (`generateMetadata`), so the page a refused visitor
// gets carries no trace of them (no stylesheet hint, no title). The list itself
// is `ReportsQueue`, which talks to `POST /api/admin/reports/[id]`. See
// `devpost/spec.md > Reports (v3)`.
import type { Metadata } from 'next'
import { connection } from 'next/server'
import { isAdmin, requireAdminPage } from '@/lib/auth/admin'
import { currentUser } from '@/lib/auth/session'

/** A title and a robots line for an admin; for anyone else the page's metadata is the studio's default, as for any unknown page. */
export async function generateMetadata(): Promise<Metadata> {
  await connection()
  const userId = await currentUser()
  if (!userId || !(await isAdmin(userId))) return {}
  return { title: 'Reports · Ink Desk', robots: { index: false, follow: false } }
}

export default async function AdminReportsPage() {
  await connection() // who is looking is a request-time fact: never prerendered
  await requireAdminPage()
  const { ReportsScreen } = await import('@/components/admin/ReportsScreen')
  return <ReportsScreen />
}
