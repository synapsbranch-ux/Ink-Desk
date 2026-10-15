// Sign-in (slice 19): Clerk's card — email, Google, GitHub, as the Clerk
// dashboard enables them — in the studio's paper frame, with Terms and
// Privacy one click away. After signing in Clerk returns the visitor where
// they were going (the proxy passed it along), else to the desk. A desk with
// sign-in off has no one to sign in, so it goes straight to the desk.
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { SignIn } from '@clerk/nextjs'
import { AuthShell } from '@/components/AuthControls'
import { authMode, SIGN_UP_PATH } from '@/lib/auth/config'

export const metadata: Metadata = { title: 'Sign in · Ink Desk' }

export default async function SignInPage() {
  await connection() // the mode is the server's, read per request
  if (authMode() !== 'clerk') redirect('/')
  return (
    <AuthShell lede="Sign in to your desk.">
      <SignIn signUpUrl={SIGN_UP_PATH} fallbackRedirectUrl="/" />
    </AuthShell>
  )
}
