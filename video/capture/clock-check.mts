// A free check that the recorder keeps real time: no app, no generation.
// A scratch page shows Date.now() — as text and as a 24-bit barcode of its
// milliseconds — redrawn every animation frame for 3 s, then frozen for 3 s,
// over and over. It is recorded with the very code record.mts uses
// (screencast.mts), marks are taken at known moments, and then every frame of
// the file is decoded: the time it shows against the time it should show.
// Constant drift or a drift that grows means the clock is wrong.
//
// Then the marks themselves: the page changes a state counter (a second,
// 8-bit barcode) and record.mts's own `onScreen` times it, a dozen times over
// moving and frozen screens. Each mark must land on a frame that already shows
// its state — never before it.
//
//   cd video && npx tsx capture/clock-check.mts --out <scratch dir> [--seconds 30]
//
// Writes <out>/footage.mp4 and <out>/clock.json (the marks, with the wall time
// each was taken at, for reading frames by eye).
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { FPS, HEIGHT, WIDTH } from '../src/timeline.ts'
import { onScreen, startRecording } from './screencast.mts'

const { values } = parseArgs({ options: { out: { type: 'string' }, seconds: { type: 'string', default: '30' } } })
if (!values.out) {
  console.error('\nThe clock check needs --out <dir>, a scratch folder for its footage.\n')
  process.exit(1)
}
const OUT = resolve(process.env.INIT_CWD ?? process.cwd(), values.out)
const SECONDS = Number(values.seconds)
const FILE = join(OUT, 'footage.mp4')
mkdirSync(OUT, { recursive: true })

const BITS = 24
const BLOCK = 50
const BAR_X = 40
const BAR_Y = 40
const PHASE_MS = 3000
const STATE_X = BAR_X + BITS * BLOCK + 2 * BLOCK
const TRIALS = 12

const PAGE = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #f3f2f2; color: #201f1d; font-family: monospace; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden }
  #bar { position: absolute; left: ${BAR_X}px; top: ${BAR_Y}px; display: flex }
  #bar i { width: ${BLOCK}px; height: ${BLOCK}px; background: #fff }
  #bar i.on, #state i.on { background: #000 }
  #state { position: absolute; left: ${STATE_X}px; top: ${BAR_Y}px; display: flex }
  #state i { width: ${BLOCK}px; height: ${BLOCK}px; background: #fff }
  #clock { position: absolute; left: 40px; top: 140px; font-size: 140px; font-weight: bold }
  #phase { position: absolute; left: 40px; top: 330px; font-size: 60px }
  #ball { position: absolute; top: 460px; width: 80px; height: 80px; border-radius: 50%; background: #b5382e }
  #patch { position: absolute; right: 40px; top: 140px; width: 200px; height: 200px; background: #b5382e }
  #small { position: absolute; left: 40px; top: 600px; width: 1000px; font: 13px/1.4 system-ui, sans-serif }
</style>
<div id="bar"></div><div id="state"></div><div id="clock"></div><div id="phase"></div><div id="ball"></div><div id="patch"></div>
<p id="small">Small text for sharpness: the quick brown fox jumps over the lazy dog, 0123456789. Only upload pictures you made or have the rights to.</p>
<script>
  const bar = document.getElementById('bar')
  for (let i = 0; i < ${BITS}; i++) bar.appendChild(document.createElement('i'))
  const blocks = [...bar.children]
  const state = document.getElementById('state')
  for (let i = 0; i < 8; i++) state.appendChild(document.createElement('i'))
  window.__setState = (k) => [...state.children].forEach((b, i) => b.classList.toggle('on', ((k >> (7 - i)) & 1) === 1))
  const start = Date.now()
  window.__start = start
  const fmt = (ms) => new Date(ms).toISOString().slice(11, 23)
  const draw = () => {
    const now = Date.now()
    const k = Math.floor((now - start) / ${PHASE_MS})
    if (k % 2 === 0) {
      // Bit 0 is the leftmost block, the most significant.
      const v = now % ${2 ** BITS}
      blocks.forEach((b, i) => b.classList.toggle('on', ((v >> (${BITS - 1} - i)) & 1) === 1))
      document.getElementById('clock').textContent = fmt(now)
      document.getElementById('phase').textContent = 'phase ' + k + ' · moving'
      document.getElementById('ball').style.left = (40 + ((now - start) % 1500) / 1500 * 1700) + 'px'
    } else if (document.getElementById('phase').textContent.indexOf('frozen') < 0) {
      document.getElementById('phase').textContent = 'phase ' + k + ' · frozen'
    }
    requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)
