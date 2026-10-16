// The words and bounds of a report (v3, slice 21) that both sides of the wire
// need: the report dialog on the share page, the admin list, and the route that
// receives them. Plain data only and nothing here imports a server module, so a
// client component can use it. The server half — the strict schema, the record
// builder — is `lib/share/report.ts`. See `devpost/prd.md > Report (v3)`.
import type { ReportReason } from './types'

/** The longest note a visitor may leave, in characters. */
export const REPORT_NOTE_MAX = 500

/** What each reason is called, in the order the dialog lists them. */
export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  harmful: 'Harmful or unsafe',
  copyright: 'Copyright',
  personal: 'Personal information',
  spam: 'Spam or a scam',
  other: 'Something else',
}

/** One line under each reason in the dialog, so a visitor can tell them apart without guessing. */
export const REPORT_REASON_HINT: Record<ReportReason, string> = {
  harmful: 'Violent, hateful, sexual or otherwise harmful.',
  copyright: 'It uses someone else’s work without permission.',
  personal: 'It shows a real person’s private details.',
  spam: 'It is an advert, a scam or a link farm.',
  other: 'Anything the other reasons don’t cover.',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "16 Oct 2026, 09:12 UTC". Written by hand and always in UTC, so the server's
 * render and the browser's hydration agree whatever either machine's locale and
 * time zone are (a `toLocaleString` differs between Node's ICU and a browser's).
 * An unreadable stamp is returned as it came.
 */
export function formatWhen(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const d = new Date(t)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`
}

/** How long to wait, in a visitor's words: "about 12 minutes", "a minute", "30 seconds". */
export function waitWords(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds))
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`
  const minutes = Math.ceil(s / 60)
  if (minutes === 1) return 'a minute'
  if (minutes < 60) return `about ${minutes} minutes`
  const hours = Math.ceil(minutes / 60)
  return hours === 1 ? 'about an hour' : `about ${hours} hours`
}
