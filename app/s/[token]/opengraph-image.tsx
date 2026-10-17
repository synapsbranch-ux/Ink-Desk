// The preview a pasted share link shows (v3, slice 21): the cover cropped to the
// 1200x630 card, or — when the manga has no drawn cover — a paper card with its
// title. A shared trailer (slice 22) shows its POSTER the same way, found through
// the share's own `videoId` in the outputs store and cropped to the card, or a
// paper card with its title and length. A revoked or unknown token is the same bare 404 as the picture route's,
// so a preview cannot be used to find out whether a link was ever live. It takes
// the `anon` address window (60 a minute: it crops a cover on the CPU every time, so
// it does not get the picture window's 600, which is meant for streaming stored
// files), is never cached (unpublishing is immediate; a chat app that already
// fetched it keeps its own copy, which no server can recall), and holds only what
// the snapshot lists: its title and its cover.
import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { Refused, refusalResponse } from '@/lib/errors'
import { IMAGE_MISSING_HEADERS } from '@/lib/images'
import { takeWindow } from '@/lib/share/page'
import { lookupShare, lookupSharedVideo, shareNotFound } from '@/lib/share/public'
import { publicManga } from '@/lib/share/snapshot'
import { store } from '@/lib/store'

export const alt = 'Shared from Ink Desk'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** A cover is a few megapixels at most; a hand-made record could name a bomb. */
const MAX_PIXELS = 48_000_000
/** A poster is one JPEG frame, a few hundred kilobytes; a hand-made record could name a huge object. */
const MAX_POSTER_BYTES = 8 * 1024 * 1024

/** The poster of a shared trailer as the 1200x630 card, or null when it can't be had (the paper card stands in). */
async function posterCard(posterKey: string | null): Promise<Response | null> {
  if (!posterKey) return null
  try {
    const blob = await store.outputs.open(posterKey)
    if (!blob) return null
    if (blob.bytes !== null && blob.bytes > MAX_POSTER_BYTES) {
      void blob.body.cancel().catch(() => {})
      return null
    }
    const bytes = Buffer.from(await new Response(blob.body).arrayBuffer())
    if (bytes.byteLength > MAX_POSTER_BYTES) return null
    const card = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'none' })
      .resize(size.width, size.height, { fit: 'cover', position: sharp.strategy.attention })
      .png()
      .toBuffer()
    return new Response(new Uint8Array(card), { headers: { ...IMAGE_MISSING_HEADERS, 'Content-Type': 'image/png', 'Content-Length': String(card.length) } })
  } catch (err) {
    console.warn('[share-preview] the poster couldn’t be cropped:', err instanceof Error ? err.message : err)
    return null
  }
}

/** The paper card: the title, in the studio's ink and hanko red. `kicker` says what is shared. */
function paperCard(title: string, kicker: string): Response {
  const shown = title.length > 90 ? `${title.slice(0, 89)}…` : title
  const fontSize = shown.length > 60 ? 56 : shown.length > 30 ? 74 : 96
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#f3f2f2',
          color: '#201f1d',
          border: '14px solid #201f1d',
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, letterSpacing: 6, textTransform: 'uppercase', color: '#605d5d' }}>Ink Desk</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize, lineHeight: 1.08, fontWeight: 600 }}>{shown}</div>
          <div style={{ display: 'flex', width: 180, height: 8, background: '#b5382e', marginTop: 36 }} />
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#444141' }}>{kicker}</div>
      </div>
    ),
    { ...size, headers: IMAGE_MISSING_HEADERS }
  )
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const refused = await takeWindow('anon')
  if (refused) return refusalResponse(refused, IMAGE_MISSING_HEADERS)
  const { token } = await params
  let manga
  let trailer
  try {
    const share = await lookupShare(token)
    if (share?.kind === 'video') trailer = await lookupSharedVideo(token)
    else manga = share ? publicManga(share.snapshot) : null
  } catch (err) {
    if (err instanceof Refused) return refusalResponse(err, IMAGE_MISSING_HEADERS)
    console.error('[share-preview] a share couldn’t be read:', err instanceof Error ? err.message : err)
    return new Response('Unavailable', { status: 502, headers: IMAGE_MISSING_HEADERS })
  }

  if (trailer) {
    const poster = await posterCard(trailer.video.posterKey)
    if (poster) return poster
    const { seconds } = trailer.snapshot
    return paperCard(trailer.snapshot.title, seconds > 0 ? `A trailer · ${Math.round(seconds)} seconds` : 'A trailer')
  }
  if (!manga) return shareNotFound()

  if (manga.cover) {
    try {
      const blob = await store.getBlob(manga.cover.imageId)
      if (blob) {
        const card = await sharp(blob.bytes, { limitInputPixels: MAX_PIXELS, failOn: 'none' })
          .resize(size.width, size.height, { fit: 'cover', position: sharp.strategy.attention })
          .png()
          .toBuffer()
        return new Response(new Uint8Array(card), { headers: { ...IMAGE_MISSING_HEADERS, 'Content-Type': 'image/png', 'Content-Length': String(card.length) } })
      }
    } catch (err) {
      // A cover that can't be cropped is no reason to have no preview: the paper card below stands in.
      console.warn('[share-preview] the cover couldn’t be cropped:', err instanceof Error ? err.message : err)
    }
  }

  return paperCard(manga.title, manga.pages.length > 0 ? `A manga · ${manga.pages.length} ${manga.pages.length === 1 ? 'page' : 'pages'}` : 'A manga cover')
}