</script>`

const browser = await chromium.launch({ handleSIGINT: false })
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
const page = await context.newPage()
const rec = await startRecording(context, page, FILE, { fps: FPS, width: WIDTH, height: HEIGHT })
await page.goto(`data:text/html;base64,${Buffer.from(PAGE).toString('base64')}`)
const start = (await page.evaluate(() => (window as unknown as { __start: number }).__start)) as number

// Marks every 1.5 s, a quarter and three quarters into every phase (clear of
// its turns), moving and frozen alike.
const marks: { name: string; wall: number; t: number }[] = []
for (let i = 0; (750 + i * 1500) / 1000 < SECONDS; i++) {
  const due = start + 750 + i * 1500
  await new Promise((r) => setTimeout(r, Math.max(0, due - Date.now())))
  const wall = Date.now()
  const t = await rec.at()
  marks.push({ name: `m${i + 1}`, wall, t })
}
// State changes, timed as record.mts times its marks.
const trials: { k: number; t: number }[] = []
for (let k = 1; k <= TRIALS; k++) {
  await new Promise((r) => setTimeout(r, 380 + 90 * (k % 4))) // spread over moving and frozen screens
  await page.evaluate((n) => (window as unknown as { __setState: (n: number) => void }).__setState(n), k)
  trials.push({ k, t: (await onScreen(page, rec)).t })
}
await new Promise((r) => setTimeout(r, 1000))
const stopWall = Date.now()
const result = await rec.stop()
const t0 = rec.t0!
await browser.close()
writeFileSync(join(OUT, 'clock.json'), `${JSON.stringify({ t0, start, result, marks, trials }, null, 2)}\n`)
if (result.failure) {
  console.error(`\nThe recording failed: ${result.failure}\n`)
  process.exit(1)
}
const wallSeconds = stopWall / 1000 - t0
console.log(`Recorded ${result.frames} frames from ${result.received} screencast frames (max backlog ${result.maxBacklog}); t0 = ${t0.toFixed(3)}, page start ${((start - t0 * 1000) / 1000).toFixed(3)} s in.`)

// ---- the file itself ----------------------------------------------------
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries',
  'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt,nb_read_frames,color_space,color_range:format=duration', '-of', 'default=nw=1', FILE], { encoding: 'utf8' })
console.log(probe.stdout.trim().split('\n').join(' · '))
console.log(`Wall time recorded ≈ ${wallSeconds.toFixed(2)} s (t0 to stop).`)

// Every frame's barcode, as gray rows of the bar's middle line.
const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', FILE, '-vf', `format=gray,crop=${BITS * BLOCK}:1:${BAR_X}:${BAR_Y + BLOCK / 2}`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 })
const row = BITS * BLOCK
const n = Math.floor(raw.stdout.length / row)
type Seen = { k: number; at: number; shown: number | null; delta: number | null; phase: number }
const seen: Seen[] = []
for (let k = 0; k < n; k++) {
  let v = 0
  for (let i = 0; i < BITS; i++) v = v * 2 + (raw.stdout[k * row + i * BLOCK + BLOCK / 2] < 128 ? 1 : 0)
  const at = t0 * 1000 + (k * 1000) / FPS // the wall time this frame should show
  const phase = Math.floor((at - start) / PHASE_MS)
  if (at < start + 200) {
    seen.push({ k, at, shown: null, delta: null, phase })
    continue
  }
  // Unwrap the 24-bit milliseconds to the full time nearest the expected one.
  let d = (at - v) % 2 ** BITS
  if (d > 2 ** (BITS - 1)) d -= 2 ** BITS
  seen.push({ k, at, shown: at - d, delta: d, phase })
}

console.log('\nShown vs expected, per moving phase (ms the frame lags the wall clock; one frame is 33 ms):')
const phases = [...new Set(seen.filter((s) => s.delta !== null && s.phase % 2 === 0).map((s) => s.phase))]
for (const p of phases) {
  // Skip the first 100 ms of each phase: the screen is only just waking from the freeze.
  const ds = seen.filter((s) => s.phase === p && s.delta !== null && s.at - start - p * PHASE_MS > 100).map((s) => s.delta!).sort((a, b) => a - b)
  if (ds.length === 0) continue
  const q = (f: number) => ds[Math.min(ds.length - 1, Math.floor(f * ds.length))].toFixed(0)
  console.log(`  phase ${String(p).padStart(2)} (${(p * 3).toString().padStart(2)}–${(p * 3 + 3).toString().padStart(2)} s): n=${ds.length} min ${q(0)} · median ${q(0.5)} · max ${q(0.999)}`)
}
console.log('\nMarks (frame round(t × fps) of the file):')
for (const m of marks) {
  const s = seen[Math.round(m.t * FPS)]
  const moving = s && s.phase % 2 === 0
  console.log(`  ${m.name.padEnd(4)} t=${m.t.toFixed(2).padStart(6)} s  wall ${new Date(m.wall).toISOString().slice(11, 23)}  shown ${s?.shown ? new Date(s.shown).toISOString().slice(11, 23) : '—'}  ${moving ? `lag ${(m.wall - s.shown!).toFixed(0)} ms` : '(frozen: shows the freeze)'}`)
}

// Every frame's state barcode: the first frame showing each state, against its mark.
const st = spawnSync('ffmpeg', ['-v', 'error', '-i', FILE, '-vf', `format=gray,crop=${8 * BLOCK}:1:${STATE_X}:${BAR_Y + BLOCK / 2}`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 })
const srow = 8 * BLOCK
const states: number[] = []
for (let k = 0; k * srow < st.stdout.length; k++) {
  let v = 0
  for (let i = 0; i < 8; i++) v = v * 2 + (st.stdout[k * srow + i * BLOCK + BLOCK / 2] < 128 ? 1 : 0)
  states.push(v)
}
console.log('\nState marks (record.mts\'s onScreen): the frame it lands on vs the first frame showing the state:')
let early = 0
for (const tr of trials) {
  const first = states.indexOf(tr.k)
  const at = Math.round(tr.t * FPS)
  const phase = Math.floor((t0 * 1000 + (at * 1000) / FPS - start) / PHASE_MS)
  if (states[at] !== tr.k || at < first) early++
  console.log(`  state ${String(tr.k).padStart(2)}  first shown frame ${first}  mark frame ${at} (shows ${states[at]})  ${at - first >= 0 ? '+' : ''}${at - first} frames  ${phase % 2 === 0 ? 'moving' : 'frozen'}`)
}
console.log(early === 0 ? 'Every mark lands on its state.' : `${early} mark(s) land before their state is on screen.`)
