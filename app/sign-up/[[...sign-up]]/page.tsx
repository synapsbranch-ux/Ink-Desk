// Sign-up (slice 19; Better Auth since 2026-10-24; reopened 2026-10-25, the
// learner's decision: the judges must be able to make their own account): the
// studio's own card in the paper frame; Terms and Privacy are linked below it
// so a stranger can read what they agree to first. Accounts made here are
// limited per client address (the `signup` window), unverified, and on the
// free plan. After signing up the person is signed in and lands on the desk;
// someone already signed in goes straight there. A desk with sign-in off has
// no accounts to make, so it goes straight to the desk.
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { AuthShell } from '@/components/AuthControls'
import { AuthForm } from '@/components/AuthForm'
import { authMode } from '@/lib/auth/config'
import { currentUser } from '@/lib/auth/session'

export const metadata: Metadata = { title: 'Sign up · Ink Desk' }

export default async function SignUpPage() {
  await connection() // the mode is the server's, read per request
  if (authMode() !== 'better') redirect('/')
  if (await currentUser()) redirect('/')
  return (
    <AuthShell lede="Make a desk of your own.">
      <AuthForm mode="sign-up" />
    </AuthShell>
  )
}
