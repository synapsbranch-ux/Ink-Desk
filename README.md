# Ink Desk

Ink Desk is an AI manga studio that runs on your own machine. You start on a dashboard, create a project with a locked style preset (manga black and white or manhwa colour), write a pitch or paste a long scenario with reference pictures, lock two characters in the library (one drawn from a generated model sheet, one imported from your own picture), let the Director plan a chapter of at least three pages plus a cover with a cost estimate shown before anything is generated, watch the pages ink in with editable speech bubbles and per-panel redraw, then read the chapter and export it as PNG pages or one PDF.

The kernel is one rule: a character's model sheet is generated once and locked, and every panel request carries that sheet as its single reference image together with the character's frozen visual-DNA text, so the face holds across close-ups, medium shots and wide shots.

The project was planned before it was built, under the hackathon's learn skill pack. The record is in `devpost/`: [scope](devpost/scope.md), [PRD](devpost/prd.md), [spec](devpost/spec.md), [build checklist](devpost/checklist.md) and the [app map](devpost/app-map.html).

## Requirements

- Node 22 (the build ran on 22.22) and npm.
- An OpenRouter API key. Required: it pays for every image, for the text fallback, for the demo's narration and, if you generate it rather than compose it, the demo's music.
- An Anthropic API key. Optional: with it, Claude answers every text call first; without it, the fallback answers every text call. If you have none, delete the `ANTHROPIC_API_KEY=` line from `.env` or leave it empty: the placeholder value from `.env.example` would be sent to Anthropic, and the 401 it earns is not one of the failures the fallback covers.
- ffmpeg, only for the demo video (the capture, the narration leveling and the composed music all shell out to it). The app itself does not need it.

## Setup and run

```bash
npm install
cp .env.example .env     # paste your OpenRouter key, and the Anthropic key if you have one
npm run dev              # http://localhost:3000
```

Keep the OpenRouter balance above $1: at or below that the provider returns 402, which the app shows as a calm "try again in a moment" sentence while the terminal names the 402 and the floor. Top up before filming rather than discovering the floor mid-chapter.

## Prove the setup and the kernel

The kernel test is a dependency-free script that reads `.env` and talks to the providers directly. The costs below are what the script prints as `usage.cost`, measured at `medium` (`KERNEL_TEST_QUALITY`).

```bash
node scripts/kernel-test.mjs --probe-only     # ≈ $0.01: capability probe (free), text probe, image probe, fallback probe
node scripts/kernel-test.mjs                  # ≈ $0.08 at medium: one sheet, a close-up and a wide shot → data/kernel-test/index.html
```

Open `data/kernel-test/index.html` and compare the two panels with the sheet. Same person or not is the whole test; `manifest.json` beside it records cost, timing and dimensions per image.

Two more modes test the v2 candidate locks (a style reference and a setting reference, each sent beside the sheet as the second reference of every panel; in style mode the sheet itself is drawn from the style reference too; three panels, $0.13 to $0.14 per test). The reference plates are in `data/kernel-test/refs/`, with a `manifest.json` recording how they were made:

```bash
node scripts/kernel-test.mjs --style-ref data/kernel-test/refs/style-ref.png       # → data/kernel-test/style-ref/
node scripts/kernel-test.mjs --setting-ref data/kernel-test/refs/setting-ref.png   # → data/kernel-test/setting-ref/
```

Each writes its own `index.html` and `manifest.json`; the manifest's `verdict` is null until a person has looked at the images and recorded pass or fail.

The image model is an unpinned alias (`IMAGE_MODEL` in `.env.example`; the provider publishes no dated snapshot), so an upstream revision can change the art without any change in this repository. Re-run the default test with `--out` to keep the new evidence beside the day-one evidence and compare them by eye:

```bash
node scripts/kernel-test.mjs --out data/kernel-test/canary-<date>
```

`--out <dir>` works in every mode.

**Results, 2026-10-14.** Judged by eye in the build session; the learner confirms or overturns them at the final review, and each folder's `manifest.json` carries the verdict with its notes.

