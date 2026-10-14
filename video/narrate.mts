// The narration: the learner's script (narration.md) → one mp3 per beat,
// spoken by an ElevenLabs voice through OpenRouter — spec.md > The Demo Video
// Pipeline (v2). The same words are the captions (src/script.ts), so the voice
// and the subtitles cannot disagree.
//
//   cd video && npx tsx narrate.mts --voice <name> [--model elevenlabs/eleven-v4]
//                                   [--only intro,pages] [--dry-run]
//   cd video && npx tsx narrate.mts --samples [george,sarah,...] [--dry-run]
//   npm run video:narrate -- --voice george      (from the repo root)
//
// Writes:
//   video/public/narration/<id>-<key>.mp3   one clip per written section
//   video/public/narration/manifest.json    what prepare.mts reads (NarrationManifest)
//   video/out/voices/<voice>.mp3            --samples: one short sentence per voice
//
// A clip is cached by its key (the words, the voice and the model): run it
// again and only the sections whose words changed are sent, so an edit costs
// cents, not the whole script. Placeholder sections are never sent. The key
// comes from OPENROUTER_API_KEY in the environment or the repo's .env, and is
// never printed.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { CUT } from './src/cut.ts'
import { narrationKey, parseNarration, type NarrationManifest, type NarrationSegment } from './src/script.ts'
import { FPS, NARRATION_LEAD_SECONDS, resolvePlan } from './src/timeline.ts'

const VIDEO = dirname(fileURLToPath(import.meta.url))
const ROOT = join(VIDEO, '..')
const PUBLIC = join(VIDEO, 'public')
const NARRATION_DIR = join(PUBLIC, 'narration')
const MANIFEST = join(NARRATION_DIR, 'manifest.json')
/** The only script: prepare.mts keys the clips on this file's words, so a clip from any other file would never play. */
const SCRIPT = join(VIDEO, 'narration.md')
const VOICES_DIR = join(VIDEO, 'out', 'voices')

const ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech'
const DEFAULT_MODEL = 'elevenlabs/eleven-v4'
/** ElevenLabs' limit per request on OpenRouter (spec.md > Verified for v2). */
const MAX_CHARS = 10_000
/** Read off spec.md > Verified for v2 (and GET /api/v1/models?output_modalities=speech). */
const PRICE_PER_CHAR: Record<string, number> = {
  'elevenlabs/eleven-v4': 0.00004,
  'elevenlabs/eleven-v3': 0.00004,
  'elevenlabs/eleven-multilingual-v2': 0.00004,
  'elevenlabs/eleven-v4-turbo': 0.00002,
  'elevenlabs/eleven-flash-v2.5': 0.00002,
  'elevenlabs/eleven-flash-v2': 0.00002,
  'elevenlabs/eleven-turbo-v2.5': 0.00002,
  'elevenlabs/eleven-turbo-v2': 0.00002,
}
const PREMADE_VOICES = ['george', 'sarah', 'adam', 'alice', 'bella', 'bill', 'brian', 'charlie', 'daniel', 'jessica', 'roger', 'will']
/** Neutral, short (42 characters ≈ $0.002 at eleven-v4), and says what it is for. */
const SAMPLE_SENTENCE = 'This is how Ink Desk sounds in this voice.'

/** `voiceOnly`: the request failed for this voice or these words alone, so other requests may still go. */
class NarrateError extends Error {
  constructor(
    message: string,
    readonly voiceOnly = false,
  ) {
    super(message)
  }
}

function fail(sentence: string): never {
  console.error(`\n${sentence}\n`)
  process.exit(1)
}

// --- the key ---------------------------------------------------------------

