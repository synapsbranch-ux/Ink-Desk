// Sign-up (slice 19): Clerk's card, with its bot protection, in the studio's
// paper frame; Terms and Privacy are linked below it so a stranger can read
// what they agree to first. A desk with sign-in off goes straight to the desk.
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { SignUp } from '@clerk/nextjs'
import { AuthShell } from '@/components/AuthControls'
import { authMode, SIGN_IN_PATH } from '@/lib/auth/config'

export const metadata: Metadata = { title: 'Sign up · Ink Desk' }

export default async function SignUpPage() {
  await connection()
  if (authMode() !== 'clerk') redirect('/')
  return (
    <AuthShell lede="Make a desk of your own.">
      <SignUp signInUrl={SIGN_IN_PATH} fallbackRedirectUrl="/" />
    </AuthShell>
  )
}
