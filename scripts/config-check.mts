// Slice 16's configuration rules (`devpost/spec.md > Environment and
// Configuration (v3)`, `> Config and Boot (v3)`), with `fetch` stubbed —
// nothing outside this machine is called, and no database or bucket either:
//
//   npm run check:config
//
// The learner's variable names are mapped, never renamed: each fallback
// (DB_URL, DB_DATABASE, S3_BUCKET, the outputs bucket,
// S3_FORCE_PATH_STYLE) is taken only when the preferred name is unset or
// blank. A missing or malformed setting is refused in one sentence that names
// it by both its names — and never repeats a value, even a secret-looking one.
// Numbers are validated (CR-15): blank is the default, anything else out of
// range is refused by name. GENERATION_ENABLED is on in development and off in
// production unless set. `instrumentation.ts` refuses to boot on a bad
// setting; `/api/health` answers 200 or 503 in the same shape, with nothing
// internal in it. `.env.example` documents every name, with no values.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-config-'))
process.env.INKDESK_DATA_DIR = dir
process.env.INKDESK_STORAGE = 'local' // this check never opens a database or a bucket
for (const name of ['GENERATION_ENABLED', 'PANEL_CONCURRENCY', 'GENERATION_TIMEOUT_MS', 'INKDESK_QUEUE', 'REDIS_URL', 'QUEUE_CONCURRENCY_IMAGE', 'QUEUE_USER_INFLIGHT', 'QUEUE_MAX_WAITING', 'QUEUE_RETRY_BACKOFF_MS', 'WORKER_GRACE_MS']) delete process.env[name]
// Nothing here may reach the network; a call would fail the check loudly.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`config-check: unexpected network call to ${String(input)}`)
}) as typeof fetch

// Loaded dynamically, like every other check, after the env is set.
const config = await import('../lib/config')
const { ConfigError, cloudSettings, parseConfig, appConfig, generationEnabled, panelConcurrency, generationTimeoutMs, missingCloud, CLOUD_VARIABLES } = config

type Env = Record<string, string | undefined>
const refusal = (fn: () => unknown): InstanceType<typeof ConfigError> => {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof ConfigError, `expected a ConfigError, got ${String(err)}`)
    return err
  }
  return assert.fail('expected the settings to be refused')
}

// A full cloud environment under the preferred names, and the same under the
// learner's names. Values are placeholders; nothing connects.
const preferred: Env = {
  INKDESK_STORAGE: 'cloud',
  MONGODB_URI: 'mongodb://preferred-host:27017/',
  MONGODB_DB: 'preferred_db',
  S3_ENDPOINT: 'https://s3.preferred.example',
  S3_REGION: 'auto',
  S3_BUCKET_PROJECT_FILES: 'preferred-files',
  S3_ACCESS_KEY_ID: 'id',
  S3_SECRET_ACCESS_KEY: 'secret',
}
const learner: Env = {
  INKDESK_STORAGE: 'cloud',
  MONGODB_URI: '',
  DB_URL: 'mongodb://learner-host:27017/',
  MONGODB_DB: '',
  DB_DATABASE: 'learner_db',
  S3_ENDPOINT: 'https://s3.learner.example',
  S3_REGION: 'auto',
  S3_BUCKET_PROJECT_FILES: 'learner-files',
  S3_BUCKET_COMPILE_OUTPUTS: 'learner-outputs',
  S3_BUCKET: '',
  S3_ACCESS_KEY_ID: 'id',
  S3_SECRET_ACCESS_KEY: 'secret',
}

