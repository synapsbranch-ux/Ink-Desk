// The trailer's assembly (v3, slice 22): ffmpeg in the worker turns four silent
// Seedance clips, up to four voice lines and one music clip into `final.mp4`.
// (Remotion is out: it needs a headless Chromium and its own licence; ffmpeg is
// already on the worker's machine for the voices' levelling.)
//
// What the film is, on one clock of 24 fps CFR at 1280 x 720:
//   - the opening card (`cards.ts`) held for `introSeconds`;
//   - the four shots in panel order — a 16:9 clip fills the frame, a 1:1 clip is
//     scaled to 720 x 720 and centred on the paper canvas — each trimmed or held
//     (last frame) to exactly its planned seconds, with its line's bubble
//     (`bubbles.ts`) faded in and out between the line's `lineWindow` times;
//   - the closing hold: the last shot's last frame for `outroSeconds`, fading to
//     paper; the whole picture fades in from paper over its first quarter second;
//   - each voice line delayed to its bubble (+ 0.2 s), sped up by at most 1.25x if
//     it is longer than its shot allows, then cut with a 0.15 s fade — never
//     running past the shot's end, so two lines can never overlap;
//   - the music under it all, multiplied by the envelope WAV of `envelope.ts`
//     (v2's constants: base level, a duck under every line, fades), the lot
//     levelled by `loudnorm` to -14 LUFS, AAC 192k, H.264 yuv420p, faststart.
// And `poster.jpg`, a frame 1.2 s into the first shot, and `captions.vtt`'s text.
//
// `buildFfmpegArgs` is PURE — no fs, no spawn — so `check:video` asserts exactly
// what ffmpeg is told. `assembleTrailer` writes the stills and the envelope into
// `workDir`, runs ffmpeg (spawned with an argument array, never through a shell, so
// a path with spaces or quotes is just a path), and measures the result.
//
// Server only.
import 'server-only'
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderBubbleOverlay, shotRect } from './bubbles'
import { buildVtt } from './captions'
import { renderTitleCard, PAPER } from './cards'
import { ENVELOPE_RATE, MUSIC_BASE, writeGainEnvelope, type DuckWindow } from './envelope'
import { lineWindow } from './plan'
import { TRAILER_FPS, TRAILER_HEIGHT, TRAILER_WIDTH, type TrailerPlan } from './types'

export type AssembleInput = {
  plan: TrailerPlan
  /** Panel index -> the shot's clip (a local file). Every shot of the plan needs one. */
  clips: Record<number, string>
  /** Panel index -> the line's voice clip and its measured length. A line without one is shown, not spoken. */
  speech: Record<number, { path: string; seconds: number }>
  music: { path: string; seconds: number } | null
  /** A scratch folder for the stills and the envelope. */
  workDir: string
  /** Where `final.mp4` and `poster.jpg` are written. */
  outDir: string
}

// --- Timing (all seconds on the film's clock) ------------------------------------------------------

/** A voice comes in this long after its bubble. */
export const VOICE_LEAD_SECONDS = 0.2
/** A line longer than its shot allows is sped up by at most this much, then cut short with a fade. */
export const VOICE_MAX_TEMPO = 1.25
export const VOICE_FADE_SECONDS = 0.15
/** A line stops this long before its shot's last frame. */
const VOICE_END_MARGIN_SECONDS = 0.05
/** The picture fades in from paper, and the closing hold fades out to it. */
export const FADE_IN_SECONDS = 0.25
export const OUTRO_FADE_SECONDS = 1.5
/** The bubble comes on and goes off softly. */
const BUBBLE_FADE_SECONDS = 0.2
/** The poster is this far into the first shot. */
export const POSTER_OFFSET_SECONDS = 1.2

/** When each shot starts on the film's clock: after the opening card and the shots before it. */
export function shotStarts(plan: TrailerPlan): number[] {
  const starts: number[] = []
  let at = plan.introSeconds
  for (const shot of plan.shots) {
    starts.push(at)
    at += shot.seconds
  }
  return starts
}

