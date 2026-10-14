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
 *   0d. FALLBACK PROBE   — (v2, slice 9) one strict-schema call to the text
 *                          fallback (LLM_FALLBACK_MODEL, default
 *                          openai/gpt-5.6-terra) on OpenRouter, with the
 *                          synopsis schema `lib/llm.ts` sends. ~$0.002.
 *
 * Without ANTHROPIC_API_KEY, 0b is skipped and says so: since v2 the app runs
 * every text call on the fallback then, so the key is no longer required here.
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
 * Slice 15 — candidate-lock tests (v2):
 *   `spec.md > Image Models and Style Presets (v2)`: a style reference image
 *   or a setting reference image is a CANDIDATE lock until its own kernel test
 *   passes. Only then may the docs call it a lock; the app exposes neither
 *   yet. The test is the slice 2 test with the candidate riding beside the sheet:
 *     0a.  the free capability probe, as above. 0b, 0c and 0d are skipped:
 *          they were proven on day one and they cost money.
 *     1.   one model sheet. --style-ref draws it WITH the reference as its
 *          only input_references entry, so the sheet itself is in the
 *          candidate style. --setting-ref draws it from the DNA alone, exactly
 *          as the default test does.
 *     2-4. three panels in production's PANEL_LAYOUT shapes: a wide
 *          establishing shot (3:2), a medium shot (1:1) and a close-up (1:1),
 *          each with input_references = [sheet, reference], in that order.
 *   index.html asks the mode's question: the same person in all three panels
 *   AND unmistakably the reference's style (--style-ref) or the reference's
 *   place (--setting-ref). manifest.json records the prompts, costs, timings
 *   and dimensions and carries "verdict": null until a person who has looked
 *   fills it in. Measured at `medium` on 2026-10-14: $0.14 (--style-ref) and
 *   $0.13 (--setting-ref). A panel carrying two references cost $0.037 to
 *   $0.040, about 1.5x a one-reference panel, and the style-mode sheet drawn
 *   against its reference about 2x a sheet from the DNA alone.
 *
 *   The prompts are frozen as those runs recorded them (manifest.json >
 *   prompts in data/kernel-test/style-ref/ and setting-ref/, both "pass").
 *   Change a word and the evidence no longer belongs to this script.
 *
 *   The reference is checked before any network call: it must exist, its
 *   first bytes must say PNG, JPEG or WebP (the media type on the data URI
 *   comes from those bytes, never from the extension), and it must be at or
 *   under the app's 3.75 MB upload cap (`lib/assets.ts`).
 *
 * Slice 17 — the motion kernel test (v3):
 *   Does the face hold in MOTION? One locked character (the day-one sheet and
 *   panels, same Kaito), three shots — close-up 1:1, medium 1:1, wide 16:9 —
 *   5 s each at 720p on bytedance/seedance-2.0, animated two ways:
 *     A. the panel as the FIRST FRAME            (frame_images)
 *     B. the panel AND the sheet as REFERENCES   (input_references), the
 *        prompt naming the first as the opening frame
 *   A first frame and references cannot ride in one call (OpenRouter drops the
 *   references when both are sent; spec.md > Verified for v3), so the
 *   learner's first design is not on offer: these two are.
 *     0e.  FREE capability probe, GET /videos/models: the model is listed, 720p,
 *          1:1, 16:9, 5 s, first_frame and seed are supported, and the token
 *          price is read for the cost check below.
 *     1.   the medium panel is drawn from the day-one sheet (the only input not
 *          already on disk: ~$0.04). The sheet and the close-up are reused; the
 *          wide 3:2 panel is centre-cropped to Seedance's 16:9.
 *     2.   six jobs: submit, poll, download. Every job id is written to
 *          jobs.json the moment it exists, so a crash or a Ctrl+C never pays
 *          for a clip twice: re-run into the same folder and it resumes.
 *     3.   ffprobe each clip, pull its first / middle / last frame, and check
 *          the billed usage.cost against tokens = W x H x s x 24 / 1024 at the
 *          model's per-token price (within 5%). Spend is about $3.2 in all.
 *   index.html lays the opening panel and the sheet beside each shot's two
 *   strips; manifest.json carries "verdict": null until a person who has
 *   looked fills it in. The script never judges a face.
 *   Resolution and model are fixed at the claim's values; MOTION_VIDEO_MODEL
 *   and MOTION_VIDEO_RESOLUTION exist only to rehearse the pipeline cheaply,
 *   and a run that uses them says on the page that it is not evidence.
 *
 * Usage:
 *   node scripts/kernel-test.mjs                          # probes, then the kernel test
 *   node scripts/kernel-test.mjs --probe-only             # just prove the setup
 *   node scripts/kernel-test.mjs --out <dir>              # any mode: write results to <dir>
 *   node scripts/kernel-test.mjs --style-ref <image>      # candidate-lock test, data/kernel-test/style-ref/
 *   node scripts/kernel-test.mjs --setting-ref <image>    # candidate-lock test, data/kernel-test/setting-ref/
 *   node scripts/kernel-test.mjs --motion                 # the motion test, data/kernel-test/motion/ (~$3.2)
 *   node scripts/kernel-test.mjs --motion --probe-only    # just the free probes
 *
 * --out exists so a re-run keeps its own folder. The spec asks for the default
 * test to run again before filming as the style-drift canary (the model is an
 * unpinned alias), and that run belongs beside the day-one evidence in
 * data/kernel-test/, not over it.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const DEFAULT_OUT_DIR = 'data/kernel-test'
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
const FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL ?? 'openai/gpt-5.6-terra'
const QUALITY = process.env.KERNEL_TEST_QUALITY ?? 'medium'

// Production aspect ratios. OpenRouter takes `aspect_ratio`, NOT `size` —
// there is no pixel-dimension parameter on this model.
const ASPECT_WIDE = process.env.IMAGE_PANEL_ASPECT_WIDE ?? '3:2'
const ASPECT_SQUARE = process.env.IMAGE_PANEL_ASPECT_SQUARE ?? '1:1'
const ASPECT_SHEET = process.env.IMAGE_SHEET_ASPECT ?? '3:2'