- The canary (`data/kernel-test/canary-2026-10-14/`) shows no drift from the day-one set: the same look, the same scar and scarf on the sheet, the close-up and the wide shot, at the same cost to the cent.
- The style reference passed (`data/kernel-test/style-ref/`): the sheet and all three panels are in the reference's watercolour style and the face holds. One caveat: the reference's subject bled into the panel backgrounds although the prompt said not to copy it.
- The setting reference passed (`data/kernel-test/setting-ref/`): the same place from three cameras, the same face in each.

Neither reference lock is exposed in the app. The app's one lock is the character sheet; the tests say the method would carry a style or a setting too.

## Quality and cost

Develop at `low` (the `.env.example` default). The filming values are `IMAGE_SHEET_QUALITY=high` and `IMAGE_PANEL_QUALITY=high`; run with `--quality high`, the capture (`npm run video:capture -- --quality high`) stops before its first paid call unless the app is drawing panels at high; without the flag it records at whatever the app is set to.

Measured at `low`, an image costs about $0.02, so a four-panel page is about $0.08 (`lib/cost.ts` carries the measured figures for `low` and `medium` and labels `high`, `xhigh` and `max` as estimates). The spec's filming estimate is about $2 for two sheets, eight panels and a cover at `high` with a redraw or two; it is an estimate until a run at `high` prints its own `usage.cost`. The dashboard's budget readout sums what each reply cost: OpenRouter's reported `usage.cost` for images and the fallback, and for Claude its token counts at the list price in `lib/llm.ts`, the one figure that is computed rather than reported (the terminal marks it "from tokens"). See `devpost/spec.md > Quality, Cost and Budget (v2)`.

## Storage

`INKDESK_STORAGE` picks where projects and images live. Unset or `local` is the default: `data/projects/<id>/project.json` for state and `data/images/` for every image, so a clone runs with nothing but the keys in `.env`.

`INKDESK_STORAGE=cloud` runs the same app on MongoDB (collection `projects`) and an S3-compatible bucket for every image: MongoDB Atlas with Cloudflare R2, AWS S3 or MinIO. It needs all seven variables:

```
MONGODB_URI  MONGODB_DB  S3_ENDPOINT  S3_REGION  S3_BUCKET  S3_ACCESS_KEY_ID  S3_SECRET_ACCESS_KEY
```

What to expect, mirrored from `.env.example` and `devpost/spec.md > Storage Adapter (v2)`:

- A missing variable is refused by name at startup (`instrumentation.ts`), and the store refuses every call with the same sentence. The studio never falls back to the local desk on its own.
- The bucket must already exist and stays private. Images reach the browser only through `/api/image/<id>`, which reads from the bucket.
- A cloud desk starts empty. Local projects stay on disk, and the v1 `data/chapter.json` is not migrated into the cloud (its images are on this disk, not in the bucket).
- Several processes may share one database — the web service and the worker do. Project writes are compare-and-set, and the job records (collection `jobs`) say who is drawing what; see **The queue and the worker**.
- Variables already exported in your shell win over `.env`. If your shell sets `S3_*` for another project, unset them first. The terminal names the database host and bucket host it connected to.

## The queue and the worker

Drawing is a **job**, not a request. Pressing Draw sheet, Generate page, Redraw or Generate cover writes a job record to the store (`data/jobs/` on a local desk, the `jobs` collection in Mongo) and hands it to a queue; something else draws it and writes the result into the project. A page can ink while the web server restarts, and a picture that was paid for is attached, never drawn twice.

`INKDESK_QUEUE` picks who draws:

- `inline` (the default outside production): the web process draws, two at a time. A clone with two API keys still works; jobs do not survive a restart of the server.
- `bullmq` (the only mode in production): the web service puts the job on Redis (BullMQ) and a separate **worker** draws it. You need `REDIS_URL`, a running Redis, and a second terminal:

```bash
INKDESK_QUEUE=bullmq REDIS_URL=redis://localhost:6379 npm run dev
INKDESK_QUEUE=bullmq REDIS_URL=redis://localhost:6379 npm run worker     # the same .env works for both
```

If Redis is down, a generate button says "The studio is busy — try again in a few minutes" and every project still opens; if Redis is up but no worker is running, jobs wait and the studio says so. `/api/health` reports `queue: { mode, redis, worker }` without ever failing the deploy check on them. Settings, caps and what each failure does are in `.env.example` and `devpost/spec.md > As built — slice 18`.