export type SpeechSlot = {
  panel: number
  path: string
  /** When the voice starts on the film's clock. */
  start: number
  tempo: number
  /** How long it plays, after the speed-up and any cut. */
  seconds: number
  /** Cut short by its shot's end: it ends with a fade-out. */
  cut: boolean
}

/** Where every voice line that has a clip lands: pure, and what the music's duck follows. */
export function scheduleSpeech(plan: TrailerPlan, speech: AssembleInput['speech']): SpeechSlot[] {
  const starts = shotStarts(plan)
  const slots: SpeechSlot[] = []
  plan.shots.forEach((shot, i) => {
    const clip = speech[shot.panel]
    if (!shot.line || !clip || !(clip.seconds > 0)) return
    const start = starts[i] + lineWindow(shot.seconds).on + VOICE_LEAD_SECONDS
    const room = starts[i] + shot.seconds - VOICE_END_MARGIN_SECONDS - start
    const tempo = clip.seconds <= room ? 1 : Math.min(VOICE_MAX_TEMPO, clip.seconds / room)
    const natural = clip.seconds / tempo
    slots.push({ panel: shot.panel, path: clip.path, start, tempo, seconds: Math.min(natural, room), cut: natural > room })
  })
  return slots
}

export const duckWindows = (slots: readonly SpeechSlot[]): DuckWindow[] => slots.map((s) => ({ start: s.start, seconds: s.seconds }))

// --- The ffmpeg command ------------------------------------------------------------------------------

/** A number as ffmpeg takes it: millisecond precision, no trailing zeros. */
const n = (x: number) => String(Math.round(x * 1000) / 1000)
const colour = (hex: string) => `0x${hex.replace('#', '')}`

/**
 * The whole command as an argument list (without the program name). Pure:
 * `overlays` maps a panel to its bubble PNG, `titleCard` and `envelope` are the
 * stills and the WAV already written (`envelope` null = no music, or music at its
 * flat base level). Throws a plain Error if a shot of the plan has no clip.
 */
