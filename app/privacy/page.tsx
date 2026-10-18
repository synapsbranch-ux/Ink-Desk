// Privacy (slice 19, updated in slice 21 for sharing, reports, export and deletion, and in slice 23 for the trailer's video, voice and music models): what the studio stores, where, which outside services
// see what, and how to have it deleted — plainly, and only what is true of the
// build as it stands. Linked from sign-in and sign-up, readable signed out.
// See `devpost/prd.md > Terms and Privacy (v3)`.
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Privacy · Ink Desk' }

/** The date of this text; change it with the words. */
const UPDATED = '18 October 2026'

const page: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: 'var(--space-8) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }

export default function PrivacyPage() {
  const contact = process.env.CONTACT_EMAIL?.trim()
  const write = contact ? <a href={`mailto:${contact}`}>write to {contact}</a> : 'use the contact address on this page once it is published'
  return (
    <main className="studio">
      <article style={page}>
        <p className="eyebrow legal-crumb" style={{ margin: 0 }}>
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
            <strong>Export files</strong> — if you ask for a copy of your data in Settings, one zip is kept in the outputs bucket (a private part of
            Cloudflare R2) for you to download. Only your latest export is kept; a new one replaces the last.
          </li>
          <li>
            <strong>Generation records</strong> — what was asked to be drawn, when, whether it worked, and its cost.
          </li>
          <li>
            <strong>Your account</strong> — Clerk keeps your sign-in details: your email address, and your name and profile picture if you sign in
            with Google or GitHub. Ink Desk keeps your Clerk user id, your email address and the date the account was made.
          </li>
        </ul>
        <p>
          Your work is visible only to you, unless you share it yourself. When you choose <em>Share publicly</em> on a project, the studio makes a
          link of the form <code>/s/…</code>. <strong>Anyone who has that link can read the page without signing in</strong>: the title, the cover,
          the finished pages and their speech bubbles, and the names of the characters who speak. It is a copy taken at that moment, so later edits
          stay private until you press <em>Update share</em>. It does not carry your email address, your name, your scenario or your notes. Search
          engines are asked not to list it, but anyone you give the link to can pass it on. <em>Unpublish</em> turns the link off at once.
        </p>
        <p>
          Anyone reading a shared page can press <em>Report</em>. A report keeps the reason, the short note they may add, the time, and a hashed
          form of their network address (a one-way scrambling, not the address itself). It shows the page’s title to the person reading reports, never
          your account.
        </p>

        <h2>Which services see what</h2>
        <ul>
          <li>
            <strong>Clerk</strong> runs sign-in: your email address and sign-in details, and the device and network information it uses to keep
            sessions safe and stop automated sign-ups (with Cloudflare’s Turnstile check).
          </li>
          <li>
            <strong>Anthropic</strong> (Claude) writes the story text, and <strong>OpenRouter</strong> passes requests to the image model, to a
            backup text model and, when you animate a page, to the video, voice and music models: they receive the words, the reference pictures,
            the panels and character sheets, and the lines to be spoken that are sent with each generation, not your email address. Their own
            privacy policies apply to what they receive.
          </li>
          <li>
            <strong>MongoDB</strong> holds your projects and records, and <strong>Cloudflare R2</strong> holds the pictures and videos. Neither is public; a
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
          In <Link href="/settings/data">Settings › Data and privacy</Link>, <em>Export my data</em> gives you one zip with your account details, your
          settings, your shared links and every project with its pictures. <em>Delete my account</em> removes your projects, pictures, uploads, videos,
          shared links (they stop working at once), the reports about them, export files, usage counters and settings, and then your Clerk account.
          It cannot be undone. A few things stay: a minimal record of the account (your Clerk user id and the dates it was created and deleted, no email),
          kept so the account cannot be brought back by mistake; the studio’s own anonymous spend totals, which hold no names and none of your work;
          server logs and backups, until they expire; and, rarely, a picture that no record of yours names, which cannot be traced to you to be removed.
          If you cannot sign in,{' '}
          {write} from the email address on your account and it will be done for you.
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
