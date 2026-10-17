// The trailer's music (v3, slice 22): one clip from a music model through
// OpenRouter. A port of `video/music/generate.mts` as a library — no
// `process.exit`, no top-level side effects, no import from `video/` — whose
// verified request shape it keeps (`spec.md > Verified for v2`, 2026-10-14):
// audio output needs `stream: true` and `modalities: ['text', 'audio']`; the mp3
// arrives base64 in `choices[0].delta.audio.data` chunks; `usage.cost` closes the
// stream.
//
// Best effort in the runner, like the voices: a failure is a warning on the video
// record and the trailer is assembled without music. A 402 carries
// `code: 'credits'` for the queue's breaker. Server only: it reads the key at call
// time (never logged) and spawns ffprobe.
import 'server-only'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ProviderError } from '../errors'
import { API_BASE, failureOf, openRouterKey, postJson } from '../openrouter'
import { MUSIC_USD } from '../video/cost'
import { measureSeconds, requireMediaTools } from './media'

const ENDPOINT = `${API_BASE}/chat/completions`
/** Lyria answers a 30 s clip in well under this; the stream is cut off if it goes on longer. */
const TIMEOUT_MS = 300_000
const BUSY = 'The music didn’t come back just now.'
/** Read off `GET /api/v1/models` on 2026-10-14: a flat price per piece, not per token. Used when the stream carries no figure. */
const PRICE_PER_PIECE: Record<string, number> = {
  'google/lyria-3-pro-preview': 0.08,
  'google/lyria-3-clip-preview': 0.04,
}

/**
 * What the music model is asked for: `video/music/prompt.txt`'s mood (calm,
 * nostalgic and hopeful synthwave under a voice) cut to a clip. It is background
 * under spoken lines, so nothing sudden; the assembly fades it in, ducks it under
 * each line and fades it out, and trims it to the trailer's length.
 */
export const MUSIC_PROMPT =
  'Instrumental only, no vocals, no lyrics. A short piece of about thirty seconds. Dreamy ambient synthwave: slow warm analogue synth pads with gentle chorus, a soft side-chain pumping synth bass, a gentle arpeggio with delay, hazy lo-fi tape sheen, quiet soft drums that stay in the background. 84 BPM, D minor, calm, nostalgic and hopeful. A sparse pads-only opening that builds gradually and settles at the end. It is background music under a spoken voice-over, so keep it smooth at a steady level with no sudden loud hits.'

export type MusicInput = {
  model: string
  prompt: string
  /** Where the mp3 is written (its folder is made). */
  destPath: string
}

type Chunk = {
  usage?: { cost?: number }
  error?: { message?: string }
  choices?: { delta?: { content?: string; audio?: { data?: string } } }[]
}

/** The server-sent events of one generation: audio chunks base64, the cost at the end. Throws a `ProviderError` on an error event. */
async function readStream(res: Response): Promise<{ audio: Buffer; cost: number | null }> {
  const chunks: string[] = []
  let cost: number | null = null
  let buffer = ''
  const decoder = new TextDecoder()
  try {
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(part, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
        let j: Chunk
        try {
          j = JSON.parse(line.slice(6)) as Chunk
        } catch {
          continue
        }
        if (j.error?.message) throw new ProviderError(BUSY, 'provider', `stream error: ${j.error.message.replace(/\s+/g, ' ').slice(0, 240)}`)
        if (typeof j.usage?.cost === 'number') cost = j.usage.cost
        for (const c of j.choices ?? []) if (c.delta?.audio?.data) chunks.push(c.delta.audio.data)
      }
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err
    throw new ProviderError(BUSY, 'provider', err instanceof Error ? err.name : 'error')
  }
  // Each chunk decoded on its own: a padded chunk in the middle would end a single joined decode early.
  return { audio: Buffer.concat(chunks.map((c) => Buffer.from(c, 'base64'))), cost }
}

/** Generates one clip and writes it to `destPath`. Reports the measured seconds and what it cost (the stream's own figure, else the model's flat price). */
export async function makeMusic(input: MusicInput): Promise<{ seconds: number; costUsd: number }> {
  const key = openRouterKey('music model')
  const prompt = input.prompt.trim()
  if (prompt === '') throw new ProviderError('There is no description of the music to make.', 'refused')
  // Asked before paying: a clip that cannot be measured would be paid for again.
  await requireMediaTools()

  const res = await postJson({
    url: ENDPOINT,
    key,
    body: JSON.stringify({
      model: input.model,
      stream: true,
      modalities: ['text', 'audio'],
      audio: { format: 'mp3' },
      messages: [{ role: 'user', content: prompt }],
    }),
    timeoutMs: TIMEOUT_MS,
    label: 'music',
    busy: BUSY,
  })
  if (!res.ok) throw await failureOf(res, { label: 'music', busy: BUSY, what: 'music model' })
  if (!res.body) throw new ProviderError(BUSY, 'provider', '200 without a body')

  const { audio, cost } = await readStream(res)
  if (audio.length === 0) throw new ProviderError(BUSY, 'provider', '200 without audio')

  await mkdir(dirname(input.destPath), { recursive: true })
  const part = `${input.destPath}.part.mp3`
  try {
    await writeFile(part, audio)
    const seconds = await measureSeconds(part)
    await rename(part, input.destPath)
    const costUsd = cost ?? PRICE_PER_PIECE[input.model] ?? MUSIC_USD
    console.log(`[music] ${seconds.toFixed(1)}s · ${cost === null ? `$${costUsd.toFixed(4)} (price list)` : `$${costUsd.toFixed(4)}`} · ${input.model}`)
    return { seconds, costUsd }
  } catch (err) {
    await rm(part, { force: true })
    throw err
  }
}
