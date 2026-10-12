#!/usr/bin/env node
/**
 * Ink Desk — kernel test
 *
 * Proves the one thing the whole product rests on, before any UI exists:
 * that a locked model sheet sent as a reference image holds a character's
 * face across different shots.  See `devpost/scope.md > The Unique Kernel`.
 *
 * Images go through OPENROUTER, not the OpenAI API. Claude stays on the
 * Anthropic API directly. See `devpost/spec.md > Changes Since Approval`.
 *
 * Slice 1 — three probes, so a wrong model ID, a bad key or a silently
 * dropped parameter fails here and not three stations into the build:
 *   0a. CAPABILITY PROBE — GET /images/models. FREE, no generation. Asserts
 *                          the model is listed, that `input_references` is in
 *                          its supported_parameters, and that the configured
 *                          aspect ratios and quality are in their published
 *                          enums. This is the probe that caught `size` being
 *                          replaced by `aspect_ratio`.
 *   0b. TEXT PROBE       — one tiny structured-output call to Claude. Proves
 *                          the pinned text model resolves AND that
 *                          output_config.format works on it. Effectively free.
 *   0c. IMAGE PROBE      — cheapest possible `low` generation. Proves the
 *                          model actually renders through OpenRouter and that
 *                          the response carries data[0].b64_json. ~$0.008.
 *
 * Slice 2 — the kernel itself:
 *   1. SHEET  — one model sheet generated *from the visual DNA text*, with no
 *               input_references. Landscape, because a sheet is a row of poses.
 *   2. CLOSE  — a close-up panel, sheet sent in `input_references`.
 *               Square, as panel 3 is on the page.
 *   3. WIDE   — a wide panel, same sheet, same DNA, different shot.
 *               Landscape, as panels 1 and 4 are on the page.
 *
 * Sheets and panels are the SAME endpoint and the same body. The only
 * difference is whether `input_references` is present.
 *
 * Ratios match production exactly, so the test exercises the real framing
 * rather than a square stand-in.
 *
 * Then look at CLOSE and WIDE next to SHEET. Same person, or not?
 * That is the entire test. Open data/kernel-test/index.html to compare.
 *
 * Besides the answer, this run reports three numbers the spec is currently
 * guessing at: the slowest call (sets GENERATION_TIMEOUT_MS), the real
 * usage.cost per image (the cost table is an estimate until this runs), and
 * the actual pixel dimensions, which stopped being ours to choose when `size`
 * went away.
 *
 * Cost at the default `medium`: about $0.08 for all four images.
 *
 * Usage:
 *   node scripts/kernel-test.mjs              # probes, then the kernel test
 *   node scripts/kernel-test.mjs --probe-only # just prove the setup
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT_DIR = 'data/kernel-test'
const API = 'https://openrouter.ai/api/v1'
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

const KEY = process.env.OPENROUTER_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.IMAGE_MODEL ?? 'openai/gpt-image-2.5-sunburst'
const TEXT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'
const QUALITY = process.env.KERNEL_TEST_QUALITY ?? 'medium'

// Production aspect ratios. OpenRouter takes `aspect_ratio`, NOT `size` —
// there is no pixel-dimension parameter on this model.
const ASPECT_WIDE = process.env.IMAGE_PANEL_ASPECT_WIDE ?? '3:2'
const ASPECT_SQUARE = process.env.IMAGE_PANEL_ASPECT_SQUARE ?? '1:1'
const ASPECT_SHEET = process.env.IMAGE_SHEET_ASPECT ?? '3:2'

for (const [name, value] of [
  ['OPENROUTER_API_KEY', KEY],
  ['ANTHROPIC_API_KEY', ANTHROPIC_KEY],
]) {
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
// `aspect` and `framing` mirror the production page layout: panel 3 is a square
// close-up, panels 1 and 4 are landscape. The framing line goes in the prompt
// as well as the request, so the model composes for the shape it is drawing
// and nothing important sits where a crop would cut it.
const PANELS = [
  {
    id: 'close',
    label: 'Panel A — close-up (square)',
    aspect: ASPECT_SQUARE,
    framing: 'Square panel. Centre his face in frame with headroom above and below; keep his eyes on the upper third line and nothing important near the edges.',
    camera: 'Extreme close-up on his face, slight low angle.',
    action: 'He is breathing hard, jaw set, eyes narrowed against the wind.',
    background: 'Blurred neon signage at night, shallow depth of field.',
  },
  {
    id: 'wide',
    label: 'Panel B — wide shot (landscape)',
    aspect: ASPECT_WIDE,
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
// Helpers
// ---------------------------------------------------------------------------

const EXT_BY_MEDIA_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * Pixel dimensions straight out of the PNG IHDR chunk. We only need this for
 * the report — `size` is no longer a parameter, so the resolution the provider
 * picks is information rather than something we asked for.
 */
