// Settings (v3, slice 21): one frame for Account, Defaults, Sharing, Data and
// privacy and Usage — the studio's header (the brand, a way back to the desk,
// the account menu), the section nav, and Terms and Privacy at the foot, where
// the PRD wants them one click from Settings. Each page supplies its own head
// and body. See `devpost/prd.md > Settings (v3)`.
//
// Who is looking is a request-time fact: signed out in clerk mode goes to
// sign-in and returns here; in test mode the page says there is nobody. The
// pages and the routes behind them check again — a layout is not where a
// door is locked (`node_modules/next/dist/docs/01-app/02-guides/
// authentication.md`) — and every route they call asks `requireUser`.
import Image from 'next/image'
import Link from 'next/link'
import { connection } from 'next/server'
import { AuthControls } from '@/components/AuthControls'
import { DeskNotice } from '@/components/DeskNotice'
import { pageUser, pageWindow, SIGNED_OUT_SENTENCE, SLOW_DOWN_HEADING } from '@/components/page-user'
import { SettingsNav } from '@/components/SettingsNav'
import './settings.css'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await connection()
  const userId = await pageUser()
  if (!userId) return <DeskNotice heading="Sign in to open Settings." sentence={SIGNED_OUT_SENTENCE} back={false} />
  // The pages under this frame read the store: the same per-person window an API read takes (after-audit #13).
  const slow = await pageWindow(userId)
  if (slow) return <DeskNotice heading={SLOW_DOWN_HEADING} sentence={slow.message} back={false} />
  return (
    <div className="studio settings">
      <header className="studio-header">
        <Link className="brand" href="/" title="Back to the desk — every project">
          <Image className="brand-mark" src="/brand/inkdesk-mark.svg" alt="" width={30} height={30} priority />
          <span className="brand-name">Ink Desk</span>
        </Link>
        <div className="header-divider" />
        <div className="chapter-title">
          <span className="eyebrow eyebrow-sm">The desk</span>
          <span className="chapter-title-text">Settings</span>
        </div>
        <div className="header-spacer" />
        <div className="header-meta">
          <Link className="btn btn-secondary" href="/">
            ← Back to the desk
          </Link>
          <AuthControls />
        </div>
      </header>
      <SettingsNav />
      <main className="station">
        <div className="station-inner">{children}</div>
      </main>
      <footer className="settings-foot">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
      </footer>
    </div>
  )
}
