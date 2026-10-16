// A shared manga, for anyone with the link (v3, slice 21). A Server Component
// with no session: a stranger has none, and nothing here asks for one. It
//
//   1. waits for a real request (`connection()`): a share can be taken down at
//      any moment, so this page is never prerendered or cached;
//   2. takes the client-address window (`anon`; `generateMetadata` shares the
//      one count and reads nothing when it is full), and answers a calm "too many
//      visits" page when it is full — the page's status stays 200 because a
//      Server Component cannot set one, so the page says it in words;
//   3. looks the token up. A malformed, unknown or revoked token is the same
//      `notFound()` — this segment's `not-found.tsx` — and never says which;
//   4. hands the client reader ONLY the snapshot's fields. Props passed to a
//      client component are serialized into the page's HTML, so what is passed
//      here is everything a stranger can ever see: the title, the reading
//      direction, the cover and the complete pages. Not the project, the owner,
//      the scenario, the cost — they are not in `publicManga`'s output at all.
//
// `generateMetadata` gives the title and description for a pasted link, Open
// Graph and Twitter cards (the preview image is `opengraph-image.tsx`) and
// `robots: noindex, nofollow` (the same is sent as a header by next.config).
// See `devpost/spec.md > Sharing (v3)`.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { cache } from 'react'
import { SharedReader } from '@/components/SharedReader'
import { metadataOrigin, takeWindow } from '@/lib/share/page'
import { lookupShare } from '@/lib/share/public'
import { publicManga } from '@/lib/share/snapshot'
import type { ShareSnapshot } from '@/lib/share/types'
import '../share.css'

type Params = { params: Promise<{ token: string }> }

const NOINDEX = { index: false, follow: false } as const

/** The live share's snapshot, once per request (the page and its metadata both ask). */
const snapshotOf = cache(async (token: string): Promise<ShareSnapshot | null> => (await lookupShare(token))?.snapshot ?? null)

/** The address window, once per request: the page and its metadata both ask, and a view is counted once. */
const windowOf = cache(() => takeWindow('anon'))

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  await connection()
  const { token } = await params
  const metadataBase = new URL(await metadataOrigin())
  // Over the line, the store is not read and the head is the bare one a dead link gets: the window comes first, as on every public route.
  if (await windowOf()) return { metadataBase, title: 'Ink Desk', robots: NOINDEX }
  const snapshot = await snapshotOf(token)
  const manga = publicManga(snapshot)
  // A link that is gone (or never was) gets the same bare metadata whichever it is.
  if (!manga) return { metadataBase, title: 'Ink Desk', robots: NOINDEX }
  const pages = manga.pages.length
  const description = `A manga shared from Ink Desk${pages > 0 ? ` · ${pages} ${pages === 1 ? 'page' : 'pages'}` : ''}.`
  return {
    metadataBase,
    title: manga.title,
    description,
    robots: NOINDEX,
    referrer: 'no-referrer',
    openGraph: { type: 'article', siteName: 'Ink Desk', title: manga.title, description, url: `/s/${token}` },
    twitter: { card: 'summary_large_image', title: manga.title, description },
  }
}

export default async function SharePage({ params }: Params) {
  await connection()
  const { token } = await params
  const refused = await windowOf()
  if (refused) {
    return (
      <div className="studio share-gone">
        <div className="studio-opening">
          <div className="not-found">
            <p className="eyebrow">Ink Desk</p>
            <h1>Too many visits just now.</h1>
            <p className="notice" role="status">
              {refused.message}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const snapshot = await snapshotOf(token)
  if (!snapshot) notFound()
  if (snapshot.kind === 'video') {
    // Trailers arrive with slice 22; until then a video share says so plainly, with only its title.
    return (
      <div className="studio share-gone">
        <div className="studio-opening">
          <div className="not-found">
            <p className="eyebrow">Ink Desk</p>
            <h1>{snapshot.title}</h1>
            <p className="notice" role="status">
              This trailer can’t be played on this page yet.
            </p>
          </div>
        </div>
      </div>
    )
  }
  const manga = publicManga(snapshot)
  if (!manga) notFound()
  return <SharedReader token={token} title={manga.title} reading={manga.reading} cover={manga.cover} pages={manga.pages} />
}
