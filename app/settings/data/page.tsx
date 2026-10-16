// Data and privacy (v3, slice 21): Export my data, and — fenced off below it —
// Delete my account. A Server Component shell: it asks who is looking, and
// whether this desk has accounts at all (deleting one on a desk with sign-in
// off would wipe the single local desk, so the card says it is unavailable and
// the route refuses too). Both panels are the client's: they start background
// jobs and follow them. See `devpost/prd.md > Settings (v3)`.
import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { pageUser } from '@/components/page-user'
import { SettingsDelete } from '@/components/SettingsDelete'
import { SettingsExport } from '@/components/SettingsExport'
import { SettingsHead } from '@/components/SettingsHead'
import { authMode } from '@/lib/auth/config'

export const metadata: Metadata = { title: 'Data and privacy · Settings · Ink Desk' }

export default async function DataPage() {
  await connection() // per person and per desk: never prerendered
  if (!(await pageUser())) return null // the layout has said so
  return (
    <>
      <SettingsHead
        eyebrow="Data and privacy"
        title="Your data"
        lede={
          <>
            Take a copy of everything you’ve made, or erase it. What is stored, where, and which outside services see it is on the{' '}
            <Link href="/privacy">Privacy</Link> page.
          </>
        }
      />
      <div className="data-stack">
        <SettingsExport />
        <SettingsDelete available={authMode() !== 'off'} />
      </div>
    </>
  )
}
