#!/usr/bin/env node
/**
 * Ink Desk — kernel test
 *
 * Proves the one thing the whole product rests on, before any UI exists:
 * that a locked model sheet sent as a reference image holds a character's
 * face across different shots.  See `devpost/scope.md > The Unique Kernel`.
 *
 * Slice 1 — two probes, so a wrong model ID or key fails here and not
 * three stations into the build:
 *   0a. TEXT PROBE  — one tiny structured-output call to Claude. Proves the
 *                     pinned text model resolves AND that output_config.format
 *                     works on it. Effectively free.
 *   0b. IMAGE PROBE — cheapest possible `low` generation. Proves the pinned
 *                     image model resolves. ~$0.006.
 *
 * Slice 2 — the kernel itself:
 *   1. SHEET  — one model sheet generated *from the visual DNA text*
 *               (`/v1/images/generations`, no reference image). Landscape,
 *               because a model sheet is a row of poses.
 *   2. CLOSE  — a close-up panel, sheet sent as the reference
 *               (`/v1/images/edits`). Square, as panel 3 is on the page.
 *   3. WIDE   — a wide panel, same sheet, same DNA, different shot.
 *               Landscape, as panels 1 and 4 are on the page.
 *
 * Sizes match production exactly, so the test exercises the real framing
 * rather than a square stand-in.
 *
 * Then look at CLOSE and WIDE next to SHEET. Same person, or not?
 * That is the entire test. Open data/kernel-test/index.html to compare.
 *
 * Cost at the default `medium`: about $0.06 for all four images.
 *
 * Usage:
 *   node scripts/kernel-test.mjs              # probes, then the kernel test
 *   node scripts/kernel-test.mjs --probe-only # just prove both model IDs
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT_DIR = 'data/kernel-test'
const API = 'https://api.openai.com/v1'
const ANTHROPIC_API = 'https://api.anthropic.com/v1'

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
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst-2026-09-08'
const TEXT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'
const QUALITY = process.env.KERNEL_TEST_QUALITY ?? 'medium'

// Production sizes. Only 1024x1024, 1536x1024 and 1024x1536 are valid.
const SIZE_WIDE = process.env.OPENAI_PANEL_SIZE_WIDE ?? '1536x1024'
const SIZE_SQUARE = process.env.OPENAI_PANEL_SIZE_SQUARE ?? '1024x1024'
const SIZE_SHEET = process.env.OPENAI_SHEET_SIZE ?? '1536x1024'

for (const [name, value] of [['OPENAI_API_KEY', KEY], ['ANTHROPIC_API_KEY', ANTHROPIC_KEY]]) {
  if (!value) {
    console.error(`\n  ${name} is not set. Copy .env.example to .env and add your keys.\n`)
    process.exit(1)
  }
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
//
// `size` and `framing` mirror the production page layout: panel 3 is a square
// close-up, panels 1 and 4 are landscape. The framing line goes in the prompt
// as well as the request, so the model composes for the shape it is drawing
// and nothing important sits where a crop would cut it.
const PANELS = [
  {
    id: 'close',
    label: 'Panel A — close-up (square)',
    size: SIZE_SQUARE,
    framing: 'Square panel. Centre his face in frame with headroom above and below; keep his eyes on the upper third line and nothing important near the edges.',
    camera: 'Extreme close-up on his face, slight low angle.',
    action: 'He is breathing hard, jaw set, eyes narrowed against the wind.',
    background: 'Blurred neon signage at night, shallow depth of field.',
  },
  {
    id: 'wide',
    label: 'Panel B — wide shot (landscape)',
    size: SIZE_WIDE,
    framing: 'Wide landscape panel. Place him off-centre in the left third, full body inside the frame with clear margin on every side.',
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
    `Framing: ${p.framing}`,
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

/**
 * Proves the pinned TEXT model resolves and that structured output works on
 * it. Also the only place that would catch us accidentally sending
 * temperature / top_p / top_k, which this model family rejects with a 400.
 */
