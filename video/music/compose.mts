// The demo's music, composed and synthesized right here — no samples, no
// third-party material, so the licence beside the track is the project's own
// (CC0). An ambient future-wave instrumental to sit under the voice-over: warm
// pads, a bass that pumps with the kick, a soft arpeggio, a quiet drum pulse,
// a lo-fi sheen. The arrangement follows the edit (src/cut.ts) by beat id —
// pads alone on the intro, fullest on the pages and the money shot, thin on
// the method, landing on the tonic and fading out on the outro — so a re-cut
// edit re-shapes the track: `npm run video:music`. Deterministic: the same
// code gives the same bytes. Writes out/music/track.wav, encodes it to
// public/music/track.mp3 (ffmpeg, libmp3lame) and writes its LICENSE.txt.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CUT } from '../src/cut.ts'
import { FPS, resolvePlan } from '../src/timeline.ts'

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SR = 44100
const BPM = 84
const BEAT = 60 / BPM
const BAR = 4 * BEAT
/** Control rate: gains, the tape wobble and the filter sweep move once per block. */
const BLOCK = 1 << 6
const blockOf = (n: number) => n >> 6
/** Silence after the edit's last frame, so the fade never cuts before the picture. */
const TAIL = 0.5
/** Loudness: the render plays the track at 0.12 under the voice. */
const TARGET_RMS_DB = -15
const CEILING_DB = -2.2

// --- The arrangement, keyed on the beats' ids --------------------------------
// 0..1 per stem. An id the table does not know gets DEFAULT, so a re-cut edit
// still gets music; the order of the beats never matters.
type Level = { pads: number; bass: number; arp: number; drums: number; shine: number }
const DEFAULT: Level = { pads: 0.9, bass: 0.85, arp: 0.7, drums: 0.7, shine: 0.3 }
const LEVELS: Record<string, Partial<Level>> = {
  intro: { pads: 1, bass: 0, arp: 0, drums: 0, shine: 0.25 },
  dashboard: { arp: 0.6, drums: 0.55, shine: 0.2 },
  library: { arp: 0.75, drums: 0.65 },
  director: { pads: 1, arp: 0.7, drums: 0.75, shine: 0.4 },
  pages: { pads: 1, bass: 1, arp: 1, drums: 1, shine: 0.8 },
  moneyshot: { pads: 1, bass: 1, arp: 1, drums: 1, shine: 1 },
  reader: { arp: 0.8, drums: 0.7, shine: 0.4 },
  method: { pads: 0.8, bass: 0.6, arp: 0.3, drums: 0.25, shine: 0.15 },
  outro: { pads: 1, bass: 0.7, arp: 0, drums: 0, shine: 0.5 },
}
/** Seconds a stem takes to move from one beat's level to the next. */
const RAMP: Level = { pads: 2.5, bass: 1.5, arp: 1.5, drums: 0.8, shine: 2.5 }

// --- The material: D minor, a loop of my own ---------------------------------
type Chord = { name: string; pad: number[]; root: number }
const LOOP: Chord[] = [
  { name: 'Dm9', pad: [50, 53, 57, 60, 64], root: 38 },
  { name: 'Bbmaj9', pad: [46, 50, 53, 57, 60], root: 34 },
  { name: 'Gm9', pad: [43, 53, 58, 62, 69], root: 31 },
  { name: 'Am11', pad: [45, 55, 60, 62, 64], root: 33 },
]
/** Where the outro lands: the tonic, no 7th, the 9th on top. */
const HOME: Chord = { name: 'Dm(add9)', pad: [50, 53, 57, 64, 69], root: 38 }

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const dB = (x: number) => 10 ** (x / 20)
const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-12))
const TAU = 2 * Math.PI

