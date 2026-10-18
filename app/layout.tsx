import type { Metadata } from 'next'
import { Comic_Neue, Cormorant_Garamond, Lora } from 'next/font/google'
import { headers } from 'next/headers'
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
 *
 * Slice 23: `nonce` is the page's CSP nonce from `proxy.ts`, for Clerk's
 * `<script>` tag — the policy trusts no script host, only the nonce.
 */
function withAuth(children: React.ReactNode, nonce: string | undefined): React.ReactNode {
  const publishableKey = providerKey()
  if (!publishableKey) return children
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      nonce={nonce}
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

// Reading the request makes every page render per request (slice 23): a page
// prerendered at build time would carry no nonce, and the CSP would refuse its
// scripts. Next puts the nonce on its own scripts by itself.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <html lang="en" className={`${heading.variable} ${body.variable} ${lettering.variable}`}>
      <body>{withAuth(children, nonce)}</body>
    </html>
  )
}
