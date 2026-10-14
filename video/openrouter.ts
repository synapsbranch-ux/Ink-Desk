// The OpenRouter key and its error messages, shared by the narration
// (narrate.mts) and the generated music (music/generate.mts). The key comes
// from OPENROUTER_API_KEY in the environment or the repo's .env, and is never
// printed.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** KEY=value lines only: enough for a .env, and nothing in it is ever echoed. */
export function readDotEnv(path: string, name: string): string | undefined {
  if (!existsSync(path)) return undefined
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m || m[1] !== name) continue
    // A quoted value may still carry a comment after its closing quote, as dotenv allows.
    const value = m[2].trim()
    const quoted = /^(["'])(.*)\1\s*(?:#.*)?$/.exec(value)
    return (quoted ? quoted[2] : value.replace(/\s+#.*$/, '')) || undefined
  }
  return undefined
}

/** A setting from the shell or the repo's .env, the shell winning, as Next does. */
export const setting = (name: string) => process.env[name]?.trim() || readDotEnv(join(ROOT, '.env'), name)

/** The key, or `undefined` — then MISSING_KEY is the sentence to show. */
export const apiKey = () => setting('OPENROUTER_API_KEY')
export const MISSING_KEY = 'There is no OpenRouter key: set OPENROUTER_API_KEY in the environment or in the .env at the repository root.'

/** The provider's message, on one line and short enough to read. */
export async function providerMessage(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  let message = body
  try {
    const j = JSON.parse(body) as { error?: { message?: string; metadata?: { raw?: unknown } } }
    message = j.error?.message ?? body
    const raw = j.error?.metadata?.raw
    if (typeof raw === 'string' && raw && !message.includes(raw)) message = `${message} (${raw})`
  } catch {
    // Not JSON: the text itself is the best summary there is.
  }
  message = message.replace(/\s+/g, ' ').trim()
  return message.length > 240 ? `${message.slice(0, 237)}...` : message || 'no reason given'
}

/**
 * Best effort: OpenRouter's own figure for what a run cost. The stats for a
 * generation appear some seconds after its output does, so every id is asked
 * for together until all have answered or about twenty seconds have passed.
 */
export async function actualCost(key: string, ids: string[]): Promise<number | null> {
  const costs = new Map<string, number>()
  for (let attempt = 0; attempt < 10 && costs.size < ids.length; attempt++) {
    await new Promise((r) => setTimeout(r, 2000))
    await Promise.all(
      ids
        .filter((id) => !costs.has(id))
        .map(async (id) => {
          try {
            const res = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, {
              headers: { Authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(15_000),
            })
            if (!res.ok) return
            const j = (await res.json()) as { data?: { total_cost?: number } }
            if (typeof j.data?.total_cost === 'number') costs.set(id, j.data.total_cost)
          } catch {
            // Not reported yet, or the network blinked; the estimate stands.
          }
        }),
    )
  }
  return costs.size === ids.length ? [...costs.values()].reduce((a, b) => a + b, 0) : null
}