/** mulberry32 — every random choice below comes from this one seeded stream. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = seeded(0x494e4b)

// --- The edit, as time ---------------------------------------------------------
const plan = resolvePlan(CUT, [], false)
const beats = plan.segments.map((s) => ({
  id: s.id,
  start: s.startFrame / FPS,
  end: (s.startFrame + s.durationInFrames) / FPS,
  level: { ...DEFAULT, ...LEVELS[s.id] } as Level,
}))
const END = plan.seconds
const N = Math.round((END + TAIL) * SR)
const BLOCKS = Math.ceil(N / BLOCK)
const outro = beats.find((b) => b.id === 'outro')

// Two bars a chord; from the outro on (anticipated by a beat), HOME.
type Event = { chord: Chord; start: number; end: number }
const events: Event[] = []
{
  const homeFrom = outro ? outro.start - BEAT : Infinity
  // Counted in bars, not seconds, so equal chords in a row merge exactly.
  const runs: { chord: Chord; from: number; to: number }[] = []
  for (let bar = 0; bar * BAR < END + TAIL; bar++) {
    const chord = bar * BAR >= homeFrom ? HOME : LOOP[Math.floor(bar / 2) % LOOP.length]
    const last = runs[runs.length - 1]
    if (last && last.chord === chord && last.to === bar) last.to = bar + 1
    else runs.push({ chord, from: bar, to: bar + 1 })
  }
  for (const r of runs) events.push({ chord: r.chord, start: r.from * BAR, end: r.to * BAR })
}

/** A stem's level over time, per block: the beat's level, eased in from the beat before. */
function curve(key: keyof Level): Float32Array {
  const out = new Float32Array(BLOCKS)
  const ramp = RAMP[key]
  let i = 0
  for (let blk = 0; blk < BLOCKS; blk++) {
    const t = (blk * BLOCK) / SR
    while (i + 1 < beats.length && t >= beats[i + 1].start) i++
    const b = beats[i]
    let g = b.level[key]
    if (i > 0 && t - b.start < ramp) {
      const x = (t - b.start) / ramp
      const prev = beats[i - 1].level[key]
      g = prev + (g - prev) * x * x * (3 - 2 * x)
    }
    out[blk] = g
  }
  return out
}
const level = {
  pads: curve('pads'),
  bass: curve('bass'),
  arp: curve('arp'),
  drums: curve('drums'),
  shine: curve('shine'),
}

// The sidechain: a dip on every kick (beats 1 and 3), only as deep as the
// drums are present — so the intro does not pump and the pages do.
const duck = new Float32Array(BLOCKS)
for (let blk = 0; blk < BLOCKS; blk++) {
  const pos = ((blk * BLOCK) / SR) % (2 * BEAT)
  duck[blk] = (pos < 0.01 ? pos / 0.01 : Math.exp(-(pos - 0.01) / 0.11)) * level.drums[blk]
}

// Tape wobble: a slow wow, a faint flutter and a drifting walk, as a pitch factor.
const wobble = new Float32Array(BLOCKS)
{
  let drift = 0
  for (let blk = 0; blk < BLOCKS; blk++) {
    const t = (blk * BLOCK) / SR
    drift = drift * 0.999 + (rand() - 0.5) * 0.00004
    wobble[blk] = 1 + 0.0011 * Math.sin(TAU * 0.31 * t) + 0.0004 * Math.sin(TAU * 3.7 * t) + drift
  }
}

// --- Processors -----------------------------------------------------------------
type Stem = { L: Float32Array; R: Float32Array }
const stem = (): Stem => ({ L: new Float32Array(N), R: new Float32Array(N) })

function onePole(buf: Float32Array, cutoff: number): void {
  const c = 1 - Math.exp((-TAU * cutoff) / SR)
  let y = 0
  for (let n = 0; n < N; n++) buf[n] = y += c * (buf[n] - y)
}

/** RBJ low-pass whose cutoff moves once a block. */
function lowpass(buf: Float32Array, cutoff: (blk: number) => number, q: number): void {
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let n = 0; n < N; n++) {
    if ((n & (BLOCK - 1)) === 0) {
      const w = (TAU * cutoff(blockOf(n))) / SR
      const alpha = Math.sin(w) / (2 * q)
      const cw = Math.cos(w)
      const a0 = 1 + alpha
      b0 = (1 - cw) / 2 / a0
      b1 = (1 - cw) / a0
      b2 = b0
      a1 = (-2 * cw) / a0
      a2 = (1 - alpha) / a0
    }
    const x = buf[n]
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    buf[n] = y
  }
}

/** Haas: a little of each side arrives late on the other. Backwards, so it reads the originals. */
function widen({ L, R }: Stem, amount: number): void {
  const dl = Math.round(0.009 * SR)
  const dr = Math.round(0.014 * SR)
  for (let n = N - 1; n >= 0; n--) {
    const l = L[n], r = R[n]
    L[n] = l + amount * (n >= dl ? R[n - dl] : 0)
    R[n] = r + amount * (n >= dr ? L[n - dr] : 0)
  }
}

