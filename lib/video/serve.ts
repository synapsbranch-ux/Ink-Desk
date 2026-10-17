// Serving a trailer's file with HTTP Range (v3, slice 22). Server only. Both file
// routes — the owner's (`/api/videos/<id>/file/<name>`) and the visitor's
// (`/api/s/<token>/file/<name>`) — answer through here, so a phone, a desktop
// browser and a chat app's link preview all meet the same rules.
//
// WHY RANGE. iOS Safari will not play a `<video>` whose server cannot answer
// `Range: bytes=0-1`: it asks for the first bytes, learns the size from
// `Content-Range`, and then seeks by asking for the middle. Every other browser
// seeks the same way. So a request for a part of the file is a 206 with exactly
// those bytes, and the file is never read whole into memory — the store opens a
// stream at the offset (`OutputStore.open(key, range)`).
//
//   no Range, or one we ignore       200, the whole file
//   bytes=a-b   bytes=a-   bytes=-n  206 with `Content-Range: bytes a-b/total`
//   a range that starts past the end 416 with `Content-Range: bytes */total`
//   HEAD                             the headers of the GET, no body
//
// What is ignored (RFC 9110 allows it, and a whole file is always a correct
// answer): a unit other than `bytes`, several ranges at once (`bytes=0-1,5-6`),
// a range that is not well formed (`bytes=5-2`, letters), and any Range sent
// with `If-Range` — the files carry no validator for it to match, so the whole
// file is the right reply. A suffix longer than the file is the whole file as a
// 206 (`bytes=-99999999` of a 100-byte file is bytes 0-99). `n` of a suffix of
// zero names nothing: 416.
//
// The headers are the contract's: the file's own `Content-Type`,
// `Accept-Ranges: bytes`, `X-Content-Type-Options: nosniff`, and a
// `Cache-Control` the caller chooses (`private, no-store` for the owner,
// `no-store` for a visitor: unpublishing takes effect at once). Nothing here
// names a bucket key, a path or an owner.
import 'server-only'
import { RangeNotSatisfiable, store } from '../store'
import type { BlobStream, ByteRange } from '../store'

/** The three files a trailer serves, by the name in the address. */
export const VIDEO_FILE_NAMES = ['final.mp4', 'poster.jpg', 'captions.vtt'] as const
export type VideoFileName = (typeof VIDEO_FILE_NAMES)[number]

export const isVideoFileName = (name: unknown): name is VideoFileName => typeof name === 'string' && (VIDEO_FILE_NAMES as readonly string[]).includes(name)

/** What each file is. `captions.vtt` is text and says so; the store's extension table does not know `.vtt`. */
export const VIDEO_FILE_TYPES: Record<VideoFileName, string> = {
  'final.mp4': 'video/mp4',
  'poster.jpg': 'image/jpeg',
  'captions.vtt': 'text/vtt; charset=utf-8',
}

/** A parsed `Range` header: a closed or open range, a suffix, or nothing we act on. */
export type ParsedRange = { kind: 'span'; start: number; end?: number } | { kind: 'suffix'; length: number } | null

const SPAN = /^bytes=(\d+)-(\d*)$/
const SUFFIX = /^bytes=-(\d+)$/

/**
 * `Range: bytes=a-b` / `a-` / `-n`. Anything else — another unit, several ranges, `5-2`, text — is `null`: the header is
 * ignored and the file is whole. A number too large to count exactly is kept as `Infinity`, which no file reaches (416).
 */
export function parseRange(header: string | null): ParsedRange {
  if (header === null) return null
  const value = header.trim()
  const span = SPAN.exec(value)
  if (span) {
    const start = Number(span[1])
    const end = span[2] === '' ? undefined : Number(span[2])
    if (end !== undefined && end < start) return null // not well formed: ignored
    return { kind: 'span', start: Number.isSafeInteger(start) ? start : Infinity, ...(end === undefined ? {} : { end: Number.isSafeInteger(end) ? end : Number.MAX_SAFE_INTEGER }) }
  }
  const suffix = SUFFIX.exec(value)
  if (suffix) return { kind: 'suffix', length: Number.isSafeInteger(Number(suffix[1])) ? Number(suffix[1]) : Number.MAX_SAFE_INTEGER }
  return null
}

export type ServeOptions = {
  key: string
  contentType: string
  /** `private, no-store` for the owner; `no-store` for a visitor. */
  cacheControl: string
}

const baseHeaders = (opts: ServeOptions): Record<string, string> => ({
  'Content-Type': opts.contentType,
  'Accept-Ranges': 'bytes',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': opts.cacheControl,
  'Content-Disposition': 'inline',
})

const rangeNotSatisfiable = (total: number, opts: ServeOptions): Response =>
  new Response(null, { status: 416, headers: { ...baseHeaders(opts), 'Content-Range': `bytes */${total}` } })

/** The size of an object, learnt by opening one byte of it; null when there is no such object. A zero-byte object has no byte to open: its size is 0. */
async function sizeOf(key: string): Promise<number | null> {
  try {
    const probe = await store.outputs.open(key, { start: 0, end: 0 })
    if (!probe) return null
    void probe.body.cancel().catch(() => {})
    return probe.range?.total ?? probe.bytes
  } catch (err) {
    if (err instanceof RangeNotSatisfiable) return err.total
    throw err
  }
}

/**
 * The file as a response, or `null` when there is no such object (the caller says its own 404). `req` supplies the method
 * (`GET`/`HEAD`) and the `Range` header. Never reads the object whole.
 */
export async function serveStored(req: Request, opts: ServeOptions): Promise<Response | null> {
  const head = req.method === 'HEAD'
  // Ignored when the request also names a validator: the files carry none, so nothing could match (RFC 9110 §13.1.5).
  const wanted = req.headers.has('if-range') ? null : parseRange(req.headers.get('range'))

  let range: ByteRange | null = null
  if (wanted?.kind === 'span') {
    range = Number.isFinite(wanted.start) ? { start: wanted.start, ...(wanted.end === undefined ? {} : { end: wanted.end }) } : null
    if (range === null) {
      const total = await sizeOf(opts.key)
      return total === null ? null : rangeNotSatisfiable(total, opts)
    }
  } else if (wanted?.kind === 'suffix') {
    if (wanted.length === 0) {
      const total = await sizeOf(opts.key)
      return total === null ? null : rangeNotSatisfiable(total, opts)
    }
    const total = await sizeOf(opts.key)
    if (total === null) return null
    if (total === 0) return rangeNotSatisfiable(total, opts)
    range = { start: Math.max(0, total - wanted.length), end: total - 1 }
  }

  let blob: BlobStream | null
  try {
    blob = range ? await store.outputs.open(opts.key, range) : await store.outputs.open(opts.key)
  } catch (err) {
    if (err instanceof RangeNotSatisfiable) return rangeNotSatisfiable(err.total, opts)
    throw err
  }
  if (!blob) return null

  const headers = baseHeaders(opts)
  const part = blob.range
  if (part) headers['Content-Range'] = `bytes ${part.start}-${part.end}/${part.total}`
  if (blob.bytes !== null) headers['Content-Length'] = String(blob.bytes)
  if (head) {
    void blob.body.cancel().catch(() => {})
    return new Response(null, { status: part ? 206 : 200, headers })
  }
  return new Response(blob.body, { status: part ? 206 : 200, headers })
}