export function buildFfmpegArgs(input: AssembleInput & { overlays: Record<number, string>; titleCard: string; envelope: string | null }): string[] {
  const { plan } = input
  const total = plan.runSeconds
  const args: string[] = ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error', '-y']
  const filters: string[] = []
  let next = 0
  const addInput = (...a: string[]): number => {
    args.push(...a)
    return next++
  }
  const canvas = `${TRAILER_WIDTH}:${TRAILER_HEIGHT}`
  const fps = String(TRAILER_FPS)

  // Picture: the opening card.
  const card = addInput('-loop', '1', '-framerate', fps, '-t', n(plan.introSeconds), '-i', input.titleCard)
  filters.push(
    `[${card}:v]fps=${fps},scale=${canvas}:out_color_matrix=bt709:out_range=tv,setsar=1,trim=duration=${n(plan.introSeconds)},setpts=PTS-STARTPTS,format=yuv420p[intro]`,
  )

  // Picture: the shots, each with its bubble.
  const labels: string[] = ['[intro]']
  plan.shots.forEach((shot, i) => {
    const clip = input.clips[shot.panel]
    if (!clip) throw new Error(`panel ${shot.panel + 1} has no clip to assemble`)
    const clipIn = addInput('-i', clip)
    const rect = shotRect(shot.aspect, TRAILER_WIDTH, TRAILER_HEIGHT)
    const S = n(shot.seconds)
    filters.push(
      `[${clipIn}:v]fps=${fps},scale=${rect.w}:${rect.h}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${canvas}:(ow-iw)/2:(oh-ih)/2:color=${colour(PAPER)},setsar=1,setpts=PTS-STARTPTS,` +
        `tpad=stop_mode=clone:stop_duration=${S},trim=duration=${S},setpts=PTS-STARTPTS,format=yuv420p[b${i}]`,
    )
    let tail = `[b${i}]`
    const overlay = shot.line ? input.overlays[shot.panel] : undefined
    if (shot.line && overlay) {
      const { on, off } = lineWindow(shot.seconds)
      const ov = addInput('-loop', '1', '-framerate', fps, '-t', S, '-i', overlay)
      const fade = Math.min(BUBBLE_FADE_SECONDS, (off - on) / 2)
      filters.push(
        `[${ov}:v]format=rgba,fade=t=in:st=${n(on)}:d=${n(fade)}:alpha=1,fade=t=out:st=${n(off - fade)}:d=${n(fade)}:alpha=1[o${i}]`,
        `[b${i}][o${i}]overlay=0:0:format=auto:eof_action=pass:enable='between(t,${n(on)},${n(off)})',trim=duration=${S},setpts=PTS-STARTPTS,format=yuv420p[s${i}]`,
      )
      tail = `[s${i}]`
    }
    if (i === plan.shots.length - 1) {
      // The closing hold: the last frame, fading to paper — fully paper by the film's last frame.
      const fade = Math.min(OUTRO_FADE_SECONDS, plan.outroSeconds)
      filters.push(
        `${tail}tpad=stop_mode=clone:stop_duration=${n(plan.outroSeconds)},` +
          `fade=t=out:st=${n(shot.seconds + plan.outroSeconds - fade)}:d=${n(fade - 2 / TRAILER_FPS)}:color=${colour(PAPER)},format=yuv420p[v${i}]`,
      )
    } else {
      filters.push(`${tail}null[v${i}]`)
    }
    labels.push(`[v${i}]`)
  })
  // The film is exactly `total` long: a filter that meets the end of its input can swallow the last frame (measured: one 1/24 s short with a bubble on the last shot), so the tail is padded with its own last frame — paper, by then — and trimmed to the plan's length.
  filters.push(
    `${labels.join('')}concat=n=${labels.length}:v=1:a=0,fade=t=in:st=0:d=${n(FADE_IN_SECONDS)}:color=${colour(PAPER)},fps=${fps},` +
      `tpad=stop_mode=clone:stop_duration=0.5,trim=duration=${n(total)},setpts=PTS-STARTPTS,format=yuv420p[vout]`,
  )

  // Sound: a silent base the whole length of the film (so the mix is exactly as long as the picture), the voices, the music.
  const silence = addInput('-f', 'lavfi', '-t', n(total), '-i', `anullsrc=r=${ENVELOPE_RATE}:cl=stereo`)
  filters.push(`[${silence}:a]aformat=sample_rates=${ENVELOPE_RATE}:channel_layouts=stereo[sil]`)
  const mix: string[] = ['[sil]']
  const slots = scheduleSpeech(plan, input.speech)
  for (const slot of slots) {
    const voice = addInput('-i', slot.path)
    const label = `a${slot.panel}`
    const chain = [`aformat=sample_rates=${ENVELOPE_RATE}:channel_layouts=mono`, 'pan=stereo|c0=c0|c1=c0']
    if (slot.tempo > 1) chain.push(`atempo=${slot.tempo.toFixed(4)}`)
    chain.push(`atrim=duration=${n(slot.seconds)}`, 'asetpts=PTS-STARTPTS')
    if (slot.cut) chain.push(`afade=t=out:st=${n(Math.max(0, slot.seconds - VOICE_FADE_SECONDS))}:d=${n(VOICE_FADE_SECONDS)}`)
    chain.push(`adelay=${Math.round(slot.start * 1000)}:all=1`)
    filters.push(`[${voice}:a]${chain.join(',')}[${label}]`)
    mix.push(`[${label}]`)
  }
  if (input.music) {
    // A track shorter than the film is looped; the fade-out at the end hides the seam.
    const loops = input.music.seconds > 0 && input.music.seconds < total ? ['-stream_loop', '-1'] : []
    const music = addInput(...loops, '-i', input.music.path)
    const shaped = `[${music}:a]aformat=sample_rates=${ENVELOPE_RATE}:channel_layouts=stereo,atrim=duration=${n(total)},asetpts=PTS-STARTPTS`
    if (input.envelope) {
      const env = addInput('-i', input.envelope)
      filters.push(
        `${shaped}[m0]`,
        `[${env}:a]aformat=sample_rates=${ENVELOPE_RATE}:channel_layouts=mono,pan=stereo|c0=c0|c1=c0,atrim=duration=${n(total)},asetpts=PTS-STARTPTS[e0]`,
        `[m0][e0]amultiply[mus]`,
      )
    } else {
      filters.push(`${shaped},volume=${MUSIC_BASE}[mus]`)
    }
    mix.push('[mus]')
  }
  if (mix.length > 1) {
    filters.push(
      `${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first:dropout_transition=0,` +
        `loudnorm=I=-14:LRA=11:TP=-1.5,aresample=${ENVELOPE_RATE},atrim=duration=${n(total)},asetpts=PTS-STARTPTS[aout]`,
    )
  } else {
    filters.push('[sil]anull[aout]')
  }

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', fps, '-fps_mode', 'cfr',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '192k', '-ar', String(ENVELOPE_RATE),
    '-movflags', '+faststart',
    '-t', n(total),
    join(input.outDir, 'final.mp4'),
  )
  return args
}

