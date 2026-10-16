// Account (v3, slice 21): Clerk's own account management — the email, the
// connected Google and GitHub sign-ins, the password and the sessions — in the
// studio's paper frame. `<UserProfile routing="path">` draws its tabs as
// sub-paths of this one (`/settings/account/security`…), which is why this
// route is the optional catch-all `[[...account]]`. The CSP and `ClerkProvider`
// were set up for it in slice 19 (`next.config.ts`, `app/layout.tsx`).
//
// "Sign out of other sessions" is not ours to build: Clerk lists every device
// signed in under its Security tab, with a sign-out beside each, and the page
// says where to find it. On a desk with sign-in off or in test mode there is
// no Clerk and no account, and the page says that in a sentence rather than
// showing an empty frame.
//
// The Clerk panel is styled through `appearance` (colour, type and square
// corners as the provider already sets, plus the card's ink line and hard
// shadow); it brings its own responsive layout. See `devpost/prd.md > Settings
// (v3)` and `devpost/spec.md > Settings, Usage, Terms and Privacy (v3)`.
import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { UserProfile } from '@clerk/nextjs'
import { pageUser } from '@/components/page-user'
import { SettingsHead } from '@/components/SettingsHead'
import { authMode } from '@/lib/auth/config'

export const metadata: Metadata = { title: 'Account · Settings · Ink Desk' }

const PAPER = {
  variables: {
    colorPrimary: '#b5382e',
    colorBackground: '#ffffff',
    colorText: '#201f1d',
    colorTextSecondary: '#605d5d',
    colorDanger: '#a2352b',
    borderRadius: '2px',
  },
  elements: {
    rootBox: { width: '100%', maxWidth: '100%' },
    cardBox: {
      width: '100%',
      maxWidth: '100%',
      borderRadius: '2px',
      border: '1px solid #201f1d',
      boxShadow: '4px 4px 0 rgba(32, 31, 29, 0.1)',
    },
  },
}

export default async function AccountPage() {
  await connection() // the mode is the server's, read per request
  if (!(await pageUser())) return null // the layout has said so
  const clerk = authMode() === 'clerk'
  return (
    <>
      <SettingsHead
        eyebrow="Account"
        title="Your account"
        lede={
          clerk
            ? 'Your email, the Google or GitHub sign-ins connected to it and the devices you are signed in on are kept by the studio’s sign-in service. To sign out of your other devices, open the Security tab below.'
            : 'Your email, your connected sign-ins and the devices you are signed in on.'
        }
      />
      {clerk ? (
        <div className="settings-clerk">
          <UserProfile routing="path" path="/settings/account" appearance={PAPER} />
        </div>
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