function pngSize(buf) {
  const isPng = buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47
  if (!isPng) return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

async function fail(label, res) {
  const body = await res.text()

  // 402 is the one that will actually happen, and it fails every image at
  // once rather than one unlucky panel. Say so plainly — the app maps this
  // to "the studio is busy", so the terminal is the only honest channel.
  if (res.status === 402) {
    console.error(`\n  ✗ ${label} failed — OpenRouter returned 402, out of credits.`)
    console.error('    The balance is at or below $1, which is where OpenRouter stops serving.')
    console.error('    Top up at https://openrouter.ai/settings/credits and try again.')
    console.error('    A full filming run needs about $2.50 of headroom.\n')
    process.exit(1)
  }

  console.error(`\n  ✗ ${label} failed — HTTP ${res.status}`)
  console.error(`  ${body.slice(0, 600)}\n`)
  if (res.status === 404 || body.includes('model')) {
    console.error('  Check the slug is still listed:')
    console.error('    curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \\')
    console.error(`      ${API}/images/models | grep ${MODEL}\n`)
  }
  process.exit(1)
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * FREE. Reads the model's published capabilities and checks every assumption
 * this script makes against them, before a cent is spent.
 *
 * This is the probe that earns its place: `size` was silently replaced by
 * `aspect_ratio`, and because OpenRouter passes through only `moderation`, a
 * stale `size` would have been ignored rather than rejected — images would
 * come back the wrong shape with a 200 and no complaint.
 */
async function capabilityProbe() {
  const started = Date.now()
  const res = await fetch(`${API}/images/models`, {
    headers: { Authorization: `Bearer ${KEY}` },
  })
  if (!res.ok) await fail('Capability probe', res)

  const { data } = await res.json()
  const model = data.find((m) => m.id === MODEL)

  if (!model) {
    console.error(`\n  ✗ "${MODEL}" is not in OpenRouter's image model list.`)
    const near = data.filter((m) => m.id.startsWith('openai/gpt-image')).map((m) => m.id)
    if (near.length) {
      console.error('\n  OpenAI image models currently listed:')
      for (const id of near) console.error(`    ${id}`)
    }
    console.error('\n  Set IMAGE_MODEL in .env to one of these.\n')
    process.exit(1)
  }

  const params = model.supported_parameters ?? {}
  const problems = []

  // The kernel itself. Without this there is no product.
  if (!params.input_references) {
    problems.push(
      'input_references is NOT supported — the kernel cannot be built on this model.\n' +
        '      This is a stop-everything finding, not a config error.'
    )
  } else if ((params.input_references.max ?? 0) < 1) {
    problems.push(`input_references max is ${params.input_references.max}, need at least 1.`)
  }

  // `size` must not have come back, and `aspect_ratio` must still be there.
  if (params.size) {
    problems.push('a `size` parameter now exists — the spec assumes aspect_ratio; re-check it.')
  }
  if (!params.aspect_ratio) {
    problems.push('aspect_ratio is gone. How dimensions are passed has changed again.')
  } else {
    const allowed = params.aspect_ratio.values ?? []
    for (const [name, value] of [
      ['IMAGE_SHEET_ASPECT', ASPECT_SHEET],
      ['IMAGE_PANEL_ASPECT_WIDE', ASPECT_WIDE],
      ['IMAGE_PANEL_ASPECT_SQUARE', ASPECT_SQUARE],
    ]) {
      if (!allowed.includes(value)) {
        problems.push(`${name}="${value}" is not valid. Allowed: ${allowed.join(', ')}`)
      }
    }
  }

  if (!params.quality) {
    problems.push('quality is no longer a parameter on this model.')
  } else if (!(params.quality.values ?? []).includes(QUALITY)) {
    problems.push(
      `KERNEL_TEST_QUALITY="${QUALITY}" is not valid. ` +
        `Allowed: ${(params.quality.values ?? []).join(', ')}`
    )
  }

  if (problems.length) {
    console.error(`\n  ✗ Capability probe failed for "${MODEL}":\n`)
    for (const p of problems) console.error(`    • ${p}`)
    console.error('\n  Nothing was generated, so this cost nothing. Fix .env or devpost/spec.md')
    console.error('  before spending anything.\n')
    process.exit(1)
  }

  return {
    ms: Date.now() - started,
    refMax: params.input_references.max,
    aspects: params.aspect_ratio.values,
    qualities: params.quality.values,
  }
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
      // NOT `disabled` — the models API reports
      // thinking.types.disabled.supported === false on claude-sonnet-5-5, and
      // sending it returns a 400 telling you to use `between_tools` instead.
      // This model does not think before responding; the short updates it
      // writes between tool calls are what come back as thinking blocks.
      thinking: { type: 'between_tools' },
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

/**
 * One function for both surfaces, because OpenRouter has one endpoint.
 *
 * A sheet is this call without `references`. A panel is this call with one.
 * That is the whole difference, and it is why the kernel stopped being a
 * separate endpoint when images moved to OpenRouter.
 *
 * NOTE: `input_fidelity` is not sent and cannot be — it was a gpt-image-1.x
 * parameter, and OpenRouter passes through only `moderation` for this model.
 * Face preservation is the model's default behavior.
 */
async function generateImage({ prompt, quality, aspect, label, references = [] }) {
  const started = Date.now()

  const body = {
    model: MODEL,
    prompt,
    aspect_ratio: aspect,
    quality,
    n: 1,
  }

  // The sheet travels as a base64 data URI in the JSON body — no FormData,
  // no Blob. An HTTP(S) URL would also be accepted, but the sheet is a local
  // file. Note this makes the body ~4/3 the size of the PNG.
  if (references.length) {
    body.input_references = references.map((png) => ({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
    }))
  }

  const res = await fetch(`${API}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) await fail(label, res)

  const json = await res.json()
  const item = json.data?.[0]
  if (!item?.b64_json) {
    console.error(`\n  ✗ ${label}: no b64_json in the response.`)
    console.error(`  ${JSON.stringify(json).slice(0, 600)}\n`)
    process.exit(1)
  }

  // Extension comes from media_type, never a hardcoded .png — writing JPEG
  // bytes into a .png name is the kind of bug nobody thinks to suspect.
  const mediaType = item.media_type ?? 'image/png'
  const ext = EXT_BY_MEDIA_TYPE[mediaType]
  if (!ext) {
    console.error(`\n  ✗ ${label}: unrecognised media_type "${mediaType}".`)
    console.error('  Add it to EXT_BY_MEDIA_TYPE rather than guessing an extension.\n')
    process.exit(1)
  }

  const buf = Buffer.from(item.b64_json, 'base64')
  return {
    buf,
    ext,
    mediaType,
    ms: Date.now() - started,
    cost: json.usage?.cost ?? null,
    dims: pngSize(buf),
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

await mkdir(OUT_DIR, { recursive: true })
const timings = {}
const costs = {}
const dims = {}

const money = (n) => (n == null ? 'cost not reported' : `$${n.toFixed(4)}`)
const shape = (d) => (d ? `${d.w}x${d.h}` : 'unknown')

console.log(`\n  Ink Desk kernel test`)
console.log(`  text    ${TEXT_MODEL}            (Anthropic, direct)`)
console.log(`  image   ${MODEL}  (OpenRouter)`)
console.log(`  quality ${QUALITY} (image probe at low)`)
console.log(`  ratios  sheet ${ASPECT_SHEET} · wide ${ASPECT_WIDE} · square ${ASPECT_SQUARE}`)
console.log(`  output  ${OUT_DIR}/\n`)

// ---- Slice 1: three probes ----------------------------------------------

process.stdout.write('  [0a]  probing model capabilities ... ')
const caps = await capabilityProbe()
timings.capabilityProbe = caps.ms
console.log(`ok (${(caps.ms / 1000).toFixed(1)}s) — free`)
console.log(`        input_references supported, up to ${caps.refMax} — the kernel is buildable`)
console.log(`        aspect_ratio ${caps.aspects.join(' ')}`)
console.log(`        quality      ${caps.qualities.join(' ')}`)

process.stdout.write('  [0b]  probing text model + structured output ... ')
const tp = await textProbe()
timings.textProbe = tp.ms
console.log(`ok (${(tp.ms / 1000).toFixed(1)}s) — "${TEXT_MODEL}" resolves, JSON schema honored`)

process.stdout.write('  [0c]  probing image model ... ')
const probe = await generateImage({
  prompt: 'A single small black ink dot centred on plain white paper. No text.',
  quality: 'low',
  aspect: ASPECT_SQUARE,
  label: 'Image model probe',
})
timings.imageProbe = probe.ms
costs.imageProbe = probe.cost
console.log(`ok (${(probe.ms / 1000).toFixed(1)}s) — renders · ${money(probe.cost)} · ${shape(probe.dims)} ${probe.mediaType}`)

if (process.argv.includes('--probe-only')) {
  console.log('\n  --probe-only: stopping here. Everything this spec assumes is confirmed.')
  console.log(`  Spent ${money(probe.cost)}.\n`)
  process.exit(0)
}

// ---- Slice 2: the kernel -------------------------------------------------

process.stdout.write(`  [1/3] model sheet from DNA (${ASPECT_SHEET}) ... `)
const sheet = await generateImage({
  prompt: SHEET_PROMPT,
  quality: QUALITY,
  aspect: ASPECT_SHEET,
  label: 'Model sheet',
})
const sheetFile = `0-sheet.${sheet.ext}`
await writeFile(join(OUT_DIR, sheetFile), sheet.buf)
timings.sheet = sheet.ms
costs.sheet = sheet.cost
dims.sheet = sheet.dims
console.log(`ok (${(sheet.ms / 1000).toFixed(1)}s) · ${money(sheet.cost)} · ${shape(sheet.dims)}`)

// Panels, each carrying the sheet as its reference, at its production ratio.
const panelFiles = {}
for (const [i, p] of PANELS.entries()) {
  process.stdout.write(`  [${i + 2}/3] ${p.label} ... `)
  const out = await generateImage({
    prompt: panelPrompt(p),
    references: [sheet.buf],
    quality: QUALITY,
    aspect: p.aspect,
    label: p.label,
  })
  panelFiles[p.id] = `${i + 1}-${p.id}.${out.ext}`
  await writeFile(join(OUT_DIR, panelFiles[p.id]), out.buf)
  timings[p.id] = out.ms
  costs[p.id] = out.cost
  dims[p.id] = out.dims
  console.log(`ok (${(out.ms / 1000).toFixed(1)}s) · ${money(out.cost)} · ${shape(out.dims)}`)
}

// A comparison page, so the sheet and both panels sit side by side.
// Slowest counts only the real image calls — the low-quality probe and the
// text call aren't representative of what a panel costs in wall-clock.
const slowest = Math.max(timings.sheet, timings.close, timings.wide)
const reported = Object.values(costs).filter((c) => c != null)
const totalCost = reported.length ? reported.reduce((a, b) => a + b, 0) : null

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
  .nums{margin-top:28px;padding:16px 20px;background:#eae9e9;font-size:14px}
  .nums code{background:#f3f2f2;padding:1px 5px}
</style>
<h1>Kernel test — does the face hold?</h1>
<p class="sub">${MODEL} via OpenRouter &middot; quality <b>${QUALITY}</b>
  &middot; slowest image call ${(slowest / 1000).toFixed(1)}s
  &middot; total ${totalCost == null ? 'cost not reported' : '<b>$' + totalCost.toFixed(4) + '</b>'}</p>
<div class="row">
  <figure><img src="${sheetFile}"><figcaption><b>The sheet.</b> ${ASPECT_SHEET} &middot; ${shape(dims.sheet)} &middot; generated from the DNA text alone, no references. This is the reference.</figcaption></figure>
  <figure><img src="${panelFiles.close}"><figcaption><b>Close-up.</b> ${ASPECT_SQUARE} &middot; ${shape(dims.close)} &middot; sheet sent in <code>input_references</code>.</figcaption></figure>
  <figure><img src="${panelFiles.wide}"><figcaption><b>Wide shot.</b> ${ASPECT_WIDE} &middot; ${shape(dims.wide)} &middot; same sheet, same DNA, different shot.</figcaption></figure>
</div>
<div class="q"><strong>The only question:</strong> is this recognizably the same person in all three &mdash;
same face, same scar through the right eyebrow, same frayed scarf &mdash; from a close-up <em>and</em> from a wide shot?
If yes, the kernel holds and the build can proceed. If no, that is worth knowing before five stations are built on top of it.</div>
<div class="nums"><strong>Three numbers the spec was guessing at.</strong>
  Set <code>GENERATION_TIMEOUT_MS</code> above <b>${(slowest / 1000).toFixed(1)}s</b> &mdash; try <code>${Math.ceil((slowest * 3) / 10000) * 10000}</code>.
  Real cost at <code>${QUALITY}</code>: <b>${money(costs.sheet)}</b> for ${ASPECT_SHEET}, <b>${money(costs.close)}</b> for ${ASPECT_SQUARE}
  &mdash; update the cost table in <code>devpost/spec.md</code>, which is currently an estimate.
  Returned dimensions: <b>${shape(dims.sheet)}</b> at ${ASPECT_SHEET}, <b>${shape(dims.close)}</b> at ${ASPECT_SQUARE}
  &mdash; not ours to request any more, so size panel CSS from the ratio.</div>`
)

await writeFile(
  join(OUT_DIR, 'manifest.json'),
  JSON.stringify(
    {
      provider: 'openrouter',
      endpoint: `${API}/images`,
      imageModel: MODEL,
      imageModelPinned: false,
      textModel: TEXT_MODEL,
      textProvider: 'anthropic-direct',
      quality: QUALITY,
      aspects: { sheet: ASPECT_SHEET, wide: ASPECT_WIDE, square: ASPECT_SQUARE },
      capabilities: { inputReferencesMax: caps.refMax, aspects: caps.aspects, qualities: caps.qualities },
      timingsMs: timings,
      costsUsd: costs,
      totalCostUsd: totalCost,
      dimensions: dims,
      dna: KAITO_DNA,
    },
    null,
    2
  )
)

console.log(`\n  Done. Compare them:`)
console.log(`    ${OUT_DIR}/index.html`)
console.log(`\n  Three numbers to carry back into devpost/spec.md:`)
console.log(`    1. Slowest image call ${(slowest / 1000).toFixed(1)}s — set`)
console.log(`       GENERATION_TIMEOUT_MS to about ${Math.ceil((slowest * 3) / 10000) * 10000}.`)
console.log(`    2. Real cost at ${QUALITY}: ${money(costs.sheet)} (${ASPECT_SHEET}), ${money(costs.close)} (${ASPECT_SQUARE}).`)
console.log(`       Total for this run ${money(totalCost)}. The spec's cost table is an estimate.`)
console.log(`    3. Dimensions returned: ${shape(dims.sheet)} at ${ASPECT_SHEET}, ${shape(dims.close)} at ${ASPECT_SQUARE}.\n`)