/** KEY=value lines only: enough for a .env, and nothing in it is ever echoed. */
function readDotEnv(path: string, name: string): string | undefined {
  if (!existsSync(path)) return undefined
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m || m[1] !== name) continue
    // A quoted value may still carry a comment after its closing quote, as dotenv allows.
    const value = m[2].trim()
    const quoted = /^(["'])(.*)\1\s*(?:#.*)?$/.exec(value)
    return (quoted ? quoted[2] : value.replace(/\s+#.*$/, '')) || undefined
  }
  return undefined
}

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim() || readDotEnv(join(ROOT, '.env'), 'OPENROUTER_API_KEY')
  if (!key) fail('There is no OpenRouter key: set OPENROUTER_API_KEY in the environment or in the .env at the repository root.')
  return key
}

// --- one request -------------------------------------------------------------

type Spoken = { audio: Buffer; generationId: string | null }

/** The provider's message, on one line and short enough to read. */
async function providerMessage(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  let message = body
  try {
    const j = JSON.parse(body) as { error?: { message?: string; metadata?: { raw?: unknown } } }
    message = j.error?.message ?? body
    const raw = j.error?.metadata?.raw
    if (typeof raw === 'string' && raw && !message.includes(raw)) message = `${message} (${raw})`
  } catch {
    // Not JSON: the text itself is the best summary there is.
  }
  message = message.replace(/\s+/g, ' ').trim()
  return message.length > 240 ? `${message.slice(0, 237)}...` : message || 'no reason given'
}

async function speak(key: string, model: string, voice: string, text: string, what: string): Promise<Spoken> {
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text, voice, response_format: 'mp3' }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    throw new NarrateError(`OpenRouter could not be reached while narrating ${what}; check the connection and run again.`)
  }
  if (res.status === 401) throw new NarrateError('OpenRouter refused the key; check OPENROUTER_API_KEY.')
  if (res.status === 402) throw new NarrateError('The OpenRouter account is out of credits; add credits and run again (clips already made are kept).')
  if (res.status === 400 || res.status === 404 || res.status === 422) {
    throw new NarrateError(`OpenRouter would not narrate ${what} with ${model} in "${voice}": ${await providerMessage(res)}`, true)
  }
  if (!res.ok) {
    throw new NarrateError(`OpenRouter could not narrate ${what} just now (${await providerMessage(res)}); try again in a minute.`)
  }
  const type = res.headers.get('content-type') ?? ''
  const audio = Buffer.from(await res.arrayBuffer())
  // An error can come back with a 200 as JSON; never save that as an mp3.
  if (type.includes('json') || audio.length === 0) {
    throw new NarrateError(`OpenRouter answered ${what} without audio: ${audio.toString('utf8').replace(/\s+/g, ' ').slice(0, 240) || 'an empty reply'}`)
  }
  return { audio, generationId: res.headers.get('x-generation-id') }
}

/**
 * Asked before each paid request: a clip that cannot be measured is not
 * recorded, so it would be paid for again on the next run.
 */
function requireFfprobe() {
  if (spawnSync('ffprobe', ['-version']).error) {
    throw new NarrateError('ffprobe is not installed, and the clips cannot be measured without it; install ffmpeg and run again.')
  }
}

/** Seconds of audio, measured — the edit is timed from this, not an estimate. */
function measureSeconds(path: string): number {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', path], {
    encoding: 'utf8',
  })
  if (r.error) throw new NarrateError('ffprobe is not installed, and the clips cannot be measured without it; install ffmpeg and run again.')
  try {
    const j = JSON.parse(r.stdout) as { streams?: { codec_name?: string }[]; format?: { duration?: string } }
    const seconds = Number(j.format?.duration)
    if (j.streams?.length && seconds > 0) return seconds
  } catch {
    // Falls through to the sentence below.
  }
  throw new NarrateError(`${relative(VIDEO, path)} is not playable audio; delete it and run again.`)
}

/**
 * Best effort: OpenRouter's own figure for what the run cost. The stats for a
 * generation appear some seconds after its audio does, so every id is asked
 * for together until all have answered or about twenty seconds have passed.
 */
async function actualCost(key: string, ids: string[]): Promise<number | null> {
  const costs = new Map<string, number>()
  for (let attempt = 0; attempt < 10 && costs.size < ids.length; attempt++) {
    await new Promise((r) => setTimeout(r, 2000))
    await Promise.all(
      ids
        .filter((id) => !costs.has(id))
        .map(async (id) => {
          try {
            const res = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, {
              headers: { Authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(15_000),
            })
            if (!res.ok) return
            const j = (await res.json()) as { data?: { total_cost?: number } }
            if (typeof j.data?.total_cost === 'number') costs.set(id, j.data.total_cost)
          } catch {
            // Not reported yet, or the network blinked; the estimate stands.
          }
        }),
    )
  }
  return costs.size === ids.length ? [...costs.values()].reduce((a, b) => a + b, 0) : null
}

// --- small helpers -------------------------------------------------------------

