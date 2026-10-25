# Ink Desk

Ink Desk is an AI manga studio. You start on a dashboard, create a project with a locked style preset (manga black and white or manhwa colour), write a pitch or paste a long scenario with reference pictures, lock two characters in the library (one drawn from a generated model sheet, one imported from your own picture), let the Director plan a chapter of at least three pages plus a cover with a cost estimate shown before anything is generated, watch the pages ink in with editable speech bubbles and per-panel redraw, then read the chapter and export it as PNG pages or one PDF. Since v3 it is a public studio: you sign in, share a chapter by link, and animate a page into a short trailer with voices and music.

The kernel is one rule: a character's model sheet is generated once and locked, and every panel request carries that sheet as its single reference image together with the character's frozen visual-DNA text, so the face holds across close-ups, medium shots and wide shots.

The project was planned before it was built, under the hackathon's learn skill pack. The record is in `devpost/`: [scope](devpost/scope.md), [PRD](devpost/prd.md), [spec](devpost/spec.md), [build checklist](devpost/checklist.md), the [app map](devpost/app-map.html) and the [security report](devpost/security-report.md).

## Try it

The studio runs at `https://<your-domain>`. The domain is not named yet; `<your-domain>` stands for it everywhere in this file.

- **Judges:** sign in with the demo account's email and password from the Devpost testing instructions. It is allowlisted (the higher limits) and already holds a finished chapter and its trailer, so nothing has to be generated to see the result.
- **Anyone else:** there is **no sign-up** — the studio is private, as the hackathon rules allow when the testing instructions carry login credentials. The operator makes every account with `npm run judge:account` (below). There is no password reset (the studio sends no email). An account that is not on `ALLOWLIST_EMAILS` is on the free plan: by default 20 images, 1 new project, 20 seconds of video, 2000 characters of voice and $1 of spend a day, resetting at 00:00 UTC.
- **Signed out:** the sign-in page, `/terms`, `/privacy` and any share link (`/s/<token>`, with Report) open without an account.

Inside: the dashboard (projects, videos, library, the quota meter), the studio's stations (story, cast, Director, page, reader), Share and Report, Animate a page, and Settings (account, defaults, sharing, usage, Export my data, Delete my account).

## Requirements

- Node 22 (the build ran on 22.22) and npm.
- An OpenRouter API key. Required: it pays for every image, video shot, voice line and music clip, for the text fallback, and for the demo's narration and generated music.
- An Anthropic API key. Optional: with it, Claude answers every text call first; without it, the fallback answers every text call. If you have none, delete the `ANTHROPIC_API_KEY=` line from `.env` or leave it empty: the placeholder value from `.env.example` would be sent to Anthropic, and the 401 it earns is not one of the failures the fallback covers.
- ffmpeg (with ffprobe, which comes with it) wherever trailers are made, that is on the worker whenever `VIDEO_ENABLED=true` (or on your machine if you animate with the inline queue), and for the demo video. The studio without video does not need it.
- Redis, only for the BullMQ queue and the limits (production always; locally, optional).

## Run it locally

```bash
npm install
cp .env.example .env     # paste your OpenRouter key, and the Anthropic key if you have one
npm run dev              # http://localhost:3000
```

Outside production the defaults keep a fresh clone simple: the local desk (`INKDESK_STORAGE=local`: `data/projects/<id>/project.json` and `data/images/`), no sign-in (`INKDESK_AUTH=off`, one owner called `local`), no limits (`INKDESK_LIMITS` is off when sign-in is off), the inline queue (`INKDESK_QUEUE=inline`: the web process draws, two at a time) and generation open. "Outside production" means `NODE_ENV` is `development` or unset; every other value is production.

To run the queue as production does, start a local Redis and a worker beside the web server:

```bash
INKDESK_QUEUE=bullmq REDIS_URL=redis://localhost:6379 npm run dev
INKDESK_QUEUE=bullmq REDIS_URL=redis://localhost:6379 npm run worker     # both read .env (a variable set in the shell wins over the file)
```

`INKDESK_AUTH=better` with `BETTER_AUTH_SECRET` (32 characters or more, e.g. `openssl rand -base64 32`) and a MongoDB (`MONGODB_URI`, `MONGODB_DB`) gives real sign-in locally — Better Auth keeps the accounts in that database even on the local desk; `INKDESK_AUTH=test` (a request header names the caller) is for the checks. `VIDEO_ENABLED=true` opens Animate a page; in development it uses `bytedance/seedance-2.0-fast` at 480p unless `VIDEO_MODEL` and `VIDEO_RESOLUTION` say otherwise.

