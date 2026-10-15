// Slice 9's rules from `devpost/checklist.md > Slices > 9`, with `fetch`
// stubbed — neither Claude nor OpenRouter is ever called:
//
//   npm run check:llm
//
// Every output schema survives strict JSON-schema mode (or the check names
// the keywords that had to be lowered). Claude answers first and the
// terminal says so. With no ANTHROPIC_API_KEY, a 402, or a 529 that survives
// the single retry, the same schema goes to the fallback with the strict
// body, and the terminal names the fallback. A malformed fallback reply is
// refused by the schema, retried once, and never written to the desk.
// `LLM_FALLBACK=never` gives the calm config sentence; a Claude 400 is not
// covered by the fallback.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-llm-'))
process.env.INKDESK_DATA_DIR = dir
process.env.OPENROUTER_API_KEY = 'check-only-never-sent' // fetch is stubbed below
delete process.env.ANTHROPIC_API_KEY
delete process.env.LLM_FALLBACK
delete process.env.LLM_FALLBACK_MODEL
delete process.env.ANTHROPIC_MODEL

// Loaded dynamically, like every other check — one module instance.
const { z } = await import('zod')
const { ask, fallbackBody, strictJsonSchema } = await import('../lib/llm')
const { writeSynopsis } = await import('../lib/claude')
const { ProviderError } = await import('../lib/errors')
const schemas = await import('../lib/schemas')
const { createProject, read: readDesk } = await import('../lib/chapter')

// --- The stub: scripted answers per host, every request recorded ----------
type Sent = { url: string; headers: Headers; body: Record<string, unknown> }
type Answer = { status: number; json?: unknown; headers?: Record<string, string> }
const sent: Sent[] = []
const anthropicAnswers: Answer[] = []
const openrouterAnswers: Answer[] = []
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
  const raw = input instanceof Request ? await input.text() : String(init?.body ?? '{}')
  sent.push({ url, headers, body: JSON.parse(raw) })
  const queue = url.startsWith('https://api.anthropic.com') ? anthropicAnswers : url.startsWith('https://openrouter.ai') ? openrouterAnswers : null
  const next = queue?.shift()
  if (!next) throw new Error(`unscripted fetch to ${url}`)
  return new Response(JSON.stringify(next.json ?? { error: { type: 'error', message: 'stubbed' } }), {
    status: next.status,
    headers: { 'content-type': 'application/json', ...next.headers },
  })
}) as typeof fetch
const take = () => sent.splice(0)
const toAnthropic = (s: Sent[]) => s.filter((r) => r.url.startsWith('https://api.anthropic.com'))
const toOpenRouter = (s: Sent[]) => s.filter((r) => r.url === 'https://openrouter.ai/api/v1/chat/completions')

// --- The terminal, captured ------------------------------------------------
const lines: string[] = []
const realLog = console.log
const realWarn = console.warn
const realError = console.error
const capture = (...args: unknown[]) => void lines.push(args.map(String).join(' '))
console.log = console.warn = console.error = capture
const terminal = () => lines.splice(0).join('\n')
const ok = (msg: string) => realLog(`  ok  ${msg}`)

const SYNOPSIS = { title: 'Return to Sender', body: 'Kaito carries a letter across the rooftops to Mio.' }
const claudeReply = (obj: unknown): Answer => ({
  status: 200,
  json: {
    id: 'msg_check',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text: JSON.stringify(obj) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  },
})
const terraReply = (content: string, cost = 0.0017): Answer => ({
  status: 200,
  json: { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { cost } },
})
const claudeError = (status: number): Answer => ({
  status,
  // The SDK honours retry-after-ms, so the one retry costs a millisecond here.
  headers: { 'retry-after-ms': '1' },
  json: { type: 'error', error: { type: 'overloaded_error', message: `stubbed ${status}` } },
})
const synopsisInput = { pitch: 'A courier and a letter.', genre: 'Drama', tone: 'Bittersweet' }

