'use client'

// Saving an export on a phone (v3, slice 23). On iOS a download link opens the
// PNG or PDF in a new tab instead of saving it, so on a touch screen that can
// share files the export goes to the share sheet (Save Image, Save to Files,
// Messages…). Anywhere else — a desktop, a browser without file sharing — it
// downloads as it always did.
//
// The share sheet needs a fresh tap. Compositing can take long enough that the
// tap which started it no longer counts; then `shareFile` answers 'needs-tap'
// and the reader offers a "Share or save…" button, whose own tap opens the
// sheet. See `devpost/security-report.md > Appendix — responsive`, item 7.
import { downloadBlob } from '@/lib/export'

export type SaveResult = 'downloaded' | 'shared' | 'cancelled' | 'needs-tap'

/** The export as a file the share sheet takes, or null where the sheet isn't the way to save (a desktop, no file sharing). */
export function shareableFile(blob: Blob, filename: string): File | null {
  if (typeof window === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return null
  // A mouse saves to its downloads folder: the sheet is only for touch screens.
  if (!window.matchMedia?.('(pointer: coarse)').matches) return null
  try {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })
    return navigator.canShare({ files: [file] }) ? file : null
  } catch {
    return null
  }
}

/** Open the share sheet with one file. Dismissing the sheet is not a failure; anything else unexpected falls back to a download. */
export async function shareFile(file: File): Promise<SaveResult> {
  try {
    await navigator.share({ files: [file], title: file.name })
    return 'shared'
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''
    if (name === 'AbortError') return 'cancelled'
    // The tap that started the export has gone stale: the person taps again.
    if (name === 'NotAllowedError') return 'needs-tap'
    downloadBlob(file, file.name)
    return 'downloaded'
  }
}
