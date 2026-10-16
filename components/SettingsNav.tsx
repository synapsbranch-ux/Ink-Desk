'use client'

// The Settings sections (v3, slice 21): Account · Defaults · Sharing · Data and
// privacy · Usage, as links with `aria-current="page"` on the one you are in.
// It is a client component only because the layout above it does not re-render
// when you move between sections, so the current one has to come from the
// path. On a phone the row wraps onto a second line rather than scrolling, so
// every section is always in view and every link is at least 44px tall
// (`app/settings/settings.css`).
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const SETTINGS_SECTIONS = [
  { href: '/settings/account', label: 'Account' },
  { href: '/settings/defaults', label: 'Defaults' },
  { href: '/settings/sharing', label: 'Sharing' },
  { href: '/settings/data', label: 'Data and privacy' },
  { href: '/settings/usage', label: 'Usage' },
] as const

export function SettingsNav() {
  const pathname = usePathname()
  return (
    <nav className="settings-nav" aria-label="Settings">
      <ul>
        {SETTINGS_SECTIONS.map(({ href, label }) => {
          const here = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={href}>
              <Link href={href} aria-current={here ? 'page' : undefined}>
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