/** A feedback delay that bounces left → right → left, darker on each pass. */
function pingpong({ L, R }: Stem, seconds: number, feedback: number, wet: number): void {
  const d = Math.round(seconds * SR)
  const bl = new Float32Array(d), br = new Float32Array(d)
  const c = 1 - Math.exp((-TAU * 2500) / SR)
  let lp = 0, rp = 0
  for (let n = 0; n < N; n++) {
    const i = n % d
    const wl = bl[i], wr = br[i]
    lp += c * ((L[n] + R[n]) * 0.5 + feedback * wr - lp)
    rp += c * (feedback * wl - rp)
    bl[i] = lp
    br[i] = rp
    L[n] += wet * wl
    R[n] += wet * wr
  }
}

// --- The instruments ---------------------------------------------------------------
/** Three detuned saws a note, one each side sent left and right, under a breathing low-pass. */
function pads(): Stem {
  const s = stem()
  const ATT = 1.6
  const REL = 0.7
  const saws: [number, number, number][] = [[0, 0.6, 0.6], [6, 0.9, 0.2], [-6, 0.2, 0.9]]
  for (const ev of events) {
    const n0 = Math.round(ev.start * SR)
    const n1 = Math.min(N, Math.round((ev.end + 4 * REL) * SR))
    for (const note of ev.chord.pad) {
      for (const [cents, gl, gr] of saws) {
        const inc = (hz(note) * 2 ** (cents / 1200)) / SR
        let phase = rand()
        for (let n = n0; n < n1; n++) {
          const t = n / SR
          let env: number
          if (t < ev.start + ATT) env = 0.5 - 0.5 * Math.cos((Math.PI * (t - ev.start)) / ATT)
          else if (t < ev.end) env = 1
          else env = Math.exp(-(t - ev.end) / REL)
          const v = (2 * phase - 1) * env
          s.L[n] += v * gl
          s.R[n] += v * gr
          phase += inc * wobble[blockOf(n)]
          if (phase >= 1) phase -= 1
        }
      }
    }
  }
  // Warmth: the cutoff breathes slowly and opens a little when the drums are in.
  const cutoff = (blk: number) => 700 + 300 * Math.sin(TAU * 0.037 * ((blk * BLOCK) / SR) + 1) + 450 * level.drums[blk]
  lowpass(s.L, cutoff, 0.9)
  lowpass(s.R, cutoff, 0.9)
  widen(s, 0.3)
  return s
}

/** The chord's root, held, rounded off with a touch of drive. The pump comes from the mix. */
function bass(): Stem {
  const M = new Float32Array(N)
  for (const ev of events) {
    const inc = hz(ev.chord.root) / SR
    const n0 = Math.round(ev.start * SR)
    const n1 = Math.min(N, Math.round((ev.end + 0.5) * SR))
    let phase = 0
    for (let n = n0; n < n1; n++) {
      const t = n / SR
      const env = t < ev.end ? Math.min(1, (t - ev.start) / 0.03) : Math.exp(-(t - ev.end) / 0.12)
      const p = TAU * phase
      M[n] += Math.tanh(1.4 * (Math.sin(p) + 0.3 * Math.sin(2 * p) + 0.12 * Math.sin(3 * p))) * env
      phase += inc
      if (phase >= 1) phase -= 1
    }
  }
  onePole(M, 260)
  return { L: M, R: M }
}

/** A soft pluck: a sine with two quiet harmonics, gone in a fifth of a second. */
function pluck({ L, R }: Stem, t0: number, f: number, vel: number, pan: number): void {
  const n0 = Math.round(t0 * SR)
  const n1 = Math.min(N, n0 + Math.round(0.7 * SR))
  const gl = Math.cos(((pan + 1) * Math.PI) / 4)
  const gr = Math.sin(((pan + 1) * Math.PI) / 4)
  const inc = f / SR
  let phase = 0
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR
    const p = TAU * phase
    const v = (Math.sin(p) + 0.3 * Math.sin(2 * p) + 0.1 * Math.sin(3 * p)) * Math.min(1, t / 0.004) * Math.exp(-t / 0.2) * vel
    L[n] += v * gl
    R[n] += v * gr
    phase += inc * wobble[blockOf(n)]
    if (phase >= 1) phase -= 1
  }
}