if (!KEY) {
  console.error(`\n  OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your keys.\n`)
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

// The look lines are what a style reference replaces. The text ban is what
// no mode ever touches.
const LOOK_LINES = [
  'Black and white manga artwork, screentone shading, confident inked linework.',
  'Seinen style, detailed backgrounds, strong use of blacks.',
]
const NO_TEXT_RULE = [
  'ABSOLUTELY NO TEXT, no speech bubbles, no sound effects, no signatures,',
  'no watermarks and no panel borders anywhere in the image.',
]

const STYLE_RULES = [...LOOK_LINES, ...NO_TEXT_RULE].join(' ')

/**
 * --style-ref: the rules with the look lines swapped for the reference. The
 * sheet attaches the reference alone, so for it `which` is "the attached
 * image"; a panel attaches the sheet first, so there it is "the second
 * attached image". NO_TEXT_RULE rides verbatim either way.
 */
function styleRefRules(which) {
  return [
    `Match the style of ${which} exactly: its linework, shading, rendering and palette.`,
    ...NO_TEXT_RULE,
  ].join(' ')
}

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

const SHEET_HEAD = [
  'A single character model sheet on one sheet of paper, for animation reference.',
  'One character only, shown three times in one frame: full-body front view,',
  'full-body three-quarter view, and a row of three head-and-shoulders expressions',
  '(neutral, determined, surprised). Plain light background, consistent lighting.',
]

const SHEET_PROMPT = [
  ...SHEET_HEAD,
  '',
  'The character:',
  KAITO_DNA,
  '',
  STYLE_RULES,
].join('\n')

// --style-ref: the same sheet, drawn with the reference attached as its only
// input_references entry. The subject of the reference must not leak in.
const STYLE_SHEET_PROMPT = [
  ...SHEET_HEAD,
  '',
  'The attached image is a style reference. Match its style exactly, meaning its',
  'linework, shading, rendering and palette, but do not copy its subject: nothing',
  'from that picture appears on this sheet except the way it is drawn.',
  '',
  'The character:',
  KAITO_DNA,
  '',
  styleRefRules('the attached image'),
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
// Candidate-lock panels (slice 15).
//
// Three shots in the shapes production's PANEL_LAYOUT uses (lib/prompts.ts):
// the wide establishing shot of panel 1, the medium shot of panel 2, the
// close-up of panel 3. The framing lines are production's, word for word.
// Only action, camera and background vary; one person, always Kaito.
//
// The background line depends on the mode. With a setting reference the
// location IS the second attached image, so the line only says how much of
// it this camera sees; it never describes a place, because the plate can be
// any picture. With a style reference the place is free, as in slice 2.
// ---------------------------------------------------------------------------

const CANDIDATE_PANELS = [
  {
    id: 'wide',
    label: 'wide establishing shot (landscape)',
    aspect: ASPECT_WIDE,
    framing:
      'Wide landscape panel, medium-wide shot. The character stands in the left third of the frame, their figure at least a third of the panel’s height and ideally half — face and outfit clearly readable, never a small figure in the distance — with clear margin on every side. The setting fills the rest of the frame.',
    camera: 'Wide establishing shot, eye level, three-quarter view.',
    action: 'He has just stopped walking and stands with one hand holding the end of his scarf, looking off to the right, alert.',
    background: {
      style: 'A quiet night street with a food stall, paper lanterns, steam and cables overhead.',
      setting: 'The location in the second attached image, seen whole from this camera, filling the frame around him.',
    },
  },
  {
    id: 'medium',
    label: 'medium shot (square)',
    aspect: ASPECT_SQUARE,
    framing:
      'Square panel. Frame the character from the waist up, centred, with headroom above and nothing important near the edges.',
    camera: 'Medium shot, eye level, facing the camera.',
    action: 'He is tugging the scarf tighter with both hands, a small tired smile, eyes on something just past the camera.',
    background: {
      style: 'The counter of a night food stall behind him, a few lanterns, warm light on the steam.',
      setting: 'Part of the location in the second attached image directly behind him, close enough that its props stay readable.',
    },
  },
  {
    id: 'close',
    label: 'close-up (square)',
    aspect: ASPECT_SQUARE,
    framing:
      'Square panel. Centre the character’s face in frame with headroom above and below; keep the eyes on the upper third line and nothing important near the edges.',
    camera: 'Close-up on his face, slight low angle.',
    action: 'He is breathing hard, jaw set, eyes narrowed, a strand of hair across the scar.',
    background: {
      style: 'Lantern light out of focus behind him, shallow depth of field.',
      setting: 'The lights of the location in the second attached image out of focus behind his face, shallow depth of field.',
    },
  },
]

// The opening noun is production's ("A single manga panel", lib/prompts.ts
// panelPrompt, for every preset), kept in style mode too so the test measures
// the prompt the app sends. The style instruction appears twice in style mode,
// once in the body and once in the closing rules. Both are as the recorded
// 2026-10-14 runs had them; see the header.
function candidatePanelPrompt(p, mode) {
  const reference =
    mode === 'style'
      ? [
          'The second attached image is a style reference. Match its style exactly, meaning',
          'its linework, shading, rendering and palette, but do not copy its subject.',
        ]
      : [
          'The second attached image is the location this panel takes place in. Keep its',
          'architecture, props, lighting and time of day; put the character into it. Do not',
          'copy any person from it.',
        ]
  return [
    'A single manga panel with exactly one person in it: the character shown in the',
    'first attached image, a reference sheet. No other people, figures or silhouettes',
    'anywhere in the panel.',
    '',
    'Keep his face, hairstyle, eyes, outfit, scar and scarf EXACTLY as the',
    'reference sheet shows. Do not restyle, age, or redesign him.',
    'Only his pose, expression and surroundings change.',
    '',
    ...reference,
    '',
    'His fixed appearance, for reference:',
    KAITO_DNA,
    '',
    `Framing: ${p.framing}`,
    `Camera: ${p.camera}`,
    `Action: ${p.action}`,
    `Background: ${p.background[mode]}`,
    '',
    mode === 'style' ? styleRefRules('the second attached image') : STYLE_RULES,
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

/**
 * What the first bytes say a file is, or null. The same three signatures as
 * `sniffImage` in lib/assets.ts: the app never trusts an extension, so this
 * script does not either.
 */
function sniffImage(b) {
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return 'image/webp'
  }
  return null
}

/** The app's upload cap, from lib/assets.ts: 3.75 MB of bytes. */
const UPLOAD_LIMIT_BYTES = (5 * 1024 * 1024 * 3) / 4

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
// Arguments. Every refusal here happens before the first network call.
// ---------------------------------------------------------------------------

function refuse(sentence) {
  console.error(`\n  ${sentence}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = { probeOnly: false, out: null, mode: 'default', refPath: null }
  const modeOf = { '--style-ref': 'style', '--setting-ref': 'setting' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--probe-only') {
      opts.probeOnly = true
      continue
    }
    if (arg === '--motion') {
      if (opts.mode !== 'default') {
        refuse('--motion is its own test; run it without --style-ref, --setting-ref, and only once.')
      }
      opts.mode = 'motion'
      continue
    }
    // Object.hasOwn, not `in`: `in` would accept every Object.prototype name
    // (toString, constructor, ...) as a mode flag and run a paid test on a typo.
    if (arg !== '--out' && !Object.hasOwn(modeOf, arg)) {
      refuse(`Unknown argument "${arg}". This script takes --probe-only, --out <dir>, --motion, --style-ref <image> or --setting-ref <image>.`)
    }
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      refuse(`${arg} needs a value: ${arg === '--out' ? 'the folder to write into' : 'the path of a PNG, JPEG or WebP image'}.`)
    }
    i++
    if (arg === '--out') {
      if (opts.out != null) refuse('--out was given twice; pass one folder.')
      opts.out = value
      continue
    }
    if (opts.mode === modeOf[arg]) {
      refuse(`${arg} was given twice; pass one reference.`)
    }
    if (opts.mode !== 'default') {
      refuse('--style-ref, --setting-ref and --motion are separate tests; run one at a time, with one reference each.')
    }
    opts.mode = modeOf[arg]
    opts.refPath = value
  }
  return opts
}

/**
 * The candidate reference, read and checked the way the app checks an
 * upload: it exists, its first bytes name a PNG, JPEG or WebP, and it is
 * within the upload cap. The media type the data URI carries is the sniffed
 * one, so a PNG named .jpg goes out as the PNG it is.
 */
async function loadReference(path, flag) {
  let buf
  try {
    buf = await readFile(path)
  } catch (err) {
    refuse(`${flag}: cannot read "${path}" (${err.code ?? err.message}).`)
  }
  const mediaType = sniffImage(buf)
  if (!mediaType) {
    refuse(`${flag}: "${path}" is not a PNG, JPEG or WebP. Its first bytes decide, not its extension.`)
  }
  if (buf.length > UPLOAD_LIMIT_BYTES) {
    refuse(`${flag}: "${path}" is ${buf.length.toLocaleString('en-US')} bytes; the app's upload cap is ${UPLOAD_LIMIT_BYTES.toLocaleString('en-US')} bytes, 3.75 MB (lib/assets.ts), so a reference this size could never be used in the app.`)
  }
  return { path, buf, mediaType, ext: EXT_BY_MEDIA_TYPE[mediaType], bytes: buf.length }
}

const ARGS = parseArgs(process.argv.slice(2))
const MODE = ARGS.mode
const REF = MODE === 'style' || MODE === 'setting' ? await loadReference(ARGS.refPath, `--${MODE}-ref`) : null
const OUT_DIR =
  ARGS.out ??
  (MODE === 'default' ? DEFAULT_OUT_DIR : MODE === 'motion' ? join(DEFAULT_OUT_DIR, 'motion') : join(DEFAULT_OUT_DIR, `${MODE}-ref`))

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
 * v2, slice 9: proves the text fallback answers a strict JSON schema through
 * OpenRouter — the synopsis schema exactly as `lib/llm.ts` puts it on the
 * wire (`strictJsonSchema(SynopsisSchema)`), with
 * `provider.require_parameters` so a silent 200 of the wrong shape is
 * impossible. The reply is checked field by field, as zod does in the app.
 */
async function fallbackProbe() {
  const started = Date.now()
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: FALLBACK_MODEL,
      max_tokens: 1024 + 2048,
      reasoning: { effort: 'low' },
      messages: [
        {
          role: 'user',
          content:
            'Write a manga chapter synopsis for this pitch: a rooftop courier delivers a letter to a girl who moved away. ' +
            'Three sentences, present tense, naming both characters.',
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'synopsis',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'A short, evocative chapter title. No quotation marks.' },
              body: {
                type: 'string',
                description: 'The synopsis: three to five sentences of present-tense prose naming both characters.',
              },
            },
            required: ['title', 'body'],
            additionalProperties: false,
          },
        },
      },
      provider: { require_parameters: true },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error(`\n  ✗ Fallback probe failed — HTTP ${res.status}`)
    console.error(`  ${body.slice(0, 600)}\n`)
    if (res.status === 404) {
      console.error(`  No endpoint for "${FALLBACK_MODEL}" honours every parameter (require_parameters).`)
      console.error('  Check its supported_parameters on GET /api/v1/models, or set LLM_FALLBACK_MODEL.\n')
    }
    process.exit(1)
  }
  const json = await res.json()
  const content = json.choices?.[0]?.message?.content ?? ''
  const parsed = JSON.parse(content)
  if (typeof parsed.title !== 'string' || !parsed.title || typeof parsed.body !== 'string' || !parsed.body) {
    throw new Error(`Fallback reply does not match the synopsis schema: ${content.slice(0, 300)}`)
  }
  return { ms: Date.now() - started, cost: json.usage?.cost ?? null, title: parsed.title }
}

