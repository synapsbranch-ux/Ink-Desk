'use client'

import Link from 'next/link'

// The last line under every page: anything a page didn't turn into its own
// sentence lands here instead of Next's default screen (CR-14). The error's
// words are never shown — in production they are a digest anyway — so the
// browser gets one calm sentence, a retry and the way back (SEC-11).
export default function DeskError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="studio">
      <div className="studio-opening">
        <div className="not-found">
          <p className="eyebrow">Ink Desk</p>
          <h1>Something went wrong on the desk.</h1>
          <p className="notice" role="status">
            Nothing was lost. Try again in a moment, or go back to the desk.
          </p>
          <p>
            <button type="button" className="btn" onClick={() => retry()}>
              Try again
            </button>{' '}
            <Link className="btn btn-primary" href="/">
              ← Back to the desk
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