/** Eighth notes walking the chord's tones an octave or two up, each chord's line written once and kept. */
function arp(): Stem {
  const s = stem()
  const patterns = new Map<Chord, ({ midi: number; vel: number } | null)[]>()
  const steps = [-2, -1, -1, 1, 1, 2, 3]
  for (const chord of [...LOOP, HOME]) {
    const pool = [...chord.pad.map((m) => m + 12), ...chord.pad.slice(0, 3).map((m) => m + 24)]
    let i = Math.floor(rand() * pool.length)
    const line: ({ midi: number; vel: number } | null)[] = []
    for (let k = 0; k < 16; k++) {
      if (k % 4 !== 0 && rand() < 0.22) {
        line.push(null)
        continue
      }
      i += steps[Math.floor(rand() * steps.length)]
      if (i < 0) i = -i
      if (i >= pool.length) i = 2 * pool.length - 2 - i
      line.push({ midi: pool[i], vel: (k % 4 === 0 ? 0.9 : 0.55) + 0.25 * rand() })
    }
    patterns.set(chord, line)
  }
  for (const ev of events) {
    const line = patterns.get(ev.chord)!
    for (let k = 0; ev.start + (k * BEAT) / 2 < ev.end - 1e-9; k++) {
      const hit = line[k % line.length]
      if (hit) pluck(s, ev.start + (k * BEAT) / 2, hz(hit.midi), hit.vel, ((k % 3) - 1) * 0.35)
    }
  }
  pingpong(s, 0.75 * BEAT, 0.42, 0.45)
  onePole(s.L, 6000)
  onePole(s.R, 6000)
  return s
}

function kick({ L, R }: Stem, t0: number, vel: number): void {
  const n0 = Math.round(t0 * SR)
  const n1 = Math.min(N, n0 + Math.round(0.45 * SR))
  let phase = 0
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR
    const v = Math.sin(TAU * phase) * Math.exp(-t / 0.13) * Math.min(1, t / 0.002) * vel
    L[n] += v
    R[n] += v
    phase += (46 + 120 * Math.exp(-t / 0.028)) / SR
  }
}

/** A snare with a gated reverb: a wash held flat behind the crack, shut after 170 ms. */
function snare({ L, R }: Stem, t0: number, vel: number): void {
  const n0 = Math.round(t0 * SR)
  const n1 = Math.min(N, n0 + Math.round(0.3 * SR))
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR
    const gate = t < 0.17 ? 0.32 : 0.32 * Math.max(0, 1 - (t - 0.17) / 0.012)
    const noise = (rand() * 2 - 1) * (Math.exp(-t / 0.045) + gate)
    const body = Math.sin(TAU * 185 * t) * Math.exp(-t / 0.05)
    const v = (0.7 * body + 0.6 * noise) * Math.min(1, t / 0.001) * vel
    L[n] += v
    R[n] += v
  }
}

function hat({ L, R }: Stem, t0: number, vel: number): void {
  const n0 = Math.round(t0 * SR)
  const n1 = Math.min(N, n0 + Math.round(0.05 * SR))
  let prev = 0
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR
    const white = rand() * 2 - 1
    // The difference of two noise samples is a cheap high-pass: all sizzle, no body.
    const v = (white - prev) * 0.5 * Math.exp(-t / 0.012) * vel
    prev = white
    L[n] += v * 0.7
    R[n] += v
  }
}

/** Kick on one and three, the snare on two and four, light hats on the eighths. */
function drums(): Stem {
  const s = stem()
  for (let bar = 0; bar * BAR < END + TAIL; bar++) {
    const t = bar * BAR
    kick(s, t, 1)
    kick(s, t + 2 * BEAT, 0.9)
    if (bar % 4 === 3) kick(s, t + 3.5 * BEAT, 0.55)
    snare(s, t + BEAT, 0.8)
    snare(s, t + 3 * BEAT, 0.85)
    for (let k = 0; k < 8; k++) {
      if (k && rand() < 0.08) continue
      hat(s, t + (k * BEAT) / 2, (k % 2 ? 0.75 : 0.45) + 0.1 * rand())
    }
    if (bar % 2 === 1) hat(s, t + 3.75 * BEAT, 0.35)
  }
  // Soft: the drums stay behind the voice.
  onePole(s.L, 5500)
  onePole(s.R, 5500)
  return s
}

