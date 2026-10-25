// Terms (slice 19): what the studio may be used for, in plain words. Linked
// from sign-in, readable signed out. Honest about what exists
// today (slice 21 added the Report button on a shared page). See
// `devpost/prd.md > Terms and Privacy (v3)`.
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Terms · Ink Desk' }

/** The date of this text; change it with the words. */
const UPDATED = '16 October 2026'

const page: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: 'var(--space-8) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }

export default function TermsPage() {
  const contact = process.env.CONTACT_EMAIL?.trim()
  return (
    <main className="studio">
      <article style={page}>
        <p className="eyebrow legal-crumb" style={{ margin: 0 }}>
          <Link href="/">Ink Desk</Link> · Terms · updated {UPDATED}
        </p>
        <h1 style={{ fontSize: 36 }}>Terms of use</h1>
        <p>
          Ink Desk is a small, independent studio for making manga with AI. These are the rules for using it. By making an account you agree to
          them; if you do not, please do not use the studio.
        </p>

        <h2>What you may not make or upload</h2>
        <ul>
          <li>Anything illegal where you live or where the studio runs — and never any sexual content involving minors.</li>
          <li>The likeness of a real person without their consent.</li>
          <li>Content that harasses, threatens or demeans a person or a group.</li>
          <li>Pictures or text you do not have the right to use.</li>
        </ul>
        <p>The model providers also refuse some requests on their own rules; when they do, the studio tells you so.</p>

        <h2>Your work</h2>
        <p>
          You own what you upload, and you must have the rights to it. What the studio makes for you is yours to use as far as the law and the
          model providers’ own terms allow. Ink Desk keeps your work only to run the studio for you; it does not use it for anything else and
          does not sell it.
        </p>

        <h2>What the studio promises, and what it does not</h2>
        <p>
          Ink Desk is offered as it is. Pictures and words come from AI models and can be wrong, odd or inconsistent. The studio may be
          unavailable, generation may be limited or paused for everyone, and features may change. Keep your own copy of anything that matters to
          you — the PDF and PNG exports are there for that.
        </p>

        <h2>When the rules are broken</h2>
        <p>
          Work that breaks these rules may be removed, and an account that keeps breaking them may be closed. Anyone reading a shared page can press
          its <em>Report</em> button, and no sign-in is needed. For anything else,{' '}
          {contact ? <a href={`mailto:${contact}`}>write to {contact}</a> : 'use the contact address on this page once it is published'}.
        </p>

        <h2>Changes</h2>
        <p>If these terms change, the date at the top changes with them.</p>

        <p>
          See also: <Link href="/privacy">Privacy</Link> — what is stored, where, and who sees it.
        </p>
      </article>
    </main>
  )
}