## The text fallback

Every text call (synopsis, cast and reroll, DNA, scenario summary, page script, dialogue rewrite, chapter plan, DNA read from an imported picture) goes through one `ask()` in `lib/llm.ts`. Claude answers first. When it cannot be used (no `ANTHROPIC_API_KEY`, a 402, or a 5xx/529/429 or dropped connection that survives the single retry) the same call goes to `LLM_FALLBACK_MODEL` (its default is in `.env.example`) through OpenRouter with a strict JSON schema, and the reply is validated by the same zod schema either way. `LLM_FALLBACK` is `auto` (the default), `always` (skip Claude, to rehearse the fallback) or `never` (Claude's own errors reach the screen). The terminal names the provider that answered on every call; the screen does not change.

## Checks

The `check:*` scripts replace `fetch` with a stub wherever a provider would be called, and the ones that touch the store run on a scratch folder (`INKDESK_DATA_DIR`), so nothing is spent and `data/` is never written. None needs the dev server running.

| Command | What it asserts |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over the app. |
| `npm run lint` | ESLint with the Next config. |
| `npm run check:store` | The local store's rules: the v1 desk migrates once with every image id and bubble intact and the file untouched; projects update independently; concurrent updates all land; no temp file left behind. Also the cloud mode switch, the missing-settings sentence and the optimistic `rev` retry against a collection that loses races on purpose. |
| `npm run check:cast` | Exactly two characters; reroll leaves the other byte-identical; a sheet lands as a real file; lock needs a sheet; a locked character refuses every edit on the server. |
| `npm run check:page` | The queue runs two at a time and never doubles a key; every panel request carries exactly one reference, the DNA verbatim, the framing line and the no-text rule; panels land out of order without a lost update. |
| `npm run check:stages` | The loading-stage lines advance over time and never come back empty. |
| `npm run check:bubble` | Bubble defaults, clamping, tail paths and the edit rules, without a browser. |
| `npm run check:repair` | Redraw versions capped at three; one silent retry on 429 or timeout, never on 402; stale inking demoted to failed after a restart or the timeout. |
| `npm run check:export` | What the PNG and PDF will contain: page geometry for paged, right-to-left and vertical reading, bubbles at their stored positions, a real PDF built and read back. |
| `npm run check:models` | The style presets reach the prompts verbatim, the default preset is the v1 rules word for word, and no preset names a real work, artist or publisher. |
| `npm run check:assets` | Upload rules (PNG, JPEG or WebP by their own bytes, the size cap, the shelf cap); import makes the picture the sheet, retires the old DNA and refuses Lock until a new DNA is written from the picture by the text model; an imported character's panel reference is the uploaded bytes. |
| `npm run check:llm` | Every output schema survives strict JSON-schema mode; the fallback fires on a missing key, a 402 or a 529 after the retry; a malformed fallback reply is refused and never written. |
| `npm run check:plan` | The plan schema refuses fewer than 3 or more than 6 pages and a wrong character in a slot; the cost estimate arithmetic; Generate all is idempotent; one page's failure never touches another. |
| `npm run check:config` | The settings: the learner's variable names mapped, every problem named and no value ever repeated, numbers validated, the queue's mode and Redis rules, `/api/health`'s shape. |
| `npm run check:hardening` | Request bodies capped before parsing (chunked ones too), every schema bounded and strict, uploads re-encoded, generation closed with a 503 while the flag is off. |
| `npm run check:queue` | Against a real Redis it starts itself: a page inks through BullMQ with each picture attached once; a killed worker's job is finished by another (claimed twice, paid once); a store outage after the payment is retried without a second provider call; a flushed Redis loses nothing; Redis down is a calm 503 while projects still open; dedupe, per-person caps, fairness and the 402 breaker; a panel is inking only while a live job holds it. Needs `redis-server` on the PATH. |
| `npm run check:activity` | What the studio derives from the jobs it polls: drawing and failed cards, which panels are in flight, when to poll, the status line. |
| `npm run check:demo-timeline` | The video's edit: marks become segments, the film stays under three minutes, every beat is captioned, the music ducks under the voice. |
| `npm run kernel-test` | Live, needs the network and the keys. The only check that spends money (see above). |

The cloud half of `check:store` runs only when `MONGODB_URI` is set (with `MONGODB_DB` and the `S3_*` variables). It uses a scratch database named `<MONGODB_DB>-check-<random>`, dropped afterwards, and deletes only the objects it wrote; the bucket must already exist.

## The demo video

The demo is a Remotion project in `video/`, with its own `package.json`: run `cd video && npm install` once, and `npx playwright install chromium` once for the capture's browser. Four steps, five scripts, all run from the repository root. Start the app first with the filming values in `.env` (`npm run dev` in one terminal); then `npm run video:capture -- --quality high` in a second terminal records the real app with Playwright and writes `video/timeline.json`; `npm run video:narrate` turns `video/narration.md` into one mp3 per beat through OpenRouter; `npm run video:music` (composed by code, free) or `npm run video:music:generate` (a music model through OpenRouter, paid) produces the track; `npm run video:render` writes `video/out/inkdesk-demo.mp4`. [video/README.md](video/README.md) has the setup, every flag, the browser variable for sandboxes, what is and is not committed, and the licence notes for Remotion, the fonts and the music.

## Repository layout

```
app/          Next.js routes: the dashboard (/), the studio (/p/<id>), the API under app/api/
components/   The stations and their parts (dashboard, library, Director, page, reader, bubbles)
lib/          The engine: prompts, schemas, the text provider and fallback, the image call, the queue and its jobs (lib/queue/),
              the stores (lib/store/), the Director's plan and cost, export geometry
scripts/      kernel-test.mjs and the check:* scripts
worker/       The `worker` service: draws the jobs the web service queues (`npm run worker`)
video/        The Remotion demo: capture, narration, music, the edit, fonts and licences
data/         Projects and images (local mode), the kernel-test evidence and reference plates
devpost/      The planning documents and the build record
assets/       The Ink Desk logo kit (SVG, PNG, WebP)
reference/    The pre-existing UI mockup, Ink Desk.html
public/       Static files the app serves (the rail's mark)
agent/        The hackathon's learn skill pack, as installed
```

`data/` is tracked on purpose: the kernel-test images are the evidence slices 1 and 2 produced, and they travel with the clone. Generated panel art is committed too, so the repository grows with every run. `.env` stays local (see `.gitignore`); so do the demo's rebuilt outputs, the footage, the narration clips, the music track and the rendered mp4 (`video/.gitignore`, and `video/README.md > Not committed`).

## Pre-existing work

Two things in this repository were made by the learner before the hackathon:

- `reference/Ink Desk.html`, a standalone UI mockup. It is a visual and layout reference whose look was ported into the app; its code is not reused, and it fakes all of its art with CSS.
- The Ink Desk logo, mark and wordmark in `assets/` (SVG, PNG and WebP variants). They are the learner's own earlier work, regenerated in the brand red `#B5382E` during the build.

Everything else was built during the hackathon with an AI coding agent, from the planning documents in `devpost/`.

## Licences

- The code is MIT, see [LICENSE](LICENSE).
- The fonts in `video/public/fonts/` (Cormorant Garamond, Lora, Comic Neue) are under the SIL Open Font License 1.1; the licence files are beside them.
- Remotion is free under its Free License for an individual and for a for-profit organization with up to three employees; larger for-profit organizations need a Company License (`video/node_modules/remotion/LICENSE.md` after `npm install` in `video/`, remotion.dev/license; see the licence section of [video/README.md](video/README.md)).
- The music track's provenance is in `video/public/music/LICENSE.txt`: it is generated, or composed by this repository's code, never a third party's recording.
- Generated images and text are produced through your own provider accounts and are subject to those providers' terms.
- Uploaded references must be pictures you made or have permission to use. The app shows this notice wherever a file can be uploaded.

## Security notes

Both API keys stay on this machine: the app's server modules and `scripts/kernel-test.mjs` read both, the scripts under `video/` read the OpenRouter key only, and none of them ever sends a key to the browser. The app is local-only by design: there is no deployment, no accounts and no per-chapter image cap, so a public URL would expose the image budget; `devpost/spec.md > Where It Runs and How Someone Tries It` records that decision.