/** A path as the reader would type it: relative when it is under the current folder, absolute otherwise. */
const shown = (path: string) => {
  const r = relative(process.cwd(), path)
  return r === '' ? '.' : r.startsWith('..') ? path : r
}
const money = (usd: number | null) => (usd === null ? 'price unknown' : `$${usd.toFixed(4)}`)
const estimate = (model: string, chars: number) => (model in PRICE_PER_CHAR ? chars * PRICE_PER_CHAR[model] : null)
/** One unpriced request makes the whole total unknown, rather than quietly $0. */
const addCost = (total: number | null, cost: number | null) => (total === null || cost === null ? null : total + cost)
const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  // Written aside and renamed, so a run stopped mid-write never leaves half a manifest.
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(`${path}.tmp`, path)
}

function readManifest(): NarrationManifest | null {
  if (!existsSync(MANIFEST)) return null
  try {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as NarrationManifest
    return m && typeof m.segments === 'object' ? m : null
  } catch {
    console.warn('public/narration/manifest.json could not be read; every written section will be narrated again.')
    return null
  }
}

/** A section's older clips, so a re-narrated line leaves one file behind, not a pile. */
function removeOlderClips(id: string, keep: string) {
  // Ids are [a-z0-9-] (parseNarration), so they are safe inside the pattern as they are.
  const pattern = new RegExp(`^${id}-[0-9a-f]{14}\\.mp3$`)
  for (const f of readdirSync(NARRATION_DIR)) if (pattern.test(f) && f !== keep) rmSync(join(NARRATION_DIR, f))
}

// --- --samples -------------------------------------------------------------------

async function samples(key: string, model: string, voices: string[], dryRun: boolean) {
  const indexPath = join(VOICES_DIR, 'samples.json')
  const index: Record<string, string> = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {}
  const ids: string[] = []
  const missed: string[] = []
  let spent: number | null = 0
  for (const voice of voices) {
    // The name becomes a file name, so it is held to a plain word.
    if (!/^[a-z0-9_-]+$/i.test(voice)) fail(`"${voice}" is not a voice name; the premade voices are ${PREMADE_VOICES.join(', ')}.`)
  }
  console.log(`Voice samples with ${model}: "${SAMPLE_SENTENCE}" (${SAMPLE_SENTENCE.length} chars each)${dryRun ? ' (dry run: nothing is sent)' : ''}`)
  if (!dryRun) mkdirSync(VOICES_DIR, { recursive: true })
  for (const voice of voices) {
    const file = join(VOICES_DIR, `${voice}.mp3`)
    const k = narrationKey(SAMPLE_SENTENCE, voice, model)
    if (index[voice] === k && existsSync(file)) {
      console.log(`  ${voice.padEnd(8)} cached     ${measureSeconds(file).toFixed(1)} s`)
      continue
    }
    const cost = estimate(model, SAMPLE_SENTENCE.length)
    if (dryRun) {
      console.log(`  ${voice.padEnd(8)} would be sent   ≈ ${money(cost)}`)
      spent = addCost(spent, cost)
      continue
    }
    try {
      requireFfprobe()
      const { audio, generationId } = await speak(key, model, voice, SAMPLE_SENTENCE, `the sample for "${voice}"`)
      // Counted as soon as it is paid for, so a clip that then fails to save or measure still shows in the total.
      spent = addCost(spent, cost)
      if (generationId) ids.push(generationId)
      writeFileSync(file, audio)
      const seconds = measureSeconds(file)
      index[voice] = k
      writeJson(indexPath, index)
      console.log(`  ${voice.padEnd(8)} ${seconds.toFixed(1)} s   ≈ ${money(cost)}   generation ${generationId ?? 'not reported'}`)
    } catch (err) {
      // A voice the provider does not know should not cost the others; a refused key or no credit stops them all.
      if (!(err instanceof NarrateError) || !err.voiceOnly) {
        await report(key, spent, ids)
        throw err
      }
      console.log(`  ${voice.padEnd(8)} not made: ${err.message}`)
      missed.push(voice)
    }
  }
  if (dryRun) {
    console.log(`Total: ≈ ${money(spent)} would be spent`)
    return
  }
  await report(key, spent, ids)
  const made = voices.filter((v) => !missed.includes(v))
  if (made.length) console.log(`\nListen to ${made.map((v) => `${v}.mp3`).join(', ')} in ${shown(VOICES_DIR)}/ and pass the one you like: --voice <name>.`)
  if (missed.length) fail(`No sample was made for ${missed.join(', ')}; the premade voices are ${PREMADE_VOICES.join(', ')}.`)
}