async function textProbe() {
  const started = Date.now()
  const res = await fetch(`${ANTHROPIC_API}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      max_tokens: 128,
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { ok: { type: 'boolean' }, model_note: { type: 'string' } },
            required: ['ok', 'model_note'],
            additionalProperties: false,
          },
        },
      },
      // Deliberately no temperature / top_p / top_k — a non-default value on
      // this model family is a 400.
      messages: [{ role: 'user', content: 'Reply with ok=true and a three-word note.' }],
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error(`\n  ✗ Text probe failed — HTTP ${res.status}`)
    console.error(`  ${body.slice(0, 600)}\n`)
    if (body.includes('model')) {
      console.error('  If the model ID is wrong, check the current Sonnet on the models page')
      console.error('  and set ANTHROPIC_MODEL in .env.\n')
    }
    if (body.includes('temperature') || body.includes('top_p') || body.includes('top_k')) {
      console.error('  Sampling parameters are rejected on this model family. Remove them.\n')
    }
    process.exit(1)
  }
  const json = await res.json()
  const text = json.content.find((b) => b.type === 'text')?.text ?? ''
  const parsed = JSON.parse(text) // structured output guarantees this parses
  if (parsed.ok !== true) throw new Error(`Unexpected structured output: ${text}`)
  return { ms: Date.now() - started, usage: json.usage }
}

/** Text -> image. Used for the model sheet. No reference image. */
async function generate({ prompt, quality, size, label }) {
  const started = Date.now()
  const res = await fetch(`${API}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, size, quality, n: 1 }),
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
async function edit({ prompt, referencePng, quality, size, label }) {
  const started = Date.now()
  const form = new FormData()
  form.append('model', MODEL)
  form.append('prompt', prompt)
  form.append('size', size)
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
console.log(`  text    ${TEXT_MODEL}`)
console.log(`  image   ${MODEL}`)
console.log(`  quality ${QUALITY} (image probe at low)`)
console.log(`  sizes   sheet ${SIZE_SHEET} · wide ${SIZE_WIDE} · square ${SIZE_SQUARE}`)
console.log(`  output  ${OUT_DIR}/\n`)

// ---- Slice 1: both probes ------------------------------------------------

process.stdout.write('  [0a]  probing text model + structured output ... ')
const tp = await textProbe()
timings.textProbe = tp.ms
console.log(`ok (${(tp.ms / 1000).toFixed(1)}s) — "${TEXT_MODEL}" resolves, JSON schema honored`)

process.stdout.write('  [0b]  probing image model ... ')
const probe = await generate({
  prompt: 'A single small black ink dot centred on plain white paper. No text.',
  quality: 'low',
  size: SIZE_SQUARE,
  label: 'Image model probe',
})
timings.imageProbe = probe.ms
console.log(`ok (${(probe.ms / 1000).toFixed(1)}s) — "${MODEL}" resolves`)

if (process.argv.includes('--probe-only')) {
  console.log('\n  --probe-only: stopping here. Both pinned model IDs are valid.\n')
  process.exit(0)
}

// ---- Slice 2: the kernel -------------------------------------------------

process.stdout.write(`  [1/3] model sheet from DNA (${SIZE_SHEET}) ... `)
const sheet = await generate({
  prompt: SHEET_PROMPT,
  quality: QUALITY,
  size: SIZE_SHEET,
  label: 'Model sheet',
})
const sheetPng = Buffer.from(sheet.b64, 'base64')
await writeFile(join(OUT_DIR, '0-sheet.png'), sheetPng)
timings.sheet = sheet.ms
console.log(`ok (${(sheet.ms / 1000).toFixed(1)}s)`)

// Panels, each carrying the sheet as its reference, at its production size.
for (const [i, p] of PANELS.entries()) {
  process.stdout.write(`  [${i + 2}/3] ${p.label} ... `)
  const out = await edit({
    prompt: panelPrompt(p),
    referencePng: sheetPng,
    quality: QUALITY,
    size: p.size,
    label: p.label,
  })
  await writeFile(join(OUT_DIR, `${i + 1}-${p.id}.png`), Buffer.from(out.b64, 'base64'))
  timings[p.id] = out.ms
  console.log(`ok (${(out.ms / 1000).toFixed(1)}s)`)
}

// A comparison page, so the sheet and both panels sit side by side.
// Slowest counts only the real image calls — the low-quality probe and the
// text call aren't representative of what a panel costs in wall-clock.
const slowest = Math.max(timings.sheet, timings.close, timings.wide)
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
<p class="sub">${MODEL} &middot; quality <b>${QUALITY}</b> &middot; slowest image call ${(slowest / 1000).toFixed(1)}s
  &middot; set <code>GENERATION_TIMEOUT_MS</code> above this</p>
<div class="row">
  <figure><img src="0-sheet.png"><figcaption><b>The sheet.</b> ${SIZE_SHEET} &middot; generated from the DNA text alone. This is the reference.</figcaption></figure>
  <figure><img src="1-close.png"><figcaption><b>Close-up.</b> ${SIZE_SQUARE} &middot; sheet sent as reference image.</figcaption></figure>
  <figure><img src="2-wide.png"><figcaption><b>Wide shot.</b> ${SIZE_WIDE} &middot; same sheet, same DNA, different shot.</figcaption></figure>
</div>
<div class="q"><strong>The only question:</strong> is this recognizably the same person in all three &mdash;
same face, same scar through the right eyebrow, same frayed scarf &mdash; from a close-up <em>and</em> from a wide shot?
If yes, the kernel holds and the build can proceed. If no, that is worth knowing before five stations are built on top of it.</div>`
)

await writeFile(
  join(OUT_DIR, 'manifest.json'),
  JSON.stringify(
    {
      imageModel: MODEL,
      textModel: TEXT_MODEL,
      quality: QUALITY,
      sizes: { sheet: SIZE_SHEET, wide: SIZE_WIDE, square: SIZE_SQUARE },
      timingsMs: timings,
      dna: KAITO_DNA,
    },
    null,
    2
  )
)

console.log(`\n  Done. Compare them:`)
console.log(`    ${OUT_DIR}/index.html`)
console.log(`\n  Slowest image call was ${(slowest / 1000).toFixed(1)}s. Set`)
console.log(`  GENERATION_TIMEOUT_MS comfortably above it — try ${Math.ceil((slowest * 3) / 10000) * 10000}.\n`)