Keep the OpenRouter balance above $1: at or below that the provider returns 402, which the app shows as a calm pause sentence while the terminal names the 402. Top up before filming rather than discovering the floor mid-chapter.

## Deploy on Railway

Production runs on Railway from `main`, one replica per service:

| Service | Build and start | Needs |
|---|---|---|
| `web` | `npm run build`, then `npm run start`; health check path `/api/health` | Mongo (the work, and the accounts and sessions), Redis, the buckets, `BETTER_AUTH_SECRET`, OpenRouter |
| `worker` | `npm run worker` (same repository, its own start command) | Mongo, Redis, the buckets, OpenRouter, `BETTER_AUTH_SECRET` (account deletion ends the sign-in), ffmpeg and ffprobe on its PATH when video is open |
| `redis` | Railway's Redis template | private network only (`redis.railway.internal`); it provides `REDIS_URL` |
| `mongo` | a MongoDB on the private network (`*.railway.internal`) | |

Storage is two private S3-compatible buckets (Cloudflare R2 in this deployment): one for images and uploads, one for videos, audio and exports. The repository carries no build file that installs ffmpeg on the worker; the spec suggests nixpacks `aptPkgs = ["ffmpeg"]` or a Dockerfile.

**What production refuses.** Both services stop at start with one sentence that names the setting, never its value, unless `INKDESK_STORAGE=cloud` (the local desk would be the container's own disk, wiped on every deploy), `INKDESK_QUEUE` is `bullmq` (its production default; `inline` is refused), `INKDESK_AUTH` is `better` (its production default; `off` and `test` are refused, and so is Better Auth without `BETTER_AUTH_SECRET`, the Mongo settings or `APP_URL`) and the limits are on (`INKDESK_LIMITS=off` is refused, and they read as on in production whatever it says). The worker also refuses to start without `REDIS_URL`, without `BETTER_AUTH_SECRET` or the Mongo settings in better mode, and with `VIDEO_ENABLED=true` but no ffmpeg; if ffmpeg goes missing later, a trailer is refused before any paid call. A web service with generation closed may start before Redis exists; one that can generate may not.

### Variables

Names only; values live in Railway, never in files. `.env.example` documents each one, its default and its range.

- **Both services:** `NODE_ENV=production`, `INKDESK_STORAGE=cloud`, `INKDESK_QUEUE=bullmq`, `INKDESK_AUTH=better`, `REDIS_URL`, `BETTER_AUTH_SECRET` (the same value on both); the store: `DB_URL` (or `MONGODB_URI`), `DB_DATABASE` (or `MONGODB_DB`), `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_PROJECT_FILES`, `S3_BUCKET_COMPILE_OUTPUTS`, `S3_FORCE_PATH_STYLE`, `S3_KEY_PREFIX` (optional); the providers and models: `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` (optional), `ANTHROPIC_MODEL`, `IMAGE_MODEL`, `LLM_FALLBACK`, `LLM_FALLBACK_MODEL`, the `IMAGE_*` aspects and qualities, `GENERATION_TIMEOUT_MS`; video: `VIDEO_ENABLED`, `VIDEO_MODEL`, `VIDEO_RESOLUTION`, `VIDEO_MOTION_METHOD`, `TTS_MODEL`, `MUSIC_MODEL`.
- **web only:** `APP_URL` (required: sign-in's base URL and trusted origin), `NEXT_PUBLIC_APP_URL`, `GENERATION_ENABLED`, `ALLOWLIST_EMAILS`, `ADMIN_EMAILS`, `GLOBAL_DAILY_USD_CAP`, `GLOBAL_TOTAL_USD_CAP`, `USER_DAILY_USD_FREE`, `USER_DAILY_USD_ALLOW`, the `QUOTA_*` and `RATE_*` numbers (including `RATE_SIGNIN_PER_MIN`, default 10 per client address), `TRUSTED_PROXY_HOPS`, `CLIENT_IP_HEADER`, `QUEUE_USER_INFLIGHT`, `QUEUE_MAX_WAITING`, `CONTACT_EMAIL`.
- **worker only:** `QUEUE_CONCURRENCY_IMAGE`, `QUEUE_CONCURRENCY_VIDEO`, `VIDEO_SHOT_PARALLEL`, `VIDEO_POLL_MS`, `VIDEO_SHOT_TIMEOUT_MS`, `WORKER_GRACE_MS`, `IMAGE_RETRY_DELAY_MS`; on Railway also `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`, set to about `WORKER_GRACE_MS` (90 s by default), or the platform ends a picture mid-call and it is drawn, and paid for, again.

Every tuning number left blank takes its default; a malformed one stops the service by name.

### Domain, sign-in and the buckets

The exact records are generated per project: copy them from Railway's dashboard. On the `web` service, Railway's custom domain needs its `CNAME` (CNAME flattening or `ALIAS` at the apex) and its `TXT` record; without the `TXT` the domain answers 404. A request to `www.<your-domain>` is redirected to the apex (308).

Sign-in is [Better Auth](https://www.better-auth.com/docs) (open source), running inside the `web` service: accounts and sessions live in the studio's own MongoDB (Better Auth's `user`, `session`, `account` and `verification` collections), so there is no outside account to create, no DNS record and no webhook. Sign-in is **email and password only** — no Google, GitHub or other outside sign-in — and **there is no sign-up**: Better Auth refuses to create an account (`disableSignUp`), and every account is made by the operator with `npm run judge:account`, already verified. **There is no email service:** the studio sends no email, so there is no password reset and the email cannot be changed; the sign-in card says so. There is no CAPTCHA (nothing to sign up for); sign-in is limited per client address. Rotating `BETTER_AUTH_SECRET` signs everyone out. The buckets stay private; their CORS allows `GET` and `PUT` from `APP_URL` only. See `devpost/spec.md > Domain and DNS (v3)`.

### Opening generation

Generation is off in production until `GENERATION_ENABLED=true`. In order: set `ALLOWLIST_EMAILS` (your address, your friends', the judge account's) and the caps; put a credit limit on the OpenRouter key with auto top-up off, the backstop beyond every cap here; keep `REDIS_URL` on both services (production without Redis has no counters, so nothing can spend); then open generation.

- If `ANTHROPIC_API_KEY` is set on Railway, also set a spend limit on the Anthropic workspace: Claude is billed by Anthropic directly, and the OpenRouter credit limit does not cover it.
- `GLOBAL_DAILY_USD_CAP` (default $5) is the kill switch, shared by every plan: free accounts count toward it, and when it is reached generation pauses for everyone until 00:00 UTC, while reading, the reader, exports and shares keep working. It is read on every request, so lowering it to 0.01 pauses generation at once.
- The free plan's $1 a day is below a 720p trailer (held at about $2.69 for four panels), so only allowlisted accounts can animate at 720p.
- `ALLOWLIST_EMAILS` and `ADMIN_EMAILS` match **verified** addresses; every account `npm run judge:account` makes is verified. Make your own account the same way (`JUDGE_PASSWORD='…' INKDESK_JUDGE_CONFIRMED=yes npm run judge:account -- --email <your address>`), then put the address on `ADMIN_EMAILS` to use `/admin/reports`. Run again for an existing account, it marks the address verified and leaves the password alone.
- `TRUSTED_PROXY_HOPS` stays at 1 (Railway's edge). Switch `CLIENT_IP_HEADER` to `x-real-ip` only after checking on the live domain that the edge overwrites a client-sent `X-Real-IP`.

### One-off scripts

Each refuses to write to a cloud store without its own confirmation variable, because the database and buckets a shell points at may belong to another app. Run each with `--dry-run` first.

- **Accounts, and the judge account, step 1** (`scripts/judge-account.mts`): the only way any account exists (there is no sign-up). It makes an email-and-password account whose address is marked verified (so it can be on `ALLOWLIST_EMAILS`) and prints its id. With the web service's settings (`INKDESK_AUTH=better`, `BETTER_AUTH_SECRET`, the MongoDB): `JUDGE_PASSWORD='…' INKDESK_JUDGE_CONFIRMED=yes npm run judge:account -- --email judge@example.com --dry-run`, then without `--dry-run`. The password (10 characters or more) is never printed; running it again for the same email does not change the password. Add the email to `ALLOWLIST_EMAILS`; the email and password go in the Devpost testing instructions — the hackathon rules require login credentials there for a private site. The production judge account is `judge@inkdesk.studio`; its password is never written in the repository.
- **The judge account, step 2** (`scripts/seed-judge.mts`): copies one finished project, and with `--with-trailer` its latest finished trailer, to the judge's account, under new ids, for $0. Nothing is drawn again; the source is never written; shares, reports, jobs, counters and settings are never copied; a second run changes nothing; the judge's account deletion removes the copy. Against production: `INKDESK_STORAGE=cloud INKDESK_JUDGE_CONFIRMED=yes npx tsx scripts/seed-judge.mts --from <projectId> --to <the 24-character id step 1 printed> --with-trailer --dry-run`, then the same without `--dry-run`. The live database starts empty, so the finished chapter can be read from a local desk folder instead: add `--from-data-dir data/filming-2026-10-14 --from 17638779-4ed3-4af0-9e78-23f812b563e8` (the filmed chapter, tracked in the repository). The database is private to Railway's network, so run both steps inside the worker (`railway ssh --service worker`), where its settings already are.
- **Claiming old projects** (`scripts/claim-projects.mts --owner <account id> [--project <id>] [--dry-run]`; the id is Better Auth's, 24 hex characters): gives projects made before accounts (owner unset or `local`) to one account, with their job records; a share link they carried is revoked. Cloud needs `INKDESK_CLAIM_CONFIRMED=yes`.
- **Moving the repository's media** (`scripts/move-media-to-bucket.mts [--include-tracked] [--yes]`): uploads the generated media under `<prefix>archive/`, checks each object's size and sha256, and writes `data/MEDIA-MANIFEST.json`. It needs `INKDESK_MEDIA_TARGET_CONFIRMED=yes`, is a dry run without `--yes`, and never deletes anything.

## Prove the setup and the kernel

The kernel test is a dependency-free script that reads `.env` and talks to the providers directly. The costs below are what the script prints as `usage.cost`, measured at `medium` (`KERNEL_TEST_QUALITY`).

```bash
node scripts/kernel-test.mjs --probe-only     # ≈ $0.01: capability probe (free), text probe, image probe, fallback probe
node scripts/kernel-test.mjs                  # ≈ $0.08 at medium: one sheet, a close-up and a wide shot → data/kernel-test/index.html
```

Open `data/kernel-test/index.html` and compare the two panels with the sheet. Same person or not is the whole test; `manifest.json` beside it records cost, timing and dimensions per image.

Two more modes test the v2 candidate locks (a style reference and a setting reference, each sent beside the sheet as the second reference of every panel; $0.13 to $0.14 per test), with reference plates in `data/kernel-test/refs/`. A third, `--motion`, sends day-one panels to Seedance by both motion methods (A: the panel as the first frame; B: the panel and the sheet as references). Its run billed $4.60 for six clips and one panel; `--motion --probe-only` is free.

```bash
node scripts/kernel-test.mjs --style-ref data/kernel-test/refs/style-ref.png       # → data/kernel-test/style-ref/
node scripts/kernel-test.mjs --setting-ref data/kernel-test/refs/setting-ref.png   # → data/kernel-test/setting-ref/
node scripts/kernel-test.mjs --motion                                              # → data/kernel-test/motion/
```

Each writes its own `index.html` and `manifest.json`; the manifest's `verdict` is null until a person has looked and recorded pass or fail. The image model is an unpinned alias (`IMAGE_MODEL`; the provider publishes no dated snapshot), so re-run the default test with `--out data/kernel-test/canary-<date>` to compare against the day-one evidence by eye.

**Results, 2026-10-14.** Judged by eye in the build session; the learner confirms or overturns them at the final review. The canary (`data/kernel-test/canary-2026-10-14/`) shows no drift from the day-one set. The style reference passed, with one caveat: the reference's subject bled into the panel backgrounds. The setting reference passed. Neither reference lock is exposed in the app. The motion clips' verdict is the learner's and still null; until it is recorded, `VIDEO_MOTION_METHOD` defaults to B, provisionally.

## Quality and cost

Develop at `low` (the `.env.example` default). The filming values are `IMAGE_SHEET_QUALITY=high` and `IMAGE_PANEL_QUALITY=high`; the capture (`npm run video:capture -- --quality high`) stops before its first paid call unless the app is drawing panels at high.

Measured at `low`, an image costs about $0.02, so a four-panel page is about $0.08 (`lib/cost.ts` carries the measured figures for `low` and `medium` and labels `high`, `xhigh` and `max` as estimates). A 5 s Seedance shot at 720p bills about $0.76, wide or square; a four-panel trailer is held at about $2.69 at 720p, and about $0.75 at 480p on `seedance-2.0-fast`. Every spend is reserved at its estimate before a provider is called and settled to the provider's reported `usage.cost` when it finishes; Claude's cost is computed from its token counts at the list price in `lib/llm.ts` (the terminal marks it "from tokens"). See `devpost/spec.md > Quality, Cost and Budget (v3)`.

## Storage

`INKDESK_STORAGE=local` (the default outside production) keeps everything under `data/`. `INKDESK_STORAGE=cloud` (the only mode in production) keeps state in MongoDB and files in two S3-compatible buckets. The learner's variable names are mapped, not renamed; where two names are accepted and both are set, the first wins (`lib/config.ts`):

| Setting | Variables | |
|---|---|---|
| Mongo URL | `MONGODB_URI`, else `DB_URL` | required |
| Mongo database | `MONGODB_DB`, else `DB_DATABASE` | required |
| Project-files bucket | `S3_BUCKET_PROJECT_FILES`, else `S3_BUCKET` | required: images and uploads |
| Outputs bucket | `S3_BUCKET_COMPILE_OUTPUTS`, else the project-files bucket | videos, audio, exports; the key needs read, write and list |
| The bucket host | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | required |
| Optional | `S3_FORCE_PATH_STYLE` (default true), `S3_KEY_PREFIX` (default `inkdesk/`, never the root) | |

A missing or malformed setting is refused by name at startup, and the studio never falls back to the local desk on its own. Both buckets are probed at connect. They stay private: a picture reaches the browser only through the studio's routes, after the owner is checked (a share link serves only the pictures in its snapshot). A cloud desk starts empty; local projects stay on disk. Variables exported in your shell win over `.env`: if your shell sets `DB_*` or `S3_*` for another project, unset them first. The terminal names the database host and bucket host it connected to.

## The queue and the worker

Drawing is a **job**, not a request. Draw sheet, Generate page, Redraw, Generate cover, Animate, Export my data and Delete my account each write a job record to the store (`data/jobs/` locally, the `jobs` collection in Mongo) and hand it to a queue; something else runs it and writes the result. A page can ink while the web service is redeployed, and a picture that was paid for is attached, never drawn twice. Trailers and account jobs have lanes of their own, so a twenty-minute trailer never holds a picture's place.

If Redis is down, a generate button says "The studio is busy — try again in a few minutes" and every project still opens; if no worker is running, jobs wait and the studio says so. `/api/health` reports `queue: { mode, redis, worker }` without failing the deploy check on them. Settings, caps and failure behaviour are in `.env.example` and `devpost/spec.md > As built — slice 18`.

## The text fallback

Every text call (synopsis, cast and reroll, DNA, scenario summary, page script, dialogue rewrite, chapter plan, DNA read from an imported picture) goes through one `ask()` in `lib/llm.ts`. Claude answers first. When it cannot be used (no `ANTHROPIC_API_KEY`, a 402, or a 5xx/529/429 or dropped connection that survives the single retry) the same call goes to `LLM_FALLBACK_MODEL` through OpenRouter with a strict JSON schema, and the reply is validated by the same zod schema either way. `LLM_FALLBACK` is `auto` (the default), `always` (skip Claude, to rehearse the fallback) or `never` (Claude's own errors reach the screen). The terminal names the provider that answered on every call; the screen does not change.

## Checks

The `check:*` scripts replace `fetch` with a stub wherever a provider would be called and run on a scratch folder (`INKDESK_DATA_DIR`) or a temp copy of the filmed desk, so nothing is spent and `data/` is never written. None needs a dev server running. `check:queue` and `check:limits` need `redis-server` on the PATH (`check:share` skips its Redis assertions, loudly, without it); `check:video` and `check:judge` need ffmpeg and ffprobe; `check:responsive` needs Playwright's Chromium.

| Command | What it asserts |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over the app. |
| `npm run lint` | ESLint with the Next config. |
| `npm run check:store` | The local store: the v1 desk migrates once and intact; projects update independently; concurrent updates all land; no temp file left. Also the cloud settings' names and sentences and the optimistic `rev` retry. Its cloud half runs only with a Mongo URL and `INKDESK_CHECK_CLOUD=yes`, on a scratch database `<db>-check-<random>` dropped afterwards. |
| `npm run check:cast` | Exactly two characters; reroll leaves the other byte-identical; lock needs a sheet; a locked character refuses every edit. |
| `npm run check:page` | Every panel request carries exactly one reference, the DNA verbatim, the framing line and the no-text rule; panels land out of order without a lost update. |
| `npm run check:stages` | The loading-stage lines advance over time and never come back empty. |
| `npm run check:bubble` | Bubble defaults, clamping, tail paths and the edit rules, without a browser. |
| `npm run check:repair` | Redraw versions capped at three; one silent retry on 429 or timeout, never on 402; stale inking demoted to failed. |
| `npm run check:export` | PNG and PDF contents: page geometry for paged, right-to-left and vertical reading, bubbles in place, a real PDF read back. |
| `npm run check:models` | The style presets reach the prompts verbatim, and no preset names a real work, artist or publisher. |
| `npm run check:assets` | Upload rules by the file's own bytes and size; import makes the picture the sheet and needs a new DNA before Lock. |
| `npm run check:llm` | Every output schema survives strict JSON-schema mode; the fallback fires on a missing key, a 402 or a 529; a malformed reply is never written. |
| `npm run check:plan` | The plan schema's 3 to 6 pages; the cost estimate; Generate all is idempotent; one page's failure never touches another. |
| `npm run check:demo-timeline` | The video's edit: under three minutes, every beat captioned, the music ducked under the voice. |
| `npm run check:config` | The learner's variable names mapped; every bad setting refused by name, never by value; numbers validated; generation off by default in production; `/api/health`'s shape. |
| `npm run check:hardening` | Bodies capped before parsing (chunked ones too); every schema bounded and strict; generation closed with a 503; the image optimizer off; a fresh CSP nonce on every page, with no `'unsafe-inline'` for scripts. |
| `npm run check:queue` | Against a real Redis: a page inks through BullMQ, each picture attached once; a killed worker's job finished by another, paid once; a flushed Redis loses nothing; Redis down is a calm 503; caps, fairness, the 402 breaker; the account and video lanes. |
| `npm run check:activity` | What the studio derives from the jobs it polls: which cards and panels are in flight, when to poll, the status line. |
| `npm run check:auth` | Every API route asks who is calling; the sign-in modes and production's refusals; the real Better Auth on an in-memory database — sign-up refused, an account made verified by the learner's script, sign-in, the session, the account record carrying only a verified email, the sign-in window, a cross-origin write refused, a Google or GitHub sign-in refused; the Origin and `www` rules; admins; the share routes' headers. |
| `npm run check:ownership` | Two accounts on every API route found on disk: the other person gets the missing-project 404 before a body is read, and never sees a picture, job, share, video or spend that is not theirs. |
| `npm run check:limits` | Against a real Redis: quotas, spend reservation and settle, atomic under racing requests; the kill switch pauses everyone; sliding windows; plans; the meter equals the enforcement. |
| `npm run check:share` | Shares, reports, settings, export and account deletion (a crash at every step), on the store and through the routes; a revoked link answers like one that never existed. |
| `npm run check:poll` | The light status route and the poller: no overlap, back-off, hidden tabs, and the full desk read only when it changed. |
| `npm run check:video` | Trailer cost against the measured bills; every shot state, never re-submitted after a crash; settled once; the request bodies for A and B; real ffmpeg assembly with bubbles on time; ownership on the video routes. |
| `npm run check:judge` | `seed-judge.mts`: the dry run writes nothing; the copy is the judge's, byte for byte, under new ids; the source is untouched; a second run changes nothing; the trailer; the refusals; deletion. |
| `npm run check:responsive` | Every screen at 390, 768 and 1280 px in a real browser: no sideways scroll, no touch target under 44 px (24 px at desktop), no cut-off lettering; screenshots in `out/responsive/`. |
| `npm run kernel-test` | Live, needs the network and the keys. The only one that spends money (see above). |

## Security

Every key stays on the server: secret-reading modules import `server-only`, and nothing sends a key to the browser. Every project, picture, job, video and share is checked against its owner, and anything not yours answers the same 404 as something that never existed. With sign-in on, writes to the API from another origin are refused. Spending is always behind sign-in, a quota, a rate window and the kill switch. Uploads are re-encoded, which strips hidden metadata. The Content Security Policy is set per request in `proxy.ts` with a fresh nonce, so production pages run no inline script; Next's image optimizer is off. Errors shown to people never carry internals.

The security and stability audit was run before the v3 build (on the v2 freeze, read as if it were deployed) and again after it, on the frozen build; each slice also had its own adversarial review. The findings, their severity and their fix status are in [devpost/security-report.md](devpost/security-report.md); see the report rather than a summary here.

## Disclosures

- **Pre-existing work.** Two things were made by the learner before the hackathon: `reference/Ink Desk.html`, a standalone UI mockup whose look was ported into the app (its code is not reused, and it fakes all of its art with CSS); and the Ink Desk logo, mark and wordmark in `assets/`, regenerated in the brand red `#B5382E` during the build.
- **How it was built.** Everything else was built during the hackathon with an AI coding agent, from the planning documents in `devpost/`.
- **Who receives what.** OpenRouter: the image, video, speech, music and fallback text prompts, and the pictures sent as references. Anthropic: the text prompts, when `ANTHROPIC_API_KEY` is set. Accounts (email, the password only as a one-way hash, sessions) are kept by the studio itself in its own MongoDB — signing in involves no outside service. The MongoDB host and the bucket host: the stored work. Railway hosts the studio and keeps its logs.
- **Generated output** is produced through the operator's provider accounts and is subject to those providers' terms. Uploaded references must be pictures you made or have permission to use; the app says so wherever a file can be uploaded.
- **Share pages are public** to anyone with the link, without signing in, and are marked `noindex`. They are a snapshot of the finished pages, never the scenario, notes or account; Unpublish turns the link off at once.
- **Terms and Privacy** are at `/terms` and `/privacy`, readable signed out and linked from sign-in. `CONTACT_EMAIL` sets the address they show.

## The demo video

The demo is a Remotion project in `video/`, with its own `package.json`: run `cd video && npm install` once, and `npx playwright install chromium` once for the capture's browser. Start the app with the filming values in `.env` (`npm run dev`); then `npm run video:capture -- --quality high` records the real app and writes `video/timeline.json`; `npm run video:narrate` turns `video/narration.md` into one mp3 per beat through OpenRouter; `npm run video:music` (composed by code, free) or `npm run video:music:generate` (a music model through OpenRouter, paid) produces the track; `npm run video:render` writes `video/out/inkdesk-demo.mp4`. [video/README.md](video/README.md) has the setup, every flag, what is and is not committed, and the licence notes.

## Repository layout

```
app/          Next.js routes: dashboard (/), studio (/p/<id>), share pages (/s/<token>), settings, admin,
              sign-in (no sign-up), terms, privacy, and the API under app/api/
components/   The stations and their parts, the dashboard, the meter, the share, report and animate screens
lib/          The engine: config and boot, auth and ownership (lib/auth/), limits (lib/limits/), the queue
              (lib/queue/), the stores (lib/store/), sharing, accounts, video and audio, prompts, schemas, CSP
proxy.ts      Sign-in gate, www redirect, Origin check and the per-request CSP
worker/       The `worker` service (`npm run worker`)
scripts/      kernel-test.mjs, the check:* scripts and the one-off scripts
video/        The Remotion demo: capture, narration, music, the edit, fonts and licences
data/         The local desk, the kernel-test evidence, the filmed desk (data/filming-2026-10-14)
devpost/      The planning documents, the build record and the security report
assets/       The Ink Desk logo kit (SVG, PNG, WebP)
reference/    The pre-existing UI mockup, Ink Desk.html
public/       Static files the app serves
.agents/      The hackathon's learn skill pack, as installed (linked from .claude/skills; skills-lock.json)
```

`data/` is tracked on purpose: the kernel-test images are the evidence the early slices produced, and they travel with the clone. `.env` stays local; so do the local desk's job records and backups, and the demo's rebuilt outputs (`video/.gitignore`).

## Licences

- The code is MIT, see [LICENSE](LICENSE).
- The fonts in `video/public/fonts/` (Cormorant Garamond, Lora, Comic Neue) are under the SIL Open Font License 1.1; the licence files are beside them.
- Remotion is free under its Free License for an individual and for a for-profit organization with up to three employees; larger for-profit organizations need a Company License (see the licence section of [video/README.md](video/README.md)). The trailers made in the studio are assembled with ffmpeg, not Remotion.
- The music track's provenance is in `video/public/music/LICENSE.txt`: it is generated, or composed by this repository's code, never a third party's recording.
