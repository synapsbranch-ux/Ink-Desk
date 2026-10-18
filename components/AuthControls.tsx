// The account menu for a header (slice 19): Clerk's user button — profile,
// sign out (back to sign-in, set on the provider in `app/layout.tsx`) — when
// someone is signed in through Clerk, and nothing on a desk with sign-in off
// or in test mode, where there is no Clerk to ask.
//
// A Server Component (it reads the mode on the server and `<Show>` asks
// Clerk's `auth()`), so a client component cannot import it. Render it in the
// page and hand it down as a prop:
//
//   <Dashboard account={<AuthControls />} … />   // then {account} in the header
//
// `AuthShell`, below, is the frame of the sign-in and sign-up pages.
import Image from 'next/image'
import Link from 'next/link'
import { Show, UserButton } from '@clerk/nextjs'
import { providerKey } from '@/lib/auth/config'

export function AuthControls() {
  // Only where the layout set up Clerk's provider: the same tolerant read, so it never throws either.
  if (!providerKey()) return null
  return (
    <Show when="signed-in">
      {/* "Manage account" goes to the Settings account page (not Clerk's own modal), where the rest of Settings is one click away. */}
      <UserButton userProfileUrl="/settings/account" />
    </Show>
  )
}

/**
 * The paper frame around Clerk's sign-in and sign-up cards: the brand, one
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
