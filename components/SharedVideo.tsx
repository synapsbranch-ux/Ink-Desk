'use client'

// The shared trailer, watched (v3, slice 22): what a stranger holding the link
// sees. A title, the native player and the same footer as the shared manga —
// "Made with Ink Desk", a way into the studio and the Report button with its
// dialog. There is nothing of the owner's on it and no way into anything of
// theirs: this component is given only the snapshot's own fields (the title,
// the length, whether there are captions), because everything it is given is
// serialized into the page's HTML. The files come from the share's own routes,
// `/api/s/<token>/file/final.mp4`, `poster.jpg` and `captions.vtt`, which serve
// the video of this share and no other (HTTP Range, so iOS plays it). The title
// is rendered as text; nothing here sets inner HTML. Implements
// `devpost/prd.md > Sharing (v3)` and `> Report (v3)`.
import Link from 'next/link'
import { lengthOf } from '@/components/VideoCard'
import { ReportDialog } from '@/components/ReportDialog'
import { VideoPlayer } from '@/components/VideoPlayer'
import { shareFileUrl } from '@/lib/share/url'
import '../app/s/share.css'

type Props = {
  token: string
  title: string
  /** The trailer's length in seconds; 0 when the snapshot has none. */
  seconds?: number
  /** The trailer has a captions file; the player turns them on by default. */
  hasCaptions: boolean
}

export function SharedVideo({ token, title, seconds = 0, hasCaptions }: Props) {
  const length = lengthOf(seconds)
  return (
    <div className="share-page">
      <main className="station">
        <div className="station-inner shared-video">
          <div className="station-head share-head">
            <div className="eyebrow">Shared on Ink Desk</div>
            <h1 className="station-title share-title">{title}</h1>
            <p className="share-meta">A one-page trailer{length ? ` · ${length}` : ''}</p>
          </div>

          <VideoPlayer
            src={shareFileUrl(token, 'final.mp4')}
            poster={shareFileUrl(token, 'poster.jpg')}
            captions={hasCaptions ? shareFileUrl(token, 'captions.vtt') : null}
            title={`Trailer: ${title}`}
          />
          {hasCaptions && <p className="share-meta shared-video-note">This trailer has captions. Turn them on or off in the player’s controls.</p>}
        </div>
      </main>

      <footer className="share-footer">
        <p className="share-made">
          <span className="share-brand">Made with Ink Desk</span>
          <Link className="share-studio-link" href="/">
            Open the studio →
          </Link>
        </p>
        <ReportDialog token={token} />
      </footer>
    </div>
  )
}