/**
 * One function for both surfaces, because OpenRouter has one endpoint.
 *
 * A sheet is this call without `references` (or, for --style-ref, with the
 * style reference alone). A panel is this call with the sheet first and, in
 * a candidate-lock test, the reference second. That is the whole difference,
 * and it is why the kernel stopped being a separate endpoint when images
 * moved to OpenRouter.
 *
 * A reference is a Buffer (taken as PNG, which is what this model returns)
 * or `{ buf, mediaType }` when the bytes are something else, as an uploaded
 * JPEG or WebP reference can be. Order is kept: references[0] is the first
 * attached image.
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
    body.input_references = references.map((ref) => {
      const { buf, mediaType } = Buffer.isBuffer(ref) ? { buf: ref, mediaType: 'image/png' } : ref
      return {
        type: 'image_url',
        image_url: { url: `data:${mediaType};base64,${buf.toString('base64')}` },
      }
    })
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
// Slice 17: the motion kernel test. See the header for what it asks.
//
// Declared above the run section on purpose: the dispatch below calls
// runMotion() before the end of the file, and a `const` that appears later in
// the file would still be in its temporal dead zone at that point.
// ---------------------------------------------------------------------------

const MOTION_MODEL = process.env.MOTION_VIDEO_MODEL ?? 'bytedance/seedance-2.0'
const MOTION_RESOLUTION = process.env.MOTION_VIDEO_RESOLUTION ?? '720p'
const MOTION_SECONDS = 5
const MOTION_SEED = 1717
const MOTION_COST_TOLERANCE = 0.05
const MOTION_POLL_MS = 10_000
const MOTION_TIMEOUT_MS = 20 * 60_000
/** Only this configuration is evidence for the claim; anything else is a rehearsal. */
const MOTION_IS_CLAIM = MOTION_MODEL === 'bytedance/seedance-2.0' && MOTION_RESOLUTION === '720p'

// What may differ between the two methods is the framing words and how the
// images travel; everything else in a shot's prompt is the same string.
const MOTION_STYLE =
  'Keep the exact black-and-white manga ink style of the opening image for the whole shot: screentone shading, confident inked linework, no colour, no 3D or photoreal rendering, no change of style.'
const MOTION_NO_TEXT = 'No text, no speech bubbles, no captions, no sound-effect lettering and no watermark anywhere in the shot.'

// The medium panel is the one input that does not exist from day one. It is
// drawn exactly the way slice 2 draws a panel: the sheet as input_references,
// production's panel prompt. The close-up and the wide are slice 2's own panels.
const MOTION_MEDIUM_PANEL = {
  id: 'medium',
  aspect: ASPECT_SQUARE,
  framing: 'Square panel. Frame the character from the waist up, centred, with headroom above and nothing important near the edges.',
  camera: 'Medium shot, eye level, facing the camera.',
  action: 'He is tugging the scarf tighter with both hands, a small tired smile, eyes on something just past the camera.',
  background: 'A rooftop at night, water towers and tangled cables behind him, the city lights soft and out of focus.',
}

const MOTION_SHOTS = [
  {
    id: 'close',
    label: 'Close-up',
    aspect: '1:1',
    camera: 'Slow push-in on his face, the camera otherwise steady.',
    action:
      'He breathes hard, a puff of steam leaving his mouth; his jaw stays set and his eyes narrow against the wind; a strand of hair stirs across the scar and the end of the scarf flutters.',
  },
  {
    id: 'medium',
    label: 'Medium shot',
    aspect: '1:1',
    camera: 'Static medium shot with a very slight handheld drift.',
    action: 'He tugs the scarf tighter with both hands, a small tired smile comes and goes, and his eyes move to something just past the camera.',
  },
  {
    id: 'wide',
    label: 'Wide shot',
    aspect: '16:9',
    camera: 'Slow tracking shot to the right, following him; the city stays behind him.',
    action: 'He sails through the air across the rooftop gap, scarf streaming behind him, and comes down on the far rooftop in a low running crouch.',
  },
]

const MOTION_METHODS = [
  { id: 'A', label: 'Method A — the panel as the first frame', how: '<code>frame_images</code> = [panel as <code>first_frame</code>]' },
  { id: 'B', label: 'Method B — the panel and the sheet as references', how: '<code>input_references</code> = [panel, sheet]' },
]

function motionPrompt(shot, method) {
  const lead =
    method === 'A'
      ? [
          `Animate this manga panel into one continuous ${MOTION_SECONDS}-second shot.`,
          'The attached image is the first frame: begin exactly on it, then let it move.',
        ]
      : [
          `One continuous ${MOTION_SECONDS}-second animated shot of a single character.`,
          'The first reference image is the opening frame of the shot: begin exactly on that composition, with the character, framing and background as drawn.',
          'The second reference image is the character model sheet: his face, hair, eyes, scar, scarf and outfit match it in every frame, from the first frame to the last.',
        ]
  return [
    ...lead,
    '',
    `Camera: ${shot.camera}`,
    `Action: ${shot.action}`,
    '',
    'His fixed appearance, which does not change at any point in the shot:',
    KAITO_DNA,
    '',
    MOTION_STYLE,
    MOTION_NO_TEXT,
  ].join('\n')
}

/** Pixel size Seedance renders a ratio at, for the estimate made before any money is spent. */
function expectedVideoDims(aspect, resolution) {
  const h = parseInt(resolution, 10)
  if (!Number.isFinite(h)) return null
  if (aspect === '1:1') return { w: h, h }
  if (aspect === '16:9') return { w: Math.round((h * 16) / 9), h }
  return null
}