async function report(key: string, estimated: number | null, ids: string[]) {
  const actual = await actualCost(key, ids)
  const line = actual === null ? 'OpenRouter has not reported the actual cost yet' : `actual ${money(actual)}`
  console.log(`Total: ≈ ${money(estimated)} estimated · ${line} · ${ids.length} request${ids.length === 1 ? '' : 's'}`)
}

// --- the narration ------------------------------------------------------------------

async function narrate(opts: { model: string; voice: string; only: string[]; dryRun: boolean }) {
  const { model, voice } = opts
  if (!existsSync(SCRIPT)) fail(`There is no script at ${shown(SCRIPT)}.`)
  let sections: NarrationSegment[]
  try {
    sections = parseNarration(readFileSync(SCRIPT, 'utf8'))
  } catch (err) {
    fail((err as Error).message)
  }
  const beats = new Set(CUT.map((s) => s.id))
  for (const s of sections) {
    if (!beats.has(s.id)) fail(`The script has a "## ${s.id}" section that is not a beat of the edit (src/cut.ts); rename it to one of: ${[...beats].join(', ')}.`)
  }
  for (const id of opts.only) {
    if (!sections.some((s) => s.id === id)) fail(`--only names "${id}", which is not a section of the script.`)
  }
  const chosen = opts.only.length ? sections.filter((s) => opts.only.includes(s.id)) : sections
  // Every limit is checked before the first request, so a long section never costs the ones before it.
  for (const s of chosen) {
    if (!s.placeholder && s.text.length > MAX_CHARS) {
      fail(`The "${s.id}" section has ${s.text.length} characters; one request takes at most ${MAX_CHARS}, so split it or trim it.`)
    }
  }

  const key = opts.dryRun ? '' : apiKey()
  if (!opts.dryRun) mkdirSync(NARRATION_DIR, { recursive: true })
  const previous = readManifest()
  const manifest: NarrationManifest = { model, voice, segments: { ...(previous?.segments ?? {}) } }

  console.log(`Narrating ${shown(SCRIPT)} with ${model} in "${voice}"${opts.dryRun ? ' (dry run: nothing is sent)' : ''}`)
  const ids: string[] = []
  let spent: number | null = 0
  // Sections with a clip in this run's voice and model, made now or cached.
  let current = 0
  let failure: string | null = null
  for (const s of chosen) {
    if (s.placeholder) {
      console.log(`  ${s.id.padEnd(10)} skipped: still a placeholder, nothing sent`)
      continue
    }
    const k = narrationKey(s.text, voice, model)
    const had = manifest.segments[s.id]
    if (had && had.key === k && existsSync(join(PUBLIC, had.src))) {
      console.log(`  ${s.id.padEnd(10)} ${String(s.text.length).padStart(5)} chars   ${had.seconds.toFixed(1).padStart(5)} s   cached`)
      current++
      continue
    }
    const cost = estimate(model, s.text.length)
    if (opts.dryRun) {
      console.log(`  ${s.id.padEnd(10)} ${String(s.text.length).padStart(5)} chars   would be sent   ≈ ${money(cost)}`)
      spent = addCost(spent, cost)
      continue
    }
    try {
      requireFfprobe()
      const { audio, generationId } = await speak(key, model, voice, s.text, `"${s.id}"`)
      // Counted as soon as it is paid for, so a clip that then fails to save or measure still shows in the total.
      spent = addCost(spent, cost)
      if (generationId) ids.push(generationId)
      const name = `${s.id}-${k}.mp3`
      writeFileSync(join(NARRATION_DIR, name), audio)
      const seconds = measureSeconds(join(NARRATION_DIR, name))
      removeOlderClips(s.id, name)
      manifest.segments[s.id] = { src: `narration/${name}`, seconds: Math.round(seconds * 1000) / 1000, key: k }
      // Saved after every clip: a stop half-way keeps (and caches) what was made.
      writeJson(MANIFEST, manifest)
      current++
      console.log(
        `  ${s.id.padEnd(10)} ${String(s.text.length).padStart(5)} chars   ${seconds.toFixed(1).padStart(5)} s   ≈ ${money(cost)}   generation ${generationId ?? 'not reported'}`,
      )
    } catch (err) {
      if (!(err instanceof NarrateError)) throw err
      failure = err.message
      break
    }
  }

  if (opts.dryRun) {
    console.log(`Total: ≈ ${money(spent)} would be spent`)
    return
  }
  // prepare.mts plays only the clips that match the manifest's voice and model,
  // so they switch only once this run has a clip in the new ones; a failed
  // first request or a run that sent nothing keeps the earlier clips playing.
  const switched = previous && (previous.voice !== voice || previous.model !== model)
  if (current > 0) {
    // A voice or model change makes every clip not re-made in this run stale.
    if (previous && switched) {
      const stale = Object.entries(manifest.segments)
        .filter(([id, c]) => {
          const s = sections.find((x) => x.id === id)
          return s && c.key !== narrationKey(s.text, voice, model)
        })
        .map(([id]) => id)
      if (stale.length) console.log(`The earlier clips were ${previous.model} in "${previous.voice}"; ${stale.join(', ')} will be narrated again on a full run.`)
    }
    writeJson(MANIFEST, manifest)
  } else if (previous && switched) {
    console.log(`No clip was made with ${model} in "${voice}", so the narration stays ${previous.model} in "${previous.voice}".`)
  }
  await report(key, spent, ids)
  const kept = current > 0 ? manifest : previous
  if (kept) roomCheck(sections, kept)
  if (failure) fail(failure)
}

