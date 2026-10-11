#!/usr/bin/env node
/**
 * Ink Desk — kernel test
 *
 * Proves the one thing the whole product rests on, before any UI exists:
 * that a locked model sheet sent as a reference image holds a character's
 * face across different shots.  See `devpost/scope.md > The Unique Kernel`.
 *
 * Four calls, in order:
 *   0. PROBE  — cheapest possible `low` generation, purely to prove the
 *               pinned model ID resolves. If this 404s, nothing else matters.
 *   1. SHEET  — one model sheet generated *from the visual DNA text*
 *               (`/v1/images/generations`, no reference image).
 *   2. CLOSE  — a close-up panel, sheet sent as the reference
 *               (`/v1/images/edits`).
 *   3. WIDE   — a wide panel, same sheet, same DNA, different shot.
 *
 * Then look at CLOSE and WIDE next to SHEET. Same person, or not?
 * That is the entire test. Open data/kernel-test/index.html to compare.
 *
 * Cost at the default `medium`: about $0.05 for all four images.
 *
 * Usage:
 *   node scripts/kernel-test.mjs              # all four steps
 *   node scripts/kernel-test.mjs --probe-only # just prove the model ID
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT_DIR = 'data/kernel-test'
const API = 'https://api.openai.com/v1'

// ---------------------------------------------------------------------------
// Environment. Reads .env by hand so the script stays dependency-free.
// ---------------------------------------------------------------------------

async function loadEnv() {
  try {
    const raw = await readFile('.env', 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    // No .env is fine if the vars are already exported.
  }
}

await loadEnv()

const KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst-2026-09-08'
const QUALITY = process.env.KERNEL_TEST_QUALITY ?? 'medium'
const SIZE = '1024x1024'

if (!KEY) {
  console.error('\n  OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.\n')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// The frozen half of every prompt.
//
// In the real app these two constants live in lib/prompts.ts and are pasted
// into every panel request verbatim, exactly as `scope.md > The Unique Kernel`
// requires. Here they are hardcoded to the mockup's worked sample so the test
// measures the method, not Claude's wording on any given run.
// ---------------------------------------------------------------------------

const STYLE_RULES = [
  'Black and white manga artwork, screentone shading, confident inked linework.',
  'Seinen style, detailed backgrounds, strong use of blacks.',
  'ABSOLUTELY NO TEXT, no speech bubbles, no sound effects, no signatures,',
  'no watermarks and no panel borders anywhere in the image.',
].join(' ')

// Kaito Ren, from `scope.md > Inspiration & Identity`. This stands in for the
// DNA that Claude writes once per character and that is then frozen at lock.
const KAITO_DNA = [
  'Kaito Ren, an 18-year-old male rooftop courier.',
  'Short messy black hair with a blunt fringe falling over the left eyebrow.',
  'Sharp amber eyes, thin angular face, light olive skin.',
  'Wears a dark grey high-collared courier jacket over a white shirt,',
  'cargo trousers and worn lace-up boots.',
  'Distinguishing marks: a long pale scar through the right eyebrow,',
  'and a frayed deep-red scarf always wound twice around his neck,',
  'one end hanging to his waist.',
].join(' ')

const SHEET_PROMPT = [
  'A single character model sheet on one sheet of paper, for animation reference.',
  'One character only, shown three times in one frame: full-body front view,',
  'full-body three-quarter view, and a row of three head-and-shoulders expressions',
  '(neutral, determined, surprised). Plain light background, consistent lighting.',
  '',
  'The character:',
  KAITO_DNA,
  '',
  STYLE_RULES,
].join('\n')

// The variable half — what Claude authors per panel. Only action, camera and
// background change between these two. Appearance comes from the sheet + DNA.
const PANELS = [
  {
    id: 'close',
    label: 'Panel A — close-up',
    camera: 'Extreme close-up on his face, slight low angle.',
    action: 'He is breathing hard, jaw set, eyes narrowed against the wind.',
    background: 'Blurred neon signage at night, shallow depth of field.',
  },
  {
    id: 'wide',
    label: 'Panel B — wide shot',
    camera: 'Wide establishing shot, high angle looking down, character small in frame.',
    action: 'He is sprinting across a rooftop gap in mid-air, scarf streaming behind him.',
    background: 'Dense neo-Osaka rooftops at night, water towers, tangled cables, full moon.',
  },
]

function panelPrompt(p) {
  return [
    'A single manga panel.',
    '',
    'The character in this panel is shown in the attached reference sheet.',
    'Keep his face, hairstyle, eyes, outfit, scar and scarf EXACTLY as the',
    'reference sheet shows. Do not restyle, age, or redesign him.',
    'Only his pose, expression and surroundings change.',
    '',
    'His fixed appearance, for reference:',
    KAITO_DNA,
    '',
    `Camera: ${p.camera}`,
    `Action: ${p.action}`,
    `Background: ${p.background}`,
    '',
    STYLE_RULES,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function fail(label, res) {
  const body = await res.text()
  console.error(`\n  ✗ ${label} failed — HTTP ${res.status}`)
  console.error(`  ${body.slice(0, 600)}\n`)
  if (res.status === 404 || body.includes('model')) {
    console.error('  If the model ID is wrong, try the floating alias:')
    console.error('    OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst node scripts/kernel-test.mjs\n')
  }
  process.exit(1)
}

/** Text -> image. Used for the model sheet. No reference image. */
async function generate({ prompt, quality, label }) {
  const started = Date.now()
  const res = await fetch(`${API}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, size: SIZE, quality, n: 1 }),
  })
  if (!res.ok) await fail(label, res)
  const json = await res.json()
  return { b64: json.data[0].b64_json, ms: Date.now() - started }
}

/**
 * Image + text -> image. This is the kernel.
 *
 * NOTE: `input_fidelity` is deliberately NOT sent. It is a gpt-image-1.x
 * parameter; gpt-image-2.x always uses high input fidelity.
 */
async function edit({ prompt, referencePng, quality, label }) {
  const started = Date.now()
  const form = new FormData()
  form.append('model', MODEL)
  form.append('prompt', prompt)
  form.append('size', SIZE)
  form.append('quality', quality)
  form.append('image', new Blob([referencePng], { type: 'image/png' }), 'sheet.png')

  const res = await fetch(`${API}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}` },
    body: form,
  })
  if (!res.ok) await fail(label, res)
  const json = await res.json()
  return { b64: json.data[0].b64_json, ms: Date.now() - started }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

await mkdir(OUT_DIR, { recursive: true })
const timings = {}

console.log(`\n  Ink Desk kernel test`)
console.log(`  model   ${MODEL}`)
console.log(`  quality ${QUALITY} (probe at low)`)
console.log(`  output  ${OUT_DIR}/\n`)

// Step 0 — prove the pinned model ID resolves, as cheaply as possible.
process.stdout.write('  [0/3] probing model ID ... ')
const probe = await generate({
  prompt: 'A single small black ink dot centred on plain white paper. No text.',
  quality: 'low',
  label: 'Model ID probe',
})
timings.probe = probe.ms
console.log(`ok (${(probe.ms / 1000).toFixed(1)}s) — "${MODEL}" resolves`)

if (process.argv.includes('--probe-only')) {
  console.log('\n  --probe-only: stopping here. The pinned model ID is valid.\n')
  process.exit(0)
}

// Step 1 — the sheet, generated from the DNA text.
process.stdout.write('  [1/3] generating model sheet from DNA ... ')
const sheet = await generate({ prompt: SHEET_PROMPT, quality: QUALITY, label: 'Model sheet' })
const sheetPng = Buffer.from(sheet.b64, 'base64')
await writeFile(join(OUT_DIR, '0-sheet.png'), sheetPng)
timings.sheet = sheet.ms
console.log(`ok (${(sheet.ms / 1000).toFixed(1)}s)`)

// Steps 2 and 3 — panels, each carrying the sheet as its reference.
for (const [i, p] of PANELS.entries()) {
  process.stdout.write(`  [${i + 2}/3] ${p.label} ... `)
  const out = await edit({
    prompt: panelPrompt(p),
    referencePng: sheetPng,
    quality: QUALITY,
    label: p.label,
  })
  await writeFile(join(OUT_DIR, `${i + 1}-${p.id}.png`), Buffer.from(out.b64, 'base64'))
  timings[p.id] = out.ms
  console.log(`ok (${(out.ms / 1000).toFixed(1)}s)`)
}

// A comparison page, so the sheet and both panels sit side by side.
const slowest = Math.max(...Object.values(timings))
await writeFile(
  join(OUT_DIR, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Ink Desk — kernel test</title>
<style>
  body{margin:0;padding:40px;background:#f3f2f2;color:#201f1d;
       font:16px/1.6 Lora,Georgia,serif}
  h1{font:600 30px/1.2 "Cormorant Garamond",Georgia,serif;margin:0 0 6px}
  p.sub{margin:0 0 32px;color:#6b6762}
  .row{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
  figure{margin:0;flex:1 1 300px;min-width:280px}
  img{width:100%;border:1px solid #d6d4d1;background:#fff;display:block}
  figcaption{margin-top:10px;font-size:14px;color:#6b6762}
  b{color:#b5382e}
  .q{margin-top:36px;padding:20px 24px;border-left:3px solid #b5382e;background:#eae9e9}
</style>
<h1>Kernel test — does the face hold?</h1>
<p class="sub">${MODEL} &middot; quality <b>${QUALITY}</b> &middot; slowest call ${(slowest / 1000).toFixed(1)}s</p>
<div class="row">
  <figure><img src="0-sheet.png"><figcaption><b>The sheet.</b> Generated from the DNA text alone. This is the reference.</figcaption></figure>
  <figure><img src="1-close.png"><figcaption><b>Close-up.</b> Sheet sent as reference image.</figcaption></figure>
  <figure><img src="2-wide.png"><figcaption><b>Wide shot.</b> Same sheet, same DNA, different shot.</figcaption></figure>
</div>
<div class="q"><strong>The only question:</strong> is this recognizably the same person in all three &mdash;
same face, same scar through the right eyebrow, same frayed scarf &mdash; from a close-up <em>and</em> from a wide shot?
If yes, the kernel holds and the build can proceed. If no, that is worth knowing before five stations are built on top of it.</div>`
)

await writeFile(
  join(OUT_DIR, 'manifest.json'),
  JSON.stringify({ model: MODEL, quality: QUALITY, size: SIZE, timingsMs: timings, dna: KAITO_DNA }, null, 2)
)

console.log(`\n  Done. Compare them:`)
console.log(`    ${OUT_DIR}/index.html`)
console.log(`\n  Slowest call was ${(slowest / 1000).toFixed(1)}s — use this to set the`)
console.log(`  generation timeout in prd.md > States and Boundaries.\n`)
