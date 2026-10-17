// The trailer's captions (v3, slice 22): one WebVTT cue per spoken line, the
// words only (a caption is not a script — no speaker names), shown while the
// line's bubble is on screen. Pure and client-safe; `assemble.ts` returns the
// text and the runner stores it as `captions.vtt`, which the player's `<track>`
// loads.
//
// The times are the bubble's: the line's `lineWindow` inside its shot, offset by
// the opening card and the shots before it — the same clock `assemble.ts` lays
// the bubble and the voice on.
import { lineWindow } from './plan'
import type { TrailerPlan } from './types'

/** `HH:MM:SS.mmm`, the only form WebVTT accepts. */
export function vttTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000))
  const ms = total % 1000
  const s = Math.floor(total / 1000) % 60
  const m = Math.floor(total / 60000) % 60
  const h = Math.floor(total / 3600000)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`
}

/** A cue's words: one line, markup characters escaped, and never the `-->` that would end the timing line. */
function cueText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** The captions for a plan: `WEBVTT`, then a numbered cue per line, in order. A plan with no dialogue is a valid, empty file. */
export function buildVtt(plan: TrailerPlan): string {
  const cues: string[] = []
  let shotStart = plan.introSeconds
  for (const shot of plan.shots) {
    const text = shot.line ? cueText(shot.line.text) : ''
    if (shot.line && text !== '') {
      const { on, off } = lineWindow(shot.seconds)
      cues.push(`${cues.length + 1}\n${vttTime(shotStart + on)} --> ${vttTime(shotStart + off)}\n${text}`)
    }
    shotStart += shot.seconds
  }
  return `WEBVTT\n\n${cues.map((cue) => `${cue}\n`).join('\n')}`
}