/** Each current clip against its beat's room — the budgeted length, less the lead-in. */
function roomCheck(sections: readonly NarrationSegment[], manifest: NarrationManifest) {
  const plan = resolvePlan(CUT, [], false)
  for (const seg of plan.segments) {
    const s = sections.find((x) => x.id === seg.id)
    const clip = manifest.segments[seg.id]
    if (!s || s.placeholder || !clip || clip.key !== narrationKey(s.text, manifest.voice, manifest.model)) continue
    const room = seg.durationInFrames / FPS - NARRATION_LEAD_SECONDS
    if (clip.seconds > room) {
      console.log(`Runs long: "${seg.id}" is ${clip.seconds.toFixed(1)} s and its beat has room for ${room.toFixed(1)} s; trim the words or lengthen the beat in src/cut.ts.`)
    }
  }
}

// --- the command line ----------------------------------------------------------------

async function main() {
  // `--samples` takes an optional list; a bare one means every premade voice.
  const argv = process.argv.slice(2).flatMap((a, i, all) => (a === '--samples' && (i === all.length - 1 || all[i + 1].startsWith('--')) ? ['--samples=all'] : [a]))
  let values: { voice?: string; model?: string; only?: string; samples?: string; 'dry-run'?: boolean }
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        voice: { type: 'string' },
        model: { type: 'string' },
        only: { type: 'string' },
        samples: { type: 'string' },
        'dry-run': { type: 'boolean' },
      },
    }))
  } catch (err) {
    fail(`${(err as Error).message.replace(/\s+/g, ' ').replace(/\.?$/, '.')} Usage: npx tsx narrate.mts --voice <name> [--model <id>] [--only a,b] [--dry-run], or --samples [a,b] [--dry-run].`)
  }
  const model = values.model?.trim() || DEFAULT_MODEL
  const dryRun = values['dry-run'] === true

  if (values.samples !== undefined) {
    const voices = values.samples === 'all' ? PREMADE_VOICES : list(values.samples)
    // A dry run needs no key, so it cannot send anything even by mistake.
    await samples(dryRun ? '' : apiKey(), model, voices, dryRun)
    return
  }

  const voice = values.voice?.trim() || process.env.NARRATION_VOICE?.trim() || readDotEnv(join(ROOT, '.env'), 'NARRATION_VOICE')
  // The voice is the learner's choice, so there is no default to fall back on.
  if (!voice) {
    fail(`Pick a voice first — pass --voice <name> or set NARRATION_VOICE (in .env or the shell); the premade voices are ${PREMADE_VOICES.join(', ')} (hear them with --samples).`)
  }
  await narrate({
    model,
    voice,
    only: list(values.only),
    dryRun,
  })
}

main().catch((err) => fail(err instanceof NarrateError ? err.message : `The narration stopped unexpectedly: ${(err as Error).message}`))
