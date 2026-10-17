// ffmpeg and ffprobe for the audio clips (v3, slice 22): measure a clip's length
// and level a voice to the loudness the mix expects. A port of the helpers in
// `video/narrate.mts` as a library — no `process.exit`, no top-level side
// effects, no import from `video/` — and asynchronous, because the worker makes
// the shots, the voices and the music side by side and a blocking child process
// would stall the shot polling beside it.
//
// Server only: it spawns processes.
import 'server-only'
import { execFile } from 'node:child_process'
import { rename, rm } from 'node:fs/promises'
import { ProviderError } from '../errors'

/** The voice's loudness on every clip, so the mix constants (`video/src/mix.ts`) mean the same on every line. */
export const VOICE_LUFS = -16
/** Room for the music summed under the voice, and for the mp3's own overshoot. */
const VOICE_TRUE_PEAK_DB = -2

type Ran = { stdout: string; stderr: string }

function run(cmd: string, args: string[]): Promise<Ran> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout, stderr })
      const last = stderr.trim().split('\n').pop() ?? ''
      reject(Object.assign(new Error(`${cmd}: ${last || err.message}`), { code: (err as NodeJS.ErrnoException).code, stderr }))
    })
  })
}

let toolsFound = false

/**
 * Asked before each paid request: a clip that cannot be measured cannot be
 * recorded, so it would be paid for again. A `config` error, because the fix is
 * local (install ffmpeg).
 */
export async function requireMediaTools(): Promise<void> {
  if (toolsFound) return
  try {
    await run('ffmpeg', ['-version'])
    await run('ffprobe', ['-version'])
    toolsFound = true
  } catch (err) {
    throw new ProviderError(
      'The studio can’t prepare audio without ffmpeg. Install ffmpeg (it brings ffprobe) and restart the worker.',
      'config',
      err instanceof Error ? err.message : String(err)
    )
  }
}

/** Seconds of audio, measured — the edit is timed from this, not an estimate. */
export async function measureSeconds(path: string): Promise<number> {
  let stdout: string
  try {
    ;({ stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', path]))
  } catch (err) {
    throw new ProviderError('The audio that came back couldn’t be played.', 'provider', err instanceof Error ? err.message : String(err))
  }
  try {
    const j = JSON.parse(stdout) as { streams?: { codec_name?: string }[]; format?: { duration?: string } }
    const seconds = Number(j.format?.duration)
    if (j.streams?.length && seconds > 0) return seconds
  } catch {
    // Falls through to the sentence below.
  }
  throw new ProviderError('The audio that came back couldn’t be played.', 'provider', 'ffprobe found no audio stream')
}

/**
 * Levels a clip in place: integrated loudness measured (EBU R128), then one
 * linear gain to `VOICE_LUFS` — the voice keeps its own dynamics — held under
 * the true-peak ceiling by a limiter. The provider's clips arrive around −23
 * LUFS, too quiet beside a platform's −14 to −16. Returns the loudness the file
 * has afterwards (the target, or what it already had when it needed no change).
 */
export async function levelClip(path: string): Promise<number> {
  const probe = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-vn', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'])
  const lufs = Number(/^\s+I:\s+(-?[\d.]+) LUFS/m.exec(probe.stderr)?.[1])
  const peak = Number(/^\s+Peak:\s+(-?[\d.]+) dBFS/m.exec(probe.stderr)?.[1])
  if (!Number.isFinite(lufs) || !Number.isFinite(peak)) throw new Error('could not be measured for loudness (silent or unreadable)')
  const gain = VOICE_LUFS - lufs
  if (Math.abs(gain) < 0.3 && peak <= VOICE_TRUE_PEAK_DB) return lufs
  const leveled = `${path}.leveled.mp3`
  // The limiter's ceiling sits under the true-peak target: the encoder overshoots by up to half a decibel.
  const limit = Math.pow(10, (VOICE_TRUE_PEAK_DB - 0.8) / 20).toFixed(3)
  try {
    await run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', path, '-vn', '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=${limit}:attack=5:release=60:level=false`, '-c:a', 'libmp3lame', '-q:a', '2', leveled])
    await rename(leveled, path)
  } catch (err) {
    await rm(leveled, { force: true })
    throw err
  }
  return VOICE_LUFS
}
