// The public side of a share (v3, slice 21): what the page, the JSON route, the
// picture route and the preview image all ask first — "is this token live, and
// what does it hold?" — and the one 404 they all give when it is not.
//
// A token that is malformed, unknown, revoked, or whose snapshot is gone is the
// SAME answer: `lookupShare` returns null for all four and the caller shows
// `shareNotFound()` (or the page's `notFound()`), word for word and header for
// header, so a stranger cannot tell a link that was taken down from one that
// never was — nor probe which tokens exist. A malformed token never reaches the
// store. What a live share hands out is `publicManga(snapshot)` (or, for a
// trailer, `publicVideo`): the allow-list applied once more to whatever the store
// returned.
// Server only.
import 'server-only'
import { store } from '../store'
import { publicManga, publicVideo } from './snapshot'
import type { MangaSnapshot, ShareRecord, VideoRecord, VideoSnapshot } from './types'
import { isShareToken } from './url'

/** The active share at `token`, or null — for a bad shape, an unknown token, a revoked one and a record with no snapshot alike. */
export async function lookupShare(token: unknown): Promise<ShareRecord | null> {
  if (!isShareToken(token)) return null
  const share = await store.shares.get(token)
  if (!share || share.revokedAt !== null || !share.snapshot) return null
  return share
}

/** The live share's manga, allow-listed — null when the token is not live or the share is not a manga (a video, slice 22). */
export async function lookupManga(token: unknown): Promise<MangaSnapshot | null> {
  const share = await lookupShare(token)
  return share ? publicManga(share.snapshot) : null
}

/** The live share's trailer snapshot, allow-listed — null when the token is not live or the share is not a trailer. */
export async function lookupVideoSnapshot(token: unknown): Promise<{ share: ShareRecord; snapshot: VideoSnapshot } | null> {
  const share = await lookupShare(token)
  if (!share || share.kind !== 'video' || share.videoId === null) return null
  const snapshot = publicVideo(share.snapshot)
  return snapshot ? { share, snapshot } : null
}

/**
 * A live trailer share AND the trailer it names: the record is read through the share's own `videoId` (never through
 * anything a visitor typed), and must be the share owner's, finished, and with its video file — otherwise it is the
 * same null as a dead link. The files are served from this record's keys and no others.
 */
export async function lookupSharedVideo(token: unknown): Promise<{ share: ShareRecord; snapshot: VideoSnapshot; video: VideoRecord } | null> {
  const found = await lookupVideoSnapshot(token)
  if (!found || found.share.videoId === null) return null
  const video = await store.videos.get(found.share.videoId)
  if (!video || video.ownerId !== found.share.ownerId || video.status !== 'done' || !video.finalKey) return null
  return { ...found, video }
}

/** What every public route answers for a token that is not live. Never cached, never sniffed, one body for every reason. */
const NOT_FOUND_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const

export function shareNotFound(): Response {
  return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS })
}
