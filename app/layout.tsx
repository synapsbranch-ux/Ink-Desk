import type { Metadata } from 'next'
import { Comic_Neue, Cormorant_Garamond, Lora } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { providerKey, SIGN_IN_PATH, SIGN_UP_PATH } from '@/lib/auth/config'
import './globals.css'
// Slice 23: the responsive rules, one file per area, after globals.css so they win.
import './responsive/shell.css'
import './responsive/page.css'
import './responsive/planning.css'
import './responsive/reader.css'
import './responsive/surfaces.css'

// The three faces from `devpost/spec.md > Look and Feel`, exposed as CSS
// variables so globals.css can use them without knowing the generated names.
const heading = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-heading',
  display: 'swap',
})

const body = Lora({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-body',
  display: 'swap',
})

// Dialogue lettering only.
const lettering = Comic_Neue({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-letter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Ink Desk',
  description:
    'An AI manga creator studio: pitch a story, lock your cast, and watch a four-panel page ink in with your characters drawn consistently.',
}

/**
 * Clerk's provider, in clerk mode only (slice 19): a desk with sign-in off, or
 * in test mode, never loads Clerk. The publishable key is passed explicitly,
 * because the learner's host names it CLERK_PUBLISHABLE_KEY and the SDK reads
 * only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. A clerk mode with no key, or a mode
 * production refuses, renders the page bare and never throws — `next build`
 * prerenders this with whatever a development .env says, and the boot refuses
 * such a server when it starts.
 */
function withAuth(children: React.ReactNode): React.ReactNode {
  const publishableKey = providerKey()
  if (!publishableKey) return children
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl={SIGN_IN_PATH}
      signUpUrl={SIGN_UP_PATH}
      afterSignOutUrl={SIGN_IN_PATH}
      // The paper look: the one brand red, the body face, square corners.
      appearance={{ variables: { colorPrimary: '#b5382e', fontFamily: 'var(--font-body), Georgia, serif', borderRadius: '2px' } }}
    >
      {children}
    </ClerkProvider>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable} ${lettering.variable}`}>
      <body>{withAuth(children)}</body>
    </html>
  )
}
