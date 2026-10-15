// Usage (v3, slice 20): today's allowance and what it has cost. A Server
// Component shell — it asks who is looking (signed out in clerk mode →
// sign-in, test mode → the sentence) and hands the rest to the client panel,
// which shows the numbers the server enforces (`GET /api/usage`). It stands
// alone on purpose: slice 21 puts Settings' own layout and navigation around
// it, so this page carries no settings links — only its way back to the desk.
// See `devpost/prd.md > Limits and Usage (v3)` and `> Settings (v3)`.
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { connection } from 'next/server'
import { AuthControls } from '@/components/AuthControls'
import { DeskNotice } from '@/components/DeskNotice'
import { pageUser, SIGNED_OUT_SENTENCE } from '@/components/page-user'
import { UsagePanel } from '@/components/UsagePanel'

export const metadata: Metadata = { title: 'Usage · Ink Desk' }

export default async function UsagePage() {
  await connection() // who is looking is a request-time fact: never prerendered
  const userId = await pageUser()
  if (!userId) return <DeskNotice heading="Sign in to see your usage." sentence={SIGNED_OUT_SENTENCE} back={false} />
  return (
    <div className="studio">
      <header className="studio-header">
        <Link className="brand" href="/" title="Back to the desk — every project">
          <Image className="brand-mark" src="/brand/inkdesk-mark.svg" alt="" width={30} height={30} priority />
          <span className="brand-name">Ink Desk</span>
        </Link>
        <div className="header-spacer" />
        <div className="header-meta">
          <Link className="btn btn-secondary" href="/">
            ← Back to the desk
          </Link>
          <AuthControls />
        </div>
      </header>
      <main className="station">
        <div className="station-inner">
          <div className="station-head">
            <div className="eyebrow">Usage</div>
            <h1 className="station-title">What you’ve used today</h1>
            <p className="station-lede">
              A small allowance of pictures, projects, video and voice resets every day. Everything here is counted
              by the studio itself, so the meter and the buttons always agree with it.
            </p>
          </div>
          <UsagePanel />
        </div>
      </main>
    </div>
  )
}
