'use client'

// The sign-in form (the Better Auth revision, 2026-10-24) — the studio's own
// card, in the paper frame (`AuthShell`): email and password, the one way in.
// There is no sign-up: the accounts are the ones the learner makes (their own,
// and the judges'). After signing in the visitor goes back where they were going
// (`next`, a same-site path only — `lib/auth/next.ts`), else to the desk.
// See `devpost/prd.md > Accounts and Sign-in (v3)`.
import { useState } from 'react'
import { authClient, authSentence } from '@/lib/auth/client'
import { safeNext } from '@/lib/auth/next'

export function AuthForm({ next }: { next: string | null }) {
  const back = safeNext(next)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    const { error: failed } = await authClient.signIn.email({ email: email.trim(), password })
    if (failed) {
      setBusy(false)
      setError(authSentence(failed, 'Signing in didn’t work just now. Try again in a moment.'))
      return
    }
    // A full load: the desk is rendered on the server for the person now signed in.
    window.location.assign(back)
  }

  return (
    <div className="card auth-form">
      <h1 className="auth-title">Sign in</h1>
      <form onSubmit={submit}>
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input className="input" name="password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="notice auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="auth-fine">There is no sign-up: accounts are given by the studio. There is no password reset either — the studio sends no email.</p>
    </div>
  )
}
