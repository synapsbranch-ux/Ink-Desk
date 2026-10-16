// The shapes slice 21 stores (v3): a public share of a finished manga, the
// reports visitors make about one, a person's defaults, and the video records
// slice 22 will fill. Plain data only and nothing here imports a server module,
// so a client component can use these types and the two constants below.
// `lib/store/index.ts` is the contract that keeps them; see `devpost/spec.md >
// Sharing (v3) / Reports (v3) / Settings, Usage, Terms and Privacy (v3)`.
//
// A share is a SNAPSHOT: what the owner chose to publish, copied when they
// pressed *Share publicly* (or *Update share*), through an allow-list — a
// title, a cover, the dialogue and the pictures of complete pages — and nothing
// else. Never the scenario, the DNA, the cost, the owner or the project's id
// beyond the share record itself. Revoking drops the snapshot, so a revoked
// share holds none of the work.
import type { BubbleLayout } from '../types'
import type { StylePresetId } from '../styles'

export type ShareKind = 'manga' | 'video'

/** How the reader opens: a manga share opens right-to-left; the visitor may flip it, as in the studio. */
export type ShareReading = 'ltr' | 'rtl' | 'vertical'

/** One panel of a shared page: the picture, what is said and by whom — and where, as the studio lays it out. */
export type SnapshotPanel = {
  imageId: string
  dialogue: string
  bubble: BubbleLayout | null
  /** The speaking character's name, or null for narration. */
  speaker: string | null
  /** The shot's static slot label (a short, fixed set of words), never the author's own camera notes. */
  shot: string
}

/** A complete page: `index` is its place in the chapter, `panels` holds all four. */
export type SnapshotPage = { index: number; panels: SnapshotPanel[] }

export type MangaSnapshot = {
  kind: 'manga'
  title: string
  reading: ShareReading
  cover: { imageId: string; title: string } | null
  pages: SnapshotPage[]
  takenAt: string
}

/** Slice 22 creates these; the store and the public page must already cope with them. */
export type VideoSnapshot = { kind: 'video'; title: string; posterImageId: string | null; seconds: number; takenAt: string }

export type ShareSnapshot = MangaSnapshot | VideoSnapshot

/**
 * One share as stored. `token` is 128 random bits in base62 and the only
 * address of it: a revoked token is dead for good and never handed out again.
 * A revoked share keeps its record (so its address still answers, with the same
 * 404 as any unknown one, and reports about it can still be read) but `snapshot`
 * is null and `revokedAt` is set.
 */
export type ShareRecord = {
  token: string
  ownerId: string
  kind: ShareKind
  /** The manga's project; null for a video share. */
  projectId: string | null
  /** The video; null for a manga share. */
  videoId: string | null
  /** What a visitor sees; null once revoked. */
  snapshot: ShareSnapshot | null
  createdAt: string
  updatedAt: string
  revokedAt: string | null
}

/** What the owner's screens and the settings list are given of a share — never the snapshot itself. */
export type ShareView = {
  token: string
  /** Absolute: from APP_URL, else the request's origin. */
  url: string
  /** `/s/<token>` */
  path: string
  kind: ShareKind
  title: string
  projectId: string | null
  /** The cover (a manga) or the poster (a video), when there is one. */
  cover: string | null
  pages: number
  createdAt: string
  updatedAt: string
  /** The project changed after the snapshot was taken. */
  stale: boolean
}

export const REPORT_REASONS = ['harmful', 'copyright', 'personal', 'spam', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

/**
 * A visitor's report about a share. `ipHash` is the same keyed hash the request
 * windows use — no raw address is ever stored. A report is kept for any share
 * whose record exists, revoked or not.
 */
export type ReportRecord = {
  id: string
  token: string
  reason: ReportReason
  note: string
  ipHash: string
  at: string
  handledAt: string | null
}

/** A person's defaults (Settings › Defaults). `voices` is reserved for slice 22 and has no screen yet. */
export type UserSettings = {
  userId: string
  defaultStyle: StylePresetId | null
  readingDirection: 'rtl' | 'ltr'
  voices?: { lead?: string; counterpart?: string }
  updatedAt: string
}

/** A trailer made from a finished page. Slice 22 fills it; the dashboard and account deletion already read it. */
export type VideoRecord = {
  id: string
  ownerId: string
  projectId: string
  page: number
  status: 'queued' | 'making' | 'done' | 'failed'
  seconds: number
  costUsd: number
  /** Keys in the outputs store. */
  posterKey: string | null
  finalKey: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

/** What the dashboard lists for a video. */
export type VideoSummary = Pick<VideoRecord, 'id' | 'projectId' | 'page' | 'status' | 'seconds' | 'createdAt'> & {
  posterUrl: string | null
  /** 0..1 while one is being made, else null. */
  progress: number | null
}