/** One frame inside the first shot, as the poster. */
export function buildPosterArgs(plan: TrailerPlan, finalPath: string, posterPath: string): string[] {
  const at = plan.introSeconds + Math.min(POSTER_OFFSET_SECONDS, Math.max(0, plan.shots[0].seconds - 0.1))
  return ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error', '-y', '-ss', n(at), '-i', finalPath, '-frames:v', '1', '-q:v', '3', posterPath]
}

// --- Running it --------------------------------------------------------------------------------------

/** Longest ffmpeg may run: a 25 s film at 720p is well under a minute on a worker; this only stops a hung process. */
const FFMPEG_TIMEOUT_MS = 8 * 60 * 1000
const STDERR_KEEP_BYTES = 16 * 1024

function run(program: string, args: string[], timeoutMs = FFMPEG_TIMEOUT_MS): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-STDERR_KEEP_BYTES)
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new Error(err.code === 'ENOENT' ? `${program} is not installed on this machine` : `${program} could not start: ${err.message}`))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) return resolve({ stdout })
      const tail = stderr.trim().split('\n').slice(-12).join('\n')
      reject(new Error(`${program} ${timedOut ? `was stopped after ${Math.round(timeoutMs / 1000)} s` : `exited with ${code ?? signal}`}${tail ? `:\n${tail}` : ''}`))
    })
  })
}

async function measureSeconds(path: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], 60_000)
  const seconds = Number.parseFloat(stdout.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('the assembled trailer has no measurable length')
  return seconds
}

/**
 * Writes the opening card, the bubbles and the music envelope into `workDir`,
 * runs ffmpeg into `outDir/final.mp4`, takes `poster.jpg` and returns both paths,
 * the captions' text and the finished film's measured length. A failed run throws
 * an Error that carries ffmpeg's last lines (for the log, never for the browser);
 * a half-written `final.mp4` is removed.
 */
export async function assembleTrailer(input: AssembleInput): Promise<{ finalPath: string; posterPath: string; captions: string; seconds: number }> {
  const { plan } = input
  await mkdir(input.workDir, { recursive: true })
  await mkdir(input.outDir, { recursive: true })

  const titleCard = join(input.workDir, 'title.png')
  await writeFile(titleCard, await renderTitleCard({ title: plan.title, page: plan.page }))

  const overlays: Record<number, string> = {}
  for (const shot of plan.shots) {
    if (!shot.line) continue
    const path = join(input.workDir, `bubble-${shot.panel}.png`)
    await writeFile(path, await renderBubbleOverlay({ line: shot.line, aspect: shot.aspect }))
    overlays[shot.panel] = path
  }

  let envelope: string | null = null
  if (input.music) {
    envelope = join(input.workDir, 'music-gain.wav')
    await writeGainEnvelope(envelope, duckWindows(scheduleSpeech(plan, input.speech)), plan.runSeconds)
  }

  const finalPath = join(input.outDir, 'final.mp4')
  const posterPath = join(input.outDir, 'poster.jpg')
  try {
    await run('ffmpeg', buildFfmpegArgs({ ...input, overlays, titleCard, envelope }))
    await run('ffmpeg', buildPosterArgs(plan, finalPath, posterPath), 60_000)
    const seconds = await measureSeconds(finalPath)
    return { finalPath, posterPath, captions: buildVtt(plan), seconds }
  } catch (err) {
    await rm(finalPath, { force: true })
    await rm(posterPath, { force: true })
    throw err
  }
}
