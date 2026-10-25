'use client'

// Settings › Account, the two things a person can change here (the Better Auth
// revision, 2026-10-24): their password, and the devices they are signed in
// on, with "Sign out of other devices". What the account IS (the email,
// whether it is verified, its id) is drawn by the page on the server; this is
// the part that talks to `/api/auth`.
import { useState } from 'react'
import { authClient, authSentence } from '@/lib/auth/client'

export type DeviceView = { id: string; current: boolean; lastActive: string; browser: string }

const PASSWORD_MIN = 10

export function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [revokeOthers, setRevokeOthers] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (next.length < PASSWORD_MIN) {
      setStatus({ text: `Use a new password of at least ${PASSWORD_MIN} characters.`, error: true })
      return
    }
    setBusy(true)
    setStatus(null)
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: revokeOthers })
    setBusy(false)
    if (error) {
      setStatus({ text: authSentence(error, 'The password couldn’t be changed just now. Nothing was changed; try again.'), error: true })
      return
    }
    setCurrent('')
    setNext('')
    setStatus({ text: revokeOthers ? 'Password changed, and your other devices are signed out.' : 'Password changed.', error: false })
  }

  return (
    <section className="card settings-card">
      <h2 className="settings-card-title">Password</h2>
      <form className="settings-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Current password</span>
          <input className="input" type="password" autoComplete="current-password" required maxLength={128} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">New password</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="settings-check">
          <input type="checkbox" checked={revokeOthers} onChange={(e) => setRevokeOthers(e.target.checked)} />
          <span>Sign out my other devices too</span>
        </label>
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </div>
        <p className={`settings-status${status?.error ? ' is-error' : ''}`} role="status">
          {status?.text}
        </p>
      </form>
    </section>
  )
}

export function DevicesCard({ devices }: { devices: DeviceView[] }) {
  const [list, setList] = useState(devices)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)
  const others = list.filter((d) => !d.current).length

  async function signOutOthers() {
    if (busy) return
    setBusy(true)
    setStatus(null)
    const { error } = await authClient.revokeOtherSessions()
    setBusy(false)
    if (error) {
      setStatus({ text: authSentence(error, 'Your other devices couldn’t be signed out just now. Try again in a moment.'), error: true })
      return
    }
    setList((current) => current.filter((d) => d.current))
    setStatus({ text: 'Your other devices are signed out.', error: false })
  }

  return (
    <section className="card settings-card">
      <h2 className="settings-card-title">Where you are signed in</h2>
      <ul className="settings-devices">
        {list.map((device) => (
          <li key={device.id}>
            <span className="settings-device-name">{device.browser}</span>
            <span className="settings-device-meta">{device.current ? 'This device' : `Last active ${device.lastActive}`}</span>
          </li>
        ))}
      </ul>
      <div className="settings-actions">
        <button type="button" className="btn btn-secondary" disabled={busy || others === 0} onClick={signOutOthers}>
          {busy ? 'Signing out…' : 'Sign out of other devices'}
        </button>
      </div>
      <p className={`settings-status${status?.error ? ' is-error' : ''}`} role="status">
        {status?.text ?? (others === 0 ? 'You are signed in on this device only.' : '')}
      </p>
    </section>
  )
}
