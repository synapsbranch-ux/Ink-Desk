// Sharing (v3, slice 21): every link this person has published, with Copy link,
// Update share and Unpublish. The list is the client's (`GET /api/shares`), so
// an unpublish from here or from the Reader station is never stale on return;
// this shell only asks who is looking. See `devpost/prd.md > Settings (v3)`.
import type { Metadata } from 'next'
import { connection } from 'next/server'
import { pageUser } from '@/components/page-user'
import { SettingsHead } from '@/components/SettingsHead'
import { SettingsSharing } from '@/components/SettingsSharing'

export const metadata: Metadata = { title: 'Sharing · Settings · Ink Desk' }

export default async function SharingPage() {
  await connection() // per person: never prerendered
  if (!(await pageUser())) return null // the layout has said so
  return (
    <>
      <SettingsHead
        eyebrow="Sharing"
        title="What you’ve shared"
        lede="Each link is a copy of a chapter as it was when you shared it. Later changes don’t reach it until you update it, and unpublishing ends it for good."
      />
      <SettingsSharing />
    </>
  )
}