try {
  // 1. The mapping, one fallback at a time.
  const p = cloudSettings(preferred)
  assert.equal(p.mongoUrl, 'mongodb://preferred-host:27017/')
  assert.equal(p.mongoDb, 'preferred_db')
  assert.equal(p.projectFilesBucket, 'preferred-files')
  assert.equal(p.outputsBucket, 'preferred-files', 'no outputs bucket: the project-files bucket')
  assert.equal(p.forcePathStyle, true, 'S3_FORCE_PATH_STYLE defaults to true')
  const l = cloudSettings(learner)
  assert.equal(l.mongoUrl, 'mongodb://learner-host:27017/', 'MONGODB_URI blank: DB_URL')
  assert.equal(l.mongoDb, 'learner_db', 'MONGODB_DB blank: DB_DATABASE')
  assert.equal(l.projectFilesBucket, 'learner-files')
  assert.equal(l.outputsBucket, 'learner-outputs', 'S3_BUCKET_COMPILE_OUTPUTS is the outputs bucket')
  const both = cloudSettings({ ...learner, MONGODB_URI: 'mongodb://wins/', MONGODB_DB: 'wins', S3_BUCKET: 'loses' })
  assert.equal(both.mongoUrl, 'mongodb://wins/', 'both set: MONGODB_URI wins over DB_URL')
  assert.equal(both.mongoDb, 'wins', 'both set: MONGODB_DB wins over DB_DATABASE')
  assert.equal(both.projectFilesBucket, 'learner-files', 'both set: S3_BUCKET_PROJECT_FILES wins over S3_BUCKET')
  const unsetPreferred = { ...learner }
  delete unsetPreferred.MONGODB_URI
  delete unsetPreferred.MONGODB_DB
  assert.equal(cloudSettings(unsetPreferred).mongoUrl, 'mongodb://learner-host:27017/', 'MONGODB_URI unset: DB_URL')
  assert.equal(cloudSettings(unsetPreferred).mongoDb, 'learner_db', 'MONGODB_DB unset: DB_DATABASE')
  const oldBucket = cloudSettings({ ...preferred, S3_BUCKET_PROJECT_FILES: '  ', S3_BUCKET: 'v2-bucket' })
  assert.equal(oldBucket.projectFilesBucket, 'v2-bucket', 'S3_BUCKET_PROJECT_FILES blank: S3_BUCKET, the v2 name')
  assert.equal(oldBucket.outputsBucket, 'v2-bucket', 'and the outputs bucket follows it')
  assert.equal(cloudSettings({ ...preferred, S3_FORCE_PATH_STYLE: 'false' }).forcePathStyle, false)
  assert.equal(cloudSettings({ ...preferred, S3_FORCE_PATH_STYLE: 'true' }).forcePathStyle, true)
  assert.equal(cloudSettings({ ...preferred, S3_FORCE_PATH_STYLE: '' }).forcePathStyle, true, 'blank is the default')
  // SEC-13: Ink Desk writes under a folder of the bucket, never at its root.
  assert.equal(cloudSettings(preferred).keyPrefix, 'inkdesk/', 'S3_KEY_PREFIX defaults to inkdesk/')
  assert.equal(cloudSettings({ ...preferred, S3_KEY_PREFIX: 'apps/inkdesk/' }).keyPrefix, 'apps/inkdesk/')
  for (const bad of ['/', 'inkdesk', '/inkdesk/', '../x/', 'a//b/', 'in kdesk/']) {
    assert.match(refusal(() => cloudSettings({ ...preferred, S3_KEY_PREFIX: bad })).message, /S3_KEY_PREFIX must be a folder name ending in a slash/, `S3_KEY_PREFIX=${bad}`)
  }
  assert.equal(parseConfig(learner).cloud?.mongoDb, 'learner_db', 'the whole config maps the same way')
  assert.equal(parseConfig({}).storage, 'local')
  assert.equal(parseConfig({}).cloud, null, 'a local desk reads no cloud setting')
  assert.equal(parseConfig({ DB_URL: 'not even a url' }).storage, 'local', 'and refuses none: another app’s DB_URL in the shell is not ours to judge')
  console.log('  ok  the mapping: DB_URL, DB_DATABASE, S3_BUCKET, the outputs bucket and S3_FORCE_PATH_STYLE each fall back only when the preferred name is unset or blank; keys go under S3_KEY_PREFIX (inkdesk/), never the root')

  // 2. Missing settings: every one named, by both names where two are accepted.
  const nothing = refusal(() => parseConfig({ INKDESK_STORAGE: 'cloud' }))
  for (const name of [
    'MONGODB_URI (or DB_URL) is not set',
    'MONGODB_DB (or DB_DATABASE) is not set',
    'S3_ENDPOINT is not set',
    'S3_REGION is not set',
    'S3_BUCKET_PROJECT_FILES (or S3_BUCKET) is not set',
    'S3_ACCESS_KEY_ID is not set',
    'S3_SECRET_ACCESS_KEY is not set',
  ]) {
    assert.ok(nothing.message.includes(name), `the sentence names “${name}”`)
  }
  assert.equal(nothing.problems.length, 7, 'every problem, not the first')
  assert.match(nothing.message, /^The studio’s settings need fixing — .* — so set them in \.env \(or the host’s variables\) and restart\.$/)
  assert.equal(nothing.message.match(/\.(\s|$)/g)?.length, 1, 'one sentence')
  assert.deepEqual(missingCloud({ ...learner, DB_URL: ' ' }), ['MONGODB_URI (or DB_URL)'], 'blank under both names is missing')
  assert.match(refusal(() => cloudSettings({ ...preferred, S3_REGION: '' })).message, /S3_REGION is not set — so set it in/, 'one problem: “it”')
  console.log('  ok  missing settings: all seven named in one sentence, the mapped ones by both names')

  // 3. Never a value: secret-looking values, malformed and well-formed, never
  //    reach the sentence — not whole, not in part.
  const secrets = {
    DB_URL: 'postgres://admin:Sup3r-S3cret-Pw@db.internal.example:5432/prod',
    DB_DATABASE: 'prod/../db',
    S3_ENDPOINT: 'ftp://r2-account-1234567890abcdef.example',
    S3_REGION: 'auto',
    S3_BUCKET_PROJECT_FILES: '!!zq-hidden-7781!!',
    S3_BUCKET_COMPILE_OUTPUTS: '_x_',
    S3_ACCESS_KEY_ID: 'AKIAEXAMPLEKEYID12345',
    S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    S3_FORCE_PATH_STYLE: 'maybe-with-a-token-abc123',
    GENERATION_ENABLED: 'sk-or-v1-0000000000000000000000000000000000',
    PANEL_CONCURRENCY: 'sk-ant-api03-zzzzzzzz',
    GENERATION_TIMEOUT_MS: '6m-and-a-secret-xyz',
  }
  const leaked = refusal(() => parseConfig({ INKDESK_STORAGE: 'cloud', MONGODB_URI: '', ...secrets }))
  for (const [name, value] of Object.entries(secrets)) {
    const pieces = [value, ...value.split(/[^A-Za-z0-9]+/).filter((piece) => piece.length >= 6)]
    for (const piece of pieces) assert.ok(!leaked.message.includes(piece), `${name}'s value (or a piece of it) is not in the sentence`)
  }
  for (const name of [
    'MONGODB_URI (or DB_URL) must be',
    'MONGODB_DB (or DB_DATABASE) must be',
    'S3_ENDPOINT must be',
    'S3_BUCKET_PROJECT_FILES (or S3_BUCKET) must be',
    'S3_BUCKET_COMPILE_OUTPUTS must be',
    'S3_FORCE_PATH_STYLE must be true or false',
    'GENERATION_ENABLED must be true or false',
    'PANEL_CONCURRENCY must be',
    'GENERATION_TIMEOUT_MS must be',
  ]) {
    assert.ok(leaked.message.includes(name), `the sentence names “${name}”`)
  }
  assert.ok(!leaked.message.includes('S3_ACCESS_KEY_ID') && !leaked.message.includes('S3_SECRET_ACCESS_KEY'), 'well-formed keys are not problems')
  const unparsable = refusal(() => cloudSettings({ ...preferred, MONGODB_URI: 'mongodb://user:pa ss@host/' }))
  assert.ok(!unparsable.message.includes('pa ss') && !unparsable.message.includes('user:'), 'a URL with a password is never echoed')
  console.log('  ok  never a value: thirteen secret-looking values refused by name, and no piece of any of them in the sentence')

  // 4. Numbers (CR-15): blank is the default, the range is enforced, the
  //    getters other modules read agree with the boot check.
  assert.equal(panelConcurrency({}), 2)
  assert.equal(panelConcurrency({ PANEL_CONCURRENCY: '' }), 2, 'an empty value is the default, never 0')
  assert.equal(panelConcurrency({ PANEL_CONCURRENCY: ' 8 ' }), 8)
  assert.equal(panelConcurrency({ PANEL_CONCURRENCY: '1' }), 1)
  for (const bad of ['0', '9', '2.5', '-1', 'two', '1e1', '0x2']) {
    assert.match(refusal(() => panelConcurrency({ PANEL_CONCURRENCY: bad })).message, /PANEL_CONCURRENCY must be a whole number from 1 to 8/, `PANEL_CONCURRENCY=${bad}`)
    refusal(() => parseConfig({ PANEL_CONCURRENCY: bad }))
  }
  assert.equal(generationTimeoutMs({}), 360_000)
  assert.equal(generationTimeoutMs({ GENERATION_TIMEOUT_MS: '' }), 360_000)
  assert.equal(generationTimeoutMs({ GENERATION_TIMEOUT_MS: '30000' }), 30_000)
  assert.equal(generationTimeoutMs({ GENERATION_TIMEOUT_MS: '900000' }), 900_000)
  for (const bad of ['6m', '29999', '900001', 'NaN', '360000.5', '-360000']) {
    assert.match(refusal(() => generationTimeoutMs({ GENERATION_TIMEOUT_MS: bad })).message, /GENERATION_TIMEOUT_MS must be a whole number of milliseconds from 30000 to 900000/, `GENERATION_TIMEOUT_MS=${bad}`)
  }
  const numbers = parseConfig({ PANEL_CONCURRENCY: '3', GENERATION_TIMEOUT_MS: '120000' })
  assert.equal(numbers.panelConcurrency, 3)
  assert.equal(numbers.generationTimeoutMs, 120_000)
  console.log('  ok  numbers: blank is the default; out of range, fractional or non-numeric is refused by name (PANEL_CONCURRENCY 1–8, GENERATION_TIMEOUT_MS 30000–900000)')

  // 4b. The queue (slice 18): inline by default outside production, bullmq in it; Redis
  //     is named when it is missing and never echoed; the numbers are checked like the others.
  {
    const { queueSettings, imageConcurrency } = config
    assert.deepEqual(queueSettings({}), { mode: 'inline', redisUrl: null, imageConcurrency: 2, videoConcurrency: 1, accountConcurrency: 1, userInflight: 30, maxWaiting: 200, retryBackoffMs: 5000, graceMs: 90_000 })
    assert.equal(queueSettings({ INKDESK_QUEUE: 'bullmq', REDIS_URL: 'redis://redis.railway.internal:6379' }).mode, 'bullmq')
    assert.equal(queueSettings({ NODE_ENV: 'production', REDIS_URL: 'redis://h:6379', GENERATION_ENABLED: 'true' }).mode, 'bullmq', 'production defaults to the real queue')
    assert.match(refusal(() => queueSettings({ INKDESK_QUEUE: 'bullmq' }, 'worker')).message, /REDIS_URL is not set/, 'a worker cannot start without Redis')
    assert.match(refusal(() => queueSettings({ INKDESK_QUEUE: 'bullmq', GENERATION_ENABLED: 'true' })).message, /REDIS_URL is not set/, 'nor a web service that can generate')
    assert.equal(queueSettings({ NODE_ENV: 'production' }).redisUrl, null, 'a production web service with generation closed may start before Redis exists')
    assert.match(refusal(() => queueSettings({ NODE_ENV: 'production', INKDESK_QUEUE: 'inline', GENERATION_ENABLED: 'true', REDIS_URL: 'redis://h:6379' })).message, /INKDESK_QUEUE must be bullmq in production/)
    assert.match(refusal(() => queueSettings({ INKDESK_QUEUE: 'redis' })).message, /INKDESK_QUEUE must be inline or bullmq/)
    const leaky = refusal(() => queueSettings({ INKDESK_QUEUE: 'bullmq', REDIS_URL: 'http://:hunter2-the-password@h:6379' })).message
    assert.match(leaky, /REDIS_URL must be a redis:\/\/ or rediss:\/\/ address/)
    assert.ok(!leaky.includes('hunter2'), 'a malformed Redis address is named, never repeated')
    assert.equal(imageConcurrency({}), 2)
    assert.equal(imageConcurrency({ PANEL_CONCURRENCY: '3' }), 3, 'PANEL_CONCURRENCY is the fallback')
    assert.equal(imageConcurrency({ PANEL_CONCURRENCY: '3', QUEUE_CONCURRENCY_IMAGE: '5' }), 5, 'QUEUE_CONCURRENCY_IMAGE wins when set')
    for (const [name, bad] of [['QUEUE_CONCURRENCY_IMAGE', '9'], ['QUEUE_USER_INFLIGHT', '0'], ['QUEUE_MAX_WAITING', '5001'], ['QUEUE_RETRY_BACKOFF_MS', '-1'], ['WORKER_GRACE_MS', '600001']] as const) {
      assert.match(refusal(() => queueSettings({ [name]: bad })).message, new RegExp(`${name} must be a whole number`), `${name}=${bad}`)
    }
    assert.equal(queueSettings({ QUEUE_USER_INFLIGHT: '', QUEUE_MAX_WAITING: ' 50 ' }).maxWaiting, 50)
    assert.equal(parseConfig({ INKDESK_QUEUE: 'inline' }).queue.mode, 'inline')
    refusal(() => parseConfig({ INKDESK_QUEUE: 'bullmq', GENERATION_ENABLED: 'true' }))
    console.log('  ok  the queue: inline outside production, bullmq in it; Redis named when missing and never echoed; the queue numbers are validated')
  }

  // 4c. Slice 21's settings: who administers, whether video is open, the share page's two request windows and the
  //     account lane. Blank is the default, a bad value is refused by name and never repeated, every accessor reads fresh.
  {
    const { adminEmails, videoEnabled, limitsSettings, queueSettings } = config
    // ADMIN_EMAILS: a comma list like ALLOWLIST_EMAILS — case-insensitive, de-duplicated, blank = nobody.
    assert.deepEqual(adminEmails({}), [], 'unset: nobody')
    assert.deepEqual(adminEmails({ ADMIN_EMAILS: '  ' }), [], 'blank: nobody')
    assert.deepEqual(adminEmails({ ADMIN_EMAILS: ' Boss@Example.COM, you@x.org ,, boss@example.com' }), ['boss@example.com', 'you@x.org'])
    assert.deepEqual(adminEmails({ ADMIN_EMAILS: 'fine@x.org,not-an-address' }), [], 'a malformed list names nobody — a typo can never promote anyone')
    const SECRET = 'sneaky-value-456'
    const badAdmins = refusal(() => parseConfig({ ADMIN_EMAILS: `fine@x.org,${SECRET}` }))
    assert.match(badAdmins.message, /ADMIN_EMAILS must be a comma-separated list of email addresses/)
    assert.ok(!badAdmins.message.includes(SECRET), 'the value is never repeated')
    assert.doesNotThrow(() => limitsSettings({ ADMIN_EMAILS: SECRET }), 'a typo in the admin list never stops a request window being taken')
    assert.deepEqual(parseConfig({ ADMIN_EMAILS: 'A@b.co' }).adminEmails, ['a@b.co'])
    // Read fresh on every call: changing the environment changes the answer, with no restart and no memo.
    delete process.env.ADMIN_EMAILS
    assert.deepEqual(adminEmails(), [])
    process.env.ADMIN_EMAILS = 'first@x.org'
    assert.deepEqual(adminEmails(), ['first@x.org'])
    process.env.ADMIN_EMAILS = 'second@x.org'
    assert.deepEqual(adminEmails(), ['second@x.org'])
    delete process.env.ADMIN_EMAILS

    // VIDEO_ENABLED: off unless exactly true.
    assert.equal(videoEnabled({}), false, 'unset: off')
    assert.equal(videoEnabled({ VIDEO_ENABLED: '' }), false)
    assert.equal(videoEnabled({ VIDEO_ENABLED: ' true ' }), true)
    assert.equal(videoEnabled({ VIDEO_ENABLED: 'false' }), false)
    assert.equal(videoEnabled({ NODE_ENV: 'development', VIDEO_ENABLED: 'yes' }), false, 'a value it does not know keeps video closed')
    assert.equal(videoEnabled({ VIDEO_ENABLED: 'TRUE' }), false, 'only the exact word opens it')
    const badVideo = refusal(() => parseConfig({ VIDEO_ENABLED: SECRET }))
    assert.match(badVideo.message, /VIDEO_ENABLED must be true or false/)
    assert.ok(!badVideo.message.includes(SECRET))
    assert.equal(parseConfig({}).videoEnabled, false)
    assert.equal(parseConfig({ VIDEO_ENABLED: 'true' }).videoEnabled, true)
    process.env.VIDEO_ENABLED = 'true'
    assert.equal(videoEnabled(), true)
    process.env.VIDEO_ENABLED = 'false'
    assert.equal(videoEnabled(), false, 'read fresh')
    delete process.env.VIDEO_ENABLED
    assert.equal(appConfig().videoEnabled, false)
    process.env.ADMIN_EMAILS = 'memo@x.org'
    process.env.VIDEO_ENABLED = 'true'
    assert.deepEqual([appConfig().adminEmails, appConfig().videoEnabled], [['memo@x.org'], true], 'appConfig’s memo is keyed on these too')
    delete process.env.ADMIN_EMAILS
    delete process.env.VIDEO_ENABLED

    // The two new request windows join the others with the same rules.
    const rates = Object.fromEntries(Object.entries(limitsSettings({}).rates).map(([k, v]) => [k, `${v.limit}/${v.windowMs / 60_000}min`]))
    assert.equal(rates.report, '6/60min', 'reports: 6 an hour')
    assert.equal(rates.anonMedia, '600/1min', 'a shared manga’s pictures: 600 a minute')
    assert.deepEqual(Object.keys(rates).sort(), ['anon', 'anonMedia', 'edit', 'image', 'media', 'read', 'report', 'signin', 'text', 'upload'])
    // The Better Auth revision's one: sign-in attempts, per client address.
    assert.equal(rates.signin, '10/1min', 'sign-in attempts: 10 a minute')
    assert.equal(limitsSettings({ RATE_SIGNIN_PER_MIN: '' }).rates.signin.limit, 10, 'blank is the default, never 0')
    assert.equal(limitsSettings({ RATE_REPORT_PER_HOUR: '' }).rates.report.limit, 6, 'blank is the default, never 0')
    assert.equal(limitsSettings({ RATE_ANON_MEDIA_PER_MIN: '' }).rates.anonMedia.limit, 600)
    assert.equal(limitsSettings({ RATE_REPORT_PER_HOUR: ' 2 ', RATE_ANON_MEDIA_PER_MIN: '30' }).rates.report.limit, 2)
    assert.equal(limitsSettings({ RATE_REPORT_PER_HOUR: '2', RATE_ANON_MEDIA_PER_MIN: '30' }).rates.anonMedia.limit, 30)
    for (const name of ['RATE_REPORT_PER_HOUR', 'RATE_ANON_MEDIA_PER_MIN'] as const) {
      for (const bad of ['0', '-1', '1.5', 'many', SECRET, '1000001']) {
        for (const fn of [() => limitsSettings({ [name]: bad }), () => parseConfig({ [name]: bad })]) {
          const err = refusal(fn)
          assert.ok(err.message.includes(`${name} must be a whole number from 1 to`), `${name}=${bad} is refused by name`)
          assert.ok(!err.message.includes(bad) || bad.length < 3, `${name}'s value is never repeated`)
        }
      }
    }
    // The account lane: one at a time, not a setting.
    assert.equal(queueSettings({}).accountConcurrency, 1)
    assert.equal(queueSettings({ QUEUE_CONCURRENCY_IMAGE: '8' }).accountConcurrency, 1, 'the image lane’s width does not widen it')
    console.log('  ok  slice 21’s settings: ADMIN_EMAILS (case-insensitive list, blank = nobody, typo = nobody), VIDEO_ENABLED (only true opens it), RATE_REPORT_PER_HOUR 6 and RATE_ANON_MEDIA_PER_MIN 600 — blank is the default, bad is refused by name, all read fresh; the account lane is one wide')
  }

  // 5. The generation flag.
  assert.equal(generationEnabled({}), true, 'development, unset: on')
  assert.equal(generationEnabled({ NODE_ENV: 'development' }), true)
  assert.equal(generationEnabled({ NODE_ENV: 'production' }), false, 'production, unset: off')
  assert.equal(generationEnabled({ NODE_ENV: 'production', GENERATION_ENABLED: '' }), false, 'production, blank: off')
  assert.equal(generationEnabled({ NODE_ENV: 'production', GENERATION_ENABLED: 'true' }), true, 'production, opened on purpose')
  assert.equal(generationEnabled({ NODE_ENV: 'development', GENERATION_ENABLED: 'false' }), false, 'development, closed on purpose')
  assert.equal(generationEnabled({ GENERATION_ENABLED: 'yes' }), false, 'a value it doesn’t know keeps the studio closed')
  assert.equal(parseConfig({ ...preferred, NODE_ENV: 'production' }).generationEnabled, false)
  assert.match(refusal(() => parseConfig({ GENERATION_ENABLED: 'yes' })).message, /GENERATION_ENABLED must be true or false/, 'and is refused at boot')
  // One rule for "production" (S19-SEC-1, after-audit #2/#15): `next start` keeps any NODE_ENV it is given, so test or
  // staging is a public server for every default, not only for sign-in and the limits.
  {
    const { queueSettings, videoSettings, isProduction } = config
    const { configSentence, ProviderError, UNAVAILABLE } = await import('../lib/errors')
    for (const nodeEnv of ['production', 'staging', 'test']) {
      assert.equal(isProduction({ NODE_ENV: nodeEnv }), true, `NODE_ENV=${nodeEnv} is production`)
      assert.equal(generationEnabled({ NODE_ENV: nodeEnv }), false, `NODE_ENV=${nodeEnv}, GENERATION_ENABLED unset: closed`)
      assert.equal(queueSettings({ NODE_ENV: nodeEnv }).mode, 'bullmq', `NODE_ENV=${nodeEnv}: the real queue`)
      assert.match(refusal(() => queueSettings({ NODE_ENV: nodeEnv, INKDESK_QUEUE: 'inline', GENERATION_ENABLED: 'true', REDIS_URL: 'redis://h:6379' })).message, /INKDESK_QUEUE must be bullmq in production/)
      assert.deepEqual([videoSettings({ NODE_ENV: nodeEnv, VIDEO_FAIL_SHOT: '2' }).model, videoSettings({ NODE_ENV: nodeEnv }).resolution, videoSettings({ NODE_ENV: nodeEnv, VIDEO_FAIL_SHOT: '2' }).failShot], ['bytedance/seedance-2.0', '720p', null], `NODE_ENV=${nodeEnv}: the production trailer, no rehearsal`)
      const env = process.env as Env
      const was = env.NODE_ENV
      env.NODE_ENV = nodeEnv
      try {
        assert.equal(configSentence(new ProviderError('OPENROUTER_API_KEY is not set', 'config')), UNAVAILABLE, `NODE_ENV=${nodeEnv}: a config sentence names no variable`)
      } finally {
        if (was === undefined) delete env.NODE_ENV
        else env.NODE_ENV = was
      }
    }
    for (const nodeEnv of [undefined, 'development']) {
      assert.equal(isProduction({ NODE_ENV: nodeEnv }), false)
      assert.equal(generationEnabled({ NODE_ENV: nodeEnv }), true)
      assert.equal(queueSettings({ NODE_ENV: nodeEnv }).mode, 'inline')
      assert.equal(videoSettings({ NODE_ENV: nodeEnv }).model, 'bytedance/seedance-2.0-fast')
    }
    const source = (await Promise.all(['lib/config.ts', 'lib/errors.ts', 'lib/boot.ts', 'worker/index.ts', 'app/api/health/route.ts', 'lib/queue/processors.ts'].map((f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8')))).join('\n')
    assert.ok(!/NODE_ENV\s*[!=]==\s*'production'/.test(source), 'no default reads NODE_ENV against the one word')
  }
  console.log('  ok  GENERATION_ENABLED: on in development, off in production, true/false honoured, anything else closed and refused at boot; production is one rule (any NODE_ENV but development or unset) for the generation, queue and trailer defaults and the config sentence')

  // 6. appConfig: memoised per set of values; INKDESK_STORAGE typos refused.
  const first = appConfig()
  assert.equal(appConfig(), first, 'the same object while nothing changes')
  process.env.PANEL_CONCURRENCY = '4'
  assert.equal(appConfig().panelConcurrency, 4, 'a changed value is read again')
  process.env.PANEL_CONCURRENCY = 'many'
  assert.throws(() => appConfig(), ConfigError)
  delete process.env.PANEL_CONCURRENCY
  assert.match(refusal(() => parseConfig({ INKDESK_STORAGE: 'mongo' })).message, /INKDESK_STORAGE must be local \(the default\) or cloud/)
  assert.ok(!refusal(() => parseConfig({ INKDESK_STORAGE: 'mongo' })).message.includes('mongo '), 'the typo itself is not repeated')
  console.log('  ok  appConfig is validated once per set of values; a storage typo is refused by name')

  // 6b. Production runs on Mongo and the buckets (after-audit #10/#16): a local desk there is the container's own disk,
  //     wiped on every deploy and unseen by the worker's container — refused at boot on both services, in one sentence.
  for (const role of ['web', 'worker'] as const) {
    const base = { NODE_ENV: 'production', REDIS_URL: 'redis://h:6379' }
    for (const storage of [undefined, '', 'local', ' local ']) {
      const refused = refusal(() => parseConfig({ ...base, INKDESK_STORAGE: storage }, role))
      assert.match(refused.message, /INKDESK_STORAGE must be cloud in production/, `${role}, INKDESK_STORAGE=${JSON.stringify(storage)}`)
      assert.deepEqual(refused.problems.filter((problem) => problem.includes('INKDESK_STORAGE')), ['INKDESK_STORAGE must be cloud in production (the local desk is for development and the checks)'], 'one plain sentence')
    }
  }
  assert.match(refusal(() => parseConfig({ NODE_ENV: 'staging' })).message, /INKDESK_STORAGE must be cloud in production/, 'staging is production too')
  assert.equal(parseConfig({ ...preferred, NODE_ENV: 'production' }).storage, 'cloud', 'production with its cloud settings starts')
  assert.equal(parseConfig({ ...preferred, NODE_ENV: 'production', REDIS_URL: 'redis://h:6379' }, 'worker').storage, 'cloud')
  assert.equal(parseConfig({ NODE_ENV: 'development' }).storage, 'local', 'development keeps the local desk')
  assert.equal(parseConfig({}).storage, 'local', 'and so do the checks (NODE_ENV unset)')
  console.log('  ok  production (any NODE_ENV but development or unset) refuses the local desk at boot, web and worker alike, by name')

  // 7. Boot: instrumentation refuses a bad setting with the sentence, in the
  //    Node runtime only.
  const { register } = await import('../instrumentation')
  const said = console.log
  console.log = () => {}
  try {
    process.env.NEXT_RUNTIME = 'nodejs'
    await register()
    process.env.GENERATION_TIMEOUT_MS = '6m'
    await assert.rejects(register(), (err: unknown) => err instanceof ConfigError && /GENERATION_TIMEOUT_MS must be/.test(err.message) && !err.message.includes('6m'))
    process.env.NEXT_RUNTIME = 'edge'
    await register() // not the Node runtime: nothing to validate there
  } finally {
    console.log = said
    delete process.env.GENERATION_TIMEOUT_MS
    delete process.env.NEXT_RUNTIME
  }
  console.log('  ok  boot: instrumentation refuses a bad setting with the sentence, and only in the Node runtime')

  // 8. /api/health: 200 with the shape and nothing internal; 503 in the same
  //    shape when a setting is wrong; never cached.
  const health = await import('../app/api/health/route')
  const quiet = console.error
  console.error = () => {}
  try {
    const okRes = await health.GET()
    assert.equal(okRes.status, 200)
    assert.equal(okRes.headers.get('cache-control'), 'no-store')
    const okBody = await okRes.json()
    assert.deepEqual(okBody, { status: 'ok', storage: 'local', checks: { mongo: 'n/a', bucket: 'n/a' }, queue: { mode: 'inline', redis: 'n/a', worker: 'n/a' }, generation: 'on' })
    process.env.GENERATION_ENABLED = 'false'
    assert.equal((await (await health.GET()).json()).generation, 'off', 'the flag is reported')
    process.env.GENERATION_ENABLED = 'sideways'
    const badRes = await health.GET()
    assert.equal(badRes.status, 503, 'a bad setting is not healthy')
    const badBody = await badRes.json()
    assert.deepEqual(Object.keys(badBody).sort(), ['checks', 'generation', 'queue', 'status', 'storage'], 'the same shape')
    assert.equal(badBody.status, 'down')
    assert.equal(badBody.generation, 'off')
    assert.ok(!JSON.stringify(badBody).includes('sideways') && !JSON.stringify(badBody).includes('GENERATION_ENABLED'), 'no internals in the answer')
    delete process.env.GENERATION_ENABLED
    // A local desk is never a healthy production deploy (after-audit #10): Railway must not promote it.
    ;(process.env as Env).NODE_ENV = 'production'
    try {
      const localProd = await health.GET()
      assert.equal(localProd.status, 503, 'production on the local desk is down')
      assert.deepEqual(await localProd.json(), { status: 'down', storage: 'local', checks: { mongo: 'n/a', bucket: 'n/a' }, queue: { mode: 'inline', redis: 'n/a', worker: 'n/a' }, generation: 'off' })
    } finally {
      delete (process.env as Env).NODE_ENV
    }
  } finally {
    console.error = quiet
    delete process.env.GENERATION_ENABLED
  }
  console.log('  ok  /api/health: 200 { status, storage, checks, queue, generation } with no internals, 503 in the same shape, no-store; production on the local desk is 503')

  // 8b. Health is cheap for strangers (after-audit #4): it is public and unthrottled, so the probe of the outside systems
  //     (a Mongo ping and a HEAD per bucket in cloud mode, a Redis PING and GET) is shared — callers at the same moment
  //     wait on one probe, and a result is reused for a few seconds — while the settings are still read on every call.
  {
    const { store } = await import('../lib/store')
    const realHealth = store.health
    const realNow = Date.now
    let probes = 0
    let answer: 'ok' | 'down' = 'ok'
    store.health = async () => {
      probes++
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { mongo: answer, bucket: answer }
    }
    let clock = realNow() + 3_600_000 // past anything an earlier section left
    Date.now = () => clock
    const said = console.error
    console.error = () => {}
    try {
      const burst = await Promise.all(Array.from({ length: 25 }, () => health.GET()))
      assert.equal(probes, 1, `25 callers at once share one probe (${probes})`)
      assert.ok(burst.every((r) => r.status === 200 && r.headers.get('cache-control') === 'no-store'))
      clock += 2_000
      answer = 'down'
      assert.equal((await health.GET()).status, 200, 'two seconds later the same result is reused…')
      assert.equal(probes, 1)
      process.env.GENERATION_ENABLED = 'sideways'
      assert.equal((await health.GET()).status, 503, '…but the settings are read on every call')
      delete process.env.GENERATION_ENABLED
      clock += 4_000
      assert.equal((await health.GET()).status, 503, 'after a few seconds it is asked again, and a store that went down is reported')
      assert.equal(probes, 2)
    } finally {
      console.error = said
      store.health = realHealth
      Date.now = realNow
      delete process.env.GENERATION_ENABLED
    }
  }
  console.log('  ok  /api/health: callers at once share one probe of the outside systems, reused for a few seconds; the settings are read on every call')

  // 9. .env.example documents every name of the mapping and the flag, and
  //    carries no value for any of them.
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8')
  for (const name of [...CLOUD_VARIABLES, 'GENERATION_ENABLED', 'INKDESK_STORAGE', 'PANEL_CONCURRENCY', 'GENERATION_TIMEOUT_MS', 'INKDESK_QUEUE', 'REDIS_URL', 'QUEUE_CONCURRENCY_IMAGE', 'QUEUE_USER_INFLIGHT', 'QUEUE_MAX_WAITING', 'QUEUE_RETRY_BACKOFF_MS', 'WORKER_GRACE_MS', 'IMAGE_RETRY_DELAY_MS', 'ADMIN_EMAILS', 'VIDEO_ENABLED', 'RATE_ANON_MEDIA_PER_MIN', 'RATE_REPORT_PER_HOUR']) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(example), `.env.example names ${name}`)
  }
  for (const name of [...CLOUD_VARIABLES, 'GENERATION_ENABLED', 'REDIS_URL']) {
    for (const line of example.split('\n').filter((row) => new RegExp(`^#?\\s*${name}=`).test(row))) {
      assert.match(line, new RegExp(`^#?\\s*${name}=$`), `.env.example gives ${name} no value`)
    }
  }
  console.log('  ok  .env.example documents every name — both names of each mapped setting — and gives none of them a value')

  // 10. The worker's own boot (`npm run worker`, a process of its own): refused in one sentence, before it takes a job,
  //     when production would run it on the local desk (after-audit #10), when video is open and ffmpeg is not on its
  //     PATH (#12 — every trailer would pay for its shots and then fail at the assembly), and when it shares the cloud
  //     desk with sign-in left unset (#2 — it would read sign-in as off and skip ending the sign-in when deleting an account).
  {
    const { spawn } = await import('node:child_process')
    const { mkdir } = await import('node:fs/promises')
    const ROOT = new URL('..', import.meta.url).pathname
    const noTools = join(dir, 'no-tools')
    await mkdir(noTools, { recursive: true })
    const redis = { INKDESK_QUEUE: 'bullmq', REDIS_URL: 'redis://127.0.0.1:1' } // never reached by a refused worker
    const boot = (vars: Env, ms: number) =>
      new Promise<{ code: number | null; said: string }>((resolve) => {
        const env: Env = { ...process.env, INKDESK_STORAGE: undefined, NODE_ENV: undefined, INKDESK_AUTH: undefined, VIDEO_ENABLED: undefined, BETTER_AUTH_SECRET: undefined, ...vars }
        for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name]
        const child = spawn(process.execPath, ['--import', 'tsx', '--import', './scripts/server-only.mts', 'worker/index.ts'], { cwd: ROOT, env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
        let said = ''
        child.stdout.on('data', (d: Buffer) => (said += d))
        child.stderr.on('data', (d: Buffer) => (said += d))
        const timer = setTimeout(() => child.kill('SIGKILL'), ms) // still running: it got past every check
        child.on('exit', (code) => {
          clearTimeout(timer)
          resolve({ code, said })
        })
      })
    const SECRET_KEY = 'w'.repeat(32)
    const [local, unset, noFfmpeg, started] = await Promise.all([
      boot({ ...redis, NODE_ENV: 'production', INKDESK_STORAGE: 'local', BETTER_AUTH_SECRET: SECRET_KEY }, 15_000),
      boot({ ...redis, ...preferred }, 15_000),
      boot({ ...redis, VIDEO_ENABLED: 'true', PATH: noTools }, 15_000),
      boot({ ...redis, VIDEO_ENABLED: 'true' }, 8_000),
    ])
    assert.equal(local.code, 1, `a production worker on the local desk does not start: ${local.said}`)
    assert.match(local.said, /\[worker\] The studio’s settings need fixing — INKDESK_STORAGE must be cloud in production/)
    assert.equal(unset.code, 1, `a worker on the cloud desk with sign-in unset does not start: ${unset.said}`)
    assert.match(unset.said, /INKDESK_AUTH is not set/)
    assert.ok(!unset.said.includes('preferred-host'), 'names, never values')
    assert.equal(noFfmpeg.code, 1, `video open and no ffmpeg: the worker does not start: ${noFfmpeg.said}`)
    assert.match(noFfmpeg.said, /\[worker\] .*ffmpeg/)
    assert.equal(started.code, null, `with ffmpeg on its PATH the same worker gets past its checks (and waits for Redis): ${started.said}`)
    assert.ok(!/ffmpeg|settings need fixing/.test(started.said))
  }
  console.log('  ok  the worker refuses to start, in one sentence, on the local desk in production, with video open and no ffmpeg, and on the cloud desk with sign-in unset')

  console.log('\n  Config check passed.\n')
} finally {
  await rm(dir, { recursive: true, force: true })
}
