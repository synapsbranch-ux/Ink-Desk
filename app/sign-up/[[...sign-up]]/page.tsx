// Sign-up (slice 19; Better Auth since 2026-10-24): the studio's own card in
// the paper frame; Terms and Privacy are linked below it so a stranger can read
// what they agree to first. Accounts made here are limited per client address
// (the `signup` window). A desk with sign-in off goes straight to the desk.
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { AuthShell } from '@/components/AuthControls'
import { AuthForm } from '@/components/AuthForm'
import { authMode } from '@/lib/auth/config'
import { safeNext } from '@/lib/auth/next'
import { currentUser } from '@/lib/auth/session'

export const metadata: Metadata = { title: 'Sign up · Ink Desk' }

type Search = Promise<Record<string, string | string[] | undefined>>

const one = (value: string | string[] | undefined): string | null => (typeof value === 'string' ? value : null)

export default async function SignUpPage({ searchParams }: { searchParams: Search }) {
  await connection()
  if (authMode() !== 'better') redirect('/')
  const params = await searchParams
  const next = one(params.next)
  if (await currentUser()) redirect(safeNext(next))
  return (
    <AuthShell lede="Make a desk of your own.">
      <AuthForm mode="sign-up" next={next} />
    </AuthShell>
  )
}
