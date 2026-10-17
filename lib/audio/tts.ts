// A spoken line (v3, slice 22): one speech request to OpenRouter's ElevenLabs
// voices, leveled to the loudness the mix expects and measured. A port of
// `speak()`, `levelClip()` and the ffprobe measuring in `video/narrate.mts` as a
// library — no `process.exit`, no top-level side effects, no import from
// `video/` — so the trailer's runner can speak each panel's dialogue in its
// character's voice. See `devpost/spec.md > Animate a Page (v3)` and
// `> Verified for v2` (the endpoint and its price).
//
// The runner treats a voice line as best effort: a failure is a warning on the
// video record and the trailer is assembled without it. So this throws a
// `ProviderError` with a calm sentence and leaves nothing behind; a 402 carries
// `code: 'credits'` for the queue's breaker.
//
// Server only: it reads the key (`OPENROUTER_API_KEY`, at call time, never
// logged) and spawns ffmpeg.
import 'server-only'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ProviderError } from '../errors'
import { API_BASE, failureOf, openRouterKey, postJson } from '../openrouter'
import { TTS_USD_PER_CHAR } from '../video/cost'
import { levelClip, measureSeconds, requireMediaTools } from './media'

const ENDPOINT = `${API_BASE}/audio/speech`
/** ElevenLabs' limit per request on OpenRouter (`spec.md > Verified for v2`). A trailer line is far shorter (`MAX_LINE_CHARS`). */
const MAX_CHARS = 10_000
const TIMEOUT_MS = 120_000
const BUSY = 'A voice line didn’t come back just now.'

export type SpeakInput = {
  text: string
  /** An ElevenLabs premade voice name (`lib/video/plan.ts > VOICES`). */
  voice: string
  model: string
  /** Where the leveled mp3 is written (its folder is made). */
  destPath: string
}

/** A figure the response itself carries, if it carries one: speech comes back as bytes, so only a header could say. */
function billedUsd(headers: Headers): number | null {
  for (const name of ['x-openrouter-cost', 'x-generation-cost']) {
    const raw = headers.get(name)
    const value = raw === null ? NaN : Number(raw)
    if (Number.isFinite(value) && value >= 0) return value
  }
  return null
}

/**
 * Speaks `text` in `voice` and writes `destPath` as an mp3 at −16 LUFS: the
 * loudness measured (EBU R128), then one linear gain under a true-peak limiter.
 * Reports the measured seconds and the cost — characters × the model's price
 * (`TTS_USD_PER_CHAR`) unless the response says what it billed.
 */
export async function speak(input: SpeakInput): Promise<{ seconds: number; costUsd: number }> {
  const key = openRouterKey('voice model')
  const text = input.text.replace(/\s+/g, ' ').trim()
  if (text === '') throw new ProviderError('This line has no words to speak.', 'refused')
  if (text.length > MAX_CHARS) throw new ProviderError('This line is too long to speak.', 'refused')
  // The name travels in a JSON body, never a path; it is still held to a plain word.
  if (!/^[a-z0-9_-]{1,40}$/i.test(input.voice)) throw new ProviderError('That voice isn’t one the studio knows.', 'refused')
  // Asked before the paid request: a clip that cannot be measured is not recorded, so it would be paid for twice.
  await requireMediaTools()

  const res = await postJson({
    url: ENDPOINT,
    key,
    body: JSON.stringify({ model: input.model, input: text, voice: input.voice, response_format: 'mp3' }),
    timeoutMs: TIMEOUT_MS,
    label: `voice · ${text.length} chars`,
    busy: BUSY,
  })
  // A 400/404/422 is this voice or these words alone; the sentence is the same calm one, the cause is in the terminal.
  if (!res.ok) throw await failureOf(res, { label: 'voice', busy: BUSY, what: 'voice model' })

  const type = res.headers.get('content-type') ?? ''
  let audio: Buffer
  try {
    audio = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    throw new ProviderError(BUSY, 'provider', err instanceof Error ? err.name : 'error')
  }
  // An error can come back with a 200 as JSON; never save that as an mp3.
  if (type.includes('json') || type.includes('text') || audio.length === 0) {
    throw new ProviderError(BUSY, 'provider', `200 without audio: ${audio.toString('utf8').replace(/\s+/g, ' ').slice(0, 240) || 'an empty reply'}`)
  }
  const billed = billedUsd(res.headers)

  await mkdir(dirname(input.destPath), { recursive: true })
  const raw = `${input.destPath}.part.mp3`
  try {
    await writeFile(raw, audio)
    // The clip is paid for by now. A leveling that fails keeps the unleveled clip (the assembly's final loudnorm still evens it out) rather than lose it.
    try {
      await levelClip(raw)
    } catch (err) {
      console.warn(`[tts] a voice line could not be leveled, kept as it came: ${err instanceof Error ? err.message : 'ffmpeg failed'}`)
    }
    const seconds = await measureSeconds(raw)
    await rename(raw, input.destPath)
    const costUsd = billed ?? text.length * TTS_USD_PER_CHAR
    console.log(`[tts] ${input.voice} — ${text.length} chars · ${seconds.toFixed(1)}s · $${costUsd.toFixed(4)} · ${input.model}`)
    return { seconds, costUsd }
  } catch (err) {
    await rm(raw, { force: true })
    throw err
  }
}
