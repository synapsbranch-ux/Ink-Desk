import Link from 'next/link'

// The one page a wrong URL lands on: a project id that isn't on the desk,
// or a path the studio doesn't have. Plain words, one way back.
export default function NotFound() {
  return (
    <div className="studio">
      <div className="studio-opening">
        <div className="not-found">
          <p className="eyebrow">Ink Desk</p>
          <h1>There is no such page on the desk.</h1>
          <p>
            <Link className="btn btn-primary" href="/">
              ← Back to the desk
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