/** The chord's top two notes an octave up, as slow sines that shimmer. */
function shine(): Stem {
  const s = stem()
  const ATT = 2.5
  const REL = 1.2
  for (const ev of events) {
    const n0 = Math.round(ev.start * SR)
    const n1 = Math.min(N, Math.round((ev.end + 4 * REL) * SR))
    const top = ev.chord.pad.slice(-2)
    top.forEach((note, i) => {
      const inc = hz(note + 12) / SR
      const gl = i === 0 ? 0.8 : 0.4
      const gr = i === 0 ? 0.4 : 0.8
      let phase = rand()
      for (let n = n0; n < n1; n++) {
        const t = n / SR
        let env: number
        if (t < ev.start + ATT) env = 0.5 - 0.5 * Math.cos((Math.PI * (t - ev.start)) / ATT)
        else if (t < ev.end) env = 1
        else env = Math.exp(-(t - ev.end) / REL)
        const v = Math.sin(TAU * phase) * env * (0.7 + 0.3 * Math.sin(TAU * 0.45 * t + i))
        s.L[n] += v * gl
        s.R[n] += v * gr
        phase += inc * wobble[blockOf(n)]
        if (phase >= 1) phase -= 1
      }
    })
  }
  return s
}

/** The noise floor: dark hiss on each side, breathing a little, like tape. */
function hiss(): Stem {
  const s = stem()
  const c = 1 - Math.exp((-TAU * 3500) / SR)
  let l = 0, r = 0
  for (let n = 0; n < N; n++) {
    const flutter = 1 + 0.12 * Math.sin(TAU * 0.6 * (n / SR))
    l += c * (rand() * 2 - 1 - l)
    r += c * (rand() * 2 - 1 - r)
    s.L[n] = l * flutter
    s.R[n] = r * flutter
  }
  return s
}

// --- The mix ---------------------------------------------------------------------------
const master = { L: new Float64Array(N), R: new Float64Array(N) }

function rms(L: ArrayLike<number>, R: ArrayLike<number>, from = 0, to = N): number {
  let sum = 0
  for (let n = from; n < to; n++) sum += L[n] * L[n] + R[n] * R[n]
  return Math.sqrt(sum / (2 * Math.max(1, to - from)))
}

/** Adds a stem at a nominal loudness, shaped by its level curve. */
function mix(s: Stem, gain: Float32Array | null, nominalDb: number): void {
  const scale = dB(nominalDb) / Math.max(rms(s.L, s.R), 1e-9)
  for (let n = 0; n < N; n++) {
    const g = scale * (gain ? gain[blockOf(n)] : 1)
    master.L[n] += s.L[n] * g
    master.R[n] += s.R[n] * g
  }
}

const pumped = (gain: Float32Array, depth: number): Float32Array =>
  gain.map((g, blk) => g * (1 - depth * duck[blk]))

/** A one-pole high-pass at 10 Hz: no DC. */
function dcBlock(buf: Float64Array): void {
  const r = 1 - (TAU * 10) / SR
  let x1 = 0, y1 = 0
  for (let n = 0; n < N; n++) {
    const x = buf[n]
    buf[n] = y1 = x - x1 + r * y1
    x1 = x
  }
}

/** Soft knee from −4.4 dBFS: the loudest moments round off instead of cracking. */
function soft(x: number): number {
  const knee = 0.6
  const a = Math.abs(x)
  return a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)))
}

/** A look-ahead peak limiter: 5 ms ahead, 1 ms attack, 120 ms release. */
function limit({ L, R }: typeof master, ceiling: number): number {
  const LA = Math.round(0.005 * SR)
  const blocks = Math.ceil(N / LA)
  const mins = new Float64Array(blocks).fill(1)
  for (let n = 0; n < N; n++) {
    const p = Math.max(Math.abs(L[n]), Math.abs(R[n]))
    if (p > ceiling) mins[(n / LA) | 0] = Math.min(mins[(n / LA) | 0], ceiling / p)
  }
  const attack = Math.exp(-1 / (0.001 * SR))
  const release = Math.exp(-1 / (0.12 * SR))
  let env = 1
  let reduction = 1
  for (let n = 0; n < N; n++) {
    const b = (n / LA) | 0
    const target = Math.min(mins[b], b + 1 < blocks ? mins[b + 1] : 1)
    env = target + (env - target) * (target < env ? attack : release)
    reduction = Math.min(reduction, env)
    L[n] *= env
    R[n] *= env
  }
  return reduction
}

function wav(L: Float64Array, R: Float64Array): Buffer {
  const buf = Buffer.alloc(44 + N * 4)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + N * 4, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(N * 4, 40)
  // TPDF dither, one LSB wide: 16 bits without the grain of plain rounding.
  const pcm = (x: number) => Math.round(Math.max(-1, Math.min(1, x + (rand() - rand()) / 32768)) * 32767)
  for (let n = 0; n < N; n++) {
    buf.writeInt16LE(pcm(L[n]), 44 + n * 4)
    buf.writeInt16LE(pcm(R[n]), 46 + n * 4)
  }
  return buf
}

