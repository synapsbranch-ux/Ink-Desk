// Request bodies, read with a cap. Route handlers have no body-size limit of
// their own (the Next 16 docs say so), and `req.json()` / `req.formData()`
// buffer whatever arrives — a chunked body with no Content-Length included.
// So every route reads its body here: a declared length over the cap is
// refused before a byte is read, and the stream itself is counted as it
// arrives and cancelled the moment it passes the cap. See
// `devpost/security-report.md` SEC-03, SEC-04, CR-4, CR-5.
import type { z } from 'zod'
import { Refused } from './errors'

/** Enough for any JSON edit or generation request but the scenario patch. */
export const JSON_LIMIT_BYTES = 64 * 1024

const TOO_LARGE = 'That request is too large.'
const UNREADABLE = 'That edit couldn’t be read.'

type Sentences = { tooLarge?: string; unreadable?: string }

/** The body's bytes, never more than `maxBytes` of them. */
export async function readBytes(req: Request, maxBytes: number, sentences: Sentences = {}): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = sentences.tooLarge ?? TOO_LARGE
  const declared = req.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) throw new Refused(tooLarge, 413)
  if (!req.body) return new Uint8Array(0)

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    let next: ReadableStreamReadResult<Uint8Array>
    try {
      next = await reader.read()
    } catch {
      // The client went away mid-body, or the stream broke: nothing to parse.
      throw new Refused(sentences.unreadable ?? UNREADABLE, 400)
    }
    if (next.done) break
    total += next.value.byteLength
    if (total > maxBytes) {
      // Stop pulling: the rest of the body is never read into memory.
      void reader.cancel().catch(() => {})
      throw new Refused(tooLarge, 413)
    }
    chunks.push(next.value)
  }

  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}

/** The body as JSON, capped. Invalid JSON is the route's own "couldn't be read". */
export async function readJson(req: Request, maxBytes: number, sentences: Sentences = {}): Promise<unknown> {
  const bytes = await readBytes(req, maxBytes, sentences)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Refused(sentences.unreadable ?? UNREADABLE, 400)
  }
}

/**
 * Read, cap and validate in one step: the parsed body, or a 400 carrying the
 * route's sentence. One sentence for bad JSON and a bad shape alike, as the
 * routes have always answered.
 */
export async function parseJson<T extends z.ZodType>(
  req: Request,
  schema: T,
  maxBytes: number,
  unreadable: string
): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await readJson(req, maxBytes, { unreadable }))
  if (!parsed.success) throw new Refused(unreadable, 400)
  return parsed.data
}

/** A multipart body, capped while it streams, then parsed. */
export async function readForm(req: Request, maxBytes: number, sentences: Sentences = {}): Promise<FormData> {
  const bytes = await readBytes(req, maxBytes, sentences)
  const type = req.headers.get('content-type') ?? ''
  try {
    return await new Response(bytes, { headers: { 'content-type': type } }).formData()
  } catch {
    throw new Refused(sentences.unreadable ?? UNREADABLE, 400)
  }
}