try {
  // 1. Every output schema survives strict mode. -----------------------------
  const outputs: [string, import('zod').ZodType][] = [
    ['SynopsisSchema', schemas.SynopsisSchema],
    ['CastSchema', schemas.CastSchema],
    ['CharacterProposalSchema', schemas.CharacterProposalSchema],
    ['DnaSchema', schemas.DnaSchema],
    ['pageScriptSchema', schemas.pageScriptSchema(['char-a', 'char-b'])],
    ['PanelRewriteSchema', schemas.PanelRewriteSchema],
    // Slice 11: the Director's plan at both ends of its range, and the summary.
    ['chapterPlanSchema(3)', schemas.chapterPlanSchema(['char-a', 'char-b'], 3)],
    ['chapterPlanSchema(6)', schemas.chapterPlanSchema(['char-a', 'char-b'], 6)],
    ['ScenarioSummarySchema', schemas.ScenarioSummarySchema],
  ]
  const loweredBy: Record<string, string[]> = {}
  for (const [name, schema] of outputs) {
    const { schema: wire, lowered } = strictJsonSchema(schema)
    assert.equal(wire.$schema, undefined, `${name}: $schema must not reach the wire`)
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`))
      if (!node || typeof node !== 'object') return
      const obj = node as Record<string, unknown>
      for (const k of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'pattern', 'format']) {
        assert.ok(!(k in obj), `${name}${path}: ${k} reached the strict schema`)
      }
      if (obj.type === 'object') {
        assert.equal(obj.additionalProperties, false, `${name}${path}: object not closed`)
        assert.deepEqual([...(obj.required as string[])].sort(), Object.keys(obj.properties as object).sort(), `${name}${path}: not every property required`)
      }
      for (const v of Object.values(obj)) walk(v, path)
    }
    walk(wire, '')
    if (lowered.length) loweredBy[name] = lowered
  }
  // The one schema the raw conversion would not have survived strict mode as is.
  assert.deepEqual(Object.keys(loweredBy), ['PanelRewriteSchema'], 'unexpected schemas needed lowering')
  assert.deepEqual(loweredBy.PanelRewriteSchema, ['.action.minLength', '.camera.minLength', '.background.minLength'])
  assert.ok(JSON.stringify(z.toJSONSchema(schemas.PanelRewriteSchema)).includes('minLength'))
  // The enum that pins a panel's character survives to the grammar.
  const script = strictJsonSchema(schemas.pageScriptSchema(['char-a', 'char-b'])).schema as {
    properties: Record<string, { properties: { characterId: { enum: string[] } } }>
  }
  assert.deepEqual(script.properties.panel1.properties.characterId.enum, ['char-a'])
  assert.deepEqual(script.properties.panel2.properties.characterId.enum, ['char-b'])
  // An optional property cannot be strict; the error names it.
  assert.throws(() => strictJsonSchema(z.object({ a: z.string(), b: z.string().optional() })), /optional b — make it \.nullable\(\)/)
  ok(`every output schema survives strict mode; lowered (zod still enforces): PanelRewriteSchema ${loweredBy.PanelRewriteSchema.join(' ')}`)

  // 2. No key → the fallback, with the strict body. -------------------------
  openrouterAnswers.push(terraReply(JSON.stringify(SYNOPSIS)))
  assert.deepEqual(await writeSynopsis(synopsisInput), SYNOPSIS)
  let reqs = take()
  assert.equal(toAnthropic(reqs).length, 0, 'no key: Claude must not be called')
  assert.equal(reqs.length, 1)
  const body = toOpenRouter(reqs)[0].body as {
    model: string
    max_tokens: number
    messages: { role: string; content: unknown }[]
    response_format: { type: string; json_schema: { name: string; strict: boolean; schema: unknown } }
    provider: { require_parameters: boolean }
    temperature?: unknown
  }
  assert.equal(toOpenRouter(reqs)[0].headers.get('authorization'), 'Bearer check-only-never-sent')
  assert.equal(body.model, 'openai/gpt-5.6-terra')
  assert.equal(body.response_format.type, 'json_schema')
  assert.equal(body.response_format.json_schema.name, 'synopsis')
  assert.equal(body.response_format.json_schema.strict, true)
  assert.deepEqual(body.response_format.json_schema.schema, strictJsonSchema(schemas.SynopsisSchema).schema)
  assert.deepEqual(body.provider, { require_parameters: true })
  assert.equal(body.messages.length, 1)
  assert.equal(body.messages[0].role, 'user')
  assert.equal(typeof body.messages[0].content, 'string')
  assert.ok(body.max_tokens >= 1024)
  assert.equal(body.temperature, undefined)
  let log = terminal()
  assert.match(log, /\[text\] synopsis — Claude unavailable \(no ANTHROPIC_API_KEY\); asking openrouter\/openai\/gpt-5\.6-terra/)
  assert.match(log, /\[text\] synopsis — openrouter\/openai\/gpt-5\.6-terra · \d+\.\ds · \$0\.0017/)
  ok('no ANTHROPIC_API_KEY → the fallback, strict json_schema body, require_parameters, terminal names it')

  // 3. Images travel as data URIs ahead of the prompt. -----------------------
  const withImage = fallbackBody(schemas.DnaSchema, 'Describe her.', 1024, 'dna from picture', [
    { bytes: Buffer.from('png-bytes'), mediaType: 'image/png' },
  ], 'openai/gpt-5.6-terra') as { messages: { content: { type: string; image_url?: { url: string }; text?: string }[] }[]; response_format: { json_schema: { name: string } } }
  const parts = withImage.messages[0].content
  assert.equal(parts[0].type, 'image_url')
  assert.equal(parts[0].image_url?.url, `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`)
  assert.deepEqual(parts[1], { type: 'text', text: 'Describe her.' })
  assert.equal(withImage.response_format.json_schema.name, 'dna_from_picture')
  ok('images go to the fallback as image_url data URIs ahead of the prompt')

  // 4. Claude first, when it answers — and the terminal says so. -------------
  process.env.ANTHROPIC_API_KEY = 'check-only-never-sent'
  anthropicAnswers.push(claudeReply(SYNOPSIS))
  const claudeMeter = { costUsd: 0 }
  assert.deepEqual(await writeSynopsis(synopsisInput, claudeMeter), SYNOPSIS)
  reqs = take()
  assert.equal(toAnthropic(reqs).length, 1)
  assert.equal(toOpenRouter(reqs).length, 0)
  assert.equal((toAnthropic(reqs)[0].body as { model: string }).model, 'claude-sonnet-5-5')
  assert.match(terminal(), /\[text\] synopsis — anthropic\/claude-sonnet-5-5 · \d+\.\ds/)
  // Slice 11: Claude's cost from its token counts at the listed $2 / $10 per million.
  assert.ok(Math.abs(claudeMeter.costUsd - (10 * 2 + 10 * 10) / 1e6) < 1e-12, 'Claude’s text cost is metered from its usage')
  ok('with a key, Claude answers and the fallback is never called; its cost is metered from the tokens')

  // 5. A 402 → the fallback, without a retry. -------------------------------
  anthropicAnswers.push(claudeError(402))
  openrouterAnswers.push(terraReply(JSON.stringify(SYNOPSIS)))
  assert.deepEqual(await writeSynopsis(synopsisInput), SYNOPSIS)
  reqs = take()
  assert.equal(toAnthropic(reqs).length, 1, '402: Claude must not be retried')
  assert.equal(toOpenRouter(reqs).length, 1)
  assert.match(terminal(), /Claude unavailable \(402\); asking openrouter/)
  ok('Claude 402 → the fallback with no retry')

  // 6. A 529 → one retry, then the fallback. --------------------------------
  anthropicAnswers.push(claudeError(529), claudeError(529))
  openrouterAnswers.push(terraReply(JSON.stringify(SYNOPSIS)))
  assert.deepEqual(await writeSynopsis(synopsisInput), SYNOPSIS)
  reqs = take()
  assert.equal(toAnthropic(reqs).length, 2, '529: exactly one retry')
  assert.equal(toOpenRouter(reqs).length, 1)
  assert.match(terminal(), /Claude unavailable \(529 after one retry\)/)
  // …and a 529 the retry clears never reaches the fallback.
  anthropicAnswers.push(claudeError(529), claudeReply(SYNOPSIS))
  assert.deepEqual(await writeSynopsis(synopsisInput), SYNOPSIS)
  reqs = take()
  assert.equal(toAnthropic(reqs).length, 2)
  assert.equal(toOpenRouter(reqs).length, 0)
  terminal()
  ok('Claude 529 → one retry, then the fallback; a retry that clears stays on Claude')

  // 7. A Claude 400 is a bug, not an outage: no fallback. --------------------
  anthropicAnswers.push({ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'stubbed 400' } } })
  await assert.rejects(writeSynopsis(synopsisInput), (e: unknown) => e instanceof ProviderError && e.kind === 'provider')
  reqs = take()
  assert.equal(toAnthropic(reqs).length, 1)
  assert.equal(toOpenRouter(reqs).length, 0)
  terminal()
  ok('Claude 400 → no fallback, the calm provider error')

  // 8. A malformed fallback reply: refused, retried once, never written. -----
  delete process.env.ANTHROPIC_API_KEY
  const project = await createProject({ title: 'LLM check', stylePresetId: 'manga-bw' }, 'local')
  const pid = project.address.projectId
  const projectFile = join(dir, 'projects', pid, 'project.json')
  const before = await readFile(projectFile, 'utf8')
  const { POST } = await import('../app/api/projects/[id]/synopsis/route')
  const callRoute = () =>
    POST(new Request('http://check/api', { method: 'POST', body: JSON.stringify(synopsisInput) }), {
      params: Promise.resolve({ id: pid }),
    })
  openrouterAnswers.push(terraReply(JSON.stringify({ title: 'Only a title' })), terraReply('not json at all'))
  const res = await callRoute()
  assert.equal(res.status, 502)
  assert.deepEqual(await res.json(), { error: 'The studio couldn’t write a synopsis just now. Try again in a moment.' })
  reqs = take()
  assert.equal(toOpenRouter(reqs).length, 2, 'a refused reply is retried exactly once on the fallback')
  assert.equal(await readFile(projectFile, 'utf8'), before, 'a refused reply must never reach the desk')
  log = terminal()
  assert.match(log, /reply refused by the schema/)
  // A first malformed reply and a good second one: the good one lands.
  openrouterAnswers.push(terraReply('{"title":'), terraReply(JSON.stringify(SYNOPSIS)))
  const good = await callRoute()
  assert.equal(good.status, 200)
  assert.equal(toOpenRouter(take()).length, 2)
  const desk = await readDesk(pid, project.address)
  assert.deepEqual({ title: desk.synopsis?.title, body: desk.synopsis?.body }, SYNOPSIS)
  terminal()
  ok('a malformed fallback reply is refused by the schema, retried once, and never written to the desk')

  // 9. A fallback 402 never retries. ----------------------------------------
  openrouterAnswers.push({ status: 402, json: { error: { code: 402, message: 'Insufficient credits' } } })
  await assert.rejects(ask(schemas.SynopsisSchema, 'x', 256, { label: 'synopsis' }), (e: unknown) => e instanceof ProviderError && e.kind === 'provider')
  assert.equal(toOpenRouter(take()).length, 1)
  assert.match(terminal(), /OpenRouter returned 402 — out of credits \(text fallback · synopsis\)/)
  ok('a fallback 402 → no retry, the credit message in the terminal')

  // 10. LLM_FALLBACK=never, and both providers unavailable → the config sentence.
  const NO_KEY = 'The studio isn’t connected to Claude yet. Add ANTHROPIC_API_KEY to .env and restart the dev server.'
  process.env.LLM_FALLBACK = 'never'
  await assert.rejects(writeSynopsis(synopsisInput), (e: unknown) => e instanceof ProviderError && e.kind === 'config' && e.message === NO_KEY)
  assert.equal(take().length, 0)
  assert.match(terminal(), /no fallback \(LLM_FALLBACK=never\)/)
  delete process.env.LLM_FALLBACK
  delete process.env.OPENROUTER_API_KEY
  await assert.rejects(writeSynopsis(synopsisInput), (e: unknown) => e instanceof ProviderError && e.kind === 'config' && e.message === NO_KEY)
  assert.equal(take().length, 0)
  terminal()
  process.env.OPENROUTER_API_KEY = 'check-only-never-sent'
  ok('LLM_FALLBACK=never, or no key for either provider → the calm config sentence, nothing sent')

  // 11. LLM_FALLBACK=always skips Claude even with a key; the model is configurable.
  process.env.ANTHROPIC_API_KEY = 'check-only-never-sent'
  process.env.LLM_FALLBACK = 'always'
  process.env.LLM_FALLBACK_MODEL = 'anthropic/claude-sonnet-5.5'
  openrouterAnswers.push(terraReply(JSON.stringify(SYNOPSIS)))
  assert.deepEqual(await writeSynopsis(synopsisInput), SYNOPSIS)
  reqs = take()
  assert.equal(toAnthropic(reqs).length, 0)
  assert.equal((toOpenRouter(reqs)[0].body as { model: string }).model, 'anthropic/claude-sonnet-5.5')
  assert.match(terminal(), /\[text\] synopsis — openrouter\/anthropic\/claude-sonnet-5\.5/)
  ok('LLM_FALLBACK=always skips Claude; LLM_FALLBACK_MODEL picks the fallback')

  assert.equal(anthropicAnswers.length + openrouterAnswers.length, 0, 'every scripted answer was consumed')
} finally {
  console.log = realLog
  console.warn = realWarn
  console.error = realError
  await rm(dir, { recursive: true, force: true })
}

console.log('\n  Text fallback check passed.\n')