/** OpenRouter's formula for Seedance: tokens = W x H x seconds x 24 / 1024. */
const videoTokens = (d, seconds) => (d.w * d.h * seconds * 24) / 1024

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}: ${(r.stderr ?? '').slice(-500)}`)
  return r.stdout
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** FREE. The video counterpart of capabilityProbe(): every assumption this test makes, before any spend. */
async function videoCapabilityProbe() {
  const started = Date.now()
  const res = await fetch(`${API}/videos/models`, { headers: { Authorization: `Bearer ${KEY}` } })
  if (!res.ok) await fail('Video capability probe', res)
  const json = await res.json()
  const list = json.data ?? json
  const model = list.find((m) => m.id === MOTION_MODEL)
  if (!model) {
    console.error(`\n  ✗ "${MOTION_MODEL}" is not in OpenRouter's video model list (${list.length} models). Nothing was spent.\n`)
    process.exit(1)
  }

  const problems = []
  const has = (field, value) => (model[field] ?? []).includes(value)
  if (!has('supported_resolutions', MOTION_RESOLUTION)) {
    problems.push(`resolution ${MOTION_RESOLUTION} is not offered. Offered: ${(model.supported_resolutions ?? []).join(', ')}`)
  }
  for (const ratio of new Set(MOTION_SHOTS.map((s) => s.aspect))) {
    if (!has('supported_aspect_ratios', ratio)) {
      problems.push(`aspect ratio ${ratio} is not offered. Offered: ${(model.supported_aspect_ratios ?? []).join(', ')}`)
    }
  }
  if (!has('supported_durations', MOTION_SECONDS)) {
    problems.push(`a ${MOTION_SECONDS} s duration is not offered. Offered: ${(model.supported_durations ?? []).join(', ')}`)
  }
  if (!has('supported_frame_images', 'first_frame')) problems.push('first_frame is not a supported frame image — method A cannot be sent.')
  if (model.seed !== true) problems.push('seed is not supported; the two methods could not be compared on one seed.')

  // generate_audio is sent as false, so the no-audio price applies.
  const skus = model.pricing_skus ?? {}
  const rate = Number(skus.video_tokens_without_audio ?? skus.video_tokens)
  if (!Number.isFinite(rate) || rate <= 0) problems.push('no per-token price in pricing_skus; the cost check has nothing to compare with.')

  if (problems.length) {
    console.error(`\n  ✗ Video capability probe failed for "${MOTION_MODEL}":\n`)
    for (const p of problems) console.error(`    • ${p}`)
    console.error('\n  Nothing was generated, so this cost nothing.\n')
    process.exit(1)
  }
  return { ms: Date.now() - started, rate, resolutions: model.supported_resolutions, ratios: model.supported_aspect_ratios, durations: model.supported_durations }
}

/** Remaining OpenRouter credit in dollars, or null when the endpoint will not say. */
async function creditsLeft() {
  try {
    const res = await fetch(`${API}/credits`, { headers: { Authorization: `Bearer ${KEY}` } })
    if (!res.ok) return null
    const { data } = await res.json()
    return typeof data?.total_credits === 'number' ? data.total_credits - (data.total_usage ?? 0) : null
  } catch {
    return null
  }
}

/** A job id worth resuming: one that has not ended in failure, cancellation or expiry. */
const isLiveJob = (job) => Boolean(job?.id) && !['failed', 'cancelled', 'expired'].includes(job.status)

const jpegDataUri = (buf) => `data:image/jpeg;base64,${buf.toString('base64')}`

/** The test's own state, written after every step that costs money so nothing is paid for twice. */
async function saveMotionState(state) {
  await writeFile(join(OUT_DIR, 'jobs.json'), JSON.stringify(state, null, 2))
}

async function submitMotionJob(state, shot, method, inputs) {
  const key = `${method.id}-${shot.id}`
  if (isLiveJob(state.jobs[key])) {
    console.log(`  ↻ ${key}: job ${state.jobs[key].id} already submitted — resuming it, not paying twice`)
    return
  }
  const panel = { type: 'image_url', image_url: { url: jpegDataUri(inputs[shot.id]) } }
  const body = {
    model: MOTION_MODEL,
    prompt: motionPrompt(shot, method.id),
    duration: MOTION_SECONDS,
    resolution: MOTION_RESOLUTION,
    aspect_ratio: shot.aspect,
    generate_audio: false,
    seed: MOTION_SEED,
    session_id: 'ink-desk-kernel-motion',
  }
  if (method.id === 'A') {
    body.frame_images = [{ ...panel, frame_type: 'first_frame' }]
  } else {
    body.input_references = [panel, { type: 'image_url', image_url: { url: jpegDataUri(inputs.sheet) } }]
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${API}/videos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 429 && attempt < 3) {
      await sleep(attempt * 5000)
      continue
    }
    if (res.status === 402) await fail(`Submit ${key}`, res)
    const text = await res.text()
    if (!res.ok) {
      state.jobs[key] = { error: `submit HTTP ${res.status}: ${text.slice(0, 500)}` }
      await saveMotionState(state)
      console.log(`  ✗ ${key}: submit refused — HTTP ${res.status} ${text.slice(0, 200)}`)
      return
    }
    const json = JSON.parse(text)
    state.jobs[key] = {
      id: json.id,
      pollingUrl: json.polling_url ?? `${API}/videos/${json.id}`,
      submittedAt: new Date().toISOString(),
      prompt: body.prompt,
      inputReferences: method.id === 'A' ? [`inputs/${shot.id}.jpg (first_frame)`] : [`inputs/${shot.id}.jpg`, 'inputs/sheet.jpg'],
    }
    await saveMotionState(state)
    console.log(`  → ${key}: submitted, job ${json.id}`)
    return
  }
}