const LICENSE = `Ink Desk demo music — track.mp3

Composed and synthesized by this repository's own code, video/music/compose.mts:
an original instrumental by the Ink Desk project. No samples, no third-party
material — every sound is calculated by that script, and the file is rebuilt
with \`npm run video:music\`.

Released under CC0 1.0 Universal (public domain dedication):
https://creativecommons.org/publicdomain/zero/1.0/
To the extent possible under law, the Ink Desk project has waived all copyright
and related or neighboring rights to this track.
`

// --- Run ---------------------------------------------------------------------------
const started = Date.now()
console.log(`Edit: ${END.toFixed(1)} s, ${beats.length} beats → track ${(END + TAIL).toFixed(1)} s at ${BPM} BPM`)
for (const b of beats) {
  const l = b.level
  console.log(`  ${b.start.toFixed(1).padStart(6)} s  ${b.id.padEnd(10)} pads ${l.pads}  bass ${l.bass}  arp ${l.arp}  drums ${l.drums}  shine ${l.shine}`)
}
console.log(`  chords: ${events.map((e) => e.chord.name).join(' → ')}`)

mix(pads(), pumped(level.pads, 0.3), -17)
mix(bass(), pumped(level.bass, 0.55), -19)
mix(arp(), level.arp, -25)
mix(drums(), level.drums, -23)
mix(shine(), pumped(level.shine, 0.3), -30)
mix(hiss(), null, -50)

dcBlock(master.L)
dcBlock(master.R)
{
  // Level, then round the peaks off, then the limiter holds the ceiling.
  const scale = dB(TARGET_RMS_DB) / rms(master.L, master.R)
  for (let n = 0; n < N; n++) {
    master.L[n] = soft(master.L[n] * scale)
    master.R[n] = soft(master.R[n] * scale)
  }
}
const reduction = limit(master, dB(CEILING_DB))
{
  // The sheen: nothing above the top of the tape.
  const c = 1 - Math.exp((-TAU * 11000) / SR)
  let l = 0, r = 0
  for (let n = 0; n < N; n++) {
    master.L[n] = l += c * (master.L[n] - l)
    master.R[n] = r += c * (master.R[n] - r)
  }
}
// The last three seconds of the outro fade to silence; the tail after the edit is silent.
const fadeEnd = outro ? outro.end : END
const fadeStart = fadeEnd - 3
for (let n = Math.max(0, Math.round(fadeStart * SR)); n < N; n++) {
  const t = n / SR
  const g = t >= fadeEnd ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (t - fadeStart)) / 3)
  master.L[n] *= g
  master.R[n] *= g
}

// The numbers the render relies on.
let peak = 0, dcL = 0, dcR = 0
for (let n = 0; n < N; n++) {
  peak = Math.max(peak, Math.abs(master.L[n]), Math.abs(master.R[n]))
  dcL += master.L[n]
  dcR += master.R[n]
}
let quietest = { at: 0, db: 0 }
for (let t = 0; t + 10 <= fadeStart; t += 5) {
  const db = toDb(rms(master.L, master.R, Math.round(t * SR), Math.round((t + 10) * SR)))
  if (t === 0 || db < quietest.db) quietest = { at: t, db }
}
console.log(
  `Mix: RMS ${toDb(rms(master.L, master.R)).toFixed(1)} dBFS · peak ${toDb(peak).toFixed(1)} dBFS · limiter at most ${toDb(reduction).toFixed(1)} dB` +
    ` · DC ${(dcL / N).toExponential(1)} / ${(dcR / N).toExponential(1)} · quietest 10 s before the fade ${quietest.db.toFixed(1)} dBFS at ${quietest.at} s`,
)

const outDir = join(VIDEO, 'out', 'music')
const pubDir = join(VIDEO, 'public', 'music')
mkdirSync(outDir, { recursive: true })
mkdirSync(pubDir, { recursive: true })
const wavPath = join(outDir, 'track.wav')
const mp3Path = join(pubDir, 'track.mp3')
writeFileSync(wavPath, wav(master.L, master.R))
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-q:a', '2', mp3Path], { stdio: 'inherit' })
writeFileSync(join(pubDir, 'LICENSE.txt'), LICENSE)
console.log(`Wrote ${wavPath}, ${mp3Path} and its LICENSE.txt in ${((Date.now() - started) / 1000).toFixed(1)} s`)
