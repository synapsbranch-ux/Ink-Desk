// Usage (v3, slice 20; inside Settings since slice 21): today's allowance and
// what it has cost. A Server Component shell — it asks who is looking (signed
// out with sign-in on → sign-in, test mode → the sentence) and hands the rest to
// the client panel, which shows the numbers the server enforces
// (`GET /api/usage`). The frame — header, nav, Terms and Privacy — is
// `app/settings/layout.tsx`'s. See `devpost/prd.md > Limits and Usage (v3)` and
// `> Settings (v3)`.
import type { Metadata } from 'next'
import { connection } from 'next/server'
import { pageUser } from '@/components/page-user'
import { SettingsHead } from '@/components/SettingsHead'
import { UsagePanel } from '@/components/UsagePanel'

export const metadata: Metadata = { title: 'Usage · Settings · Ink Desk' }

export default async function UsagePage() {
  await connection() // who is looking is a request-time fact: never prerendered
  if (!(await pageUser())) return null // the layout has said so
  return (
    <>
      <SettingsHead
        eyebrow="Usage"
        title="What you’ve used today"
        lede="A small allowance of pictures, projects, video and voice resets every day. Everything here is counted by the studio itself, so the meter and the buttons always agree with it."
      />
      <UsagePanel />
    </>
  )
}
