// narration.md → segments of narration → burned-in caption cues. Pure.
//
// narration.md has one `## <segment id>` section per segment of the edit
// (cut.ts). Everything else in a section is the words spoken over it, and
// the captions are the same words — one source, so they cannot disagree.
// HTML comments are notes for the writer and are never spoken. A section
// whose words are still a [bracketed placeholder] is a draft: it is captioned
// as written so the timing can be judged, and never sent to the voice.
import { FPS, NARRATION_LEAD_SECONDS, type ResolvedPlan } from './timeline'

/**
 * Still the writer's to fill: empty, one bracketed placeholder, or any line
 * that keeps the template's "[Your words" marker — a half-written section is
 * never sent to the voice and never passes for final.
 */
export const isPlaceholder = (text: string) => text === '' || /^\[.*\]$/.test(text) || /\[Your words\b/i.test(text)

export type NarrationSegment = { id: string; text: string; placeholder: boolean }

export type CaptionCue = { segmentId: string; startFrame: number; endFrame: number; text: string }

/** Comfortable speaking rate for the estimate before any audio exists. */
export const WORDS_PER_SECOND = 2.6
/** Two lines of captions at the burned-in size. */
export const MAX_CUE_CHARS = 84
const MIN_CUE_SECONDS = 1.2

export function parseNarration(markdown: string): NarrationSegment[] {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, '')
  const out: NarrationSegment[] = []
  let current: { id: string; lines: string[] } | null = null
  const flush = () => {
    if (!current) return
    const text = current.lines.join(' ').replace(/\s+/g, ' ').trim()
    out.push({ id: current.id, text, placeholder: isPlaceholder(text) })
  }
  for (const line of withoutComments.split(/\r?\n/)) {
    const heading = /^##\s+([a-z0-9-]+)\b/i.exec(line)
    if (heading) {
      flush()
      current = { id: heading[1].toLowerCase(), lines: [] }
    } else if (current && !/^#\s/.test(line)) {
      current.lines.push(line)
    }
  }
  flush()
  const seen = new Set<string>()
  for (const s of out) {
    if (seen.has(s.id)) throw new Error(`narration.md has two sections called "${s.id}".`)
    seen.add(s.id)
  }
  return out
}

export const wordCount = (text: string) => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length)

export const estimateSpokenSeconds = (text: string) => wordCount(text) / WORDS_PER_SECOND

/** Sentences, then any sentence too long for two lines split at word boundaries, evenly. */
export function chunkCaption(text: string, maxChars = MAX_CUE_CHARS): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter(Boolean)
  const chunks: string[] = []
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      chunks.push(sentence)
      continue
    }
    const words = sentence.split(' ')
    const parts = Math.ceil(sentence.length / maxChars)
    const target = sentence.length / parts
    let line = ''
    for (const w of words) {
      const next = line ? `${line} ${w}` : w
      if (line && (next.length > maxChars || line.length >= target)) {
        chunks.push(line)
        line = w
      } else {
        line = next
      }
    }
    if (line) chunks.push(line)
  }
  return chunks
}

/**
 * One cue per chunk, timed across the spoken length of the segment — the
 * narration's measured duration when the mp3 exists, the estimate otherwise —
 * in proportion to its characters. Never past the end of the segment.
 */
export function captionCues(
  plan: ResolvedPlan,
  narration: readonly NarrationSegment[],
  spokenSeconds: Readonly<Record<string, number>>,
): CaptionCue[] {
  const byId = new Map(narration.map((n) => [n.id, n]))
  const cues: CaptionCue[] = []
  for (const seg of plan.segments) {
    const n = byId.get(seg.id)
    if (!n || n.text === '') continue
    const chunks = chunkCaption(n.text)
    const lead = Math.round(NARRATION_LEAD_SECONDS * FPS)
    const room = Math.max(1, seg.durationInFrames - lead)
    const spoken = spokenSeconds[seg.id] ?? estimateSpokenSeconds(n.text)
    const span = Math.min(room, Math.max(Math.round(spoken * FPS), Math.round(chunks.length * MIN_CUE_SECONDS * FPS)))
    const total = chunks.reduce((s, c) => s + c.length + 8, 0)
    let at = seg.startFrame + lead
    chunks.forEach((text, i) => {
      const last = i === chunks.length - 1
      const len = Math.max(1, Math.round((span * (text.length + 8)) / total))
      const end = last ? seg.startFrame + lead + span : Math.min(at + len, seg.startFrame + lead + span)
      cues.push({ segmentId: seg.id, startFrame: at, endFrame: Math.max(at + 1, end), text })
      at = end
    })
  }
  return cues
}

/**
 * Words that fit a segment at a comfortable pace — the writer's budget. The
 * voice starts NARRATION_LEAD_SECONDS in and must end before the beat does
 * (the next beat's voice follows at once), so the budget keeps a breath at
 * the end and takes the voice at 85 % of the estimate's pace: a line that
 * fits the budget never runs into the ink wipe.
 */
export const wordBudget = (seconds: number) => Math.max(0, Math.floor((seconds - NARRATION_LEAD_SECONDS - 0.6) * WORDS_PER_SECOND * 0.85))

/**
 * What `npm run narrate` writes to public/narration/manifest.json. A clip is
 * used only while its key still matches the section's words, voice and model —
 * edit a line and its old audio is ignored until it is narrated again.
 */
export type NarrationManifest = {
  model: string
  voice: string
  /** `lufs`: the loudness the clip was leveled to; absent on a clip recorded before leveling. */
  segments: Record<string, { src: string; seconds: number; key: string; lufs?: number }>
}

/** A content key for one clip (cyrb53, pure — the same in Node and the browser). */
export function narrationKey(text: string, voice: string, model: string): string {
  const str = `${model}\u0000${voice}\u0000${text}`
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}
