'use client'

// The header's account menu (the Better Auth revision): the way into Settings ›
// Account, and Sign out — which ends this session on the server and goes to
// sign-in. Rendered only where sign-in is on (`AuthControls`).
import Link from 'next/link'
import { useState } from 'react'
import { authClient } from '@/lib/auth/client'
import { SIGN_IN_PATH } from '@/lib/auth/config'

export function AccountMenu() {
  const [leaving, setLeaving] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signOut() {
    if (leaving) return
    setLeaving(true)
    setFailed(false)
    const { error } = await authClient.signOut()
    if (error) {
      setLeaving(false)
      setFailed(true)
      return
    }
    window.location.assign(SIGN_IN_PATH)
  }

  return (
    <div className="account-menu">
      <Link className="btn btn-secondary btn-sm" href="/settings/account" title="Your account and Settings">
        Account
      </Link>
      <button type="button" className="btn btn-secondary btn-sm" onClick={signOut} disabled={leaving} title={failed ? 'Signing out didn’t work just now — try again.' : undefined}>
        {leaving ? 'Signing out…' : failed ? 'Try signing out again' : 'Sign out'}
      </button>
    </div>
  )
}
