import Link from 'next/link'
import '../share.css'

// The one page a share link lands on when it leads nowhere: never shared, taken
// down, mistyped, cut short in a chat message. It is the same page for all of
// them and says nothing about which, so a link cannot be used to learn whether a
// token ever existed (v3, slice 21). Plain words, one way on.
export default function ShareNotFound() {
  return (
    <div className="studio share-gone">
      <div className="studio-opening">
        <div className="not-found">
          <p className="eyebrow">Ink Desk</p>
          <h1>There is nothing at this link.</h1>
          <p className="notice" role="status">
            Check that the whole link was copied. If it still doesn’t open, ask whoever sent it for a new one.
          </p>
          <p>
            <Link className="btn btn-primary" href="/">
              Open the studio
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
