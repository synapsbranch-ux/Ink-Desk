// What a visitor's report is, and what the admin list is shown of one (v3,
// slice 21): the strict schema of the public form, the one function that makes
// a stored record from it, and the view the admin page and its API hand to the
// screen. See `devpost/spec.md > Reports (v3)` and `devpost/prd.md > Report (v3)`.
//
//   • The body is `{ reason, note? }` and nothing else: an unknown key, a
//     reason that is not on the list, a note that is not a string are all the
//     same calm 400. The note is cleaned BEFORE its length is judged — trimmed,
//     stripped of control characters (and of the invisible ones that reorder or
//     hide text: bidi overrides, zero-width marks), lone surrogates dropped,
//     tabs made spaces, runs of blank lines folded — and then it may be at most
//     500 characters. What the admin page prints is therefore already plain.
//   • `ipHash` is `clientKey`, the very HMAC the request windows use: a hash of
//     the address as the trusted proxy hop saw it, never the address, and never
//     a value the caller wrote (`lib/limits/requests.ts`). With no readable
//     address it is the shared `unknown`.
//   • The admin sees a report, the share's title and whether it is still
//     published — never the snapshot itself, never the owner, never the hash.
//
// Server only: it reads the client key.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { clientKey } from '../limits/requests'
import { REPORT_NOTE_MAX } from './report-copy'
import { REPORT_REASONS, type ReportRecord, type ShareRecord } from './types'

/** A report is a reason and a few sentences: 8 KB covers 500 characters of any script, JSON-escaped, with room to spare. */
export const REPORT_BODY_LIMIT = 8 * 1024

/** The one sentence for a body that cannot be used — bad JSON and a bad shape alike. */
export const REPORT_UNREADABLE = `That report couldn’t be read. Choose a reason, and keep any note under ${REPORT_NOTE_MAX} characters.`

/** What every visitor is told after a report, whatever became of it. */
export const REPORT_THANKS = { ok: true } as const

// What a note may not carry, by code point: controls (C0 and C1, the plain newline aside), DEL, the soft hyphen, the
// Arabic letter mark, the Mongolian vowel separator, zero-width and directional marks, line and paragraph separators,
// bidi embeddings and overrides, the word joiner and the invisible operators, the byte-order mark, the interlinear
// annotation marks — and a lone surrogate, which is not text. Written as numbers, not escapes, so it reads the same
// in every editor.
const INVISIBLE: readonly (readonly [number, number])[] = [
  [0x0000, 0x0009],
  [0x000b, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xd800, 0xdfff],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
]

function invisible(code: number): boolean {
  return INVISIBLE.some(([from, to]) => code >= from && code <= to)
}

/** A note as it is kept: plain text, single spaces for tabs, at most one blank line in a row, trimmed. */
export function cleanNote(raw: string): string {
  let kept = ''
  for (const ch of raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')) {
    // `for…of` walks code points: a lone surrogate comes through alone and is dropped with the rest.
    if (ch === '\n' || !invisible(ch.codePointAt(0) ?? 0)) kept += ch
  }
  return kept.replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const NoteSchema = z
  .string()
  .transform(cleanNote)
  .pipe(z.string().max(REPORT_NOTE_MAX))

export const ReportBodySchema = z.strictObject({
  reason: z.enum(REPORT_REASONS),
  note: NoteSchema.optional(),
})
export type ReportBody = z.infer<typeof ReportBodySchema>

/** The record to store for a body that passed the schema. No raw address: `ipHash` is the window's own keyed hash. */
export function reportRecord(req: Request, token: string, body: ReportBody, now: Date = new Date()): ReportRecord {
  return {
    id: randomUUID(),
    token,
    reason: body.reason,
    note: body.note ?? '',
    ipHash: clientKey(req.headers),
    at: now.toISOString(),
    handledAt: null,
  }
}

// --- The admin side -------------------------------------------------------------------

/** What the admin list shows of one report. */
export type AdminReportView = {
  id: string
  reason: ReportRecord['reason']
  note: string
  at: string
  handledAt: string | null
  /** The share's title while it is published; null once it is not (the snapshot is dropped on unpublish). */
  title: string | null
  kind: ShareRecord['kind'] | null
  /** Is the share still published? */
  live: boolean
  /** Where the live share opens; null when it does not. */
  path: string | null
}

/** A report beside the share it is about (null when the share no longer exists). */
export function adminReportView(report: ReportRecord, share: ShareRecord | null): AdminReportView {
  const live = share !== null && share.revokedAt === null && share.snapshot !== null
  return {
    id: report.id,
    reason: report.reason,
    note: report.note,
    at: report.at,
    handledAt: report.handledAt ?? null,
    title: live ? share.snapshot?.title ?? null : null,
    kind: share?.kind ?? null,
    live,
    path: live ? `/s/${report.token}` : null,
  }
}

/** The admin API's body: one of two actions, nothing else. */
export const ADMIN_ACTION_LIMIT = 1024
export const ADMIN_ACTION_UNREADABLE = 'That request couldn’t be read.'
export const AdminActionSchema = z.strictObject({ action: z.enum(['unpublish', 'handled']) })
