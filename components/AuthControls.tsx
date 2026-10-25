// The account menu for a header (slice 19; Better Auth since 2026-10-24): a
// way into Settings › Account and Sign out when sign-in is on, and nothing on a
// desk with sign-in off or in test mode, where there is no account.
//
// A Server Component (it reads the mode on the server), so a client component
// cannot import it. Render it in the page and hand it down as a prop:
//
//   <Dashboard account={<AuthControls />} … />   // then {account} in the header
//
// `AuthShell`, below, is the frame of the sign-in page.
import Image from 'next/image'
import Link from 'next/link'
import { AccountMenu } from '@/components/AccountMenu'
import { signInOn } from '@/lib/auth/config'

export function AuthControls() {
  // The tolerant read: it never throws, whatever the build's environment says.
  if (!signInOn()) return null
  return <AccountMenu />
}

/**
 * The paper frame around the sign-in card: the brand, one
 * line of welcome, the card centred, and the two pages a stranger should be
 * able to read before signing up. Its styles are in
 * `app/responsive/surfaces.css`: on a phone the card never pushes the page
 * sideways, and Terms and Privacy are 44px targets on touch.
 */
export function AuthShell({ lede, children }: { lede: string; children: React.ReactNode }) {
  return (
    <main className="studio auth-shell">
      <div className="auth-head">
        <div className="brand">
          <Image className="brand-mark" src="/brand/inkdesk-mark.svg" alt="" width={30} height={30} priority />
          <span className="brand-name">Ink Desk</span>
        </div>
        <p className="auth-lede">{lede}</p>
      </div>
      <div className="auth-card">{children}</div>
      <p className="eyebrow auth-links">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
      </p>
    </main>
  )
}
