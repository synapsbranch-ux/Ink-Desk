// One OpenRouter call, for both surfaces. Server only — this is the second of
// the two files that see an API key.
// See `devpost/spec.md > External Services and Dependencies > OpenRouter —
// GPT Image (pictures)`.
//
// The structural point: OpenRouter has ONE image route. A sheet is this call
// without `references`; a panel is this call with one. That is the whole
// difference, which is why the kernel is a single extra field rather than a
// different endpoint. Proven end to end by `scripts/kernel-test.mjs`.
//
// No SDK: the body shape (`aspect_ratio`, `input_references`) is not the
// OpenAI images API, so a client would hide the request rather than help.
import { ProviderError } from './claude'

const API = 'https://openrouter.ai/api/v1'

export const IMAGE_MODEL = process.env.IMAGE_MODEL ?? 'openai/gpt-image-2.5-sunburst'
export const SHEET_ASPECT = process.env.IMAGE_SHEET_ASPECT ?? '3:2'
export const PANEL_ASPECT_WIDE = process.env.IMAGE_PANEL_ASPECT_WIDE ?? '3:2'
export const PANEL_ASPECT_SQUARE = process.env.IMAGE_PANEL_ASPECT_SQUARE ?? '1:1'
export const SHEET_QUALITY = process.env.IMAGE_SHEET_QUALITY ?? 'low'
export const PANEL_QUALITY = process.env.IMAGE_PANEL_QUALITY ?? 'low'

/** `media_type` picks the extension — never a hardcoded `.png`. Writing JPEG
 *  bytes into a `.png` name produces a file some viewers open, the canvas
 *  export may not, and nobody thinks to suspect. Unknown types are a hard
 *  failure rather than a guess. */
const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export type GeneratedImage = {
  bytes: Buffer
  ext: string
  mediaType: string
  /** The real dollar cost of this one call, straight from the provider. */
  cost: number | null
  ms: number
}

type Options = {
  prompt: string
  aspect: string
  quality: string
  /** The kernel. Present for a panel, absent for a sheet. */
  references?: Buffer[]
  /** Prefixes the terminal log line, e.g. `sheet` or `panel 3`. */
  label: string
}

/**
 * Generate one image. Throws `ProviderError` with a sentence fit for the
 * browser; the raw cause is logged by the caller and never sent on.
 */
export async function generateImage({
  prompt,
  aspect,
  quality,
  references = [],
  label,
}: Options): Promise<GeneratedImage> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) {
    throw new ProviderError(
      'The studio isn’t connected to the art board yet. Add OPENROUTER_API_KEY to .env and restart the dev server.',
      'config'
    )
  }

  const body: Record<string, unknown> = { model: IMAGE_MODEL, prompt, aspect_ratio: aspect, quality, n: 1 }

  // References travel as base64 data URIs inside the JSON body — no FormData,
  // no Blob. This makes the body ~4/3 the size of the PNG, which is fine for
  // the one reference a panel ever sends.
  if (references.length) {
    body.input_references = references.map((png) => ({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
    }))
  }

  const started = Date.now()
  let res: Response
  try {
    res = await fetch(`${API}/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new ProviderError('The art board didn’t answer just now. Try again in a moment.', 'provider', err)
  }

  if (!res.ok) throw await providerFailure(res, label)

  const json = (await res.json()) as {
    data?: { b64_json?: string; media_type?: string }[]
    usage?: { cost?: number }
  }
  const item = json.data?.[0]
  if (!item?.b64_json) {
    throw new ProviderError(
      'The art board sent back nothing to draw. Try again in a moment.',
      'provider',
      JSON.stringify(json).slice(0, 600)
    )
  }

  const mediaType = item.media_type ?? 'image/png'
  const ext = EXT_BY_MEDIA_TYPE[mediaType]
  if (!ext) {
    throw new ProviderError(
      'The art board sent an image this studio can’t read. Try again in a moment.',
      'provider',
      `unrecognised media_type "${mediaType}" — add it to EXT_BY_MEDIA_TYPE rather than guessing`
    )
  }

  const cost = json.usage?.cost ?? null
  const ms = Date.now() - started
  // The real price of this call, better than any table in the spec.
  console.log(
    `[image] ${label} · ${quality} ${aspect} · ${(ms / 1000).toFixed(1)}s · ${
      cost == null ? 'cost not reported' : `$${cost.toFixed(4)}`
    }`
  )

  return { bytes: Buffer.from(item.b64_json, 'base64'), ext, mediaType, cost, ms }
}

/**
 * 402 is the one that will actually happen, and it fails every image at once
 * rather than one unlucky panel. The terminal gets the four-line explanation
 * with the real fix; the browser gets a calm sentence, per
 * `devpost/spec.md > Important Failure Modes`.
 */
async function providerFailure(res: Response, label: string): Promise<ProviderError> {
  const detail = await res.text().catch(() => '')

  if (res.status === 402) {
    console.error(`[image] ${label} — OpenRouter returned 402, out of credits.`)
    console.error('        The balance is at or below $1, which is where OpenRouter stops serving.')
    console.error('        Top up at https://openrouter.ai/settings/credits.')
    console.error('        A full filming run needs about $2.50 of headroom.')
    return new ProviderError('The studio is out of ink for today.', 'provider', `402 ${detail.slice(0, 300)}`)
  }

  const calm =
    res.status === 429
      ? 'The art board is busy. Try again in a moment.'
      : 'The art board didn’t come back. Try again in a moment.'
  return new ProviderError(calm, 'provider', `HTTP ${res.status} ${detail.slice(0, 600)}`)
}
