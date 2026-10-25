'use client'

// The sign-in and sign-up form (the Better Auth revision, 2026-10-24; sign-up
// reopened 2026-10-25) — the studio's own card, in the paper frame
// (`AuthShell`): email and password, the one way in. After signing in the
// visitor goes back where they were going (`next`, a same-site path only —
// `lib/auth/next.ts`), else to the desk; after signing up they are signed in
// and land on the desk.
//
// What it says plainly, because nothing is sent by email: there is no "forgot
// password" — the studio has no email service — and an address typed at
// sign-up is not verified. See `devpost/prd.md > Accounts and Sign-in (v3)`.
import Link from 'next/link'
import { useState } from 'react'
import { authClient, authSentence } from '@/lib/auth/client'
import { SIGN_IN_PATH, SIGN_UP_PATH } from '@/lib/auth/config'
import { safeNext } from '@/lib/auth/next'

type Props = {
  mode: 'sign-in' | 'sign-up'
  next?: string | null
}

/** The same rule as the server's (`lib/auth/server.ts`): 10 to 128 characters. */
const PASSWORD_MIN = 10
const PASSWORD_MAX = 128

export function AuthForm({ mode, next = null }: Props) {
  const signUp = mode === 'sign-up'
  // A new account has nothing but its desk yet: sign-up always lands there.
  const back = signUp ? '/' : safeNext(next)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (signUp && password.length < PASSWORD_MIN) {
      setError(`Use a password of at least ${PASSWORD_MIN} characters.`)
      return
    }
    setBusy(true)
    const trimmed = email.trim()
    const { error: failed } = signUp
      ? // Better Auth needs a display name; the studio asks for none, so it is the part of the email before the @.
        await authClient.signUp.email({ email: trimmed, password, name: trimmed.split('@')[0] || 'Storyteller' })
      : await authClient.signIn.email({ email: trimmed, password })
    if (failed) {
      setBusy(false)
      setError(authSentence(failed, signUp ? 'The account couldn’t be made just now. Try again in a moment.' : 'Signing in didn’t work just now. Try again in a moment.'))
      return
    }
    // A full load: the desk is rendered on the server for the person now signed in.
    window.location.assign(back)
  }

  return (
    <div className="card auth-form">
      <h1 className="auth-title">{signUp ? 'Make an account' : 'Sign in'}</h1>
      <form onSubmit={submit}>
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            className="input"
            name="password"
            type="password"
            autoComplete={signUp ? 'new-password' : 'current-password'}
            required
            minLength={signUp ? PASSWORD_MIN : undefined}
            maxLength={PASSWORD_MAX}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {signUp && (
            <span className="auth-hint">
              {PASSWORD_MIN} to {PASSWORD_MAX} characters.
            </span>
          )}
        </label>
        {error && (
          <p className="notice auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
          {busy ? (signUp ? 'Making your desk…' : 'Signing in…') : signUp ? 'Make my account' : 'Sign in'}
        </button>
      </form>
      <p className="auth-switch">
        {signUp ? (
          <>
            Have an account? <Link href={SIGN_IN_PATH}>Sign in</Link>
          </>
        ) : (
          <>
            No account? <Link href={SIGN_UP_PATH}>Sign up</Link>
          </>
        )}
      </p>
      <p className="auth-fine">
        {signUp
          ? 'A new account is on the free plan. The studio sends no email, so the address you type is not verified and there is no password reset — keep your password somewhere safe. By making an account you agree to the Terms.'
          : 'Anyone can make an account with an email and a password. There is no password reset: the studio sends no email, so keep your password safe.'}
      </p>
    </div>
  )
}
