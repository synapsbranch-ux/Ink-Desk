import type { Metadata } from 'next'
import { Comic_Neue, Cormorant_Garamond, Lora } from 'next/font/google'
import { headers } from 'next/headers'
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

// Reading the request makes every page render per request (slice 23): a page
// prerendered at build time would carry no nonce, and the CSP would refuse its
// scripts. Next puts the nonce on its own scripts by itself. Sign-in needs no
// provider here: Better Auth's pages and forms are the studio's own.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers()
  return (
    <html lang="en" className={`${heading.variable} ${body.variable} ${lettering.variable}`}>
      <body>{children}</body>
    </html>
  )
}
