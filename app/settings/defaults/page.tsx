// Studio defaults (v3, slice 21): the style New project starts on and the way
// the reader opens a manga. A Server Component shell that reads the saved
// values for whoever is looking and hands them to the form, so the page never
// flashes the wrong choice. Saving goes through `PUT /api/settings/defaults`.
// See `devpost/prd.md > Settings (v3)` and `lib/settings.ts`.
import type { Metadata } from 'next'
import { connection } from 'next/server'
import { pageUser } from '@/components/page-user'
import { SettingsDefaults } from '@/components/SettingsDefaults'
import { SettingsHead } from '@/components/SettingsHead'
import { readSettings } from '@/lib/settings'

export const metadata: Metadata = { title: 'Defaults · Settings · Ink Desk' }

export default async function DefaultsPage() {
  await connection() // per person: never prerendered
  const userId = await pageUser()
  if (!userId) return null // the layout has said so
  const settings = await readSettings(userId)
  return (
    <>
      <SettingsHead
        eyebrow="Defaults"
        title="How you like to start"
        lede="Two choices the studio remembers for you. They only set where things begin: every project still asks for its own title, and a project’s style is locked once it is made."
      />
      <SettingsDefaults initial={settings} />
    </>
  )
}