/** Polls one job to a terminal state. Writes the outcome onto state.jobs[key]; never throws on a provider failure. */
async function waitMotionJob(state, key) {
  const job = state.jobs[key]
  const started = Date.now()
  let last = ''
  let flaky = 0
  while (Date.now() - started < MOTION_TIMEOUT_MS) {
    let json
    try {
      const res = await fetch(job.pollingUrl, { headers: { Authorization: `Bearer ${KEY}` } })
      if (res.status === 402) await fail(`Poll ${key}`, res)
      if (!res.ok) {
        if (res.status < 500 && res.status !== 429) {
          job.error = `poll HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
          return
        }
        throw new Error(`HTTP ${res.status}`)
      }
      json = await res.json()
      flaky = 0
    } catch (err) {
      if (++flaky >= 6) {
        job.error = `poll kept failing: ${err.message}`
        return
      }
      await sleep(MOTION_POLL_MS)
      continue
    }
    if (json.status !== last) {
      last = json.status
      console.log(`    ${key}: ${json.status} (${Math.round((Date.now() - started) / 1000)}s)`)
    }
    if (json.status === 'completed') {
      job.status = 'completed'
      job.costUsd = json.usage?.cost ?? null
      job.generationMs = Date.now() - Date.parse(job.submittedAt)
      job.unsignedUrls = json.unsigned_urls ?? []
      await saveMotionState(state)
      return
    }
    if (['failed', 'cancelled', 'expired'].includes(json.status)) {
      job.status = json.status
      job.error = typeof json.error === 'string' ? json.error : JSON.stringify(json.error ?? json.status)
      job.costUsd = json.usage?.cost ?? null
      await saveMotionState(state)
      return
    }
    await sleep(MOTION_POLL_MS)
  }
  job.error = `no result after ${Math.round(MOTION_TIMEOUT_MS / 60000)} minutes — the job may still finish; re-run into this folder to resume it`
}

async function downloadMotionJob(state, key) {
  const job = state.jobs[key]
  const file = join(OUT_DIR, `${key}.mp4`)
  let res = await fetch(`${API}/videos/${job.id}/content?index=0`, { headers: { Authorization: `Bearer ${KEY}` } })
  if (!res.ok && job.unsignedUrls?.[0]) res = await fetch(job.unsignedUrls[0], { headers: { Authorization: `Bearer ${KEY}` } })
  if (!res.ok) {
    job.error = `download HTTP ${res.status}`
    await saveMotionState(state)
    return null
  }
  await writeFile(file, Buffer.from(await res.arrayBuffer()))
  return file
}

/** ffprobe + frames + the cost check for one downloaded clip. */
function analyseClip(key, shot, rate, billed) {
  const file = join(OUT_DIR, `${key}.mp4`)
  const info = JSON.parse(
    run('ffprobe', [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_read_frames:format=duration',
      '-of', 'json', file,
    ])
  )
  const st = info.streams?.[0] ?? {}
  const duration = Number(info.format?.duration)
  const [num, den] = String(st.avg_frame_rate ?? '0/1').split('/').map(Number)
  const clip = { w: st.width, h: st.height, codec: st.codec_name, durationS: duration, frames: Number(st.nb_read_frames), fps: den ? num / den : null }

  const frames = {}
  for (const [name, args] of [
    ['first', ['-ss', '0']],
    ['middle', ['-ss', String(duration / 2)]],
    ['last', ['-sseof', '-0.2']],
  ]) {
    const out = `frames/${key}-${name}.jpg`
    run('ffmpeg', ['-v', 'error', '-y', ...args, '-i', file, ...(name === 'last' ? ['-update', '1'] : ['-frames:v', '1']), '-q:v', '2', join(OUT_DIR, out)])
    frames[name] = out
  }

  const [rw, rh] = shot.aspect.split(':').map(Number)
  const formulaUsd = clip.w && clip.h ? videoTokens({ w: clip.w, h: clip.h }, MOTION_SECONDS) * rate : null
  const deviation = billed != null && formulaUsd ? (billed - formulaUsd) / formulaUsd : null
  const checks = {
    playable: Boolean(clip.codec) && clip.frames > 0,
    ratio: Boolean(clip.w && clip.h) && Math.abs(clip.w / clip.h - rw / rh) < 0.02,
    duration: Math.abs(duration - MOTION_SECONDS) <= 0.5,
    costWithinTolerance: deviation != null && Math.abs(deviation) <= MOTION_COST_TOLERANCE,
  }
  return { clip, frames, formulaUsd, deviation, checks }
}

function motionPage({ results, state, inputsMeta, totalCost, claim }) {
  const money4 = (n) => (n == null ? 'cost not reported' : `$${n.toFixed(4)}`)
  const sections = MOTION_SHOTS.map((shot) => {
    const methods = MOTION_METHODS.map((m) => {
      const key = `${m.id}-${shot.id}`
      const r = results[key]
      if (!r?.ok) {
        return `<div class="method"><h3>${esc(m.label)}</h3><p class="bad">No clip — ${esc(r?.error ?? state.jobs[key]?.error ?? 'not run')}</p></div>`
      }
      const cell = (name, caption) =>
        `<figure><a href="${r.frames[name]}"><img src="${r.frames[name]}" loading="lazy"></a><figcaption>${caption}</figcaption></figure>`
      return `<div class="method"><h3>${esc(m.label)} <span class="how">${m.how}</span></h3>
  <div class="strip">
    ${cell('first', 'first frame')}${cell('middle', `middle · ${(r.clip.durationS / 2).toFixed(1)} s`)}${cell('last', `<b>last frame</b> · ${r.clip.durationS.toFixed(1)} s`)}
    <figure class="vid"><video src="${key}.mp4" controls loop muted playsinline preload="metadata"></video><figcaption>${esc(key)}.mp4 · ${r.clip.w}×${r.clip.h} · ${r.clip.fps ? r.clip.fps.toFixed(0) : '?'} fps · ${money4(r.costUsd)}</figcaption></figure>
  </div>
  <details><summary>the prompt</summary><pre>${esc(state.jobs[key].prompt)}</pre></details></div>`
    }).join('\n')
    return `<section>
<h2>${esc(shot.label)} <span class="how">${shot.aspect}</span></h2>
<div class="src">
  <figure><img src="inputs/${shot.id}.jpg"><figcaption><b>The opening panel</b> — ${esc(inputsMeta[shot.id])}</figcaption></figure>
  <figure><img src="inputs/sheet.jpg"><figcaption><b>The model sheet</b> — what the face must still match at the last frame.</figcaption></figure>
</div>
${methods}
</section>`
  }).join('\n')

  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ink Desk — motion kernel test</title>
<style>
  body{margin:0;padding:40px;background:#f3f2f2;color:#201f1d;font:16px/1.6 Lora,Georgia,serif}
  h1{font:600 30px/1.2 "Cormorant Garamond",Georgia,serif;margin:0 0 6px}
  h2{font:600 24px/1.2 "Cormorant Garamond",Georgia,serif;margin:44px 0 12px;border-top:1px solid #d6d4d1;padding-top:24px}
  h3{font-size:16px;margin:20px 0 8px}
  .how{font:400 13px/1 system-ui,sans-serif;color:#6b6762;margin-left:8px}
  p.sub{margin:0 0 24px;color:#6b6762}
  .warn{padding:12px 18px;background:#f5e2de;border-left:3px solid #b5382e;margin:0 0 24px}
  .bad{color:#b5382e}
  .src,.strip{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  figure{margin:0;flex:1 1 220px;min-width:200px;max-width:420px}
  .src figure{max-width:340px}
  img,video{width:100%;display:block;border:1px solid #d6d4d1;background:#fff}
  figcaption{margin-top:6px;font-size:13px;color:#6b6762}
  b{color:#b5382e}
  .q{margin-top:44px;padding:20px 24px;border-left:3px solid #b5382e;background:#eae9e9}
  .nums{margin-top:24px;padding:16px 20px;background:#eae9e9;font-size:14px}
  code{background:#f3f2f2;padding:1px 5px;font-size:13px}
  pre{white-space:pre-wrap;font-size:12px;background:#eae9e9;padding:12px;margin:8px 0 0}
  details{margin-top:8px;font-size:13px;color:#6b6762}
</style>
<h1>The motion kernel test — does the face hold in motion?</h1>
<p class="sub">${esc(MOTION_MODEL)} via OpenRouter · ${MOTION_RESOLUTION} · ${MOTION_SECONDS} s per shot · seed ${MOTION_SEED} · audio off · total <b>${money4(totalCost)}</b></p>
${claim ? '' : `<p class="warn"><strong>Not evidence.</strong> This run used ${esc(MOTION_MODEL)} at ${MOTION_RESOLUTION}, not the claim's bytedance/seedance-2.0 at 720p. It rehearses the pipeline; it cannot pass or fail the kernel.</p>`}
${sections}
<div class="q"><strong>The question:</strong> In each shot, <em>to the last frame</em>, is it still the same person — face, the scar through the right eyebrow, the hair, the red scarf, the jacket — as the model sheet and the opening panel? And is it still the same ink drawing, not a smoothed or recoloured one?
Judge A and B separately, shot by shot. Then record it as <code>"verdict"</code> in <code>manifest.json</code> and in <code>spec.md &gt; Decisions and Open Issues (v3)</code>: the method that holds, or neither.
If neither holds, the Animate slice and the film change shape. If one does, only that method is called a lock in the docs.</div>
<div class="nums">Each clip's billed <code>usage.cost</code> against OpenRouter's formula (tokens = W × H × seconds × 24 / 1024 at ${state.rate ? '$' + (state.rate * 1e6).toFixed(2) + ' per million' : 'the listed price'}):
${MOTION_SHOTS.flatMap((s) => MOTION_METHODS.map((m) => results[`${m.id}-${s.id}`])).filter((r) => r?.ok).map((r) => `${esc(r.key)} ${money4(r.costUsd)} vs ${money4(r.formulaUsd)} (${r.deviation == null ? 'n/a' : (r.deviation * 100).toFixed(1) + '%'})`).join(' · ')}</div>`
}

/**
 * The motion test. Resumable by construction: every job id is written to
 * jobs.json the moment it exists, and a clip that is already on disk is never
 * fetched or paid for again. Returns true when every mechanical check passed
 * (never a verdict on the faces).
 */
async function runMotion(imageCaps, videoCaps) {
  await mkdir(join(OUT_DIR, 'inputs'), { recursive: true })
  await mkdir(join(OUT_DIR, 'frames'), { recursive: true })

  let state = { medium: null, jobs: {} }
  try {
    state = JSON.parse(await readFile(join(OUT_DIR, 'jobs.json'), 'utf8'))
  } catch {
    // A fresh folder.
  }
  state.rate = videoCaps.rate
  state.jobs ??= {}

  // Estimate the money still to be spent, and refuse before spending it if the balance cannot cover it.
  const pending = MOTION_SHOTS.flatMap((s) => MOTION_METHODS.map((m) => ({ s, key: `${m.id}-${s.id}` }))).filter(({ key }) => !isLiveJob(state.jobs[key]))
  const estimate =
    pending.reduce((sum, { s }) => sum + videoTokens(expectedVideoDims(s.aspect, MOTION_RESOLUTION) ?? { w: 0, h: 0 }, MOTION_SECONDS) * videoCaps.rate, 0) +
    (state.medium ? 0 : 0.05)
  const credits = await creditsLeft()
  console.log(`  jobs    ${pending.length} to submit, ${MOTION_SHOTS.length * MOTION_METHODS.length - pending.length} already in ${OUT_DIR}/jobs.json`)
  console.log(`  spend   about $${estimate.toFixed(2)} by the formula · balance ${credits == null ? 'not readable' : '$' + credits.toFixed(2)}`)
  if (credits != null && credits < estimate + 1) {
    refuse(`The balance ($${credits.toFixed(2)}) cannot cover about $${estimate.toFixed(2)} and still stay above the $1 floor where OpenRouter stops serving. Top up at https://openrouter.ai/settings/credits. Nothing was spent.`)
  }

  // ---- the inputs -----------------------------------------------------------
  // JPEG transport copies: a 3.7 MB PNG as base64 would make a 7 MB body for
  // method B. What is sent is exactly what is kept in inputs/ and shown on the page.
  const sourceDir = DEFAULT_OUT_DIR
  const sheetSrc = join(sourceDir, '0-sheet.png')
  const closeSrc = join(sourceDir, '1-close.png')
  const wideSrc = join(sourceDir, '2-wide.png')
  for (const f of [sheetSrc, closeSrc, wideSrc]) {
    if (!existsSync(f)) refuse(`${f} is missing. The motion test animates the day-one kernel test's sheet and panels; run "node scripts/kernel-test.mjs" first. Nothing was spent.`)
  }
  const toJpeg = (src, dest, vf) =>
    run('ffmpeg', ['-v', 'error', '-y', '-i', src, ...(vf ? ['-vf', vf] : []), '-q:v', '2', join(OUT_DIR, dest)])
  toJpeg(sheetSrc, 'inputs/sheet.jpg')
  toJpeg(closeSrc, 'inputs/close.jpg')
  // 3:2 -> 16:9, the crop the spec's Animate a Page step 1 prescribes: Seedance has no 3:2.
  toJpeg(wideSrc, 'inputs/wide.jpg', 'crop=iw:trunc(iw*9/16/2)*2')

  const inputsMeta = {
    close: 'slice 2’s close-up (1:1), as drawn on day one.',
    wide: 'slice 2’s wide panel (3:2), centre-cropped to 16:9.',
    medium: 'drawn for this test from the same sheet, production’s panel prompt (1:1).',
  }
  if (!existsSync(join(OUT_DIR, 'inputs/medium.png'))) {
    process.stdout.write(`  [1] medium panel from the sheet (${ASPECT_SQUARE}, ${QUALITY}) ... `)
    const sheetPng = await readFile(sheetSrc)
    const prompt = panelPrompt(MOTION_MEDIUM_PANEL)
    const img = await generateImage({ prompt, quality: QUALITY, aspect: ASPECT_SQUARE, label: 'Medium panel', references: [sheetPng] })
    await writeFile(join(OUT_DIR, `inputs/medium.${img.ext}`), img.buf)
    if (img.ext !== 'png') refuse(`The medium panel came back as ${img.mediaType}; this script stores it as a .png. Add the case rather than guessing.`)
    state.medium = { prompt, costUsd: img.cost, ms: img.ms, dimensions: img.dims }
    await saveMotionState(state)
    console.log(`ok (${(img.ms / 1000).toFixed(1)}s) · ${money(img.cost)} · ${shape(img.dims)}`)
  } else {
    console.log('  [1] medium panel already in inputs/ — reused')
  }
  toJpeg(join(OUT_DIR, 'inputs/medium.png'), 'inputs/medium.jpg')

  const inputs = {}
  for (const name of ['sheet', 'close', 'medium', 'wide']) inputs[name] = await readFile(join(OUT_DIR, `inputs/${name}.jpg`))

  // ---- submit: A and B of the first shot first, so a wrong request shape costs nothing ----
  console.log(`  [2] submitting ${pending.length} jobs`)
  const order = MOTION_SHOTS.flatMap((s) => MOTION_METHODS.map((m) => ({ s, m })))
  for (const { s, m } of order) await submitMotionJob(state, s, m, inputs)

  // ---- wait, download, analyse — every job on its own, so one refusal stops nobody ----
  console.log('  [3] waiting for the clips (Seedance takes minutes, not seconds)')
  const results = {}
  await Promise.all(
    order.map(async ({ s, m }) => {
      const key = `${m.id}-${s.id}`
      const job = state.jobs[key]
      if (!isLiveJob(job)) {
        results[key] = { key, ok: false, error: job?.error ?? 'never submitted' }
        return
      }
      const mp4 = join(OUT_DIR, `${key}.mp4`)
      if (!existsSync(mp4)) {
        await waitMotionJob(state, key)
        if (job.status !== 'completed') {
          results[key] = { key, ok: false, error: job.error ?? job.status }
          return
        }
        if (!(await downloadMotionJob(state, key))) {
          results[key] = { key, ok: false, error: job.error }
          return
        }
      }
      try {
        const a = analyseClip(key, s, videoCaps.rate, job.costUsd ?? null)
        results[key] = { key, ok: true, method: m.id, shot: s.id, costUsd: job.costUsd ?? null, generationMs: job.generationMs ?? null, ...a }
        console.log(`    ${key}: ${a.clip.w}x${a.clip.h} ${a.clip.durationS.toFixed(1)}s · ${money(job.costUsd)}${a.deviation == null ? '' : ` (${(a.deviation * 100).toFixed(1)}% off the formula)`}`)
      } catch (err) {
        results[key] = { key, ok: false, error: `unreadable clip: ${err.message}` }
      }
    })
  )

  // ---- report ---------------------------------------------------------------
  const clipCosts = Object.values(state.jobs).map((j) => j.costUsd).filter((c) => typeof c === 'number')
  const totalCost = clipCosts.reduce((a, b) => a + b, 0) + (state.medium?.costUsd ?? 0)
  const claim = MOTION_IS_CLAIM

  await writeFile(join(OUT_DIR, 'index.html'), motionPage({ results, state, inputsMeta, totalCost, claim }))

  const ok = Object.values(results).filter((r) => r.ok)
  const manifest = {
    test: 'motion-kernel',
    provider: 'openrouter',
    endpoint: `${API}/videos`,
    videoModel: MOTION_MODEL,
    videoModelPinned: false,
    resolution: MOTION_RESOLUTION,
    seconds: MOTION_SECONDS,
    seed: MOTION_SEED,
    generateAudio: false,
    isClaimConfiguration: claim,
    capabilities: { resolutions: videoCaps.resolutions, aspectRatios: videoCaps.ratios, durations: videoCaps.durations, tokenPriceUsd: videoCaps.rate },
    inputs: {
      sheet: { file: 'inputs/sheet.jpg', from: sheetSrc },
      close: { file: 'inputs/close.jpg', from: closeSrc },
      medium: { file: 'inputs/medium.jpg', from: 'inputs/medium.png', image: state.medium },
      wide: { file: 'inputs/wide.jpg', from: wideSrc, crop: '3:2 -> 16:9, centred' },
    },
    clips: Object.fromEntries(
      order.map(({ s, m }) => {
        const key = `${m.id}-${s.id}`
        const r = results[key]
        const j = state.jobs[key] ?? {}
        return [
          key,
          {
            method: m.id,
            shot: s.id,
            aspect: s.aspect,
            jobId: j.id ?? null,
            prompt: j.prompt ?? null,
            inputReferences: j.inputReferences ?? null,
            file: r?.ok ? `${key}.mp4` : null,
            error: r?.ok ? null : r?.error ?? null,
            costUsd: r?.costUsd ?? j.costUsd ?? null,
            formulaUsd: r?.formulaUsd ?? null,
            costDeviation: r?.deviation ?? null,
            generationMs: r?.generationMs ?? null,
            clip: r?.clip ?? null,
            frames: r?.frames ?? null,
            checks: r?.checks ?? null,
          },
        ]
      })
    ),
    totalCostUsd: totalCost,
    dna: KAITO_DNA,
    generatedAt: new Date().toISOString(),
    verdict: null,
    verdictNote:
      'A person records the verdict here after looking at index.html; the script never fills this in, and null means nobody has looked yet. Suggested shape: {"method": "A" | "B" | "neither", "A": {"close": "pass|fail", "medium": "pass|fail", "wide": "pass|fail"}, "B": {...}, "note": "..."}. Judge to the last frame: face, scar, hair, scarf, outfit, ink style.',
  }
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

  // ---- the mechanical verify line (slice 17's Verify) -------------------------
  const total = MOTION_SHOTS.length * MOTION_METHODS.length
  const all = (field) => ok.length === total && ok.every((r) => r.checks[field])
  const pageHtml = await readFile(join(OUT_DIR, 'index.html'), 'utf8')
  const stripsRendered = (pageHtml.match(/frames\/[A-B]-[a-z]+-(first|middle|last)\.jpg"><img/g) ?? []).length === total * 3
  const stripsOnDisk = ok.every((r) => Object.values(r.frames).every((f) => existsSync(join(OUT_DIR, f))))
  const verify = [
    ['probe passed for ' + MOTION_MODEL, true],
    [`${ok.length}/${total} clips downloaded`, ok.length === total],
    ['every clip playable (ffprobe)', all('playable')],
    ['every clip the right shape and about 5 s', all('ratio') && all('duration')],
    [`billed cost within ${MOTION_COST_TOLERANCE * 100}% of the formula, every clip`, all('costWithinTolerance')],
    [`the page renders all ${total * 3} frames`, stripsRendered && stripsOnDisk],
  ]
  console.log('\n  Mechanical checks (not a verdict on the faces):')
  for (const [label, pass] of verify) console.log(`    ${pass ? '✓' : '✗'} ${label}`)
  for (const r of Object.values(results).filter((x) => !x.ok)) console.log(`    ✗ ${r.key}: ${r.error}`)

  console.log(`\n  Done. Look at them:`)
  console.log(`    ${OUT_DIR}/index.html`)
  console.log(`  Then record "verdict" in ${OUT_DIR}/manifest.json. Until it says a method holds, motion is a candidate lock, not a lock.`)
  if (!claim) console.log(`  This run used ${MOTION_MODEL} at ${MOTION_RESOLUTION}: a rehearsal, not evidence.`)
  console.log(`\n  Output ${OUT_DIR}/ · total ${money(totalCost)}\n`)
  return verify.every(([, pass]) => pass)
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// The output folder is created only once something is about to be written,
// so a probe-only run or a failed probe leaves nothing behind.
const timings = {}
const costs = {}
const dims = {}

const money = (n) => (n == null ? 'cost not reported' : `$${n.toFixed(4)}`)
const shape = (d) => (d ? `${d.w}x${d.h}` : 'unknown')

if (MODE === 'default') {
  console.log(`\n  Ink Desk kernel test`)
  console.log(`  text    ${TEXT_MODEL}            (Anthropic, direct)${ANTHROPIC_KEY ? '' : ' — no key, probe skipped'}`)
  console.log(`  backup  ${FALLBACK_MODEL}  (OpenRouter, text fallback)`)
  console.log(`  image   ${MODEL}  (OpenRouter)`)
  console.log(`  quality ${QUALITY} (image probe at low)`)
  console.log(`  ratios  sheet ${ASPECT_SHEET} · wide ${ASPECT_WIDE} · square ${ASPECT_SQUARE}`)
  console.log(`  output  ${OUT_DIR}/\n`)
} else if (MODE === 'motion') {
  console.log(`\n  Ink Desk kernel test — motion (candidate lock)`)
  console.log(`  video   ${MOTION_MODEL}  (OpenRouter) · ${MOTION_RESOLUTION} · ${MOTION_SECONDS} s · seed ${MOTION_SEED}${MOTION_IS_CLAIM ? '' : '  — NOT the claim configuration: a rehearsal'}`)
  console.log(`  image   ${MODEL}  (OpenRouter) · medium panel only, at ${QUALITY}`)
  console.log(`  output  ${OUT_DIR}/\n`)
} else {
  console.log(`\n  Ink Desk kernel test — ${MODE} reference (candidate lock)`)
  console.log(`  ref     ${REF.path}  (${REF.mediaType}, ${(REF.bytes / (1024 * 1024)).toFixed(2)} MB)`)
  console.log(`  image   ${MODEL}  (OpenRouter)`)
  console.log(`  quality ${QUALITY}`)
  console.log(`  ratios  sheet ${ASPECT_SHEET} · wide ${ASPECT_WIDE} · square ${ASPECT_SQUARE}`)
  console.log(`  output  ${OUT_DIR}/\n`)
}

// ---- Slice 1: three probes ----------------------------------------------

process.stdout.write('  [0a]  probing model capabilities ... ')
const caps = await capabilityProbe()
timings.capabilityProbe = caps.ms
console.log(`ok (${(caps.ms / 1000).toFixed(1)}s) — free`)
console.log(`        input_references supported, up to ${caps.refMax} — the kernel is buildable`)
console.log(`        aspect_ratio ${caps.aspects.join(' ')}`)
console.log(`        quality      ${caps.qualities.join(' ')}`)

if (MODE === 'motion') {
  console.log('  [0b-0d] skipped — proven on day one; this test pays only for one panel and six clips')
  process.stdout.write('  [0e]  probing video model capabilities ... ')
  const vcaps = await videoCapabilityProbe()
  console.log(`ok (${(vcaps.ms / 1000).toFixed(1)}s) — free`)
  console.log(`        ${MOTION_MODEL}: ${MOTION_RESOLUTION}, 1:1 and 16:9, ${MOTION_SECONDS} s, first_frame and seed supported`)
  console.log(`        token price $${(vcaps.rate * 1e6).toFixed(2)} per million (no audio); input_references on video is not in the listing — method B's first submit proves it`)
  if (caps.refMax < 1) {
    console.error(`\n  ✗ input_references max is ${caps.refMax}; the medium panel needs the sheet as a reference.\n`)
    process.exit(1)
  }
  if (ARGS.probeOnly) {
    console.log('\n  --probe-only: stopping here. Spent $0.0000.\n')
    process.exit(0)
  }
  const passed = await runMotion(caps, vcaps)
  process.exit(passed ? 0 : 1)
}

if (MODE !== 'default') {
  // A candidate-lock test pays for its four images and nothing else. The
  // three paid probes proved the setup on day one; the free one above is
  // enough to catch a renamed parameter or a dropped ratio before spending.
  console.log('  [0b-0d] skipped — the text, image and fallback probes cost money and were proven on day one; this test pays only for its four images')
  if (caps.refMax < 2) {
    console.error(`\n  ✗ input_references max is ${caps.refMax}; a candidate-lock test sends two (the sheet and the reference).\n`)
    process.exit(1)
  }
  if (ARGS.probeOnly) {
    console.log('\n  --probe-only: stopping here. Spent $0.0000.\n')
    process.exit(0)
  }
  await runCandidate()
  process.exit(0)
}

process.stdout.write('  [0b]  probing text model + structured output ... ')
if (ANTHROPIC_KEY) {
  const tp = await textProbe()
  timings.textProbe = tp.ms
  console.log(`ok (${(tp.ms / 1000).toFixed(1)}s) — "${TEXT_MODEL}" resolves, JSON schema honored`)
} else {
  console.log('skipped — ANTHROPIC_API_KEY is not set; the app will answer every text call with the fallback')
}

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

process.stdout.write('  [0d]  probing text fallback + strict schema ... ')
const fp = await fallbackProbe()
timings.fallbackProbe = fp.ms
costs.fallbackProbe = fp.cost
console.log(`ok (${(fp.ms / 1000).toFixed(1)}s) — "${FALLBACK_MODEL}" answers the synopsis schema · ${money(fp.cost)} · "${fp.title}"`)

if (ARGS.probeOnly) {
  const spent = [probe.cost, fp.cost].filter((c) => c != null).reduce((a, b) => a + b, 0)
  console.log('\n  --probe-only: stopping here. Everything this spec assumes is confirmed.')
  console.log(`  Spent ${money(spent)}.\n`)
  process.exit(0)
}

// ---- Slice 2: the kernel -------------------------------------------------

await mkdir(OUT_DIR, { recursive: true })
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

// ---------------------------------------------------------------------------
// Slice 15: the candidate-lock test. One sheet, three panels, the reference
// beside the sheet in every panel. Declared after the default run above so
// the slice 2 path reads top to bottom as it always has.
// ---------------------------------------------------------------------------

async function runCandidate() {
  await mkdir(OUT_DIR, { recursive: true })
  const refFile = `ref.${REF.ext}`
  await writeFile(join(OUT_DIR, refFile), REF.buf)
  const refEntry = { buf: REF.buf, mediaType: REF.mediaType }

  const prompts = {}
  const files = {}
  const inputs = {}

  // The sheet. In style mode the reference is its only attached image; in
  // setting mode it is the slice 2 sheet, from the DNA alone.
  const sheetPrompt = MODE === 'style' ? STYLE_SHEET_PROMPT : SHEET_PROMPT
  const sheetRefs = MODE === 'style' ? [refEntry] : []
  process.stdout.write(`  [1/4] model sheet ${MODE === 'style' ? 'in the reference style' : 'from DNA'} (${ASPECT_SHEET}) ... `)
  const sheet = await generateImage({
    prompt: sheetPrompt,
    quality: QUALITY,
    aspect: ASPECT_SHEET,
    label: 'Model sheet',
    references: sheetRefs,
  })
  files.sheet = `0-sheet.${sheet.ext}`
  await writeFile(join(OUT_DIR, files.sheet), sheet.buf)
  prompts.sheet = sheetPrompt
  inputs.sheet = MODE === 'style' ? [refFile] : []
  timings.sheet = sheet.ms
  costs.sheet = sheet.cost
  dims.sheet = sheet.dims
  console.log(`ok (${(sheet.ms / 1000).toFixed(1)}s) · ${money(sheet.cost)} · ${shape(sheet.dims)}`)

  // The panels: [sheet, reference], in that order, every time.
  const sheetEntry = { buf: sheet.buf, mediaType: sheet.mediaType }
  for (const [i, p] of CANDIDATE_PANELS.entries()) {
    process.stdout.write(`  [${i + 2}/4] ${p.label} ... `)
    const prompt = candidatePanelPrompt(p, MODE)
    const out = await generateImage({
      prompt,
      references: [sheetEntry, refEntry],
      quality: QUALITY,
      aspect: p.aspect,
      label: `Panel ${p.id}`,
    })
    files[p.id] = `${i + 1}-${p.id}.${out.ext}`
    await writeFile(join(OUT_DIR, files[p.id]), out.buf)
    prompts[p.id] = prompt
    inputs[p.id] = [files.sheet, refFile]
    timings[p.id] = out.ms
    costs[p.id] = out.cost
    dims[p.id] = out.dims
    console.log(`ok (${(out.ms / 1000).toFixed(1)}s) · ${money(out.cost)} · ${shape(out.dims)}`)
  }

  const slowest = Math.max(timings.sheet, timings.wide, timings.medium, timings.close)
  const reported = Object.values(costs).filter((c) => c != null)
  const totalCost = reported.length ? reported.reduce((a, b) => a + b, 0) : null

  const question =
    MODE === 'style'
      ? 'Is this recognisably the same person as the sheet in all three panels, <em>and</em> is every image unmistakably in the reference’s style?'
      : 'Is this recognisably the same person in all three panels, <em>and</em> is every panel unmistakably the same place as the reference (same lanterns, stall, vending machine, bicycle, pillar)?'
  const refCaption =
    MODE === 'style'
      ? 'The style reference. Attached alone to the sheet, and second to every panel.'
      : 'The setting reference. Attached second to every panel; the sheet never sees it.'
  const sheetCaption =
    MODE === 'style'
      ? 'The sheet, drawn with the style reference attached. Not the manga preset.'
      : 'The sheet, generated from the DNA text alone, no references.'

  await writeFile(
    join(OUT_DIR, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Ink Desk — ${MODE} reference test</title>
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
<h1>Candidate lock — ${MODE} reference</h1>
<p class="sub">${MODEL} via OpenRouter &middot; quality <b>${QUALITY}</b>
  &middot; slowest image call ${(slowest / 1000).toFixed(1)}s
  &middot; total ${totalCost == null ? 'cost not reported' : '<b>$' + totalCost.toFixed(4) + '</b>'}</p>
<div class="row">
  <figure><img src="${refFile}"><figcaption><b>Reference.</b> ${REF.mediaType} &middot; ${(REF.bytes / 1024).toFixed(0)} KB &middot; ${refCaption}</figcaption></figure>
  <figure><img src="${files.sheet}"><figcaption><b>The sheet.</b> ${ASPECT_SHEET} &middot; ${shape(dims.sheet)} &middot; ${sheetCaption}</figcaption></figure>
</div>
<div class="row" style="margin-top:24px">
  <figure><img src="${files.wide}"><figcaption><b>Wide establishing shot.</b> ${ASPECT_WIDE} &middot; ${shape(dims.wide)} &middot; <code>input_references</code> = [sheet, reference].</figcaption></figure>
  <figure><img src="${files.medium}"><figcaption><b>Medium shot.</b> ${ASPECT_SQUARE} &middot; ${shape(dims.medium)} &middot; same two references.</figcaption></figure>
  <figure><img src="${files.close}"><figcaption><b>Close-up.</b> ${ASPECT_SQUARE} &middot; ${shape(dims.close)} &middot; same two references.</figcaption></figure>
</div>
<div class="q"><strong>The question:</strong> ${question}
If yes to both, the ${MODE} reference is a lock and the docs may say so. If no to either, it stays a candidate.
Record the answer as <code>"verdict"</code> in <code>manifest.json</code>.</div>
<div class="nums">Slowest image call <b>${(slowest / 1000).toFixed(1)}s</b> &middot;
  sheet ${money(costs.sheet)}, wide ${money(costs.wide)}, medium ${money(costs.medium)}, close ${money(costs.close)} at <code>${QUALITY}</code>.</div>`
  )

  const image = (id, aspect) => ({
    file: files[id],
    aspect,
    inputReferences: inputs[id],
    ms: timings[id],
    costUsd: costs[id],
    dimensions: dims[id],
  })

  await writeFile(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        test: 'candidate-lock',
        mode: MODE,
        reference: { path: REF.path, bytes: REF.bytes, mediaType: REF.mediaType, copy: refFile },
        provider: 'openrouter',
        endpoint: `${API}/images`,
        imageModel: MODEL,
        imageModelPinned: false,
        quality: QUALITY,
        capabilities: { inputReferencesMax: caps.refMax, aspects: caps.aspects, qualities: caps.qualities },
        images: {
          sheet: image('sheet', ASPECT_SHEET),
          wide: image('wide', ASPECT_WIDE),
          medium: image('medium', ASPECT_SQUARE),
          close: image('close', ASPECT_SQUARE),
        },
        slowestMs: slowest,
        totalCostUsd: totalCost,
        prompts,
        dna: KAITO_DNA,
        generatedAt: new Date().toISOString(),
        verdict: null,
        verdictNote:
          'A person records "pass" or "fail" here after looking at index.html. The script never fills this in; a null verdict means nobody has looked yet.',
      },
      null,
      2
    )
  )

  console.log(`\n  Done. Look at them:`)
  console.log(`    ${OUT_DIR}/index.html`)
  console.log(`  Then record "verdict" in ${OUT_DIR}/manifest.json. Until it says pass, the ${MODE} reference is a candidate, not a lock.`)
  console.log(`\n  Output ${OUT_DIR}/ · slowest image call ${(slowest / 1000).toFixed(1)}s · total ${money(totalCost)}\n`)
}
