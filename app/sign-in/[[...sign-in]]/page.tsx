// Sign-in (slice 19; Better Auth since 2026-10-24): the studio's own card —
// email and password — in the paper frame, with Terms and Privacy one click away. After signing in the
// visitor returns where they were going (`?next=`, a same-site path only),
// else to the desk. Someone already signed in goes straight there. A desk with
// sign-in off has no one to sign in, so it goes straight to the desk.
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { AuthShell } from '@/components/AuthControls'
import { AuthForm } from '@/components/AuthForm'
import { authMode } from '@/lib/auth/config'
import { safeNext } from '@/lib/auth/next'
import { currentUser } from '@/lib/auth/session'

export const metadata: Metadata = { title: 'Sign in · Ink Desk' }

type Search = Promise<Record<string, string | string[] | undefined>>

const one = (value: string | string[] | undefined): string | null => (typeof value === 'string' ? value : null)

export default async function SignInPage({ searchParams }: { searchParams: Search }) {
  await connection() // the mode is the server's, read per request
  if (authMode() !== 'better') redirect('/')
  const params = await searchParams
  const next = one(params.next)
  if (await currentUser()) redirect(safeNext(next))
  return (
    <AuthShell lede="Sign in to your desk.">
      <AuthForm mode="sign-in" next={next} />
    </AuthShell>
  )
}
