import Link from 'next/link'

/**
 * The calm full-page state: the brand's eyebrow, one heading, at most one
 * sentence, one way back to the desk. The not-found page, a project that
 * can't be opened, a studio whose project is not the caller's, and a
 * signed-out desk in test mode all use it, so they read alike.
 */
export function DeskNotice({ heading, sentence, back = true }: { heading: string; sentence?: string; back?: boolean }) {
  return (
    <div className="studio">
      <div className="studio-opening">
        <div className="not-found">
          <p className="eyebrow">Ink Desk</p>
          <h1>{heading}</h1>
          {sentence && (
            <p className="notice" role="status">
              {sentence}
            </p>
          )}
          {back && (
            <p>
              <Link className="btn btn-primary" href="/">
                ← Back to the desk
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
