// Privacy (slice 19): what the studio stores, where, which outside services
// see what, and how to have it deleted — plainly, and only what is true of the
// build as it stands. Linked from sign-in and sign-up, readable signed out.
// See `devpost/prd.md > Terms and Privacy (v3)`.
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Privacy · Ink Desk' }

/** The date of this text; change it with the words. */
const UPDATED = '14 October 2026'

const page: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: 'var(--space-8) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }

export default function PrivacyPage() {
  const contact = process.env.CONTACT_EMAIL?.trim()
  const write = contact ? <a href={`mailto:${contact}`}>write to {contact}</a> : 'use the contact address on this page once it is published'
  return (
    <main className="studio">
      <article style={page}>
        <p className="eyebrow" style={{ margin: 0 }}>
          <Link href="/">Ink Desk</Link> · Privacy · updated {UPDATED}
        </p>
        <h1 style={{ fontSize: 36 }}>Privacy</h1>
        <p>What Ink Desk keeps about you, where it is kept, and who else sees it.</p>

        <h2>What is stored</h2>
        <ul>
          <li>
            <strong>Your projects</strong> — titles, pitches and scenarios, the story, the cast and their descriptions, the plan, page scripts and
            speech bubbles, and what each generation cost.
          </li>
          <li>
            <strong>Pictures</strong> — every image drawn for you, and the pictures you upload. Uploads are re-encoded when they arrive, which removes
            their hidden metadata (camera details, GPS location).
          </li>
          <li>
            <strong>Generation records</strong> — what was asked to be drawn, when, whether it worked, and its cost.
          </li>
          <li>
            <strong>Your account</strong> — Clerk keeps your sign-in details: your email address, and your name and profile picture if you sign in
            with Google or GitHub. Ink Desk keeps your Clerk user id, your email address and the date the account was made.
          </li>
        </ul>
        <p>Your work is visible only to you. Nothing is shown to anyone else unless you share it yourself (sharing arrives in a later version).</p>

        <h2>Which services see what</h2>
        <ul>
          <li>
            <strong>Clerk</strong> runs sign-in: your email address and sign-in details, and the device and network information it uses to keep
            sessions safe and stop automated sign-ups (with Cloudflare’s Turnstile check).
          </li>
          <li>
            <strong>Anthropic</strong> (Claude) writes the story text, and <strong>OpenRouter</strong> passes requests to the image model and to a
            backup text model: they receive the words and the reference pictures sent with each generation, not your email address. Their own
            privacy policies apply to what they receive.
          </li>
          <li>
            <strong>MongoDB</strong> holds your projects and records, and <strong>Cloudflare R2</strong> holds the pictures. Neither is public; a
            picture reaches your browser only through the studio, after it has checked that it is yours.
          </li>
          <li>
            <strong>Railway</strong> hosts the studio and keeps its logs, which record requests and errors. An error shown to you carries a short
            reference instead of details.
          </li>
        </ul>
        <p>No advertising, no analytics trackers, and nothing is sold. The only cookies are Clerk’s, which keep you signed in.</p>

        <h2>Deleting your data</h2>
        <p>
          A <em>Delete account</em> button in Settings is coming in the next version; it will remove your projects, pictures, uploads, records and
          your Clerk account. Until it arrives, {write} from the email address on your account, and everything will be deleted by hand.
        </p>

        <h2>Changes</h2>
        <p>If this page changes, the date at the top changes with it.</p>

        <p>
          See also: <Link href="/terms">Terms</Link> — what the studio may be used for.
        </p>
      </article>
    </main>
  )
}
