// Account (v3, slice 21; the studio's own since the Better Auth revision of
// 2026-10-24): the email and whether it is verified, the account id, the
// password, and the devices signed in with "Sign out of other devices". Read on the server from Better Auth; the two cards that change
// something are `components/SettingsAccount.tsx`. Still the optional catch-all
// `[[...account]]`, so an old link to a sub-path lands here too.
//
// What it says plainly: an email typed at sign-up is not verified, because the
// studio sends no email; only the accounts the learner makes with
// `npm run judge:account` are. Only a verified address counts for the allowlist. The address cannot be changed here (there
// is no email to prove a new one). On a desk with sign-in off or in test mode
// there is no account, and the page says that in a sentence rather than
// showing an empty frame. See `devpost/prd.md > Settings (v3)` and
// `devpost/spec.md > Settings, Usage, Terms and Privacy (v3)`.
import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { connection } from 'next/server'
import { pageUser } from '@/components/page-user'
import { DevicesCard, PasswordCard, type DeviceView } from '@/components/SettingsAccount'
import { SettingsHead } from '@/components/SettingsHead'
import { authMode } from '@/lib/auth/config'

export const metadata: Metadata = { title: 'Account · Settings · Ink Desk' }

/** A browser's plain name from its user agent — enough to tell two devices apart, nothing more. */
function browserOf(agent: string | null | undefined): string {
  const ua = agent ?? ''
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser'
  const system = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return system ? `${browser} on ${system}` : browser
}

const DAY = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })

async function BetterAccount() {
  const { getAuth } = await import('@/lib/auth/server')
  const auth = getAuth()
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session) return null // pageUser has already sent a signed-out visitor to sign-in
  const sessions = await auth.api.listSessions({ headers: requestHeaders })
  const devices: DeviceView[] = sessions
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((s) => ({ id: s.id, current: s.id === session.session.id, lastActive: `${DAY.format(new Date(s.updatedAt))} UTC`, browser: browserOf(s.userAgent) }))
  const { user } = session
  return (
    <>
      <section className="card settings-card">
        <h2 className="settings-card-title">The account</h2>
        <dl className="settings-facts">
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Verified</dt>
          <dd>
            {user.emailVerified
              ? 'Yes — the studio confirmed this address for you.'
              : 'No. The studio sends no email, so an address typed at sign-up is not verified. The account is on the free plan.'}
          </dd>
          <dt>Account id</dt>
          <dd>
            <code>{user.id}</code>
          </dd>
        </dl>
        <p className="settings-note">The email can’t be changed here: there is no email service to prove a new one. To move to another address, export your data and make a new account.</p>
      </section>
      <PasswordCard />
      <DevicesCard devices={devices} />
    </>
  )
}

export default async function AccountPage() {
  await connection() // the mode is the server's, read per request
  if (!(await pageUser())) return null // the layout has said so
  const signedIn = authMode() === 'better'
  return (
    <>
      <SettingsHead
        eyebrow="Account"
        title="Your account"
        lede={
          'Your email, your password and the devices you are signed in on.'
        }
      />
      {signedIn ? (
        <BetterAccount />
      ) : (
        <div className="card settings-card">
          <h2 className="settings-card-title">There is no account on this desk</h2>
          <p className="settings-note">
            {authMode() === 'test'
              ? 'This desk is in test mode: callers name themselves in a header, so there is no email, password or session to manage.'
              : 'This desk is running without sign-in, so everything on it belongs to the one person using it and there is no email, password or session to manage.'}
          </p>
          <div className="settings-actions">
            <Link className="btn btn-secondary" href="/settings/defaults">
              Studio defaults
            </Link>
            <Link className="btn btn-secondary" href="/settings/sharing">
              Shared links
            </Link>
            <Link className="btn btn-secondary" href="/settings/data">
              Your data
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
