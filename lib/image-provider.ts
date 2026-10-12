// The one OpenRouter call. Server only — the second of the two files that
// see an API key. See `devpost/spec.md > External Services and Dependencies
// > OpenRouter — GPT Image (pictures)`.
//
// One endpoint for both surfaces: a sheet is this call without `references`,
// a panel is this call with one. Proven by `scripts/kernel-test.mjs` in
// slices 1–2 and ported from it:
//   • `aspect_ratio`, never `size` — there is no pixel parameter on this model;
//   • the reference travels as a base64 data URI inside the JSON body;
//   • the response is `b64_json` plus a `media_type`, never a URL;
//   • `usage.cost` is the real price of the call, logged every time.
import { ProviderError } from './errors'

const API = 'https://openrouter.ai/api/v1/images'

export type ImageRequest = {
  prompt: string
  aspect: string
  quality: string
  /** Locked sheets, as raw bytes. Absent for a sheet; one entry for a panel. */
  references?: { bytes: Buffer; mediaType: string }[]
  /** For the terminal log only, e.g. "sheet · Kaito Ren". */
  label: string
}

export type GeneratedImage = {
  b64: string
  mediaType: string
  costUsd: number | null
  ms: number
}

/** Read at call time, so a `.env` edit needs only a dev-server restart. */
export function imageConfig() {
  return {
    model: process.env.IMAGE_MODEL ?? 'openai/gpt-image-2.5-sunburst',
    sheetAspect: process.env.IMAGE_SHEET_ASPECT ?? '3:2',
    sheetQuality: process.env.IMAGE_SHEET_QUALITY ?? 'low',
    panelAspectWide: process.env.IMAGE_PANEL_ASPECT_WIDE ?? '3:2',
    panelAspectSquare: process.env.IMAGE_PANEL_ASPECT_SQUARE ?? '1:1',
    panelQuality: process.env.IMAGE_PANEL_QUALITY ?? 'low',
    timeoutMs: Number(process.env.GENERATION_TIMEOUT_MS ?? 360000),
  }
}

const BUSY = 'The image model didn’t answer just now.'

type ImagesResponse = {
  data?: { b64_json?: string; media_type?: string }[]
  usage?: { cost?: number }
}

export async function generateImage(req: ImageRequest): Promise<GeneratedImage> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) {
    throw new ProviderError(
      'The studio isn’t connected to the image model yet. Add OPENROUTER_API_KEY to .env and restart the dev server.',
      'config'
    )
  }
  const cfg = imageConfig()

  const body: Record<string, unknown> = {
    model: cfg.model,
    prompt: req.prompt,
    aspect_ratio: req.aspect,
    quality: req.quality,
    n: 1,
  }
  if (req.references?.length) {
    body.input_references = req.references.map((r) => ({
      type: 'image_url',
      image_url: { url: `data:${r.mediaType};base64,${r.bytes.toString('base64')}` },
    }))
  }

  const started = Date.now()
  let res: Response
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    })
  } catch (err) {
    // A timeout or a network failure. Slice 6 adds the one silent retry.
    throw new ProviderError(BUSY, 'provider', err)
  }
  if (!res.ok) throw await failure(res, req.label)

  const json = (await res.json()) as ImagesResponse
  const item = json.data?.[0]
  if (!item?.b64_json) {
    throw new ProviderError(BUSY, 'provider', JSON.stringify(json).slice(0, 600))
  }

  const ms = Date.now() - started
  const costUsd = json.usage?.cost ?? null
  const mediaType = item.media_type ?? 'image/png'
  console.log(
    `[image] ${req.label} — ${(ms / 1000).toFixed(1)}s · ${costUsd == null ? 'cost not reported' : `$${costUsd.toFixed(4)}`} · ${mediaType} · ${cfg.model} ${req.quality} ${req.aspect}`
  )
  return { b64: item.b64_json, mediaType, costUsd, ms }
}

/**
 * The browser gets a sentence; the terminal gets the cause. 402 gets the full
 * explanation because it is the one failure that hits every image at once,
 * and the calm "busy" sentence in the browser is honest but incomplete.
 */
async function failure(res: Response, label: string): Promise<ProviderError> {
  const text = await res.text().catch(() => '')

  if (res.status === 402) {
    console.error(
      [
        `✗ OpenRouter returned 402 — out of credits (${label}).`,
        '  The balance is at or below $1, which is where OpenRouter stops serving.',
        '  Top up at https://openrouter.ai/settings/credits and try again.',
        '  A full filming run needs about $2.50 of headroom.',
      ].join('\n')
    )
    return new ProviderError(BUSY, 'provider', `402 ${text.slice(0, 300)}`)
  }

  if (res.status === 400 && /moderation|safety|content[_ ]policy|refus|not allowed/i.test(text)) {
    return new ProviderError(
      'The image model wouldn’t draw that description as written. Edit the look and draw again.',
      'refused',
      `400 ${text.slice(0, 600)}`
    )
  }

  return new ProviderError(BUSY, 'provider', `HTTP ${res.status} ${text.slice(0, 600)}`)
}
