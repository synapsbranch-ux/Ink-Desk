// The preview a pasted share link shows (v3, slice 21): the cover cropped to the
// 1200x630 card, or — when the manga has no drawn cover — a paper card with its
// title. A revoked or unknown token is the same bare 404 as the picture route's,
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
import { lookupManga, shareNotFound } from '@/lib/share/public'
import { store } from '@/lib/store'

export const alt = 'A manga shared from Ink Desk'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** A cover is a few megapixels at most; a hand-made record could name a bomb. */
const MAX_PIXELS = 48_000_000

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const refused = await takeWindow('anon')
  if (refused) return refusalResponse(refused, IMAGE_MISSING_HEADERS)
  const { token } = await params
  let manga
  try {
    manga = await lookupManga(token)
  } catch (err) {
    if (err instanceof Refused) return refusalResponse(err, IMAGE_MISSING_HEADERS)
    console.error('[share-preview] a share couldn’t be read:', err instanceof Error ? err.message : err)
    return new Response('Unavailable', { status: 502, headers: IMAGE_MISSING_HEADERS })
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

  const title = manga.title.length > 90 ? `${manga.title.slice(0, 89)}…` : manga.title
  const fontSize = title.length > 60 ? 56 : title.length > 30 ? 74 : 96
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
          <div style={{ display: 'flex', fontSize, lineHeight: 1.08, fontWeight: 600 }}>{title}</div>
          <div style={{ display: 'flex', width: 180, height: 8, background: '#b5382e', marginTop: 36 }} />
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#444141' }}>
          {manga.pages.length > 0 ? `A manga · ${manga.pages.length} ${manga.pages.length === 1 ? 'page' : 'pages'}` : 'A manga cover'}
        </div>
      </div>
    ),
    { ...size, headers: IMAGE_MISSING_HEADERS }
  )
}
