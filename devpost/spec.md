---
doc: spec
status: approved
---

# Ink Desk — Technical Spec

The blueprint for `prd.md`. One Next.js app, two AI providers called from the
server, one chapter of work kept on disk.

> **Revised again 2026-10-14 — v3, approved 2026-10-14: see [Revision — Ink Desk Studio v3](#revision--ink-desk-studio-v3-public-on-the-learners-domain)
> at the very end, with its *Changes Since Approval*.**
>
> **Revised 2026-10-13 — see [Revision — Ink Desk Studio (v2)](#revision--ink-desk-studio-v2)
> at the end.** Everything below is the approved v1 spec, built and tagged
> `v1-poc`, kept intact. The v2 section specifies the project data model and
> its migration, the storage adapter (local by default, MongoDB + bucket
> switchable), the text provider with the GPT Terra fallback, the image-model
> registry and style presets, uploads and imported references, the Director,
> routing and the dashboard, the chapter reader and PDF export, and the demo
> video pipeline. The v1 page engine is reused per page, unchanged.

---

## How This Works, In Plain Language

Ink Desk is **one Next.js app** — a single program that serves the web page
*and* answers requests from it. Nothing else has to be running.

Three things live inside it:

1. **The studio** — the five stations from `prd.md > Screens and Layout`, drawn
   in the browser. This is all it does: show what exists and let you act on it.
   It holds no secrets and generates nothing itself.
2. **The route handlers** — small server-side functions, one per action
   (*write a synopsis*, *draw a sheet*, *generate panel 3*). These are the only
   code that sees your API keys, and the only code that talks to Claude or to
   the image model. The browser asks them for things; it never calls a provider
   itself. This is what `scope.md > Model Providers` requires.
3. **The desk** — a folder on your laptop called `data/`. Every generated image
   is a `.png` file in `data/images/`, and everything else about the chapter —
   the synopsis, the cast, the locked DNA, the page script, which panel version
   is showing — is a single file, `data/chapter.json`.

**The two AI providers do different jobs.** Claude writes all the words:
synopsis, characters, each character's visual DNA, the four-panel script, the
dialogue. An OpenAI image model draws all the pictures — two model sheets and
four panels — but it is reached **through OpenRouter**, not the OpenAI API. So
there are two providers in the architecture and two keys, and one of them is a
broker rather than the lab that made the model.

**The kernel, mechanically.** When a panel is generated, the route handler opens
that character's locked sheet `.png` off the disk and sends it to the image model
**as an attached reference picture**, together with the locked DNA text pasted in
word for word. The only part that changes between panels is Claude's description
of the action, the camera angle, and the background. That is
`scope.md > The Unique Kernel`, and it is the whole reason the face holds.

**Why this shape and not something more elaborate.** There is no database,
because one chapter of one story is a single JSON file. There are no accounts,
because `prd.md > States and Boundaries` says one chapter at a time. There is no
separate backend server, because Next.js route handlers already run on the
server. And the images are plain files in a folder you can open — which matters,
because the hardest question in this build is *"did the face actually hold?"*,
and the fastest way to answer it is to put `sheet.png` next to `panel-1.png` and
look.

---

## The Core Journey Through the System

`prd.md > The Core Journey`, traced through the pieces above. The numbers match
the PRD's steps.

```
   BROWSER                      SERVER ROUTE HANDLER                PROVIDER
   ───────                      ────────────────────                ────────

1  Story station opens
   reads GET /api/chapter  ──▶  reads data/chapter.json

2  type pitch, pick chips
   POST /api/synopsis      ──▶  prompt + pitch + genre + tone  ──▶  Claude
                                writes synopsis into chapter.json
3  synopsis in an editable
   field; edit / regenerate
4  Accept               ──▶     marks accepted, unlocks Cast
   POST /api/cast        ──▶    synopsis → two characters     ──▶  Claude

5  edit text freely, Reroll
   POST /api/cast/reroll ──▶    replaces exactly one          ──▶  Claude

6  Draw sheet
   POST /api/sheet       ──▶    (a) description → DNA text    ──▶  Claude
                                (b) DNA text → sheet image    ──▶  OpenRouter
                                    no input_references            POST /api/v1/images
                                decodes b64 → data/images/<id>.png
7  card shows DNA beside
   the sheet; Redraw reuses
   the same DNA
8  Lock                  ──▶    freezes { dna, sheetImageId }

9  both locked
   POST /api/script      ──▶    synopsis + 2 locked DNA       ──▶  Claude
                                → 4 panels, one character each

10 Storyboard: 4 pencil
   placeholders
   POST /api/panels/start──▶    queues 4 jobs, 2 at a time
                                per panel:
                                  reads data/images/<sheet>.png
                                  sends sheet AS REFERENCE     ──▶  OpenRouter
                                  in input_references[0]            POST /api/v1/images
                                  + locked DNA verbatim             (same endpoint as
                                  + Claude's action/angle/bg         the sheet above)
                                  + "no text in the image"
                                decodes b64 → data/images/<id>.png
   polls GET /api/chapter ──▶    returns per-panel status
   each panel inks in as
   it lands, out of order

11 Redraw panel          ──▶    same request, same references
   POST /api/panels/3            keeps ≤3 versions

12 all four have art
   → Ink & Publish: full-page replay, right-to-left toggle,
     PNG export drawn in the browser on a <canvas>

13 success: Kaito is the same person in panels 1 and 3
```

The browser never holds image bytes. Every `<img>` points at
`/api/image/<id>`, which streams the file off the disk.

---

## Stack

| Concern | Choice | Docs |
|---|---|---|
| Framework | **Next.js, App Router** | https://nextjs.org/docs/app |
| Language | TypeScript | https://www.typescriptlang.org/docs/ |
| Text generation | **Anthropic, direct — `claude-sonnet-5-5`** | https://docs.claude.com/en/api/messages |
| Image generation | **OpenRouter — `openai/gpt-image-2.5-sunburst`** | https://openrouter.ai/docs/guides/overview/multimodal/image-generation |
| Structured JSON from Claude | `zod` + the SDK's `zodOutputFormat` helper | https://docs.claude.com/en/docs/build-with-claude/structured-outputs |
| Fonts | `next/font/google` — Cormorant Garamond, Lora, Comic Neue | https://nextjs.org/docs/app/api-reference/components/font |

Packages: `next`, `react`, `react-dom`, `typescript`,
`@anthropic-ai/sdk`, `zod`.

**No `openai` package.** It was in the list when images went to the OpenAI API
directly. OpenRouter's image endpoint is not the OpenAI images API — different
body (`aspect_ratio`, `input_references`), different route — so the SDK would
not fit it even with a `baseURL` override. `lib/image-provider.ts` uses plain
`fetch`, which is one fewer dependency and makes the request shape visible in
the file rather than hidden behind a client.

**Why Next.js App Router** (learner's choice, from their named stack): one
process, and server-side route handlers hold both `ANTHROPIC_API_KEY` and
`OPENROUTER_API_KEY` so neither reaches the browser —
required by `scope.md > Model Providers`. No separate API server to start on
camera. Accepted tradeoff: React rather than Angular, and the mockup's CSS is
**ported rather than reused**, consistent with `scope.md > Explicitly Cut`.

**Unverified, check at install:** the exact Next.js major version. Scaffold with
`npx create-next-app@latest` and take whatever stable version it gives; nothing
in this spec depends on a specific one.

---

## Where It Runs and How Someone Tries It

**Local only.** Submission needs a short demo video and a public GitHub
repository; a locally-run app is sufficient to film, and deployment was already
optional in `prd.md > Deferred From the POC`.

**Deployment stays in Later.** The learner's reason, recorded because it is an
architecture constraint rather than a preference: *a public URL would expose the
image budget without a cap.* If revisited after the build, it gets done
**together with a server-side per-chapter image cap** — the enforcement
`prd.md > States and Boundaries` deliberately left out of the product. Note that
server-side disk storage is itself local-only: a deployed version would need
real object storage, which is part of why deployment is a separate piece of work
rather than a flag.

**Setup, once:**

```bash
npm install
cp .env.example .env     # then paste both API keys into .env
```

**Prove both models and the kernel before any UI exists:**

```bash
node scripts/kernel-test.mjs --probe-only   # ~$0.01 — capabilities, both model IDs, structured output
node scripts/kernel-test.mjs                # ~$0.08 — proves the face holds
open data/kernel-test/index.html            # sheet, close-up and wide, side by side
```

`--probe-only` runs three probes, and the first one is new in this revision:

- **The capability probe** — `GET /api/v1/images/models`, free, no generation.
  It asserts that `IMAGE_MODEL` is listed, that `input_references` is in its
  `supported_parameters`, and that the configured aspect ratios and quality are
  in their published enums. This is the probe that would have caught the
  `size` → `aspect_ratio` change *before* a single image was paid for, which is
  exactly why it now runs first. See **Verified: Image Model and
  Reference-Image Support**.
- **The text probe** — one tiny structured-output call that proves
  `ANTHROPIC_MODEL` resolves *and* that `output_config.format` works on it;
  because it deliberately sends no sampling parameters, it would also catch that
  mistake.
- **The image probe** — one `low` generation proving the model actually renders
  through OpenRouter and that the response really does carry
  `data[0].b64_json`. It also prints `usage.cost`, the first real price this
  project has seen.

Between them, every provider assumption in this spec is checked for about a
cent.

**Run the app:**

```bash
npm run dev     # then open http://localhost:3000
```

**For the demo recording** — the shot is already written in
`scope.md > What "Working" Looks Like`:

1. Set `IMAGE_SHEET_QUALITY=max` and `IMAGE_PANEL_QUALITY=high` in `.env`,
   then restart `npm run dev`.
2. Check the OpenRouter balance is above **~$3** — the run costs ~$1.25 and
   everything below $1 is unspendable, since that is where 402 starts.
3. Delete `data/` for a clean first-use state.
4. Story → **"Try the sample"** → accept the synopsis.
5. Cast → **Draw sheet** on Kaito → **Lock**. *Film the stamp landing.*
6. Lock Mio, let the page script write, let the four panels ink in.
7. Split screen: Kaito's locked sheet beside panels 1 and 3.
8. Ink & Publish → the reveal replay, the right-to-left toggle, PNG export.

---

## Look and Feel

Carried forward from `prd.md > Look and Feel` and
`scope.md > Inspiration & Identity` — settled from the learner's pre-existing
mockup, not re-interviewed. `reference/Ink Desk.html` is the visual reference;
its code is not reused.

CSS custom properties in `app/globals.css`, ported from the mockup:

```css
--paper:   #f3f2f2;   --surface: #eae9e9;
--ink:     #201f1d;   --hanko:   #b5382e;   /* the single brand red, 9-step ramp */
--ink-speed: 1.4s;
```

- **Type:** Cormorant Garamond (headings), Lora (body), Comic Neue (dialogue
  lettering only), all via `next/font/google`.
- **Texture:** halftone in pure CSS — `radial-gradient` dot screens,
  `repeating-linear-gradient` tone bands. No image assets.
- **Motion:** panels ink in from pencil sketch to final art. A CSS reveal over
  the finished image — `scope.md > Explicitly Cut` rules out real two-pass
  generation.
- **The red is reserved** for primary actions and the Locked badge, so it reads
  as a hanko seal landing.
- **Copy tone:** plain and calm. `prd.md > Look and Feel` forbids raw error
  codes on screen, so failure text is written as a sentence —
  *"Panel 3 didn't come back, the studio is busy."*

The stack honors all of this: it's hand-written CSS in a React app, with no
component library imposing its own look.

---

## The Page Layout

`prd.md > Deferred From the POC` builds **one** 4-panel layout, so it can be
fixed here rather than discovered during the build. The shot order comes from
`scope.md > What "Working" Looks Like`: **Kaito → Mio → Kaito close-up → Mio
reacting.**

```
┌─────────────────────────────────────────┐
│  1   KAITO · wide establishing          │   3:2   landscape
│                                         │
├──────────────────────┬──────────────────┤
│  2   MIO             │  3   KAITO       │   1:1   square
│      medium          │      close-up    │   1:1   square
├──────────────────────┴──────────────────┤
│  4   MIO · reaction, wide               │   3:2   landscape
│                                         │
└─────────────────────────────────────────┘
```

| Panel | Character | Shot | Generated ratio | Page slot |
|---|---|---|---|---|
| 1 | Kaito | wide establishing | `3:2` | full width, top |
| 2 | Mio | medium | `1:1` | middle left |
| 3 | Kaito | **close-up** | `1:1` | middle right |
| 4 | Mio | reaction, wide | `3:2` | full width, bottom |

**Each panel's aspect ratio is fixed, and passed in its own request.** This is
`aspect_ratio`, not `size` — see **Verified: Image Model and Reference-Image
Support** for why. The ratios the model offers are `1:1`, `3:2`, `2:3`, `4:3`,
`3:4`, `16:9`, `9:16` and `21:9`; the two in use here are chosen so the
generated image already matches the slot it will sit in. Nothing is scaled to
fit, which means **nothing is ever cropped through a face** — the one failure
that would undo the kernel after the model got it right.

**The ratio is what that guarantee rests on, and the ratio is what we control.**
Pixel dimensions are no longer ours to set: there is no size parameter on this
model through OpenRouter, so the provider returns whatever resolution it
chooses at the requested ratio. That costs nothing here, because a `3:2` image
drops into a `3:2` slot uncropped at any resolution. It does mean the layout
should size panels in CSS from their ratio rather than from hardcoded pixel
numbers, and the kernel test records the dimensions it actually gets back so
the real numbers are known before the UI is built.

**The framing also goes in the prompt**, not just the request, so the model
composes for the shape it's drawing:

- Square close-up — *"Centre his face in frame with headroom above and below;
  keep his eyes on the upper third line and nothing important near the edges."*
- Wide landscape — *"Place him off-centre in the left third, full body inside
  the frame with clear margin on every side."*

**The model sheet is landscape, `3:2`** — it's a row of poses (front,
three-quarter, a few expressions in one frame, per
`scope.md > The POC Boundary`), so a square would either crowd them or waste
half the image.

The two landscape panels bookending two squares is also just good manga page
design: a wide establishing shot to open, the tight shot/reverse-shot pair in
the middle, and a wide reaction to close.

> **Ratios live in `.env`** as `IMAGE_SHEET_ASPECT`, `IMAGE_PANEL_ASPECT_WIDE`
> and `IMAGE_PANEL_ASPECT_SQUARE`, with the per-panel assignment in
> `lib/prompts.ts` beside the framing lines — so layout and framing stay
> together rather than drifting apart.

---

## Components

### Station Rail

The persistent navigation and progress indicator. Reads the chapter's derived
gates and renders four stations, each clickable only once its prerequisite is
met, with a hover hint when locked. Carries the Ink Desk mark, the *"Saved to
desk"* label, and the *"Images this chapter: N"* counter.

Implements `prd.md > Screens and Layout`.

Gates are **computed from chapter state, never stored** — one function,
`gates(chapter)`, returns which stations are open. Storing them would let them
drift out of sync with the thing they describe.

### Story Station

Pitch box, genre and tone chips, **"Try the sample"**, and the synopsis in an
editable field with regenerate and **Accept**. Accepting is the gate that
unlocks Cast. "Try the sample" fills the **pitch text only** — everything after
is generated for real.

Implements `prd.md > Story — The Pitch Desk`.

### Cast Station and Character Card

Two character cards. Each shows name, role, traits and look description — all
editable — plus **Reroll** (text only, replaces exactly one character),
**Draw sheet**, the DNA text beside the sheet image, **Redraw sheet**, and
**Lock**. A locked card is read-only and wears the Locked stamp.

Implements `prd.md > Cast — Model Sheets`. **This is where the kernel is built.**

The load-bearing ordering from the PRD is enforced server-side, not in the UI:
`POST /api/sheet` writes the DNA *and then* generates the sheet from that DNA in
one handler, so the two frozen artifacts cannot contradict each other. **Redraw
sheet** passes `reuseDna: true`; editing the description clears the DNA and the
next draw rewrites it.

### Page Script

Claude's four-panel breakdown, displayed as a visible step inside Storyboard
rather than its own rail entry (the open question in `prd.md > Open Questions`,
drafted that way because the user doesn't act on it). Per panel: which
character, action, camera angle, background, dialogue.

Implements `prd.md > Page Script`. The one-locked-character-per-panel rule is a
schema constraint, not a prompt suggestion — see **Data Model**.

### Storyboard Station and Panel

The four-panel page. Each `Panel` owns its own status and renders one of:
pencil-sketch placeholder with a per-panel label, finished art with overlaid
Comic Neue speech bubbles, a *"Inking…"* indicator over existing art during a
redraw, or a calm failure message with **Try again** or **Rewrite panel**. The
version stepper appears in the corner once a panel has two versions.

Implements `prd.md > Storyboard — The Main Studio`. **Per-panel independence is
the governing rule** — one panel's failure never touches another, and panels
fill in whatever order they finish.

Each panel renders at its own aspect ratio from **The Page Layout** — two
landscape, two square — and the image it holds was generated at that ratio, so
the art is displayed at its native shape and never scaled into a crop.

### Speech Bubble

Positioned over the panel art as app UI in Comic Neue, never drawn by the image
model. Implements `scope.md > Lettering`.

**Rewritten in slice 5b** — `prd.md > Changes Since Approval > Speech bubbles`.
The bubble is an **SVG oval with a smooth two-curve tail** (geometry in
`lib/bubble.ts`: the tail is one open path, filled white so it merges with the
rim, stroked only on its two sides), not a CSS box. **Click the text to edit
it in place** (the edit replaces `dialogue`); **drag the body to move, pull a
corner to resize** (react-rnd, chosen for its maintained drag+resize with
`bounds="parent"` on React 19-safe internals); **drag the tail tip** to point
at the speaker. The placed layout is stored per panel as **percentages of the
panel** (`Panel.bubble`), clamped by the shared `clampBubble` on both sides of
the wire, so a reload and the slice 7 export reproduce it exactly — the export
can feed the identical path strings to `new Path2D()`.

Until the user touches a bubble, placement is still **derived, not authored**:
the camera-angle lookup picks a corner and `defaultBubble` lays the bubble out
there, so Claude never returns coordinates. Claude's dialogue is only the
starting text.

### Reader Station

Full-page reading with the ink-in reveal replaying panel by panel on entry, the
right-to-left toggle, and PNG export. Export composites art **and** bubbles by
drawing both onto an off-screen `<canvas>` in the browser and calling
`toBlob()` — no server round trip, no extra dependency.

Implements `prd.md > Ink & Publish — The Reader`.

### Panel Queue (`lib/queue.ts`)

An in-memory queue in the server process that runs at most
`PANEL_CONCURRENCY` (2) panel generations at once. Resolves the concurrency
call in `prd.md > Open Questions`. Each finished panel writes to
`chapter.json` immediately, so the browser's poll sees panels appear
independently and out of order.

### Singletons and the Dev Server

Three pieces of process-level state — the panel queue, the `update()` lock, and
`serverRunId` — have to be **genuinely single** for any of the guarantees above
to hold. Next.js hot-reloads modules on every code change, which re-evaluates
module scope and would quietly give you a *second* queue running alongside the
first (so 4 concurrent generations instead of 2) and a *second* lock (so the
lost-update bug comes back).

Pin them to `globalThis`, which survives module re-evaluation:

```ts
// lib/singleton.ts
const g = globalThis as typeof globalThis & { __inkdesk?: InkDeskGlobals }

export const singletons = (g.__inkdesk ??= {
  serverRunId: crypto.randomUUID(),   // stamped once per real process
  queue: createQueue(Number(process.env.PANEL_CONCURRENCY ?? 2)),
  chapterLock: Promise.resolve(),
})
```

`serverRunId` on `globalThis` also keeps the restart fallback honest: it must
change when the **process** restarts and *not* when a module reloads, which is
exactly what this gives.

**Every route handler declares the Node runtime:**

```ts
export const runtime = 'nodejs'
```

Without it a handler could be evaluated on the Edge runtime, where there is no
`fs` and no long-lived process — so disk writes and the in-memory queue both
fail. Making it explicit in all nine handlers is cheaper than debugging it once.

**Background work continues after the response returns.** `POST
/api/panels/start` queues four jobs and responds immediately; the generations
finish afterwards and write to `chapter.json` on their own. That is fine in a
local long-lived `next dev` process and is what makes "generation survives a
reload" work at all. It is **not** fine on a serverless host, where the
function may be frozen or killed the moment the response is sent — so this is
the third independent reason deployment is real work rather than a flag,
alongside the ephemeral filesystem and the missing image cap.

### Prompts and Schemas (`lib/prompts.ts`, `lib/schemas.ts`)

Every prompt in one file, including the **frozen style rules** pasted into each
panel request verbatim. Keeping them in one place is what makes "the frozen half
never changes" checkable rather than aspirational.

Alongside them, the four `zod` schemas that are Claude's output contracts. See
**External Services and Dependencies** for the call shape and the three
constraints that are a 400 rather than a warning.

Serves `scope.md > The Unique Kernel` and `scope.md > Lettering`.

### Image Writer (`lib/images.ts`)

OpenRouter returns **base64, never a URL**. This decodes once, writes the file,
and returns only the id — which is why the browser only ever sees
`/api/image/<id>` and never carries image bytes around. Also bumps `imageCount`
for the header counter.

**Pick the extension from `media_type`, not from a hardcoded `.png`.** Each
response item carries its own `media_type` alongside `b64_json`. This model is
configured for PNG and should return `image/png` every time, but writing a
JPEG's bytes into a `.png` filename would produce a file that some viewers
open, the `<canvas>` export may not, and nobody would think to suspect. One
lookup from `media_type` to extension removes a whole class of confusing bug
for two lines, so `imageId` carries its extension and `/api/image/<id>` serves
the matching `Content-Type`. An unrecognised `media_type` is a hard failure
rather than a guess.

### Chapter Store (`lib/chapter.ts`)

The only code that reads or writes `data/chapter.json`. Every mutation goes
through one `update()` function that reads, applies a change, and writes.

**Two separate guarantees are needed here, and they solve different problems.**

**1. No torn files — temp file then rename.** Write to `chapter.json.tmp`, then
`rename()` it over the real file. Rename is atomic, so a crash mid-write can
never leave a half-written chapter on disk.

**2. No lost updates — one in-process lock.** This is the one that actually
bites: with concurrency 2, two panels can finish within milliseconds of each
other. Both `update()` calls read the same chapter, each applies *its own*
panel, and the second write **erases the first panel's result**. The art file is
on disk, but the chapter no longer points at it — so a finished panel silently
reverts to a pencil placeholder. Atomic rename does not help, because both
writes are individually well-formed; they're just based on stale reads.

The fix is to serialize every `update()` through a single promise chain, so
read-modify-write is never interleaved:

```ts
let lock: Promise<unknown> = Promise.resolve()

export function update(fn: (c: Chapter) => Chapter): Promise<Chapter> {
  // Each call chains onto the previous one, so the read inside `run`
  // always sees the previous call's write.
  const run = async () => {
    const chapter = await read()          // fresh read, inside the lock
    const next = fn(chapter)
    await writeAtomic(next)               // tmp + rename
    return next
  }
  // `.then(run, run)` so one failed update doesn't wedge the chain.
  const result = lock.then(run, run)
  lock = result.catch(() => {})
  return result
}
```

Note `fn` receives the chapter and returns the next one — callers must not close
over a chapter they read earlier, or they reintroduce the stale read the lock
exists to prevent.

Each successful write is what the *"Saved to desk"* label reports.

**Acceptance check for this component** — `5-build` should not call it done
without it:

- [ ] Two panels completing at the same moment **both** survive in
      `chapter.json`. Drive it by starting two panel generations together and
      asserting both have `status: 'done'` and distinct `imageId`s afterwards;
      or directly, by firing two `update()` calls in the same tick and checking
      both mutations are present.
- [ ] `imageCount` after four panels is 4, not fewer. A lost update shows up
      here too, which makes the header counter a free canary.

A single-process in-memory lock is sufficient *because* this is a local
single-process app — which is one more thing that would need rethinking before
deployment. See **Singletons and the Dev Server**.

---

## Data Model

One file, `data/chapter.json`. One chapter, as `prd.md > States and Boundaries`
requires. Shapes live in `lib/types.ts`.

```ts
type Chapter = {
  version: 1                    // lets a future shape change migrate rather than crash
  serverRunId: string           // set once at server boot — see the restart fallback
  station: 'story' | 'cast' | 'storyboard' | 'reader'
  pitch:    { text: string; genre: string; tone: string }
  synopsis: { title: string; body: string; accepted: boolean } | null
  cast:     Character[]         // exactly 2 once proposed
  script:   Panel[] | null      // exactly 4 once written
  imageCount: number            // the "Images this chapter: N" counter
  updatedAt: string
}

type Character = {
  id: string
  name: string; role: string; traits: string[]; look: string
  dna: string | null            // written by Claude, frozen at lock
  sheetImageId: string | null   // → data/images/<id>.png
  locked: boolean               // final; no unlock in this version
}

type Panel = {
  index: 0 | 1 | 2 | 3
  characterId: string           // exactly one, enforced by schema
  action: string; camera: string; background: string
  dialogue: string              // Claude's line to start; the user's edits replace it (5b)
  bubble?: BubbleLayout | null  // user-placed lettering; absent = derived default (5b)
  versions: PanelVersion[]      // newest last, max 3, oldest dropped
  currentVersion: number        // the one that counts: on the page and in the export
  status: 'empty' | 'inking' | 'done' | 'failed' | 'refused'
  startedAt: string | null      // for the timeout fallback
  startedByRun: string | null   // for the restart fallback
}

type PanelVersion = { imageId: string; createdAt: string }

// Slice 5b (prd.md > Changes Since Approval): where the bubble sits, as
// percentages of the panel, so the layout survives any resolution, a reload,
// and the slice 7 export. Stored only once the user touches the bubble; a
// chapter written before 5b simply has no `bubble` and keeps the default.
type BubbleLayout = {
  x: number; y: number          // top-left corner, % of panel
  w: number; h: number          // size, % of panel
  tailX: number; tailY: number  // tail tip, % of panel — points at the speaker
}
```

**Where each piece lives, how it updates, what happens when you come back:**

| Data | Lives in | Updated by | On reload |
|---|---|---|---|
| Pitch, genre, tone | `chapter.json` | debounced `POST /api/chapter` as you type | restored |
| Synopsis | `chapter.json` | `POST /api/synopsis`, and edits as you type | restored, with accepted state |
| Cast text | `chapter.json` | `POST /api/cast`, `/reroll`, and edits | restored |
| DNA | `chapter.json` | `POST /api/sheet`, frozen at lock | restored |
| Sheet images | `data/images/<id>.png` | `POST /api/sheet` | restored, served by id |
| Page script | `chapter.json` | `POST /api/script` | restored |
| Panel art + history | `data/images/` + `versions[]` | `POST /api/panels/[i]` | restored, including the version stepper |
| Bubble layout + dialogue edits | `chapter.json` | `POST /api/chapter` on drop/blur | restored exactly where placed |
| Current station | `chapter.json` | every navigation | restored |
| Image count | `chapter.json` | every image written | restored |

**Nothing lives only in the browser.** React holds a copy for rendering, and
`data/chapter.json` is the truth. The learner confirmed that *"same browser"* in
`prd.md > States and Boundaries` meant **no accounts and one chapter**, not a
browser-storage requirement — which is just as well, since 14 images at
filming quality would be far over the ~5 MB `localStorage` ceiling.

### Reload Mid-Generation

Implements the changed behavior in
`prd.md > Changes Since Approval` — generation survives a reload, with a floor.

Because generation runs server-side, a panel in flight keeps going when the tab
reloads. The reader of `chapter.json` demotes a stale `inking` panel to `failed`
on read, on either of two conditions:

- **Timeout** — `startedAt` is older than `GENERATION_TIMEOUT_MS`.
- **Server restart** — `startedByRun !== serverRunId`. `serverRunId` is
  generated once when the server process boots, so after a restart every panel
  that was mid-flight is recognisably orphaned. This is the condition that
  matters in development, where Next.js restarts the server on every code change
  and silently kills in-flight requests.

So a reload shows each panel **finished**, **still inking**, or **failed with
Try again** — and nothing ever spins forever.

---

## File Structure

```
ink.desk/
├── app/
│   ├── layout.tsx                  # fonts, html shell
│   ├── page.tsx                     # the studio: rail + active station
│   ├── globals.css                  # design tokens + halftone, ported from the mockup
│   └── api/
│       ├── chapter/route.ts         # GET current chapter · POST edits · DELETE = new chapter
│       ├── synopsis/route.ts        # pitch+genre+tone → synopsis            (Claude)
│       ├── cast/route.ts            # synopsis → two characters              (Claude)
│       ├── cast/reroll/route.ts     # replace exactly one character          (Claude)
│       ├── sheet/route.ts           # description → DNA → sheet image  (Claude + images)
│       ├── script/route.ts          # synopsis + locked DNA → 4 panels       (Claude)
│       ├── panels/start/route.ts    # queue all four panels
│       ├── panels/[index]/route.ts  # generate or redraw one panel       (OpenRouter)
│       ├── panels/[index]/rewrite/route.ts  # rephrase visuals, then redraw  (both)
│       └── image/[id]/route.ts      # streams data/images/<id>.png
├── components/
│   ├── StationRail.tsx
│   ├── StoryStation.tsx
│   ├── CastStation.tsx
│   ├── CharacterCard.tsx            # DNA beside sheet, Draw/Redraw/Lock
│   ├── PageScript.tsx
│   ├── StoryboardStation.tsx
│   ├── Panel.tsx                    # placeholder · ink-in · stepper · failure
│   ├── PencilPlaceholder.tsx
│   ├── SpeechBubble.tsx
│   └── ReaderStation.tsx            # full page, RTL toggle, PNG export
├── lib/
│   ├── types.ts                     # Chapter, Character, Panel, PanelVersion
│   ├── schemas.ts                   # zod schemas = Claude's output contracts
│   ├── prompts.ts                   # every prompt; the frozen style rules live here
│   ├── claude.ts                    # Anthropic client + the text calls
│   ├── image-provider.ts            # one OpenRouter call; references optional
│   ├── chapter.ts                   # serialized, atomic read/write of chapter.json
│   ├── singleton.ts                 # globalThis-pinned queue, lock, serverRunId
│   ├── images.ts                    # b64 → data/images/<id>.png
│   ├── queue.ts                     # concurrency-2 panel queue
│   └── gates.ts                     # which stations are unlocked, derived
├── scripts/
│   └── kernel-test.mjs              # slices 1 and 2 — probes both models, then the lock
├── data/                            # created at runtime, and TRACKED
│   ├── chapter.json
│   ├── images/<id>.png
│   └── kernel-test/                 # sheet + two panels + index.html to compare
├── devpost/                         # the planning workspace
├── reference/Ink Desk.html          # the pre-existing UI mockup, tracked
├── assets/{svg,png,webp}/           # the learner's logo, pre-existing, tracked
├── .env.example
├── .env                             # GITIGNORED
└── README.md                        # setup, run, and the pre-existing-work disclosure
```

**Pre-existing work in the repo:** `reference/Ink Desk.html`, the UI mockup, is
**tracked**, reversing the earlier decision to gitignore it — the learner needs
it on more than one machine, and slice 3 ports its look. Its code is still not
reused; it is a visual reference that now travels with the clone. It is
**disclosed in the README at ship time** as pre-existing work, per
`scope.md > Pre-Existing Work to Disclose in the README` — tracking it makes
that obligation more visible rather than removing it, and `6-ship` still has to
write it. The logo files under `assets/` are tracked for the same reason, with
the difference that the app actually loads those. See
`checklist.md > Revisions`.

---

## External Services and Dependencies

### Anthropic — Claude (text)

**Called on the Anthropic API directly, with `ANTHROPIC_API_KEY`.** Only images
moved to OpenRouter; routing the text calls through it as well would have
bought nothing and put a broker between this app and the structured-output
features it depends on.

- **Model:** `claude-sonnet-5-5` — the current Sonnet, released 2026-09-28,
  superseding `claude-sonnet-5`. The learner's tier choice comes from
  `scope.md > Model Providers`; the exact ID was corrected from the official
  models page during spec review. 1M context, 128K max output.
  **$2 / $10 per million tokens** input/output. Every text call here is a few
  hundred tokens, so the whole text side of a run costs well under a cent — the
  image bill is the only one worth watching.
- **Pinned and configurable** as `ANTHROPIC_MODEL`, the same way the image model
  is, so a newer Sonnet is a one-line change rather than a code edit.
- **Endpoint:** `POST /v1/messages`, via `@anthropic-ai/sdk`.
- **Docs:** https://docs.claude.com/en/api/messages

**All four text calls use structured JSON output**, so there is no parsing of
prose and no "please return valid JSON" in any prompt. Declare the shape as a
`zod` schema and the API constrains the response to it:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

const res = await client.messages.parse({
  model: process.env.ANTHROPIC_MODEL,          // claude-sonnet-5-5
  max_tokens: 2048,
  thinking: { type: 'between_tools' },         // short calls; latency is on camera
  output_config: {
    effort: 'low',
    format: zodOutputFormat(PageScriptSchema),
  },
  messages: [{ role: 'user', content: prompt }],
})
res.parsed_output   // typed, already validated
```

**Re-verified against `claude-sonnet-5-5` specifically during spec review**, not
carried over from the previous Sonnet:

- **Structured outputs are supported** on it — `output_config.format` with
  `type: "json_schema"`, documented as combinable with `output_config.effort`.
  `zodOutputFormat` just produces that shape, so the helper is fine.
- **Sampling parameters are still rejected.** A non-default `temperature`,
  `top_p` or `top_k` returns a 400 on the 5.5 family. The rule stands.
- **Adaptive thinking is still on by default**, so thinking has to be turned
  off explicitly — but **not with `{ type: 'disabled' }`**. Slice 1's text
  probe found that value returns a 400 on this model, and
  `GET /v1/models/claude-sonnet-5-5` confirms why: it reports
  `thinking.types.disabled.supported === false`. The accepted value is
  **`{ type: 'between_tools' }`**. The model does not think before responding;
  the short updates it writes between tool calls are what come back as thinking
  blocks. See `checklist.md > Revisions`.

Four schemas in `lib/schemas.ts`: `SynopsisSchema`, `CastSchema`, `DnaSchema`,
`PageScriptSchema`. **The one-locked-character-per-panel rule from
`prd.md > Page Script` is expressed as a `z.enum([...])` of the two locked
character ids** — so a panel naming two characters, or a character who
isn't locked, is rejected by the schema rather than caught later by a check
somebody has to remember to write.

> **Where that rejection actually happens — a slice 5 finding.** The SDK's
> `zodOutputFormat` sends the API only a strict subset of JSON Schema (type,
> properties, required, description, a few string formats) and **lowers
> `enum` into the field's description** as text — so the API's grammar does
> not constrain the id. What enforces it is the SDK: `messages.parse`
> validates the reply against the zod schema and throws before
> `parsed_output` exists. The rule is the schema's and a wrong character never
> reaches the desk; the check runs in the SDK, not in the API. Verified by
> `npm run check:page`. See `checklist.md > Revisions`.

Three constraints worth knowing before writing the schemas, because each is a
400 rather than a warning:

- Every object needs `additionalProperties: false` — `zodOutputFormat` handles
  this. No recursive schemas; no `min`/`max` on numbers or strings.
- **Do not send `temperature`, `top_p`, or `top_k`.** They are rejected on
  `claude-sonnet-5-5`. Prompt wording is the only steering lever.
- **No assistant-message prefills.** `output_config.format` is the replacement,
  which is what we're using anyway.

`thinking: { type: 'between_tools' }` plus `effort: 'low'` is the starting
point: these calls are short, structured, and their latency is visible on
camera. Adaptive thinking is **on by default** on `claude-sonnet-5-5`, so this
has to be set explicitly, and `between_tools` is the value that does it — see
the verified bullet above. If the synopsis or dialogue reads flat, dropping
`thinking` from those two calls is a one-line change — try that before touching
the prompts.

Prompt caching is **not** used: the minimum cacheable prefix on
`claude-sonnet-5-5` is 1024 tokens and these prompts are far shorter, so a
`cache_control` marker would pay the write premium and never be read.

### OpenRouter — GPT Image (pictures)

- **Model:** `openai/gpt-image-2.5-sunburst`, for both sheets and panels. See
  **Verified: Image Model and Reference-Image Support** below.
- **Endpoint:** `POST https://openrouter.ai/api/v1/images`
- **Key:** `OPENROUTER_API_KEY`, sent as `Authorization: Bearer …`
- **Docs:** https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- **Client:** plain `fetch` in `lib/image-provider.ts`. No SDK — see **Stack**.

**One endpoint for both surfaces.** This is the structural simplification in
this revision. The OpenAI API split text-to-image (`/v1/images/generations`)
from image-and-text-to-image (`/v1/images/edits`), with different content types
for each. OpenRouter has a single route, and the *only* difference between a
sheet request and a panel request is whether `input_references` is present. So
one function covers both, and the kernel stops being a different endpoint and
becomes a single extra field.

**Sheet — no references.** Text to image, from the DNA. Landscape, because a
model sheet is a row of poses.

```ts
{ model: IMAGE_MODEL,                  // openai/gpt-image-2.5-sunburst
  prompt: sheetPrompt(dna),
  aspect_ratio: SHEET_ASPECT,          // 3:2
  quality: SHEET_QUALITY,
  n: 1 }
```

**Panel — one reference.** This is the kernel. Same endpoint, same JSON body,
plus the locked sheet as a base64 data URI and the panel's own ratio from
**The Page Layout**:

```ts
{ model: IMAGE_MODEL,
  prompt: panelPrompt(dna, panel),     // locked DNA verbatim + framing + Claude's variable part
  aspect_ratio: panel.aspect,          // 3:2 or 1:1
  quality: PANEL_QUALITY,
  n: 1,
  input_references: [{
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${sheetPng.toString('base64')}` },
  }] }
```

- **`aspect_ratio`, never `size`.** There is no pixel-dimension parameter on
  this model through OpenRouter, and `size` is not in its passthrough list, so
  sending it is silently ignored rather than honored. This changed from the
  previous revision — see the verification section.
- **JSON, not `multipart/form-data`.** The reference travels as a data URI
  inside the body, so there is no `FormData` and no `Blob` anywhere in the
  image path. An HTTP(S) URL is also accepted, but the sheet is a local file,
  so base64 it is. Note this makes the request body roughly 4/3 the size of the
  sheet PNG — fine for one reference, worth remembering if that ever grows.
- **`input_fidelity` cannot be sent, so there is nothing to get wrong.** It was
  a `gpt-image-1.x` parameter, and OpenRouter passes through only `moderation`
  for this model. Face preservation is the model's default behavior.
- Responses are **base64 (`b64_json`), never a URL**, which is exactly why
  `lib/images.ts` exists: decode once, write the file, keep only the id. Each
  item also carries a **`media_type`**, which is what picks the file extension.
- Responses carry **`usage.cost`** — the real dollar cost of that one call.
  Log it per generation; it is a better source of truth than any table in this
  document, and it is what the *"Images this chapter: N"* counter could become
  if a running total is ever wanted.
- Every panel prompt ends with an explicit **no text, no speech bubbles, no
  sound effects** instruction — `scope.md > Lettering`.
- Both the model and the two quality levels are `.env`-configurable, so the
  build runs at `low` and only filming pays for `max`/`high`.

**`402` is the error that matters here.** OpenRouter returns it when the
balance is at or below **$1**, and it is the one failure that will hit every
image call at once rather than one panel unluckily. It gets explicit handling
in both directions — see **Important Failure Modes**.

---

## Verified: Image Model and Reference-Image Support

This resolves `scope.md > Needs Verifying in 4-spec` and the carried-over item
in `prd.md > Open Questions` — *"which GPT Image model and endpoint accept
reference images, and how many per request."* The whole kernel rested on it.

**Re-verified against OpenRouter on 2026-10-12**, because the provider changed
and the previous answer was about the OpenAI API. The check was
`GET /api/v1/images/models`, which returns each model's capabilities as data
rather than prose — so this is read off the API, not off a docs page.

**Reference images are supported, with room to spare.** `openai/gpt-image-2.5-sunburst`
publishes `input_references` as a range of **0 to 16**. Ink Desk sends exactly
**one** per panel request, so the limit is never in play.
`scope.md > The Unique Kernel` is buildable as written, and the kernel survives
the provider change unchanged in substance.

Verbatim from the model's `supported_parameters`:

| Parameter | Type | Values |
|---|---|---|
| `input_references` | range | `0`–`16` |
| `quality` | enum | `auto`, `low`, `medium`, `high`, `xhigh`, `max` |
| `aspect_ratio` | enum | `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `16:9`, `9:16`, `21:9`, `auto` |
| `background` | enum | `auto`, `transparent`, `opaque` |
| `n` | range | `1`–`10` |
| `output_compression` | range | `0`–`100` |

`allowed_passthrough_parameters` is `["moderation"]` — nothing else reaches
OpenAI untranslated.

### The one thing that changed shape: `size` → `aspect_ratio`

**There is no `size` parameter.** Quality came across unchanged — same five
paid names, same spelling — but pixel dimensions did not. The previous revision
passed `size: "1536x1024"`; this model through OpenRouter takes
`aspect_ratio: "3:2"` instead, and because `size` is not in the passthrough
list it would be **dropped silently** rather than rejected with a 400. That is
the dangerous version of a breaking change: everything would have kept working
and quietly returned the wrong shape.

The mapping is exact, which is why this was a rewrite rather than a redesign:

| Was | Now | Used for |
|---|---|---|
| `1536×1024` | `3:2` | sheets, panels 1 and 4 |
| `1024×1024` | `1:1` | panels 2 and 3 |
| `1024×1536` | `2:3` | unused, as before |

**The no-crop guarantee in `The Page Layout` survives**, because it was always a
statement about *ratios* matching slots, not about specific pixel counts. What
is genuinely lost is control over resolution: the provider picks it. That is a
new small unknown, and the kernel test now records the dimensions it actually
receives so it stops being unknown on day one.

### Model choice

**Chosen model:** `openai/gpt-image-2.5-sunburst`, for **both** sheets and
panels. `sunburst` is the precision tier and takes references;
`openai/gpt-image-2.5-flare` is the other 2.5 tier and is generation-only, so
it cannot carry a reference image at all.

**Same model for both surfaces** because the sheet is the reference the panels
are judged against. A sheet drawn by one model and panels by another would
differ in line weight and rendering style even with the face held steady —
exactly the mismatch `scope.md > What "Working" Looks Like` is testing for.

**`gpt-image-1` shuts down 2026-10-23; `gpt-image-1.5` on 2026-12-01.** The
"GPT Image model family" named in `scope.md > Model Providers` would have gone
dark during the hackathon. Both are out. OpenRouter still lists them; that does
not make them safe to build on.

> ### ⚠ The model is no longer pinned, and that is a real regression
>
> The previous revision pinned `gpt-image-2.5-sunburst-2026-09-08` — a dated
> snapshot — specifically so *"an upstream revision cannot change the art style
> mid-build."* **OpenRouter publishes no dated snapshot for this model.** The
> alias `openai/gpt-image-2.5-sunburst` is the only id available, so that
> protection is gone and cannot be recovered by configuration.
>
> **What this risks:** the art style shifting between the day a sheet is locked
> and the day the panels are drawn, which would look exactly like the kernel
> failing while actually being the model moving underneath it. The thing this
> project measures is the one thing the alias puts at risk.
>
> **How it is mitigated, given the build is days rather than months:**
>
> - **The sheet is an image on disk, not a prompt.** A restyled model is still
>   handed the same reference PNG, so drift is damped by the kernel itself —
>   this is softer than a pin, but it is not nothing.
> - **Re-run the kernel test before filming**, not just once at the start. It
>   is ~$0.08 and it is the canary: if `0-sheet.png` looks like a different
>   artist drew it, the model moved.
> - **Regenerate both sheets if the style shifts mid-build**, rather than
>   mixing a pre-shift sheet with post-shift panels. Mixed-era art is the one
>   outcome worse than restyled art.
> - **If style drift actually bites**, the escape hatch is calling OpenAI
>   directly for images, where the dated snapshot still exists. That is a
>   change to one file — `lib/image-provider.ts` is named for the provider
>   seam, not for OpenRouter — and this is the reason to keep that seam clean.

> **The text model stays pinned and stays on Anthropic directly.**
> `claude-sonnet-5-5` is confirmed on the official models page. Slice 1 probes
> both models anyway — not because they're doubted, but because a wrong ID or a
> bad key fails identically and confusingly, and `--probe-only` turns that into
> a two-second answer for about a cent instead of a confusing failure three
> stations into the build.

### Quality, Cost, and the `.env` Switch

**OpenRouter bills images per token, not per image.** This is the other thing
the provider change altered, and it makes the old per-image table no longer
quotable. Verified rates for this model:

| Billable | Rate |
|---|---|
| `output_image` | **$30** per million tokens |
| `input_image` | $8 per million tokens |
| `input_text` | $5 per million tokens |

Output tokens scale with quality and with pixel count, and OpenRouter does not
publish a token count per quality tier.

**Measured by the slice 2 kernel test**, from `data/kernel-test/manifest.json` —
these four are read off real `usage.cost` values, not derived:

| Image | Ratio | Quality | Measured | Returned size |
|---|---|---|---|---|
| probe dot | `1:1` | `low` | **$0.0060** | 1024×1024 |
| model sheet | `3:2` | `medium` | **$0.0114** | 1536×1024 |
| wide rooftop panel | `3:2` | `medium` | **$0.0242** | 1536×1024 |
| close-up panel | `1:1` | `medium` | **$0.0270** | 1024×1024 |
| | | **run total** | **$0.0687** | |

> ### ⚠ The cost table's *shape* was wrong, not just its numbers
>
> The estimate below assumed ratio is the main cost driver — that a `3:2` image
> costs ~1.5× a `1:1` one at the same quality. **The measurements say
> otherwise.** Two `3:2` images at the same quality cost **$0.0114 and
> $0.0242** — the same ratio and the same tier, a 2.1× spread. And the `1:1`
> close-up ($0.0270) cost *more* than either `3:2` image, inverting the
> assumption outright.
>
> **What actually drives cost is how much is in the picture.** The cheap one is
> the model sheet: three figures on a plain light background. The expensive ones
> are a rain-soaked neon close-up and a full neo-Osaka skyline. OpenRouter bills
> output image tokens, and a denser image is simply more tokens.
>
> **Consequence for budgeting:** a per-ratio grid cannot be accurate, so treat
> the unmeasured tiers below as order-of-magnitude only and expect panel costs
> to vary ~2× with scene complexity. Backgrounds are written by Claude into the
> panel prompt, so the app does not control this directly.

| Quality | `1:1` | `3:2` | Used for |
|---|---|---|---|
| `low` | **$0.0060** probe dot · **$0.0199** panel *(measured)* | **$0.0058** sheet · **$0.0190** panel *(measured)* | **development builds** |
| `medium` | **$0.0270** *(measured)* | **$0.0114–$0.0242** *(measured)* | **the kernel test** |
| `high` | ~$0.07 | ~$0.07–$0.11 | **panels**, filming |
| `xhigh` | ~$0.13 | ~$0.13–$0.19 | — |
| `max` | ~$0.29 | ~$0.29–$0.43 | **sheets**, filming |

Rows still marked `~` are the original derivation (old OpenAI per-image prices
scaled by ~1.4× for OpenRouter's $30/M rate) and have **not** been measured.
Re-measure before trusting any filming total; the kernel test prints
`usage.cost` on every run.

**Quality plan, unchanged:** sheets at `max` (only two per chapter, and each is
the canonical reference every panel is compared against — worth the spend),
panels at `high`.

**A full filming run**, with the ratios from **The Page Layout**:

| Images | Ratio | Quality | Subtotal |
|---|---|---|---|
| 2 sheets | `3:2` | `max` | ~$0.86 |
| 2 panels (1, 4) | `3:2` | `high` | ~$0.22 |
| 2 panels (2, 3) | `1:1` | `high` | ~$0.15 |
| | | **total** | **~$1.25** |

Plus ~$0.07–$0.11 per panel redraw, depending on which slot. The same run at
`low` throughout is about **$0.09** — the slice 5 live run measured
**$0.0190–$0.0199 per panel** at `low` for the four night-rooftop panels,
three times the $0.006 probe dot, which is scene density again; the two
sheets are ~$0.006 each. That ratio is still what makes iterating on prompts
affordable. `scope.md > The POC
Boundary` budgeted "roughly 6 images per full run"; that holds — the prices
moved, the count didn't.

> **The ~$1.25 total is still an estimate, and now a looser one.** Only the
> `low` and `medium` tiers have been measured, and the kernel test showed a
> ~2× spread *within* a tier driven by scene complexity. The four panels are
> night cityscapes — the expensive end of that spread. **Budget ~$2 for a
> filming run rather than ~$1.25**, and keep the ~$2.50 balance floor from
> **Balance, Rate Limits, and Concurrency**, which still holds.

**Roughly 40% more than the previous revision's ~$0.90**, for the same images.
That is the cost of the broker, and at these absolute numbers it is a rounding
error against the convenience of one account — but it is worth saying out loud
rather than letting the total quietly drift.

The full list lives in `.env.example`; these are the ones that change behavior:

```
IMAGE_MODEL=openai/gpt-image-2.5-sunburst   # alias — no snapshot exists
ANTHROPIC_MODEL=claude-sonnet-5-5           # pinned

IMAGE_SHEET_ASPECT=3:2          # a model sheet is a row of poses
IMAGE_PANEL_ASPECT_WIDE=3:2     # panels 1 and 4
IMAGE_PANEL_ASPECT_SQUARE=1:1   # panels 2 and 3

IMAGE_SHEET_QUALITY=low       # filming: max
IMAGE_PANEL_QUALITY=low       # filming: high
KERNEL_TEST_QUALITY=medium    # deliberately not low — see The Useful Unknown

PANEL_CONCURRENCY=2
GENERATION_TIMEOUT_MS=360000  # measured: slowest kernel-test call was 118.7s
```

> **The 180000 placeholder was too low, and that is a slice 2 finding.** The
> slowest call in the kernel test — the square close-up — took **118.7s at
> `medium`**, against a 180s placeholder. That is only 1.5× headroom, on a tier
> *below* the `high`/`max` used for filming, with `PANEL_CONCURRENCY=2` adding
> contention. A panel that finished normally would have been demoted to
> `failed` on camera. Set to **360000** (3× the measured slowest call).

`.env.example` ships with the **development** values, so a fresh clone builds
cheaply and only filming opts into the expensive ones.

### Balance, Rate Limits, and Concurrency

**Keep the balance above $1.** OpenRouter returns **402** at or below that
threshold, so the last dollar is unspendable. A filming run costs ~$1.25, which
means **~$2.50 of balance is the real floor for filming** and topping up to ~$3
beforehand is the cheap way to avoid discovering this on camera. The 402
handling is specified in **Important Failure Modes**.

**The OpenAI tier question is gone.** The previous revision tracked Build /
Launch / Grow images-per-minute ceilings and left confirming the tier as an
open item. OpenRouter does not expose a per-minute image ceiling for paid
models that way — spend is bounded by the account balance and by whatever
per-key limit is set in the dashboard. **One open question closes with this
change**, and a different one — watch the balance — replaces it.

**Panel concurrency: 2.** This resolves the open call in
`prd.md > Open Questions`. It was margin rather than necessity under the old
IPM limits and it still is, but it costs nothing, it keeps panels filling out
of order as `prd.md > Storyboard — The Main Studio` requires, and it keeps a
429 off camera. `sunburst` is the slower of the two 2.5 tiers; the pencil-sketch
placeholder states already cover that latency.

---

## Important Failure Modes

The places this will realistically break in front of someone. Behavior is
specified in `prd.md > States and Boundaries`; this is the mapping.

- **A panel request is rate-limited or times out (429 / timeout)** → the handler
  **retries once, silently**. If that also fails, the panel's status becomes
  `failed` and the frame shows *"Panel 3 didn't come back, the studio is busy"*
  with **Try again**. The other three panels are untouched.
- **The OpenRouter balance runs out (402)** → the panel goes to `failed` and the
  frame shows the **same** *"the studio is busy"* sentence with **Try again**,
  per `prd.md > Look and Feel`, which forbids raw error codes on screen. **The
  terminal says what actually happened**, because nobody debugging this should
  have to guess:

  ```
  ✗ OpenRouter returned 402 — out of credits.
    The balance is at or below $1, which is where OpenRouter stops serving.
    Top up at https://openrouter.ai/settings/credits and try again.
    A full filming run needs about $2.50 of headroom.
  ```

  This is the one failure mode that is **not per-panel**: a 402 fails all four
  panels and both sheets alike, so the calm UI message is honest but
  incomplete, and the terminal is the only place the real cause appears. Worth
  knowing before spending ten minutes suspecting the queue. **Do not retry a
  402** — unlike a 429 it will not pass on its own, and the silent retry would
  just double the log noise.
- **The image model refuses a panel** → status `refused`, and the frame offers
  **Rewrite panel**, which asks Claude to rephrase **only** that panel's action,
  camera angle and background — never the dialogue, never the DNA — and retries.
  A refusal is a wording problem, not a waiting problem, so it gets a different
  button than a timeout.
- **A redraw fails** → the panel's **previous version stays on screen** and the
  message offers **Try again**. The panel reads `failed` — the failure is real
  and the data says so — but its version history is untouched, and the reader's
  gate keys on *having at least one version*, not on the status, so **Ink &
  Publish stays open** throughout. A failed redraw never leaves a panel empty,
  and the page is never less finished than it was. *(Revised in slice 6: the
  approved text said the status itself stays `done`; keying the gate on the
  history instead keeps the same behavior while letting the data record the
  failure — see `checklist.md > Revisions`.)*
- **The dev server restarts mid-generation** (the common one — every code change
  does it) → in-flight panels are orphaned, and the `startedByRun !==
  serverRunId` check demotes them to `failed` with **Try again** on the next
  read. See **Reload Mid-Generation**.
- **A model ID or a key is wrong** → every image call fails identically and
  confusingly. This is why build slice 1 is a single `--probe-only` call before
  any UI exists.
- **A request parameter is silently dropped** → the new one, and the quietest.
  OpenRouter passes through only `moderation`, so an unsupported field like the
  old `size` is ignored rather than rejected: images come back the wrong shape
  with a 200 and no complaint. The capability probe in slice 1 exists for this
  — it checks the configured ratios and quality against the model's published
  enums before anything is generated.
- **Claude returns a panel naming an unlocked or second character** → rejected
  by the `z.enum` of locked ids in the SDK's `messages.parse` (the API itself
  only sees the ids as description text — see the note under **Anthropic —
  Claude (text)**), surfaced as a retry of the script call rather than a
  broken page.

**No raw error codes on screen, ever.** Provider errors are logged to the
terminal in full; the browser gets a sentence.

---

## What Was Simplified and Why

- **A JSON file on disk instead of a database.** One chapter of one story is
  one object. A database would add a service, a schema migration story, and a
  connection string, and prove nothing about the kernel.
- **Files on disk instead of browser storage.** Also the honest option: 14
  images at filming quality is tens of megabytes, far past the ~5 MB
  `localStorage` ceiling, and base64 inflates it by a third again. The side
  benefit is the one that matters during the build — the images are in a folder
  you can open and compare.
- **Polling instead of a live connection.** The browser asks
  `GET /api/chapter` every ~1.5s while any panel is inking — and, since slice
  6, whenever the storyboard is open at all, because a redraw sits briefly in
  the queue before its panel reads `inking` and the poll is what sees the
  flip. Server-sent events would be tidier and are invisible on camera; a poll
  is a few lines and cannot get stuck half-open.
- **A CSS reveal instead of real pencil→ink generation.** Already decided in
  `scope.md > Explicitly Cut`: identical on camera, half the generations, and no
  second chance for the face to drift.
- **Derived gates and derived bubble placement instead of stored values.**
  Anything computable from the chapter is computed, so there is no second copy
  to fall out of sync.
- **No image cap in the app.** `prd.md > Product Decisions` chose a visible
  counter over enforcement at this size. The cap becomes required if deployment
  is ever revisited.

Nothing here fakes the kernel. The only seeded content in the whole app is the
pitch text behind **"Try the sample"**, which `prd.md > Story — The Pitch Desk`
specifies and which is labelled as a sample on screen.

---

## Changes Since Approval

This spec was approved before the build began. One thing changed after that,
recorded here rather than edited in silently.

### The image provider — OpenAI direct → OpenRouter

| | |
|---|---|
| **Was (approved)** | Images called on the **OpenAI API** with `OPENAI_API_KEY`. Model pinned to the dated snapshot `gpt-image-2.5-sunburst-2026-09-08`. Two endpoints: `/v1/images/generations` for sheets, `/v1/images/edits` for panels. Panel requests were `multipart/form-data` with the sheet attached as a file. Sizes passed as `size: "1536x1024"` / `"1024x1024"`. |
| **Now** | Images called on **OpenRouter** — `POST https://openrouter.ai/api/v1/images` — with `OPENROUTER_API_KEY`. Model is the alias `openai/gpt-image-2.5-sunburst`. **One** endpoint for both surfaces; a panel is just a request that carries `input_references`. JSON body throughout, with the sheet as a base64 data URI. Ratios passed as `aspect_ratio: "3:2"` / `"1:1"`. |
| **Why** | The learner's call. One account and one balance to manage instead of two, and `lib/image-provider.ts` keeps the swap to a single file if it ever needs reversing. |
| **Claude is unaffected** | Text stays on the Anthropic API directly with `ANTHROPIC_API_KEY`. Only images moved. |
| **Decided by** | The learner, after spec approval and before `5-build`. |

**Verified before anything was changed**, via `GET /api/v1/images/models` — the
instruction was to stop and report if reference images were unsupported:

- `input_references` is supported, **0–16**. Ink Desk needs 1. **The kernel
  survives the provider change.**
- `quality` carried over **unchanged** — same `low`/`medium`/`high`/`xhigh`/`max`.
- `size` **does not exist**; `aspect_ratio` replaced it. Found by the probe
  rather than by a failed build.

### What this cost, stated plainly

Three things got worse, and none of them were the reason for the change:

1. **The model is no longer pinnable.** OpenRouter publishes no dated snapshot,
   so the protection against mid-build style drift is gone. Mitigated by
   re-running the kernel test before filming. Fully detailed in the warning
   under **Verified: Image Model and Reference-Image Support**.
2. **Per-image cost is ~40% higher** — a filming run goes from ~$0.90 to
   ~$1.25 — and the cost table dropped from *published* to *estimated*, because
   OpenRouter bills per token and publishes no per-tier token count. One kernel
   test run fixes the second half of that.
3. **A new failure mode: 402 at $1.** It fails every image at once rather than
   one panel, and the UI's calm *"the studio is busy"* message cannot say so —
   only the terminal can.

Two things got better:

1. **One endpoint instead of two**, and no `multipart/form-data` anywhere. The
   kernel is now a single field rather than a different request shape.
2. **One dependency fewer** — the `openai` package is gone, since OpenRouter's
   body is not the OpenAI images body.

And one open question closed: the OpenAI tier / IPM ceiling no longer applies.

### Consequent edits to this document

`lib/openai-image.ts` → **`lib/image-provider.ts`** in **File Structure**; the
request diagrams in **The Core Journey Through the System**; **Stack**;
**The Page Layout** (sizes → ratios); **Image Writer** (extension now comes
from `media_type`); **External Services and Dependencies**; **Verified: Image
Model and Reference-Image Support**; the cost and rate-limit notes;
**Important Failure Modes**; and `.env.example`. `scripts/kernel-test.mjs` was
updated to match, and its slice 1 probe now leads with the capability check
that caught the `size` change.

---

## Decisions and Open Issues

### Decided

- **Images go through OpenRouter, not the OpenAI API.** Learner's choice, and a
  change after approval — recorded in **Changes Since Approval** below.
  Tradeoffs accepted: no dated snapshot to pin to, ~40% higher per-image cost,
  and a broker in the path. Bought: one account, one balance, and a provider
  seam that makes the next swap cheap.
- **Image model `openai/gpt-image-2.5-sunburst`, alias, for sheets and panels.**
  Forced by the `gpt-image-1` shutdown and by OpenRouter publishing no snapshot.
  Tradeoff accepted: style drift is possible mid-build, mitigated by re-running
  the kernel test rather than by configuration. It is also the slower of the two
  2.5 tiers, which the placeholder states already cover.
- **Claude stays on the Anthropic API directly.** Learner's choice. Only images
  moved; routing text through a broker would buy nothing.
- **One endpoint for both surfaces — `POST /api/v1/images`, with
  `input_references` present for panels and absent for sheets.** Derived from
  the verification, and simpler than the two-endpoint split it replaces.
- **`aspect_ratio` rather than `size`, because no size parameter exists.**
  Forced by the provider. `3:2` and `1:1` replace `1536×1024` and `1024×1024`
  exactly, so the no-crop guarantee is unaffected; resolution is now the
  provider's choice.
- **Sheets at `max`, panels at `high`, both `.env`-configurable.** Learner's
  choice, so development runs at `low` and only filming pays.
- **Text model `claude-sonnet-5-5`, pinned and `.env`-configurable.** The
  learner caught that `claude-sonnet-5` was superseded on 2026-09-28; the ID was
  corrected from the official models page, and structured-output support plus
  the sampling-parameter rejection were re-verified against the 5.5 family
  rather than inherited. Slice 1 now probes the text model too.
- **One 4-panel page layout with fixed per-panel ratios** — wide / two squares /
  wide, passed in each request and echoed as a framing line in each prompt.
  Learner's call. Chosen so a generated panel never has to be scaled into its
  slot, which is the one way to lose a face *after* the model got it right.
- **The model sheet is landscape `3:2`.** Learner's call: a sheet is a row of
  poses, so a square would crowd them or waste half the image.
- **Next.js App Router, TypeScript, both keys in server route handlers.**
  Learner's choice.
- **`update()` is serialized through one in-process lock, and the queue, lock
  and `serverRunId` live on `globalThis`.** The learner identified the
  lost-update race: with concurrency 2, two panels finishing together would both
  read-modify-write and the second write would erase the first, silently
  reverting a finished panel to a placeholder. Atomic rename does not prevent
  it. `globalThis` keeps hot reload from creating a second queue or a second
  lock. Route handlers declare `runtime = 'nodejs'`. This design is
  single-process by assumption — a fourth reason deployment is real work.
- **Server-side disk storage: `data/images/<id>.png` plus one
  `data/chapter.json`; the browser only ever sees `/api/image/<id>`.** Learner's
  choice. They confirmed *"same browser"* in the PRD meant no accounts and one
  chapter, not a storage mandate. Tradeoff accepted: this is a local-only
  design, and a deployed version would need real object storage.
- **Generation survives a reload, with a timeout-and-restart floor.** Learner's
  choice, and a change to the approved PRD — recorded in
  `prd.md > Changes Since Approval`. The learner identified the specific reason
  the floor is needed: Next.js restarts the dev server on every code change and
  kills in-flight requests.
- **Local only; deployment deferred, and tied to a server-side image cap if
  revisited.** Learner's choice.
- **Panel concurrency 2.** Learner's preference, carried from
  `prd.md > Open Questions`; margin rather than necessity at Build-tier limits.
- **Claude text calls use structured JSON output with `zod` schemas.**
  Implementation detail derived from the above, not a learner decision. It also
  turns the PRD's one-character-per-panel rule into something the API enforces.

### The Useful Unknown — does the lock actually hold?

The learner's stated learning goal in `learner-profile.md > Desired Learning
Outcome` is *"how to keep character art consistent across AI-generated panels."*
Verification settled the **mechanism** — `input_references` is supported up to
16, and face preservation is this model's default behavior.
It cannot settle the **result**: whether one sheet plus verbatim DNA actually
holds a face across a close-up *and* a wide shot. No documentation can answer
that; only a generation can.

**The agreed investigation, as build slice 2.** `scripts/kernel-test.mjs`
generates one Kaito sheet, then two panels from it — a close-up and a wide
shot — writes all three to `data/kernel-test/` with an `index.html` that puts
them side by side, and asks one question: *is this recognizably the same person,
same scar, same scarf, from both distances?*

Run at **`medium`**, at the learner's insistence and for a good reason: at
`low`, a drifted face could be the quality rather than the method, so the test
would prove nothing. About **$0.08** for all four images, at the same ratios the
real page uses.

**This runs before any UI exists.** If the kernel doesn't hold, that is worth
knowing on day one rather than after five stations are built on top of it. It
now produces three numbers besides the answer, each of which the spec above is
currently guessing at:

- **The slowest call's duration** — what `GENERATION_TIMEOUT_MS` gets set from.
- **The real `usage.cost` per image** — which turns the estimated cost table
  into a measured one.
- **The actual pixel dimensions** returned at `3:2` and `1:1` — unknown since
  `size` stopped being a parameter, and worth knowing before the CSS is
  written.

**Re-run it before filming as well**, not only on day one. Since the model is
an unpinned alias now, this run is also the style-drift canary — see the
warning in **Verified: Image Model and Reference-Image Support**.

### Open

- ~~**The generation timeout value.**~~ **Closed by slice 2.** Slowest call
  118.7s at `medium`; `GENERATION_TIMEOUT_MS=360000`. The `180000` placeholder
  was too low — see the note under **Quality, Cost, and the `.env` Switch**.
- ~~**The real per-image cost.**~~ **Measured for `low` and `medium`** —
  see the table in **Quality, Cost, and the `.env` Switch**. Replaced by a
  sharper open question: **cost varies ~2× with scene complexity within a
  single quality tier**, so a per-ratio grid can't be accurate, and
  `high`/`xhigh`/`max` are still unmeasured. Re-measure before filming.
- ~~**The pixel dimensions returned at `3:2` and `1:1`.**~~ **Closed by slice
  2:** `3:2` returns **1536×1024**, `1:1` returns **1024×1024** — exactly the
  pixel sizes the pre-OpenRouter revision used to request explicitly. Panel CSS
  can still be sized from the ratio, but the real numbers are now known.
- **Whether the alias restyles mid-build.** Unanswerable in advance and
  unpreventable by configuration. The mitigation is re-running the kernel test
  before filming; the escape hatch is calling OpenAI directly.
- ~~**The learner's OpenAI tier.**~~ **Closed by the provider change** — the
  Build / Launch / Grow IPM ceilings no longer apply. Replaced by: keep the
  OpenRouter balance above ~$2.50 before filming, since 402 starts at $1.
- **The exact Next.js version.** Whatever `create-next-app@latest` installs.
  Nothing here depends on a specific major.
- Carried from `prd.md > Open Questions`, none blocking: page script as its own
  rail entry vs. a step inside Storyboard (drafted as a step); genre and tone
  chip sets (assumed as the mockup has them); ink-in reveal timing in the reader
  (tune during build).
- **A server-side image cap** — not built, since the app stays local-only.
  Becomes required if deployment is revisited.

---

# Revision — Ink Desk Studio (v2)

**Date:** 2026-10-13. **Decided by:** the learner. **Implements:**
`prd.md > Revision — Ink Desk Studio (v2)` and
`scope.md > Revision — Ink Desk Studio (v2)`. Build order and verification
per slice live in `checklist.md` (slices 8–15).

## What Changes, In Plain Language (v2)

Still **one Next.js app**. Three things grow:

1. **The desk becomes a shelf of projects.** `data/chapter.json` becomes
   `data/projects/<id>/project.json`, one per project, each holding its style,
   its library and its chapters of pages. The v1 file is migrated into the first
   project the first time the dashboard reads it, and left where it was.
2. **The server gets two seams it did not have.** A *storage* seam
   (`lib/store/`) so the same code runs on local files or on MongoDB plus a
   bucket, and a *text-provider* seam (`lib/llm.ts`) so Claude is called first
   and GPT Terra through OpenRouter answers when Claude cannot.
3. **The page engine runs per page.** `lib/panels.ts`, `lib/script.ts`, the
   queue, the stale-inking floor, the bubbles and the repair UI are unchanged in
   behavior; they are addressed by `project / chapter / page / panel` instead of
   by panel index alone.

**The kernel, mechanically, is the same request** — the locked sheet as
`input_references[0]`, the DNA verbatim, Claude's variable part — with the
project's **style rules** in place of the one hard-coded `STYLE_RULES`, and,
for an imported character, the **uploaded bytes** as the sheet.

## Data Model (v2)

Shapes in `lib/types.ts`. `version: 2`. Everything derivable is still
computed, never stored (`lib/gates.ts` grows per-page gates).

```ts
type Project = {
  version: 2
  id: string
  title: string
  stylePresetId: StylePresetId      // locked at creation; see Image Models and Style Presets
  story: { mode: 'pitch' | 'scenario'; pitch: Pitch; synopsis: Synopsis | null;
           scenario: { text: string; notes: string; referenceAssetIds: string[] } | null }
  library: { characters: Character[]; assets: Asset[] }
  chapters: Chapter[]               // the UI shows one; the shape allows more
  usage: { images: number; costUsd: number }   // the budget readout, from usage.cost
  station: Station                  // 'story' | 'library' | 'director' | 'page' | 'reader'
  openPage: number
  serverRunId: string
  createdAt: string; updatedAt: string
}

type Asset = { id: string; kind: 'reference'; name: string; blobId: string;
               mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: number; createdAt: string }

type Character = /* v1 fields */ & {
  source: 'drawn' | 'imported'      // imported: sheetImageId is the asset's blob; Redraw sheet unavailable
}

type Chapter = {
  id: string; title: string
  plan: ChapterPlan | null          // written by the Director; editable
  cover: { brief: string; title: string; versions: PanelVersion[]; currentVersion: number;
           status: PanelStatus; startedAt: string | null; startedByRun: string | null } | null
  pages: Page[]
}

type Page = {
  index: number                     // 0-based within the chapter
  layoutId: 'four-shot'             // the v1 layout; the only one built
  panels: Panel[]                   // exactly 4, the v1 Panel shape, index 0..3
}

type ChapterPlan = { pageCount: number; coverBrief: string;
                     pages: { panels: PanelLine[] }[] }   // PanelLine = the v1 script line
```

**Migration (`lib/migrate.ts`):** a `version: 1` chapter becomes one project
(`title` = synopsis title or "Chapter 1", `stylePresetId: 'manga-bw'`, mode
`pitch`), one chapter, one page carrying the four v1 panels with their versions
and bubbles, `usage.images = imageCount`. Image files are **not moved**: every image,
v1 or v2, lives in the one `data/images/` folder — slice 8 kept it rather than
adding the `data/blobs/` folder plus a fallback path this section first
described (`checklist.md > Revisions`) — so the migrated project serves the
same bytes under the same ids. Verified by `check:store`.

**Where each piece lives** keeps the v1 table, keyed by project. Queue keys are
`${projectId}:${chapterId}:${pageIndex}:${panelIndex}` (and
`${projectId}:${chapterId}:cover`), so two pages can never collide and a redraw
on page 2 never dedupes against page 1.

## Storage Adapter (v2)

```ts
// lib/store/index.ts
interface Store {
  listProjects(): Promise<ProjectSummary[]>
  readProject(id): Promise<Project>
  updateProject(id, fn: (p: Project) => Project): Promise<Project>   // serialized per project
  createProject(p: Project): Promise<void>
  putBlob(bytes: Buffer, mediaType): Promise<string>                 // → blobId
  getBlob(blobId): Promise<{ bytes: Buffer; mediaType: string } | null>
}
```

- **`local.ts`** — today's `lib/chapter.ts` generalized: one promise-chain lock
  **per project id** on `globalThis`, temp-file-then-rename, `data/projects/`
  for state and `data/images/` for every image (slice 8 kept v1's one image
  folder instead of adding `data/blobs/` plus a fallback). The default: a
  clone runs with nothing but the two API keys.
- **`cloud.ts`** (built in slice 13) — `mongodb` driver, collection
  `projects`, one document per project: `{ _id: <project id>, rev, project }`,
  the project stored exactly as the local store would write it (a JSON
  round-trip, `ignoreUndefined`, so an absent bubble stays absent).
  `updateProject` is read → `fn` → `findOneAndUpdate({ _id, rev })` with
  `$inc: { rev: 1 }`, retried from a fresh read on a mismatch (5 attempts,
  jittered, then the calm "busy" failure); inside one process the
  per-project promise chain still serializes first, so `rev` only has work
  when a second process shares the database. `fn` must therefore be pure — a
  lost race runs it again. Blobs go to an S3-compatible bucket with
  `@aws-sdk/client-s3`, path-style addressing (AWS S3, Cloudflare R2, MinIO),
  keyed by the same `<kind>-<uuid>.<ext>` ids as the local desk. The bucket
  stays private; the browser only ever sees `/api/image/<id>` (there is no
  `/api/blob` — `checklist.md > Revisions`, slice 10), which reads from the
  bucket. One connection per process, kept on `globalThis` across hot
  reloads and keyed by the settings (an edited `.env` reconnects). Every
  connect proves what the studio will need before anything is paid for: a
  MongoDB ping, a read of `projects` and an upsert into a one-document
  `connect_check` collection (a user without `readWrite` on `MONGODB_DB` is
  refused by name), and a write and read-back of `inkdesk-bucket-check.txt`
  in the bucket (never an image id, so never served). A connection lost
  later is the same calm sentence. Cloud mode does **not** migrate the v1 `data/chapter.json`: its
  images are on this disk, not in the bucket; it stays on the local desk.
- **Selected by** `INKDESK_STORAGE=local|cloud` (unset = local; anything else
  is refused by name); cloud needs `MONGODB_URI`, `MONGODB_DB`, `S3_ENDPOINT`,
  `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. All
  server-side. `lib/store/env.ts` names them; `instrumentation.ts` refuses a
  cloud start with any missing, and the store refuses every call with the
  same sentence, so nothing ever lands on the local desk by accident. The
  cloud drivers load only in cloud mode (a dynamic import).
- **The queue stays in-process in both modes.** The single-process assumption
  of v1 holds (`Singletons and the Dev Server`); the stale-inking floor
  (`startedByRun`, `startedAt`) is what makes a restart safe, and it is
  unchanged. Cloud storage makes *data* durable and shareable; it does not make
  the app multi-instance, and `prd.md > Deferred (v2)` keeps deployment Later.
- **Honest limit:** `check:store` runs the cloud half only when `MONGODB_URI`
  is set (on a scratch database `<MONGODB_DB>-check-<random>`, dropped
  afterwards, and only the objects it wrote, deleted afterwards); the
  clean-clone check covers local, the switch, and the `rev` retry against a
  collection that loses races on purpose.

## Text Provider and the Terra Fallback (v2)

`lib/llm.ts` owns the one `ask()`:

```ts
ask<S extends z.ZodType>(schema: S, prompt: string, maxTokens: number,
                         opts?: { images?: { bytes: Buffer; mediaType: string }[] }): Promise<z.infer<S>>
```

- **Primary — Anthropic, unchanged:** `messages.parse` with
  `thinking: { type: 'between_tools' }`, `output_config: { effort: 'low',
  format: zodOutputFormat(schema) }`. Images, when given, are
  `{ type: 'image', source: { type: 'base64', media_type, data } }` content
  blocks ahead of the prompt — the DNA-from-picture call.
- **Fallback — OpenRouter chat completions, `LLM_FALLBACK_MODEL`
  (default `openai/gpt-5.6-terra`):** `POST /api/v1/chat/completions` with
  `response_format: { type: 'json_schema', json_schema: { name, strict: true,
  schema: z.toJSONSchema(schema) } }` and `provider: { require_parameters: true }`
  so routing only hits endpoints that enforce the schema; images as
  `image_url` data URIs. The reply's `content` is parsed and **validated with
  the same zod schema** — the SDK did that for Claude; here the app does it.
- **Strict-mode constraints** on the fallback side: every object
  `additionalProperties: false`, every property required, no `min`/`max`.
  `check:llm` runs `z.toJSONSchema` over every output schema and names any that
  would not survive strict mode; optional fields become nullable-required.
  *Built as (slice 9):* `strictJsonSchema()` in `lib/llm.ts` lowers the length
  and range keywords off the wire — zod still enforces them on the reply, as
  the Anthropic SDK does for Claude — and throws naming any optional property.
  The one schema lowered today is `PanelRewriteSchema` (three `minLength: 1`).
  The fallback also sends `reasoning: { effort: 'low' }` (the mirror of
  Claude's `effort: 'low'`) and `max_tokens` with 2048 tokens of reasoning
  headroom. See `checklist.md > Revisions`.
- **When the fallback fires** (`LLM_FALLBACK=auto`, the default): no
  `ANTHROPIC_API_KEY`; a 402; a 5xx/529/429 that survives the existing single
  retry. `always` forces it (for the live probe); `never` disables it.
  *Built as (slice 9):* the Anthropic client is now constructed with
  `maxRetries: 1` (the SDK's default is two), so "the single retry" is true; a
  dropped connection that survives it also falls back; a 400 or 401 does not
  (a bug or a bad key is not an outage). The fallback itself retries once, on
  a 429 / 5xx / no answer or a reply the schema refuses, never on a 402.
- **The terminal says which provider answered** on every call
  (`[text] synopsis — anthropic/claude-sonnet-5-5 · 1.8s` or
  `[text] synopsis — openrouter/openai/gpt-5.6-terra · 2.4s`); the browser's
  sentences do not change.
- **Verified 2026-10-13** (see *Verified for v2*): `openai/gpt-5.6-terra`
  lists `structured_outputs` and `response_format` in its supported parameters.

## Image Models and Style Presets (v2)

`lib/image-models.ts` is a registry read from OpenRouter's published
capabilities, so the request body is built **per model** from its parameter
list — the lesson of v1's silent `size` drop, generalized:

| Model | Params it accepts | Max references | Status |
|---|---|---|---|
| `openai/gpt-image-2.5-sunburst` | `aspect_ratio`, `quality`, `background`, `n`, `input_references` | 16 | **verified** (v1 kernel test) |
| `google/gemini-nano-banana-2.1` | `resolution`, `aspect_ratio`, `n`, `input_references` — no `quality` | 14 | candidate |
| `bytedance-seed/seedream-5-0-*` | `resolution`, `aspect_ratio`, `n`, `input_references`, `seed` | 14 | candidate |
| `black-forest-labs/flux-3-image` | `resolution`, `aspect_ratio`, `n`, `input_references` | 10 | candidate |
| `recraft/recraft-v4-styles` | `aspect_ratio`, `n`, `input_references` (1–10, style references) | 10 | candidate |

A candidate enters the app only if `scripts/kernel-test.mjs --model <id>`
passes before 2026-10-18 (`scope.md > Later (v2)`). Sending a parameter a
model does not list is refused by the registry before the request leaves.

**Style presets (`lib/styles.ts`)** — frozen rules text per project, in place
of the one `STYLE_RULES`:

| id | Rules (summary) | Colour | Reading |
|---|---|---|---|
| `manga-bw` | today's rules: black and white, screentone, inked line, strong blacks, no text | no | right-to-left, paged |
| `manhwa-colour` | full colour, clean digital line, soft cel shading, bright key light, generous vertical framing, no text | yes | vertical scroll |

Reserved ids, text written only if time allows: `manhua-ink`, `chibi`,
`western`. Rules never name a real work, artist or publisher.

**Candidate locks and their kernel tests.** A *style reference image* or a
*setting reference image* is sent as `input_references[1]` beside the sheet.
`kernel-test.mjs --style-ref <file>` and `--setting-ref <file>` draw one sheet
and **three panels at `medium`** each (≈ $0.10 per test) and write a
side-by-side `index.html`, like slice 2. A lock is called a lock in the docs
only after its test passes; until then it is a candidate and the app does not
expose it.

*Tested 2026-10-14, slice 15 — both passed,* judged by eye in the build
session and the learner's to confirm at the v2 final review:
`data/kernel-test/style-ref/` and `data/kernel-test/setting-ref/`, each with
its `index.html` and a `manifest.json` carrying the verdict and its notes. The
style reference held its style on the sheet and all three panels with the
face intact, with one caveat: its *subject* bled into the panels' backgrounds
although the prompt said not to copy it. The setting reference held its place
from three cameras with the face intact. A panel with two references cost
$0.037–$0.040 at `medium`, so a test costs ≈ $0.13–$0.14, not $0.10. Neither
lock is exposed in the app: that is a feature, and the freeze follows slice
15 (`checklist.md > Revisions`).

## Assets and Imported References (v2)

- `POST /api/projects/[id]/assets` — multipart via the Web standard
  `await request.formData()`; accepts `image/png`, `image/jpeg`, `image/webp`
  — judged by the file's own first bytes, never its name or label — up to
  **3.75 MB** (slice 10 lowered it from 8 MB to 5 MB for the vision limit of
  both text providers; slice 11's review lowered it again, because Claude's
  5 MB limit is measured on the base64 it receives — `checklist.md >
  Revisions`) and 24 per shelf; refuses anything
  else with a sentence; stores the bytes with
  `putBlob` and an `Asset` record on the project. `GET /api/image/[id]` serves
  it like any other stored image. An upload never counts as a generated image.
- **Import reference** on a character card: `importSheet(project, characterId,
  assetId)` sets `sheetImageId` to the asset's blob, `source: 'imported'`,
  `dna: null`; the server then calls `writeDnaFromImage` (Claude vision, or the
  fallback's `image_url`) with the character's text and the picture, and
  stores the DNA. Lock applies the v1 rule: DNA and sheet both present.
- The **rights notice** on the upload control is copy, not enforcement: the
  user must own or have permission for what they upload (hackathon rule on
  third-party material).

## The Director (v2)

- `chapterPlanSchema(lockedIds, pageCount)` — `pages` is a fixed-length tuple
  of `pageCount` pages, each the v1 `pageScriptSchema` shape (per-slot
  `z.enum` of the one character that slot takes, alternating), plus
  `coverBrief`. Page count is clamped **3–6** (open question in the PRD).
- `planPrompt(story, cast, style, pageCount)` — scenario text up to ~12 000
  characters is sent whole; longer text is first condensed by a `summarize`
  call to a beat list, and the plan prompt says it is planning from a summary.
- **Cost before spending** — `lib/cost.ts`, pure:
  `estimateChapterUsd(pageCount, quality)` = pageCount × 4 × the per-panel
  figure for that quality + the cover, from the measured `low` values and the
  spec's `high` estimates, labelled an estimate. Shown in the Director and in
  the New-project dialog.
- `POST /api/projects/[id]/plan` (write once; edits go through the patch route
  as `plan` edits), `POST .../pages/[n]/start` (queues that page's blank
  panels), `POST .../pages/[n]/panels/[i]` and `/rewrite` (the v1 routes, keyed
  per page), `POST .../cover` (one image: `coverPrompt(brief, cast, style)` with
  **both** sheets as references only if the two-character kernel test has
  passed; otherwise the lead character alone — the honest default).
- **The title on the cover is lettered by the app**, in Cormorant Garamond over
  the image, editable, composited into the PNG/PDF exactly like bubbles.
- *Built as (slice 11):* the plan's fixed length is named fields `page1` …
  `pageN` (as the page script has `panel1` … `panel4`), not a tuple — both
  strict grammars take closed objects, neither enforces `minItems`; and no
  `.describe()` on a page, which made the Anthropic SDK emit every panel line
  as a `$ref`. A page's plan lines become its panels on **Generate page**
  (`pages/[n]/start`); **Generate all** is `pages/all/start`, writing every
  unwritten page in one all-or-nothing write. The page-count stepper appends
  blank pages and drops only unwritten ones; "Ask the Director again"
  (`plan` with `replace`) only while no page is written. The cover is `2:3`
  (`IMAGE_COVER_ASPECT`) at the panel quality, three versions kept, and the
  stale-inking floor now runs chapter-wide, cover included. Up to four ticked
  references travel to the plan call as pictures. Text calls are metered into
  the project's spend. Details in `checklist.md > Revisions`.

## Routing and the Dashboard (v2)

- `app/page.tsx` → the dashboard (server component listing projects via the
  store; client islands for New project and the library).
- `app/p/[projectId]/page.tsx` → the studio: today's `Studio` client component,
  scoped to one project, with the patch/debounce/poll pattern unchanged.
- `app/api/projects/route.ts` (list, create), `app/api/projects/[id]/route.ts`
  (GET with stale-inking demotion, POST patch), and the per-project routes
  above; `app/api/image/[id]/route.ts` keeps serving every stored image —
  sheets, panels, and later covers and uploads — by id (slice 8 saw no reason
  for a second name; a `/api/blob` alias can come with the uploads).
- **Prerequisite before any routing code:** `npm install`, then read
  `node_modules/next/dist/docs/` as `AGENTS.md` requires — this Next version
  (16.4) has breaking changes; in particular confirm the shape of `params` in
  route handlers and pages, and the server/client component boundary for the
  dashboard. Nothing here assumes an API that has not been read first.

## Reader and Exports (v2)

- `ReaderStation` v2: cover page first, then pages; direction from the preset
  (`paged-rtl` with the v1 toggle, or `vertical`); the ink-in replay per page.
  Built in slice 12 as: **paged** for manga — one page at a time, right to
  left by default, turned with the page strip, the turn buttons or the arrow
  keys (in manga order "next" is the left); **vertical** for manhwa — every
  page in one full-width column (`pageGeometry(…, 'vertical')`), each inking
  in as it scrolls into view. The cover leads whenever the chapter has one —
  drawn, or a pencil with its title; an incomplete page is a pencil
  placeholder with its number. The desk view carries every page's panels
  (`Desk.chapterPanels`, derived) and `lib/reader.ts` walks the sequence for
  the reader, the gate and the PDF alike.
- **PDF** with `pdf-lib`, in the browser: each page is drawn by the existing
  `drawPage` onto a canvas (art + bubbles, `currentVersion`), encoded and
  embedded on a PDF page of the page's own proportions, 432 pt (6 in) wide —
  the 2:3 cover is 6 × 9 in; the cover gets the title text drawn the same way
  (`drawCover`, Cormorant Garamond, sized in proportion to the cover exactly
  as the screen's `cqw` sizing). Inside the PDF the pages are **JPEG at
  0.92**, not PNG: a composited page is ~9 MB as a PNG, so a six-page chapter
  would have been a 50–75 MB file (measured: 22.8 MB → 3.4 MB for a cover and
  two pages). The PNG export stays lossless. The PDF holds the drawn cover and
  every complete page; a right-to-left chapter sets the viewer preference
  `/Direction /R2L`. No server, no fonts to ship beyond what the page already
  loads. Chosen over print CSS because the output must be the same file on
  every browser and must include the composited bubbles.

## The Demo Video Pipeline (v2)

A separate package, `video/`, so the app's dependencies stay clean:

- **Remotion** compositions (`video/src/`): `Intro` (logo, animated title),
  `Section` titles and transitions, `Footage` (plays the captured footage with
  trim and speed-up ranges from `timeline.json`), `MoneyShot` (the upload /
  locked sheet beside its panels from pages 1–3 and the cover, animated), and
  `Outro`; brand tokens from `app/globals.css` copied into `video/src/theme.ts`.
  Rendered with `@remotion/cli` to `inkdesk-demo.mp4`, 1920×1080, h264 + aac,
  under three minutes. Remotion needs a browser to render; the pre-installed
  Chromium is passed with `--browser-executable`. **Licence:** Remotion is free
  for individuals and companies of up to three people; the README states it.
- **Capture** (`video/capture/record.mts`): Playwright drives the real app
  (viewport 1920×1080, `recordVideo`), on a seeded fresh project at filming
  quality; every generation is real, waits are time-lapsed in the edit, not
  faked; marks are written to `timeline.json` as the script runs.
- **Narration** (`video/narrate.mts`): the learner's script, split into
  segments, sent to `POST https://openrouter.ai/api/v1/audio/speech` with
  `model: 'elevenlabs/eleven-v4'`, a premade `voice`, `response_format: 'mp3'`;
  one mp3 per segment, cached, ≈ $0.10 in total.
- **Music:** royalty-free with a licence file in `video/assets/`, or none.
  Never a copyrighted track. *Revised 2026-10-14:* **composed by code** —
  `video/music/compose.mts` synthesizes an original ambient future-wave
  instrumental in Node (no audio dependency: a seeded generator, additive
  and subtractive synthesis in float, a one-pole low-pass, a feedback delay,
  a soft limiter), reading the edit so the arrangement follows the beats —
  pads alone under the intro, drums and arpeggio from the second beat,
  fullest on the pages and the money shot, thinner under the method beat,
  resolved and faded in the outro — and writes a 16-bit WAV, then
  `public/music/track.mp3` through ffmpeg (`libmp3lame`) with its
  `LICENSE.txt` (CC0, the repo's own work). Deterministic: the same bytes on
  every run. `npm run video:music`; the mp3 is rebuilt, not committed.
  *Same day:* OpenRouter turned out to serve a music model (see *Verified for
  v2*), so `video/music/generate.mts` is the second way — `google/lyria-3-pro-preview`
  from the mood prompt in `music/prompt.txt`, the streamed base64 mp3 saved
  under `out/music/` with a provenance note (model, date, prompt hash,
  length) and installed as `public/music/track.mp3` with a `LICENSE.txt`
  that says where it came from; `--install <file>` re-installs an earlier
  piece, `--dry-run` sends nothing. The key and the provider-message code are
  shared with `narrate.mts` through `video/openrouter.ts`. The learner picks
  by ear which of the two tracks ships; the review render carries the Lyria
  piece.
  Under the voice: `Demo.tsx` shapes the music's volume per frame
  (`src/mix.ts`, pure) — a fade-in, a base level, a duck while any narration
  clip plays, a fade-out over the last three seconds.
- **Subtitles:** burned-in English captions from the same script.
- **Committed:** the compositions, `timeline.json`, the script, the capture
  and narration scripts, the licence notes. **Not committed:** the captured
  footage, the mp3s and the rendered mp4 (sizes); the mp4 is uploaded to YouTube,
  public, and linked from the submission.
- *Built as (slice 14):* the edit is data — `video/src/cut.ts` (eight beats,
  170 s budgeted), `timeline.ts` (the sixteen marks the capture writes, and
  `resolvePlan`: a span that overruns its budget is time-lapsed to fit, never
  slowed, and labelled on screen with the real time it covers; a mark not yet
  captured is a slate of its budget) and `script.ts` (`narration.md`, one
  `## <beat>` section each, is both the narration and the captions).
  `prepare.mts` runs before every render, resolves frames into
  `out/props.json`, and lists what is still draft — the render carries a DRAFT
  stamp until nothing is. **The capture is not `recordVideo`:** it drifted
  (+29 s over a four-minute test capture) and encoded soft VP8, so
  `capture/screencast.mts` pipes a Chromium screencast (CDP, JPEG q92) into
  ffmpeg at a constant 30 fps h264 on its own clock — footage time is wall
  time and a mark is exact by construction; `capture/clock-check.mts` proves it
  for free. Playwright still drives the app. The footage is
  `public/capture/footage.mp4`. Narration is cached by words + voice + model
  and has no default voice (`--samples` writes all twelve to choose from).
  Fonts are the three OFL families as local files in `public/fonts/`. Every
  render carries an aac track (`--enforce-audio-track`), silent until
  narration exists. Music: none for now.
- *Revised 2026-10-14 (the learner's word: "the video has no voice-over"):*
  the edit is **nine beats, 177 s** — a `method` shot kind and
  `src/Method.tsx` ("Planned before built": the scope, the PRD and the spec
  as three sheets, then the slices) between the reader and the outro, the
  other beats trimmed to make room under the 180 s rule; the narration
  script is drafted by the AI partner into `narration.md` (the learner's to
  rewrite) and recorded with `elevenlabs/eleven-v4` in `george`; the music
  is composed by code (above) and ducked under the voice. Sync is held by
  construction: every clip starts 0.4 s into its beat, `narrate.mts` and
  `prepare.mts` report any clip longer than its beat's room before a render,
  and the captions are timed from the measured clip. Every clip is leveled
  once saved — EBU R128 measured, one linear gain to −16 LUFS, a limiter
  under −2 dBTP — so the mix constants in `src/mix.ts` (0.3 between lines,
  0.12 under one) mean the same on every beat. The mp3s, the track and
  the render stay uncommitted; the commands rebuild them.

## Verified for v2 (2026-10-13)

Read off OpenRouter's APIs and documentation, not from memory:

- `GET /api/v1/models` lists `openai/gpt-5.6-terra` (also
  `~openai/gpt-terra-latest`, `openai/gpt-5.6-terra-pro`): 1.05 M context,
  $2 / $12 per million tokens, `structured_outputs` and `response_format` in
  `supported_parameters`. `anthropic/claude-sonnet-5.5` is listed too ($2 /
  $10), a second possible fallback with no SDK.
- Structured outputs on chat completions: `response_format.type =
  'json_schema'` with `json_schema.{name, strict, schema}`; support is per
  endpoint, so `provider.require_parameters: true` is the guard.
- `POST /api/v1/audio/speech` exists (OpenAI-compatible), body
  `{ model, input, voice, response_format: 'mp3' | 'pcm', speed?, instructions? }`,
  raw audio back, `X-Generation-Id` header. ElevenLabs models on it:
  `elevenlabs/eleven-v4` ($0.00004/char, 10 000 chars per request),
  `elevenlabs/eleven-v4-turbo` and `elevenlabs/eleven-flash-v2.5`
  ($0.00002/char), `elevenlabs/eleven-multilingual-v2`; premade voices by name
  (`george`, `sarah`, `adam`, `alice`, `bella`, `bill`, `brian`, `charlie`,
  `daniel`, `jessica`, `roger`, `will`). Listed by
  `GET /api/v1/models?output_modalities=speech`.
- `GET /api/v1/images/models` (59 models) — the capability table under *Image
  Models and Style Presets*; `openai/gpt-image-2.5-sunburst` is the only one
  with a `quality` parameter among the candidates.
- `GET /api/v1/videos/models` exists (Veo 3.1, Kling 3, Seedance 2, Wan 3,
  image-to-video via `supported_frame_images`) — noted for Later only.
- *Added 2026-10-14, read off `GET /api/v1/models` and one live call:*
  OpenRouter serves a **music model** — `google/lyria-3-pro-preview` (a
  full-length song, flat **$0.08 per song**) and `google/lyria-3-clip-preview`
  (a 30 s clip, $0.04), output modalities `text + audio`, through the ordinary
  `POST /api/v1/chat/completions`: `modalities: ['text', 'audio']`,
  `audio: { format: 'mp3' }`, and **`stream: true` is required** (a plain
  request is refused with "Audio output requires stream: true"). The mp3
  arrives base64 in `choices[0].delta.audio.data` chunks; the text channel
  carries section markers; `usage.cost` closes the stream. One Pro call
  returned a 175 s stereo 44.1 kHz mp3 (max −0.1 dB, mean −14.3 dB) in about
  a minute. Not deterministic — every call is a new piece, and the piece
  brings its own ending (both songs fade over their last fifteen seconds), so
  the install step measures the tail and says when the music is already quiet
  under the outro. Terms for generated output: the service's; recorded as an
  open question for the learner to confirm before publishing.
- In this build environment: ffmpeg, Playwright 1.56.1 and Chromium are
  present; the project's `node_modules` had to be installed (`npm install`,
  366 packages, 16 s).

## Quality, Cost and Budget (v2)

The learner's cap for everything until the deadline: **≈ $10.**

| Item | Estimate |
|---|---|
| Development at `low`: ~4 one-page runs + sheets, slices 8–12 | ≈ $1.00 |
| Slice 11 live plan + page 1 at `low`; slice 12 export run | ≈ $0.20 |
| Two presets, one page each at `low` | ≈ $0.20 |
| Candidate-lock kernel tests, style + setting, 3 panels at `medium` each | ≈ $0.25 — measured 2026-10-14: $0.14 + $0.13, plus $0.02 for the two reference plates |
| One alternative image model, `kernel-test --model` (optional; price unpublished) | ≤ $1.00 |
| Filming: 2 sheets + 8 panels + 1 cover at `high`, with a redraw or two | ≈ $2.00 — measured 2026-10-14: **$0.96** for 1 sheet, 12 panels, 1 cover and 1 redraw at `high` (a 3:2 panel $0.056, a 1:1 panel $0.067) |
| Text, all calls, Claude or Terra | ≈ $0.30 |
| Narration, ElevenLabs via OpenRouter, with retakes | ≈ $0.15 |
| Music — composed by code ($0) or generated by Lyria 3 through OpenRouter ($0.08 a song, $0.04 a clip; three pieces so far) | ≈ $0.20 |
| **Total** | **≈ $5–6**, margin ≈ $4 |

Development stays at `low`; `high` only in the filming `.env`. The dashboard's
budget readout sums the providers' reported `usage.cost` so the number is read,
not reconstructed.

## Important Failure Modes (v2)

The v1 list holds per page. Added:

- **Claude unavailable** (no key, 402, persistent 5xx) → the Terra fallback
  answers; terminal names it. Both unavailable → the v1 calm config sentence.
- **A fallback reply that fails the schema** → refused and retried once on the
  fallback, then the calm sentence; never written to the desk.
- **An upload that is too large or not an image** → a sentence on the shelf;
  nothing stored.
- **A migration that cannot parse the v1 file** → the dashboard opens empty
  with a sentence naming the file, and the file is never modified.
- **Cloud mode without its env** → refused at startup with the missing names;
  the app does not silently fall back to local.
- **A parameter a model does not support** → refused by the registry before
  the request leaves; never a silent 200 of the wrong shape.
- **The Director's plan references an unlocked character or two in a slot** →
  rejected by the schema (SDK or app-side), as v1.

## File Structure (v2)

```
app/page.tsx                       # dashboard
app/p/[projectId]/page.tsx         # the studio for one project
app/api/projects/route.ts          # list · create
app/api/projects/[id]/route.ts     # GET (stale demotion) · POST patch · DELETE
app/api/projects/[id]/{synopsis,scenario,cast,cast/reroll,sheet,import,assets,plan,cover}/route.ts
app/api/projects/[id]/pages/[n]/{start,panels/[i],panels/[i]/rewrite}/route.ts
app/api/image/[id]/route.ts        # any stored image: sheet, panel, cover, upload — from data/images or the bucket
instrumentation.ts                 # refuses a cloud start with missing settings, by name
components/Dashboard.tsx · NewProjectDialog.tsx · AssetShelf.tsx · DirectorStation.tsx · PagePlanCard.tsx · PageSwitcher.tsx
lib/types.ts (v2) · lib/migrate.ts · lib/store/{index,env,local,cloud}.ts · lib/llm.ts · lib/image-models.ts · lib/styles.ts · lib/cost.ts · lib/plan.ts
scripts/{llm,assets,plan,demo-timeline}-check.mts; store-check and export-check extended; kernel-test.mjs gains --style-ref, --setting-ref and --out (slice 15; --model was never needed: no alternative model was tried, see Decisions and Open Issues (v2))
video/                             # Remotion package, capture, narration and music scripts (music/{compose,generate}.mts, openrouter.ts, src/Method.tsx, src/mix.ts)
data/projects/<id>/project.json · data/images/ (every image, v1 and v2) · data/chapter.json (the v1 desk, read once, never written)
```

New dependencies, pinned at install: `mongodb`, `@aws-sdk/client-s3`
(server, cloud mode only), `pdf-lib` (browser export); in `video/` only:
`remotion`, `@remotion/cli` (4.0.531), with `react`/`react-dom` (their peers)
and `playwright` (1.56.1, the capture — in `video/` rather than the app's
devDependencies, so the app's stay clean). No other additions.

## Checks (v2)

Same pattern as v1 (scratch folder, `INKDESK_DATA_DIR`, dynamic imports,
`fetch` stubbed; Claude never called):

| Check | Asserts |
|---|---|
| `check:store` (extended) | v1 → v2 migration keeps every image id and bubble; two projects update independently; same-tick updates both land; cloud half only with `MONGODB_URI` |
| `check:llm` | fallback on missing key / 402 / 529-after-retry; strict JSON-schema body; every output schema survives `z.toJSONSchema` strict; malformed reply refused; `never` → config sentence |
| `check:models` | body built from the model's parameter list; unsupported param refused; reference cap enforced; the two presets' rules reach the prompt verbatim |
| `check:assets` | type and size caps; blob + record written together; import sets the sheet and leaves DNA null; lock still refused without DNA; imported bytes are the panel reference |
| `check:plan` | schema refuses < 3 pages or a wrong slot; cost estimate arithmetic; queue keys include project and page; `Generate all` idempotent; one page's failure isolated |
| `check:export` (extended) | PDF has cover + N pages at page size; RTL and vertical geometry; gate opens on the first complete page |
| `check:demo-timeline` | marks → segments; total under 180 s; every segment has a caption |
| `kernel-test.mjs` | unchanged live probes; `--style-ref` and `--setting-ref` run a candidate-lock test (one sheet, three panels at `medium`, `[sheet, reference]` on every panel); `--out` keeps a re-run beside the day-one evidence (`--model` was never built: no alternative model was tried) |

## Decisions and Open Issues (v2)

### Decided

- **Projects, chapters, pages as the model; one layout.** Learner's call; the
  shape allows more layouts and volumes, the build adds none.
- **Local files default, cloud behind the same interface.** Learner's call —
  the clone must run; Mongo and a bucket are their stack and a switch.
- **Claude first, GPT Terra through OpenRouter as fallback, same schemas.**
  Learner's call; verified available.
- **Style presets as frozen rules text; style and setting reference images as
  candidate locks until tested.** Learner's rule; the video claims only
  proven locks.
- **Imported sheets get their DNA from the picture.** Keeps the frozen pair
  consistent by construction, the v1 argument.
- **Cost estimate before generation, from measured values.** The Director's
  first job.
- **Remotion for the video, Playwright for capture, ElevenLabs via OpenRouter
  for narration, in `video/`.** Learner's call; the edit is code in the repo.
- **Feature freeze 2026-10-20; `v1-poc` is the fallback submission.**

### Open

- **The strict-schema shape of the v1 output schemas under `z.toJSONSchema`.**
  Answered by `check:llm` in slice 9, not by reading.
- **Whether Next 16.4's route-handler `params` and server/client boundaries
  match what the file structure above assumes.** Answered by reading
  `node_modules/next/dist/docs/` at the start of slice 8.
- **Whether a candidate lock (style, setting) holds.** Answered by its
  kernel test in slice 15, for ≈ $0.10 each. *Answered 2026-10-14: both held
  (the style reference with its subject bleeding into the backgrounds), at
  $0.14 and $0.13 — see Image Models and Style Presets (v2). Neither is
  exposed in the app.*
- **Whether one alternative image model is worth adding before 2026-10-18.**
  Answered by `kernel-test --model`, budget-capped at $1. *2026-10-14: none
  was tried and `--model` was not built; slice 15 is the last feature slice,
  so this closes as "no" unless the learner reopens it before the freeze.*
- **The exact Remotion version and its browser flags.** Checked at install in
  slice 14.

---

# Revision — Ink Desk Studio v3 (public, on the learner's domain)

> **Approved 2026-10-14** — the learner's word: *"start with slice 16"*. Implements `prd.md > Revision — Ink Desk Studio v3`, from `scope.md > Revision — Ink Desk Studio v3`. Everything above stays the record of v1 and v2. The facts below marked *verified* were read off the live APIs, the installed packages and the providers' docs on 2026-10-14 — not from memory; no paid call was made to gather them.

## Changes Since Approval

Against the approved v2 spec:

1. **Where it runs** — from "local only; cloud is a switch, the demo runs local" to **Railway, two services from `main`**: `web` (`next start`) and `worker` (a Node process). One replica each.
2. **Storage** — from "local by default, Mongo + one bucket switchable" to **MongoDB as the source of truth in production** and **two private R2 buckets** (`S3_BUCKET_PROJECT_FILES` for images and uploads, `S3_BUCKET_COMPILE_OUTPUTS` for videos, audio and exports), served through short-lived signed URLs. The local adapter stays for development and the checks.
3. **The queue** — from an in-process FIFO with a `serverRunId` floor and a per-project promise-chain lock on `globalThis` (all of which stop protecting anything once web and worker are separate processes; confirmed as CR-1, CR-3) to **BullMQ on Redis**, with Mongo `jobs` as the record of status and results.
4. **Auth** — none to **Clerk** (`@clerk/nextjs` Core 3), a `proxy.ts` gate, and a **data-access layer** that checks the owner next to every read and write.
5. **Limits** — none to Redis sliding windows, daily quota counters, a per-user spend reservation and a global kill switch.
6. **New surfaces** — share pages, reports, settings, usage, Terms/Privacy, health, the Animate pipeline.
7. **Security baseline** — the pre-build audit (`devpost/security-report.md`, 15 security and 18 stability findings, every one confirmed by an adversarial verifier) is part of the plan: each finding is closed by a named slice.
8. **Text model id** unchanged; **image model** unchanged; **video** `bytedance/seedance-2.0` and **speech** `elevenlabs/eleven-v4` join, all through OpenRouter.

## How This Works, In Plain Language (v3)

A visitor opens the domain. The **web** service answers: if they are not signed in, Clerk's sign-in screen; if they are, their dashboard, built from **Mongo** — their projects, videos and quota. Every request the browser makes carries the Clerk session; the server asks "who is this?" and then reads only that user's records. When they press a button that costs money, the web service first asks **Redis** "is this user under their limit, and is the whole site under today's spend cap?", reserves the estimated cost, writes a **job** record in Mongo and puts the job on a **BullMQ** queue — then answers immediately. The **worker** service picks the job up, calls OpenRouter (an image, a Seedance shot, a voice line), stores the file in the **bucket**, writes the result and the real cost to Mongo, and settles the reservation in Redis. The browser polls the job records and shows progress. To show a file, the server hands the browser a signed URL that works for a few minutes. To share, the owner creates a snapshot with an unguessable token; anyone with the link sees that snapshot and nothing else.

## Where It Runs and How Someone Tries It (v3)

**Production (Railway, deployed from `main`):**

| Service | Start | Needs |
|---|---|---|
| `web` | `npm run build && npm run start` | Mongo, Redis, the buckets, Clerk, OpenRouter (text only — estimates and vision calls stay synchronous only where they already are), the health check on `/api/health` |
| `worker` | `npm run worker` (`tsx worker/index.ts`, or the compiled file) | Mongo, Redis, the buckets, OpenRouter, **ffmpeg in the image** (nixpacks `aptPkgs = ["ffmpeg"]` or a Dockerfile) |
| `redis` | Railway's Redis template | private network only: `redis.railway.internal` (verified: Railway exposes `REDIS_URL`) |
| `mongo` | the existing Mongo service, **on the private network** (`*.railway.internal`), not the public `rlwy.net` proxy with `DB_SSL=false` | |

Railway health checks: a `2xx` on the configured path within 300 s by default (`RAILWAY_HEALTHCHECK_TIMEOUT_SEC` to change), from the host `healthcheck.railway.app` — which the host allow-list and the proxy must accept (verified, Railway docs). One replica per service: no rolling overlap matters once jobs are leased, but two web replicas are not needed for this audience.

**Development:** `npm run dev` with `INKDESK_AUTH=off` (single local owner, no account, local files) — the path every `check:*`, the Playwright capture and CI use; or with Clerk development keys for real sign-in. `npm run worker` in a second terminal when Redis is available; with `INKDESK_QUEUE=inline` the web process runs jobs itself, for the checks.

**What the judges open:** `https://<your-domain>` — sign in with the judge demo account from the Devpost testing instructions (the learner writes them), or sign up.

## Domain and DNS (v3)

*Verified against Railway's and Clerk's current docs. The exact targets are generated per project and are shown in each dashboard — copy them from there, never from here.*

**Railway, on the `web` service → Settings → Networking → Custom domain:**

| Record | Name | Value | Note |
|---|---|---|---|
| `CNAME` (apex: CNAME flattening or `ALIAS`) | `@` | the target Railway shows, e.g. `xxxx.up.railway.app` | Railway supports CNAME flattening (Cloudflare) and dynamic ALIAS (DNSimple, Namecheap CNAME at root). Plain `A` records are not offered. |
| `TXT` | the name Railway shows | the value Railway shows | **Required** — without it the domain returns 404 even when the CNAME resolves. |
| `CNAME` | `www` | the target Railway shows for `www` | **On the Trial plan only one custom domain is allowed**, so `www` and the apex cannot both be added; on a paid plan add `www` and redirect it to the apex in the app (`proxy.ts`, 308). |

If DNS is on Cloudflare: the Railway records may be proxied once verified, with SSL mode **Full**; the verification CNAME must be **DNS only** during verification.

**Clerk production instance** (Dashboard → Domains): Clerk lists the records for the instance — typically `CNAME clerk.<domain>` (Frontend API), `CNAME accounts.<domain>` (Account Portal), and the email records (`clkmail.<domain>` and two DKIM `CNAME`s) that make sign-in emails come **from the domain**. On Cloudflare these must be **DNS only** (Clerk's check fails behind the proxy). No `CAA` record on the apex may block Let's Encrypt or Google Trust Services. Propagation can take up to 48 h — **start this first**. Restrict the Frontend API's allowed subdomains (Clerk's subdomain allowlist).

**OAuth apps for production** (development keeps Clerk's shared credentials): a Google OAuth client and a GitHub OAuth app, each with the **Authorized redirect URI / callback URL that Clerk's dashboard shows** for the production instance; the Google consent screen published "In production" (basic scopes — `openid`, `email`, `profile` — normally publish without the full verification review, but check on day one). Block email subaddresses for Google sign-ups (Clerk recommends it).

**The bucket (R2):** CORS allows `GET` and `PUT` from `APP_URL` (and `http://localhost:3000` in development) only; no public bucket access; signed URLs only.

## Environment and Configuration (v3)

One module (`lib/config.ts`) reads every variable once, validates it with zod at boot, and fails fast with a sentence naming the missing or malformed variable — never its value. **The learner's variable names are mapped, not renamed:**

| The app needs | This environment has (names only) | Status |
|---|---|---|
| Mongo connection | `DB_URL` (a `mongodb://` URL on `rlwy.net`) | mapped: `MONGO_URL = DB_URL`. **Open question:** these look like another app's variables (see below). `DB_PORT` is an unresolved `${{Postgres.PGPORT}}` reference — not used. |
| Mongo database name | `DB_DATABASE` | mapped |
| Redis | — | **missing**: add Railway Redis; it provides `REDIS_URL` |
| Buckets | `S3_BUCKET_PROJECT_FILES`, `S3_BUCKET_COMPILE_OUTPUTS`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | all used (v2 read only one `S3_BUCKET` and hard-coded path style — fixed) |
| Clerk | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` | the SDK reads `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, **not** `CLERK_PUBLISHABLE_KEY` (verified in `@clerk/nextjs` 7.9.15's source): add it with the same value, or the config passes `publishableKey` explicitly; `CLERK_JWT_KEY` is passed explicitly as `jwtKey` (the SDK does not read it) |
| The URL | `APP_URL` (points at another app's domain today) | `APP_URL` + `NEXT_PUBLIC_APP_URL` — **must be set to the Ink Desk domain** |
| OpenRouter | `OPENROUTER_API_KEY` | unchanged |
| Anthropic | — (`ANTHROPIC_API_KEY` unset; Terra fallback answers) | unchanged; set it on Railway for Claude |

**Open question for the learner (blocks slice 16):** `APP_URL`, `ADMIN_URL`, `COMPILE_WORKER_URL`, `FRONTEND_API_URL`, `JWKS_URL`, the buckets' names and the Postgres reference all point at another app's project. If they belong to another app, Ink Desk would share that app's Clerk users, its bucket and its database. **Ink Desk needs its own Clerk application, its own buckets (or a dedicated prefix with its own scoped key), and its own database** unless the learner confirms these are Ink Desk's. `RAILWAY_TOKEN` is also present; the build never uses it without the learner's explicit word.

**Variables per Railway service** (names only; values in Railway, never in files):

- **web:** `NODE_ENV=production`, `APP_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, `DB_URL`, `DB_DATABASE`, `REDIS_URL`, the eight `S3_*`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` (optional), `ANTHROPIC_MODEL`, `IMAGE_MODEL`, `LLM_FALLBACK`, `LLM_FALLBACK_MODEL`, the `IMAGE_*` sizes and qualities, `INKDESK_STORAGE=cloud`, `INKDESK_QUEUE=bullmq`, `ALLOWLIST_EMAILS`, `ADMIN_EMAILS`, `GLOBAL_DAILY_USD_CAP=5`, `GLOBAL_TOTAL_USD_CAP` (proposed, see Budget), the per-plan quota numbers, `VIDEO_ENABLED`, `SHARE_ENABLED` (feature flags).
- **worker:** `NODE_ENV`, `CLERK_SECRET_KEY` (deleting an account deletes its Clerk user; the worker refuses to boot in clerk mode without it, and a deletion ends `failed` with nothing changed if it is missing), `DB_URL`, `DB_DATABASE`, `REDIS_URL`, the eight `S3_*`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` (optional), the model and quality variables, `VIDEO_MODEL=bytedance/seedance-2.0`, `VIDEO_RESOLUTION=720p`, `TTS_MODEL=elevenlabs/eleven-v4`, `MUSIC_MODEL`, `QUEUE_CONCURRENCY_IMAGE=2`, `QUEUE_CONCURRENCY_VIDEO=1`, `GLOBAL_DAILY_USD_CAP`.

## Components (v3)

### Config and Boot (v3)

`lib/config.ts` (zod, server-only), `instrumentation.ts` calls it on boot; production refuses to start with `INKDESK_AUTH=off`, without Clerk keys, or without Mongo/Redis/buckets. Implements `prd.md > Status and Health (v3)`.

### Auth (v3)

`proxy.ts` at the repo root (Next 16 renamed `middleware` to `proxy`; it always runs on Node — *verified* in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`): `clerkMiddleware({ publishableKey, jwtKey, authorizedParties: [APP_URL] })`, an **optimistic** redirect of signed-out page requests to `/sign-in`, an `Origin` check on non-GET `/api/*` (CSRF defence beside SameSite cookies), `www` → apex redirect, cheap per-IP limits on public routes. Next's own docs say Proxy must not be the only check, so `lib/auth/session.ts` (`requireUser()`, server-only) runs inside every handler. Sign-in/up pages: `app/sign-in/[[...sign-in]]`, `app/sign-up/[[...sign-up]]`. Core 3 components: `<Show when="signed-in">`, `<UserButton>`, `<UserProfile>` (not the removed `SignedIn`/`SignedOut`). Webhook: `app/api/webhooks/clerk/route.ts` with `verifyWebhook()` (`@clerk/nextjs/webhooks`, Standard Webhooks — no `svix` package), de-duplicated on the message id; `user.created` → `users`, `user.deleted` → the account-deletion job. `INKDESK_AUTH=off` keeps the single-owner local desk for development, the checks and the capture. Implements `prd.md > Accounts and Sign-in (v3)`.

### Data Access and Ownership (v3)

`lib/auth/access.ts`: `ownedProject(userId, id)`, `ownedVideo(...)`, `ownedBlob(...)` — **404 for anything the caller does not own**, so ids cannot be probed. Mongo filters always include `ownerId`. `/api/image/[id]` is replaced by `/api/projects/[id]/image/[imageId]` (owner, and the image must belong to that project) and signed URLs; closes SEC-01, SEC-06. `scripts/claim-projects.mts` assigns the migrated v1 desk and the filmed project to the learner's user id. Implements `prd.md > Ownership and Privacy (v3)`.

### Store v3 — Mongo and the Buckets (v3)

`lib/store/cloud.ts` grows from one `projects` collection to: `users`, `projects` (+ `ownerId`), `jobs`, `videos` (with `shots[]`), `shares`, `reports`, `settings`. Writes become **atomic updates with a `rev` compare-and-set** (already the pattern in v2's `revUpdate`), so web and worker can both write without the in-process lock; a short Redis lock (`SET NX PX`) only where a read-modify-write cannot be expressed as one update. Indexes: `projects {ownerId, updatedAt}`, `jobs {ownerId, status}`, `shares {token}` unique, `videos {ownerId, createdAt}`. The dashboard lists **summaries by projection**, not whole documents (CR-12, SEC-12). Bucket keys: `u/<userId>/p/<projectId>/<kind>/<id>.<ext>` in `PROJECT_FILES`; `u/<userId>/p/<projectId>/video/<videoId>/{shots/<n>.mp4, final.mp4, poster.jpg, captions.vtt}` and `…/audio/…`, `…/export/…` in `COMPILE_OUTPUTS`; `archive/…` for the repo's media. Every S3 and Mongo call gets a timeout (CR-6); images stream with an `ETag`, video always by signed redirect (CR-17). `S3_FORCE_PATH_STYLE` and `S3_PUBLIC_ENDPOINT` are honoured.

### Queue and Worker (v3)

`lib/queue/` (BullMQ 6, ioredis 5): three queues — `image` (concurrency 2), `video` (1), `audio` (2) — with `attempts`, exponential back-off, a per-job timeout, and BullMQ's stalled-job recovery replacing the `serverRunId` demote rule (CR-1, CR-9, CR-13). `worker/index.ts` runs the processors; the web service only enqueues. **Mongo `jobs` is the source of truth**: `queued → running → done | failed`, written before enqueue and on every transition, so a flushed Redis loses no history; a reconciler on worker start re-enqueues `queued` jobs that Redis no longer holds. Paid video submissions are written `submitting` **before** the POST and `submitted(jobId)` straight after — never re-submitted automatically (OpenRouter has no idempotency key and no list endpoint). Per-user fairness: one active video and at most N image jobs per user in flight (CR-10, SEC-08). Redis down → `enqueue` throws `Busy`, the route answers 503 with "The studio is busy" (PRD), reads keep working.

### Limits, Quotas and the Kill Switch (v3)

`lib/limits/` on Redis: sliding-window rate limits keyed on `userId` (and IP for anonymous routes) — paid text 10/min, paid image 6/min, uploads 20/hour, edits 120/min, reads 240/min, sign-up and share views per IP; **daily quotas** per plan (`free` vs `allowlisted`, from `ALLOWLIST_EMAILS`) as atomic counters with keys that expire at the daily reset; **spend reservation**: `reserve(userId, estUsd)` atomically (a Lua script: user cap, global daily cap, optional global total cap) before enqueue, `settle(userId, reserved, actualUsd)` with the provider's `usage.cost` when the job finishes, `release` on failure. The same counters feed `GET /api/usage`, the header meter and the Usage page. Closes SEC-02, SEC-08.

### Request Hardening (v3)

Every request schema gets `.max()` on every string and array and `.strict()` objects (SEC-03, CR-5); bodies are read with a size cap before parsing (chunked bodies included — SEC-04, CR-4); `experimental.proxyClientMaxBodySize` set; environment numbers validated (CR-15); a corrupt project document shows an error with a way out (CR-14); polling pauses in hidden tabs and never overlaps itself (CR-8).

### Uploads (v3)

Real type from the bytes, size cap enforced while streaming, **re-encoded** with `sharp` (strips EXIF/GPS and any appended payload), served with `X-Content-Type-Options: nosniff` (SEC-05); per-user storage quota.

### Security Headers and CSP (v3)

`next.config.ts` headers: CSP allowing only `self`, the Clerk Frontend API host, the bucket's signed-URL host, and nothing else for scripts; `frame-ancestors 'none'`; HSTS; `Referrer-Policy: strict-origin-when-cross-origin`; `nosniff`; `poweredByHeader: false` (SEC-09). Errors shown to users never carry internals (SEC-11). Secret-reading modules import `server-only` (SEC-15).

### Sharing (v3)

`shares {token, ownerId, kind: 'manga' | 'video', projectId | videoId, snapshot, createdAt, revokedAt}` — the token is 128 random bits, base62; the **snapshot** holds only title, style, reading direction, cover and panel image ids, bubble layout and dialogue (no DNA, scenario, plan, costs, owner). `app/s/[token]/page.tsx` renders a read-only reader or player; `opengraph-image.tsx` uses the cover or poster; `generateMetadata` adds `robots: noindex`; images and video through `/api/s/[token]/…`, which serve only ids in the snapshot. Unpublish sets `revokedAt` → `notFound()`, the same page as an unknown token. Implements `prd.md > Sharing (v3)`.

### Reports (v3)

`POST /api/s/[token]/report` (public, per-IP rate-limited): `reports {token, reason, note, at, ip-hash}`; `app/admin/reports` visible only to `ADMIN_EMAILS`, with Unpublish. Email delivery only if an email service is configured (open question). Implements `prd.md > Report (v3)`.

### Settings, Usage, Terms and Privacy (v3)

`app/settings/(account|defaults|sharing|data|usage)` — account through Clerk's `<UserProfile>`; defaults in `settings`; export as one zip (`yazl`) streamed to the bucket and downloaded by signed URL; **delete account** as a worker job that removes Mongo records, bucket prefixes, queued jobs, shares, and then the Clerk user — idempotent, so `user.deleted` from the webhook runs the same job. `app/terms`, `app/privacy` — static pages. Implements `prd.md > Settings (v3)`, `prd.md > Terms and Privacy (v3)`.

### Animate a Page (v3)

Implements `prd.md > Animate a Page (v3)`. In the worker:

1. **Frames** (`lib/video/frames.ts`): each panel's image cropped or padded to a Seedance ratio (Seedance offers 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 — **no 3:2**; wide 3:2 panels are cropped to 16:9, square panels go at 1:1 and are padded onto a 16:9 paper canvas at assembly), uploaded to `COMPILE_OUTPUTS`, sent as a signed URL — never a user-supplied URL (no SSRF path).
2. **Motion prompt** (`lib/video/prompt.ts`): Claude (Terra fallback) turns the panel's action, camera and dialogue, the locked DNA word for word and the style rules into one continuous motion beat and one camera move, ending "no text, no speech bubbles, no captions".
3. **Speech** (`lib/audio/tts.ts`, ported from `video/narrate.mts` — not imported: its `process.exit` and `spawnSync` would stop the server): one ElevenLabs voice per character (`Character.voice`, chosen once and kept), `/api/v1/audio/speech`, leveled to −16 LUFS; the shot's length is `clamp(ceil(speech + 1 s), 3, 5)` s.
4. **Shot**: `POST /api/v1/videos` with `bytedance/seedance-2.0`, 720p, the chosen motion method (A or B, below), `generate_audio: false` (so the model does not invent speech), `seed`, `session_id = videoId`, `user = userId`; poll `GET /api/v1/videos/{id}` (or the signed webhook once the domain is public), download straight to the bucket — OpenRouter's copy expires.
5. **Music** (`lib/audio/music.ts`, ported from `video/music/generate.mts`): one Lyria clip per trailer.
6. **Assembly** (`lib/video/assemble.ts`, ffmpeg in the worker — not Remotion, which would need Chromium and `@remotion/renderer` server-side and a company licence above three people): normalise to 1280×720, 24 fps; overlay each bubble as a PNG lettered by the app's own renderer, timed to its line; lay in the voices; duck the music with v2's `mix.ts` constants; `loudnorm`; write `final.mp4`, `poster.jpg`, `captions.vtt`.
7. **Progress**: each shot is a `videos.shots[n]` entry with its own state; a failed shot does not stop the others; **Try again** re-runs one shot.

### Responsive (v3)

From the measured punch list at 390 and 768 px (`devpost/security-report.md > Appendix — responsive`): the station rail becomes a compact stepper under 720 px with tap-to-explain on locked stations; bubble lettering sized from the panel (container units), not the viewport; 44 px touch targets; touch bubble editing through an edit sheet instead of drag; `100dvh`; the Director's page cards collapse; the reader swipes; dialogs become full-height sheets under 480 px.

### Health, Status and Logs (v3)

`GET /api/health` — 200 with `{web: ok, mongo, redis, worker}` (the worker writes a heartbeat key every 15 s); Railway deploys on it; a status line appears in the app when Redis or the worker is down. `pino` structured logs with a redaction list (keys, tokens, emails, prompts), request ids; error tracking only if the learner adds a service (open question).

### As built — slice 16 (2026-10-14)

- **Config:** `lib/config.ts` maps the learner's names exactly as the table above says; `lib/boot.ts`, called from `instrumentation.ts`, validates at start and in production exits with the one sentence. `GENERATION_ENABLED` unset means on in development and **off in production**.
- **Bucket keys** all live under **`S3_KEY_PREFIX`** (default `inkdesk/`, never the bucket root) — added after the review found Ink Desk writing at the root of a bucket that may be shared. The key layouts in *Store v3* sit under it.
- **Signed URLs** are not used yet: `S3_PUBLIC_ENDPOINT` is mapped, the presigner arrives with ownership (slice 19); images still stream through `/api/image/[id]` (now with an ETag, 304, `no-store` on every non-200, and an idle-read limit so a stalled bucket stream fails in 30 s).
- **Local store:** each save writes the last good copy to `project.json.bak` first (git-ignored); an unreadable project opens from it, or shows as an "unreadable" card on the dashboard.
- **`server-only`** is imported by every secret-reading module; the `check:*` scripts load `scripts/server-only.mts` first so they keep running under `tsx`.
- **`check:store`'s cloud half** runs only with `INKDESK_CHECK_CLOUD=yes`, because this environment carries a real `DB_URL` that a check must never write to.
- **Bodies:** `lib/body.ts` caps every route (64 KB JSON; the project edit sized to the scenario's limit; uploads at the 3.75 MB limit plus multipart room), counting a chunked stream as it arrives.
- **CSP:** `'unsafe-inline'` for scripts until `proxy.ts` can set a nonce (slice 19); `'unsafe-eval'` in development only.

### As built — slice 17 (2026-10-14)

- **`node scripts/kernel-test.mjs --motion`** (free probe: `--motion --probe-only`) writes `data/kernel-test/motion/`: `inputs/` (the transport JPEGs actually sent, plus the medium panel's PNG), six clips `A|B-close|medium|wide.mp4`, `frames/` (first, middle, last), `index.html`, `manifest.json` (`verdict: null`) and `jobs.json` (every job id, written the moment it exists, so a re-run into the same folder resumes and never pays twice).
- **Inputs:** the day-one sheet and the day-one close-up and wide panels are reused (same Kaito); the wide 3:2 is centre-cropped to 16:9; the medium panel was drawn for the test from the sheet ($0.0271). Everything goes as a base64 JPEG data URI — OpenRouter accepted that for both `frame_images` (A) and `input_references` (B); no public URL was needed.
- **Measured:** all six jobs completed (112–239 s each, none refused — drawn faces were not blocked). Every clip billed **$0.7623** for 5 s, within 0.8% of the formula once the clip's real size is used: 1:1 renders at **960×960** and 16:9 at 1280×720, both 5 s = 108,000 tokens at $7/M = $0.756, billed $0.7623. The spec's earlier $0.085/s for 1:1 was wrong; the run cost **$4.60** (six clips + the medium panel), not ≈ $3.20. Balance after: about $2.49.
- **Mechanical checks all passed** (probe, 6/6 clips, ffprobe, shape and length, cost within 5%, 18 frames on the page). They say nothing about faces: the verdict is the learner's and is still `null`.
- **What the frames show (assistant's observation, not the verdict):** the close-up holds in both methods; in the medium shot A drifts more in pose and jacket tone by the last frame than B does; in the wide shot the figure is small and neither method shows a face at the end, and A cut to a side-profile close-up mid-shot that the prompt did not ask for.

### As built — slice 18 (2026-10-14)

*Built and verified in the session; the slice's box stays open until its live checkpoint (Railway Redis, the `worker` service, the redeploy test).*

- **A job is a record.** `lib/queue/jobs.ts` is the pure state machine — `queued → running → done | failed`, with `outcome` (`done`, `failed`, `refused`, `skipped`, `abandoned`, `cancelled`), a **lease** (`LEASE_MS` 45 s, renewed every 15 s by whoever holds it), `attempts` (claims), and two checkpoints a worker saves as it goes: `resultImageId` (the picture is in the bucket) and a patched `payload` (a sheet whose words are saved becomes `reuseDna`). Both stores apply the same functions and only make the swap atomic: `data/jobs/<id>.json` under a cross-process file lock on a local desk; the `jobs` collection in Mongo with `rev` compare-and-set and a **unique sparse `activeKey`** index (the key while queued or running, `$unset` in the write that ends it) so two racing requests for one panel cannot both win. The record is written **before** the job is queued.
- **Two queues, one code path.** `INKDESK_QUEUE=inline` (default outside production) runs the same records in the web process through the old in-memory runner (`lib/queue/memory.ts`, moved from `lib/queue.ts`); a record left over from before a restart is ended with a sentence at boot (`lib/boot.ts`). `bullmq` puts the record's id on the `image` queue (prefix `inkdesk`, `jobId` = the record id, 3 attempts with back-off for a store outage only) and `npm run worker` (`worker/index.ts`, started with `scripts/server-only.mts` preloaded) takes it. `video` and `audio` are named but have no processors until slice 22. `tsx` moved to `dependencies` so the worker starts on Railway. `serverExternalPackages: ['bullmq', 'ioredis']` in `next.config.ts`.
- **Enqueue** (`lib/queue/enqueue.ts`): breaker open → 503 *paused*; Redis down or not configured → 503 *busy*; the same key already waiting or running → that job, not a second (a dead one — lease lapsed — is let go first); `QUEUE_USER_INFLIGHT` (30) per person → 429; `QUEUE_MAX_WAITING` (200) across the studio → 503. A person's jobs queue with **priority = how many they already have in flight**, so a newcomer's first panel goes ahead of a regular's twenty-fifth (BullMQ OSS has no per-group fairness). A job that cannot be queued is ended `cancelled` so the reconciler never queues it later (CR-10, SEC-08).
- **The claim is a job id.** `Panel.startedByRun` and `CoverState.startedByRun` now hold the id of the job drawing them (the field kept its name; no migration). `markInking` refuses a claim held by a *different* job; the same job claiming again (a redelivery) is fine; `attachPanelVersion`/`attachCoverVersion` and `markFailed`/`markCoverFailed` take the claim, so a late result — or a late failure — from a job that was let go never overwrites a newer one (CR-1). The **stale floor** is now "an `inking` claim no live job holds" (`claimIsStale`; `serverRunId` no longer decides anything, though the field is still stamped); a claim younger than `CLAIM_SETTLE_MS` (10 s) is never judged, because the live list is read just before the project; a ceiling of `2 × GENERATION_TIMEOUT_MS + 180 s` (a sheet adds its Claude call, +540 s) stops renewal of a job that hangs, and the worker fails a job that runs past it plus two minutes and frees its slot (CR-13). A job is **live** while `queued`, or `running` with an unexpired lease — plus `ABANDON_GRACE_MS` (10 min) on `bullmq`, where BullMQ's own stalled-job recovery brings a stalled job back.
- **Never paid twice** (`lib/images.ts`, `lib/panels.ts`, `lib/director.ts`, `lib/sheet.ts`): the picture is stored, its id and cost are **checkpointed on the job**, and only then attached; a re-run that finds `resultImageId` attaches the stored picture without calling the provider, and a picture that already landed is not attached again. A finished job is never claimed again. After the payment, a failure that is not a refusal is rethrown so BullMQ retries and the retry attaches; a refusal (the card was locked meanwhile, the claim was lost) still **charges the project and deletes the orphaned picture**, and a redraw that pushes a fourth version out **deletes the version it dropped** (CR-16). *The one window that stays:* a worker that dies **during** the provider call. OpenRouter's image API has no idempotency key, so the stalled job is drawn again — at most `maxStalledCount` (2) extra times, at one picture's price each.
- **Stalled recovery and the reconciler.** A worker holds each job's lock; if it dies, after `stalledInterval` another takes the job (verified: `check:queue` SIGKILLs a worker mid-job). The reconciler (`lib/queue/reconcile.ts`, in the worker, at start and every minute, under a Redis lock) puts back a `queued` record Redis no longer holds and a `running` record whose lease lapsed and whose queue entry is gone, fails a job claimed six times (`TOO_MANY_RESTARTS`), and prunes records finished a week ago. A flushed Redis loses nothing (verified).
- **Sheets are jobs** (`lib/sheet.ts`; CR-11): the route checks what it can at once (story settled, card exists and unlocked), queues, and answers; the worker writes the DNA (saved before the picture), draws, and lands the pair. The card's *drawing* state is **derived from the job**, not from an open request. **Text calls stay in the request** — synopsis, cast, reroll, rewrite, the Director's plan, the page script, the import's DNA read — they return a draft or a result the person is waiting on, which a job would not improve; they got a 150 s ceiling on the Anthropic client (CR-11) and the plan a guard (`lib/inflight.ts`: one per project, three across the process; CR-18). The `text` job kind is defined and unused.
- **What the studio sees.** `GET /api/projects/[id]` and the generation POSTs return the desk plus `activity { jobs: JobView[], queue: { mode, state: ok | busy | no-worker, message } }` — never stored, no keys, owners or costs; failures show for 10 minutes unless a newer job for the same thing replaced them or the job was refused at the door. The studio polls only while a job is active or a panel/cover is `inking` (an idle project does not poll), pauses in hidden tabs, never overlaps, and — while its status line is up — looks again every 10 s so the line clears itself. A blank panel with no job is **blank** (a *Draw panel* button), not "Pencilling…" for ever (CR-9). Opening a project never needs a write to succeed (CR-7).
- **Redis and the worker's heartbeat.** The worker writes `inkdesk:heartbeat:worker` (45 s life, every 15 s). `/api/health` adds `queue: { mode, redis, worker }` and **does not fail the deploy on them** — with Redis or the worker down the studio still reads every project; the status is still decided by Mongo and the bucket. Redis down answers a generate click within seconds with "The studio is busy — try again in a few minutes." and leaves no queued record. The producer connection waits for the socket at most 3 s per command, and `family: 0` so Railway's IPv6 private name resolves.
- **The credit breaker** (`lib/queue/breaker.ts`): a 402 (`ProviderError.code = 'credits'`) opens it for 10 minutes — a Redis key shared with the web service and every worker — so waiting jobs fail without calling anyone and new work is refused with one sentence. A 429 waits for `Retry-After` (at most 20 s) or 1–3 s before its one retry (`IMAGE_RETRY_DELAY_MS`). The global daily cap of slice 20 supersedes the message.
- **CR-3**: the local store writes a unique temp file, fsyncs, and takes a cross-process lock (`lib/store/lock.ts`: an atomic directory, owner pid and token inside, stale takeover after 30 s or when the pid is gone, always released); two processes now land 300 of 300 increments.
- **Settings added** (`lib/config.ts`, `.env.example`): `INKDESK_QUEUE`, `REDIS_URL`, `QUEUE_CONCURRENCY_IMAGE` (else `PANEL_CONCURRENCY`), `QUEUE_USER_INFLIGHT`, `QUEUE_MAX_WAITING`, `QUEUE_RETRY_BACKOFF_MS`, `IMAGE_RETRY_DELAY_MS`. Production defaults to `bullmq` and refuses `inline`; **a production web service with generation closed may start before Redis exists** (reading needs none) — one that can generate, and every worker, may not.
- **Where the build departs from the spec's words.** (1) Text calls are not jobs (above). (2) `/api/health` reports Redis and the worker without failing on them. (3) `lib/queue/{queues,jobs,enqueue}.ts` grew `redis`, `breaker`, `run`, `processors`, `worker`, `reconcile` and `status` beside them. (4) The per-user in-flight cap is a count of queued plus running jobs (30), with priority for fairness; "one active video" belongs to slice 22.
- **What the adversarial review changed (the slice's own review, 22 confirmed findings, all fixed before the live checkpoint).** *Resume:* a re-run whose picture already landed returns `done` **without claiming the panel again** (it used to flip a finished panel back to "inking", and the floor then demoted it to "failed" with the art attached — the review's high); a job that already paid attaches its picture **even with the credit breaker open**; the picture's id is saved on the job with three tries and, if the store still refuses, the picture is attached anyway with its cost — and a failure after the picture is stored always rethrows so BullMQ retries; the **next job for a key picks up a picture a failed job paid for and never landed** instead of drawing again. *Delivery:* a job delivered again while this process is still working on it is dropped, and one delivered to another worker **waits for the holder's live lease to lapse or the job to finish** instead of drawing a second, paid picture beside it — so a killed worker's job resumes after at most the lease (45 s) plus BullMQ's stall check, not instantly. Liveness is always judged on the fresh record inside the update, so a worker that renewed in time is not let go. *Caps:* counted again **after** the insert and backed out if over, so ten racing requests cannot all pass (`check:queue` fires ten at a cap of three); `assertCanEnqueue` lets the Rewrite route ask before it pays Claude. *Errors:* a failed job's sentence goes through `jobSentence` (production says only that the studio is unavailable) — never the cause. *Operations:* `npm run worker` reads `.env` (`--env-file-if-exists`; a shell variable wins); a stopping worker waits `WORKER_GRACE_MS` (90 s) for what it is drawing — set Railway's `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` to match; the web side and the inline boot prune finished records (the inline queue has no worker to do it). *Studio:* a refused request re-reads the desk (Generate all may have queued some panels before the cap said no); a Draw sheet card keeps saying "Drawing…" after its words are saved (the payload keeps what was asked for, `redraw`, apart from what the job will do, `reuseDna`); a redraw or cover job that is only waiting says "Waiting its turn…" with no stage line or clock. *Refuted by the skeptics, left alone:* the status probe adds no sustained latency to reads (cached three seconds), a restarted worker's first reconcile is not meaningfully delayed by the old lock, and `/api/health` exposing queue state is the spec's own design.
- **Verified** (`check:queue`, 16 sections, against a real Redis): the state machine; dedupe, caps and fairness; a page inking through BullMQ (four records, one picture each, cost counted once); a sheet job (words then picture); a store outage after the payment (one provider call, one version, claimed twice); a SIGKILLed worker (stalled recovery, claimed twice, paid once); a flushed Redis and an orphaned running job (reconciler); thirty edits beside four attaches (no lost update); the 402 breaker; the stale floor in both modes and CR-7; CR-16; the inline queue; the review's fixes (each reproduced first); the plan guard; Redis down (503 within seconds, no queued record, the desk opens, the status line). Also typecheck, lint, every other `check:*`, `npm run build`, `check:store`'s cloud half on a scratch MongoDB and an S3 stand-in, and a real `next start` + `npm run worker` + browser run in which a page inked to completion while the web process was killed and restarted.
- **Railway, for the learner** (the live checkpoint): add the Redis template and give **both** services `REDIS_URL` (private address); a second service `worker` from the same repository with start command `npm run worker`, the worker variables of *Environment and Configuration (v3)* plus `INKDESK_QUEUE=bullmq`, and ffmpeg in its image once slice 22 needs it; on `web` set `INKDESK_QUEUE=bullmq`. Until `REDIS_URL` is on `web`, generation stays closed (`GENERATION_ENABLED` unset is off in production), so the first deploy of this slice does not need it.

### As built — slice 19 (2026-10-15)

- **Modes** (`lib/auth/config.ts`): `INKDESK_AUTH` = `clerk` | `off` | `test`; unset means `off` in development and `clerk` everywhere else — **only `NODE_ENV=development` or unset counts as development** (a review found sign-in failing open on `NODE_ENV=test` or `staging`). Production refuses `off`, `test`, and `clerk` without its keys, at boot and in the proxy.
- **Keys mapped, not renamed:** the publishable key from `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, else `CLERK_PUBLISHABLE_KEY`; `CLERK_JWT_KEY` passed as `jwtKey` (sessions verified offline); `CLERK_WEBHOOK_SIGNING_SECRET` for the webhook. The CSP adds the Frontend API host (from the publishable key), `img.clerk.com` and `challenges.cloudflare.com` (Clerk's bot protection) — fixed at **build** time, so the publishable key must be set when Railway builds.
- **`proxy.ts`:** `/api/health` and `/api/webhooks/*` pass first (Railway's `healthcheck.railway.app` included); `www.` → 308 to the apex; cross-origin writes to `/api/*` → 403; signed-out page requests → `/sign-in?redirect_url=…`; open pages: `/sign-in`, `/sign-up`, `/terms`, `/privacy`, `/s/*`.
- **Data:** `Project.ownerId`; `ownedProject` / `assertImageInProject` / `ownedJob` (`lib/auth/access.ts`) answer 404 for anything not the caller's, including a damaged project; jobs carry `ownerId`; `store.users` (`upsert`, `get`, `markDeleted`) fed by the webhook; `scripts/claim-projects.mts --owner user_… [--dry-run]` gives the v1 desk and the filmed project to the learner (cloud only with `INKDESK_CLAIM_CONFIRMED=yes`).
- **Client:** every image through `imageUrl(projectId, imageId)`; one `apiFetch` that, on a 401, refreshes Clerk's token and retries once before sending the browser to sign-in.
- **Checks:** `check:auth` (route walk, modes, webhook signatures and replays, Origin and www rules, offline JWT verification, the refresh-retry) and `check:ownership` (two users on every project route, images, jobs, listings, spend — on the local store and on MongoDB).

### As built — slice 20 (2026-10-15)

*Built and verified in the session; the slice's box stays open until its live checkpoint (the allowlist, the caps and the OpenRouter credit limit set on Railway, `GENERATION_ENABLED=true`, the two-account test).*

- **Modes** (`lib/config.ts > limitsEnabled`): `INKDESK_LIMITS` = `on` | `off`. Unset means **on** wherever sign-in is on (`clerk` or `test`) and in production, and **off only on a local desk with `INKDESK_AUTH=off`**, so a fresh clone and every check that predates accounts run untouched. Production refuses `off` at boot and `limitsEnabled()` reads `true` in production whatever the variable says (the second lock). With the limits off nothing is counted or reserved, `GET /api/usage` says `metering: false`, and the screens hide the meter. Counters live in Redis whenever `REDIS_URL` is set; otherwise in an in-process memory backend (a bare dev desk and the checks); **production with no Redis has no counters at all** (`backend()` returns an `unavailable` backend), so nothing can spend, and every spend answers with the studio-busy sentence.
- **`lib/limits/`** (pure and client-safe: `view.ts`, `button.ts`, `use-usage.ts`; everything else `server-only`): `rules.ts` (key names, the UTC day, micro-dollars, `evaluate`, `gateMicros`, every sentence), `backend.ts` (the seam), `memory.ts` and `redis.ts` (the two implementations of it), `hold.ts` (`reserve`, `preflight`, `settle`, `release`), `jobs.ts` (`holdForJob`, `settleEnded`, `sweepUnsettled`), `text.ts` (`spendText`, `spendProject`), `estimate.ts`, `plan.ts`, `requests.ts` (the windows and the client address), `usage.ts` (`usageView`), `clock.ts`, `index.ts`. `lib/queue/ending.ts` (`endJob`) is the one door every job ending goes through. `view.ts` is the contract between the enforcement and the screens (`UsageView`, `Meter`, `RefusalBody`, `WARN_AT`); the UI half only reads it, and `check:limits` asserts the screens' `spendBlock` disables exactly what the server would refuse, in the server's own sentence.
- **Redis keys** (all under `inkdesk:`; dollars are integer **micro-dollars**, so a counter is an integer and "the total after N racing reservations" is asserted to the unit):
  - `quota:<userId>:<YYYYMMDD>:<kind>` for `image`, `project`, `videoSeconds`, `audioChars`; `spend:<userId>:<YYYYMMDD>` (the person's day) and `spend:<userId>:<YYYYMM>` (their month, its own counter, so the Usage page's month figure does not depend on job records that are pruned after a week); `spend:global:<YYYYMMDD>` and `spend:global:total` (no expiry).
  - `resv:<id>` is the **hold marker** (JSON: user, the day and month it was reserved on, the dollars, the units, `tracked`), kept 8 days; `resv:index` is a sorted set of the tracked holds by their sweep deadline.
  - `rl:<bucket>:<id>` is a sorted set per sliding window (`text`, `image`, `upload`, `edit`, `read`, `media`, `anon`; `<id>` is the user id, or for `anon` the hashed client address).
  - A daily key expires at the **next 00:00 UTC plus 3 hours**, so a job that ends just after midnight still finds the day it was reserved on; a monthly key 45 days after the month ends. Nothing here is computed inside a script: keys are declared to it.
- **The Lua reserve** (`lib/limits/redis.ts`; three scripts, each run by Redis without another command in between, so two instances cannot both pass a nearly full cap). `RESERVE` answers `dup` if the id already holds, then checks **in the order `evaluate` fixes**: the studio's cumulative cap, the studio's daily cap, the person's quotas in the order the screens list them (images, projects, video seconds, voice characters), and the person's own dollar cap; only if all pass does it raise **all** the counters and write the marker, or it changes nothing. The studio's caps judge `max(estimate, $0.02)` for anything that spends (`gateMicros`), the person's dollar cap judges real dollars only. `HIT` is the sliding window (trim, count, refuse with when the oldest slides out, or record). `FINISH` adjusts exactly the counters the marker says were raised, **on the day and month they were reserved on even if that is yesterday**, never creates a key or changes an expiry, floors a counter at 0, and deletes the marker. The memory backend runs the same `evaluate`; `check:limits` drives one script through both backends and compares every answer.
- **The pause floor.** The studio counts itself **paused** when even $0.02 (`MIN_SPEND_USD`, the cheapest picture at `low`) does not fit under a cap; from then on **every** spend is refused with the pause message, a text call and a new project included. A cap of $0.01 therefore pauses everything before anyone clicks, and the meter's `paused` and a refused `reserve` are one fact. The caps are read from the environment on **every call**, never memoised, so lowering `GLOBAL_DAILY_USD_CAP` in Railway pauses generation on the next click and `0` pauses it outright.
- **Estimates.** A picture is held at the price of the configured quality (`lib/cost.ts`; $0.02 at `low`, never less than the floor), a text call at $0.02 and the Director's plan at $0.03; `settle` replaces the estimate with the provider's real `usage.cost`.
- **Settle and release survive crashes.** Every path that ends a job (the processor, an enqueue back-out, a dead job the web lets go, the boot sweep, a worker out of retries, the reconciler failing a poison job) goes through `endJob`, which writes the ending and then settles; the record carries `reservation: none | held | settled`. A **done** job is settled to `costUsd − carriedUsd` (a done job that reported no cost keeps its estimate); anything else is **released**: the quota unit comes back, and the dollars it really spent (a picture billed and never stored) stay counted. Both are **idempotent per id** (the second finds no marker), which is what lets any number of sweepers run at once. A crash between an ending and its settle leaves the record `held`, and `sweepUnsettled` settles it: the worker's reconciler does it every minute, the web side's `prune()` every ten minutes (the inline queue has no worker), and the inline boot sweep at start. Holds no job record backs (text calls, new projects) are `tracked`: unsettled after 30 minutes, they are let go **at their estimate**. `carriedUsd` makes a picture paid for by a failed job and attached later by a retry count once. **The one gap that stays:** a process that dies between the reserve and the insert of the job record (one write wide: the reads come first) leaves an untracked hold, a unit and an estimate until the day resets; tracking it would only let the sweep settle it at the same counters.
- **The request windows** (`lib/limits/requests.ts`). `requireUser(req)` is the **single choke point**: when the limits are on it takes the window for that kind of request (`classify(method, path)`), so no route has to remember; a page passes no `Request` and takes none. Text calls 10 a minute, paid image requests 6 a minute (a Generate all is one request; the quota counts the pictures), Rewrite takes one of each, uploads 20 an hour, every other change 120 a minute, every other read 240 a minute, pictures served 1200 a minute (a reader page is dozens), signed-out callers 60 a minute per client address. An unknown route is an edit or a read, so a route added later is limited from its first day, and `check:limits` fails if a route that can spend is not named. A refusal is a 429 with `Retry-After` and `{error, code: 'rate', retryAfterSec}`. **Redis down:** the three windows that guard spending (text, image, upload), `reserve` and project creation **fail closed** with the studio-busy sentence and leave nothing behind; plain reads, edits and picture serving **fail open**. While generation is closed (`GENERATION_ENABLED` off) the paid routes take the edit window, not none.
- **The client address.** Read from `X-Forwarded-For` **from the right**: the entry `TRUSTED_PROXY_HOPS` from the end (default 1, Railway's edge), so whatever a caller writes on the left is ignored. Too few entries, junk, or 0 hops gives no address, and those requests share one `unknown` window: the safe direction, it can only make a spoofer share a bucket, never escape one. IPv6 is keyed by its /64 and an IPv4-mapped address becomes the IPv4 one. The key is an HMAC of the address, so no raw address reaches Redis. **Why this rule:** Railway's docs call `X-Real-IP` the client's remote IP but say nothing about `X-Forwarded-For` or about whether the edge overwrites an `X-Real-IP` a client sent; neither could be verified from here, and the right-hand `X-Forwarded-For` rule holds for any edge that appends. Once the learner has confirmed on the live domain that the edge overwrites `X-Real-IP`, `CLIENT_IP_HEADER=x-real-ip` switches to it. `proxy.ts` has no IP logic, so nothing from it was reused. **A signed-out request to an API route gets its 401 and takes no window**, so a flood of them cannot be turned into Redis load; the `anon` window (`limitByAddress`) is built for the routes that have no signed-in person and is first used by slice 21 (share view, report).
- **The kill switch and the sentences.** One calm sentence with a way forward, a status and a `code`, the same on a refused click and in the meter. Daily cap: 503, `code: 'paused'`, "The studio has paused generation for today to keep its costs in check. It will open again at 00:00 UTC, in about 3 hours." with `resetsAt`. Cumulative cap: 503, `paused`, "The studio has paused generation to keep its costs in check. Reading, the reader and exports still work." and **no** `resetsAt` (it does not lift by itself). Out of credit (the 402 breaker, kept): "The studio has paused generation for now to keep its costs in check. Try again in a little while." A person's quota: 429, `quota`, "You have used today’s 20 images. It resets at 00:00 UTC, in about 3 hours." Their dollar cap: 429, `spend`, "You have reached today’s spending limit of $1.00. It resets at …". A rate window: 429, `rate`. Redis down: 503, `{error}` only, "The studio is busy — try again in a few minutes." The reset is told in **UTC** because the server cannot know the viewer's time zone; `resetsAt` carries the instant, and the screens word their own sentences in UTC too, so one screen never shows two different times. Reading, the reader, exports and shares keep working while paused.
- **The 402 breaker is now part of the pause.** While it is open `reserve` and `preflight` refuse every spend (text calls and new projects too), so the meter and the enforcement agree; its own Redis check skips Redis for 5 seconds after a failure so this adds no wait when Redis is down. A **text** 402 now carries `code: 'credits'` and `spendText` trips the breaker (limits on or off), so an account out of credit pauses pictures as well as words.
- **`GET /api/usage`** (`no-store`, behind `requireUser`, read-rate-limited): exactly `UsageView`, built by one function (`usageView`) from the same counters `reserve` checks and judged by the same `evaluate`: `plan`, `metering`, `day`, `resetsAt`, `images`, `projects`, `videoSeconds`, `audioChars` (each `{used, limit}`), `spend {todayUsd, monthUsd, todayLimitUsd}` (the person's own daily dollar limit), `paused`, `warn` (any meter at 80% or more) and `blocked {kind, message, resetsAt, code}` (the first thing a spend would be refused for, found by probing one of each). A fresh free account reads 20 images, 1 project, 15 video seconds, 2000 voice characters, $1 a day. If the counters do not answer, the view shows the plan's limits and `blocked.code: 'busy'` ("The studio is busy…", promising no reset time).
- **Plans** (`plan.ts`): `allowlisted` when the account's email (from `store.users`, filled by Clerk's webhook) is in `ALLOWLIST_EMAILS` (case-insensitive), `free` otherwise, a deleted account or an account the webhook has not delivered yet is free, a store that cannot be read never raises a limit, and the owner of a desk without accounts is always allowlisted. The lookup is cached 15 seconds. The webhook's `emailOf` now ignores any address Clerk marks unverified (the allowlist is matched against it); a payload that says nothing about verification is taken as before.
- **What is gated.** Every picture route and job (`holdForJob` between the dedupe and the insert, so a refusal leaves no record), the sheet, cover and panel jobs, and the text calls through `spendText` (synopsis, cast, reroll, rewrite, plan, page script, the import's DNA read); a new project through `spendProject` (the project quota; no dollars). Rewrite asks `preflight` for the picture before it pays Claude. The import takes its hold first and runs both its steps inside it. **Video and audio** have counters and meters but no estimates or holds yet: `jobSpend` returns null for those kinds until slice 22.
- **The screens.** `QuotaMeter` in the studio and dashboard headers (images today, warning from 80%, "Used up" at 100%), `SpendNote` (a `role="status"` line beside a blocked button), `UsagePanel` and the standalone Usage page `app/settings/usage/page.tsx` (signed-in check, back link to the desk, no settings navigation; the other settings pages are slice 21). Every spending button calls `useSpend(need)` → `spendBlock(usage, need)`, which checks in order a rate hold (after a 429, for `retryAfterSec`, at most 120 s), `usage.paused`, `usage.blocked`, then whether the meter has enough left ("This takes 21 images and you have 8 left today."); it shows the server's sentence word for word, in the button's title and beside it, and with no usage yet, a failed read or `metering: false` it blocks nothing and the server still decides. The usage store reads `/api/usage` through `apiFetch`, polls every 30 s only while the tab is visible, never overlaps itself, refreshes on tab return if the last read is over 5 s old, and refreshes (debounced 250 ms) on the `inkdesk:usage-changed` event, which `apiFetch` fires after any spending POST, accepted or refused, and `Studio` fires when the last job ends (a failed job gives its picture back). `usesLine` says what an action will use and what is left after it ("Uses 13 of your 20 images today (7 left after)."). The Page station no longer auto-queues blank panels when it already knows the server would refuse them.
- **Settings added** (`lib/config.ts`, `.env.example`; blank means the default, a bad value is refused at boot **by name, never by value**, and each is read fresh on every call):

  | Variable | Default |
  |---|---|
  | `INKDESK_LIMITS` | unset: on with sign-in or in production, off on `INKDESK_AUTH=off` |
  | `ALLOWLIST_EMAILS` | empty |
  | `GLOBAL_DAILY_USD_CAP` | `5` |
  | `GLOBAL_TOTAL_USD_CAP` | unset (no cap) |
  | `USER_DAILY_USD_FREE` / `USER_DAILY_USD_ALLOW` | `1` / `10` |
  | `QUOTA_FREE_IMAGES` / `_PROJECTS` / `_VIDEO_SECONDS` / `_AUDIO_CHARS` | `20` / `1` / `15` / `2000` |
  | `QUOTA_ALLOW_IMAGES` / `_PROJECTS` / `_VIDEO_SECONDS` / `_AUDIO_CHARS` | `150` / `10` / `120` / `20000` |
  | `RATE_TEXT_PER_MIN` / `RATE_IMAGE_PER_MIN` | `10` / `6` |
  | `RATE_UPLOAD_PER_HOUR` | `20` |
  | `RATE_EDIT_PER_MIN` / `RATE_READ_PER_MIN` | `120` / `240` |
  | `RATE_MEDIA_PER_MIN` (new) / `RATE_ANON_PER_MIN` (new) | `1200` / `60` |
  | `TRUSTED_PROXY_HOPS` (0 to 5) | `1` |
  | `CLIENT_IP_HEADER` | `x-forwarded-for` (or `x-real-ip`) |

- **Where the build departs from the spec's words.** (1) The file layout is not `lib/limits/{rate,quota,spend}.ts` but the files above, and `lib/queue/ending.ts` is new. (2) `reserve(userId, estUsd)` and `settle(userId, reserved, actualUsd)` became `reserve({id, userId, units, usd})` and `settle(id, actualUsd)`: the marker under the id remembers what was raised and on which day, which is what makes a settle idempotent and correct after midnight or a restart. (3) The Lua script checks the person's **quotas and own dollar cap** as well as the studio's caps (the spec named only the user cap, the daily cap and the total cap), and keeps the person's spend **per month** as its own counter as well as per day. (4) `USER_DAILY_USD_FREE` and `USER_DAILY_USD_ALLOW` (a person's own dollar cap) are the build's addition to the spec's plan table. (5) The audit's suggested "200 text calls a day" is not built: a text call is bounded by its 10-a-minute window and by the person's daily dollar cap, and new projects by a daily quota. (6) The spec's "sign-up and share views per IP" is the `anon` window, built and keyed but **not yet applied to any route**; a signed-out request to an API route is a 401 with no window, and sign-up is Clerk's own bot protection. (7) Two windows the spec did not name: `media` (a reader page of pictures must not use up the read window) and `anon`. (8) The text calls are held and settled **in the request** (the `text` job kind is still defined and unused, as in slice 18). (9) The out-of-credit message is "…paused generation **for now**… Try again in a little while", not "for today", because the breaker lasts ten minutes, not a day; the daily cap supersedes it with the "for today" sentence when it is what paused the studio. (10) The `jobs` record gains `reservation` and `carriedUsd`, and the job store lists `reservation: 'held'` (a Mongo index backs it). (11) Video and audio holds wait for slice 22.
- **What the adversarial review changed** (the review's 21 findings; findings 5 and 21 are one defect; each fix is held by an assertion in `check:limits` section 12a, the Clerk one in `check:auth`, and each was proved by breaking the fix and watching its assertion fail; the full list is in `security-report.md > Slice 20`). *Money counted wrong:* a picture the provider billed but the bucket could not store was counted at $0 (the unit comes back, the dollars stay); a sheet's words, a failed sheet and an unreported picture cost are now counted; a stranded picture's cost is carried only if the failed job is the newest ending **and** the picture is still in the bucket, so a later Redraw really draws and is not metered at zero. *Enforcement matched to the meter:* the import took its hold after the first step (it now takes it first, and a refused import leaves the card byte-identical); the credit breaker paused the meter but not text calls or new projects; a closed studio took no window at all. *Fail-fast:* the Redis backend remembers an outage for 5 s (with Redis killed, 20 reads and 5 refused spends finish in under 8 s; without it the same run took 57 s). *Screens:* three overflow fixes at tablet and phone widths (the cover line, the panel's reason, the 721 to 960 px header), the busy state no longer promises a reset time, the dollar limit is named as "Spending limit" rather than "Out of images", "(N left after)", a closed studio no longer disables a project-only action. *Left alone:* a worker that outlives its lease through a sustained store outage costs one picture (finding 4, refuted by one of two skeptics); the one-write-wide gap between a hold and its record (finding 5/21, reduced); a picture deleted between enqueue and run (milliseconds).
- **Known limits, stated plainly.** (1) When a person reaches their **own dollar cap**, the usage view blocks only pictures; the text and plan buttons stay enabled and are refused after the click with the spending-limit sentence. Marking them blocked would also disable New project, which the server allows, and `check:limits` rejects that; fixing it properly needs a way to say "everything except new projects" in `view.ts`. (2) A text 402 pauses for ten minutes (slice 18's breaker), not for the day. (3) The "two instances" race is covered by Lua atomicity on one Redis; two OS processes were not run against it. (4) The Mongo half of the job-store change (the `reservation` filter and index) is **untested**, because the real `DB_URL` is never written to; it mirrors the existing filters and sits behind the same `INKDESK_CHECK_CLOUD` gate as `check:store`. (5) Opening a Page station with no plan still makes one text request to write the page script; while paused it is refused with the sentence and Try again stays disabled. (6) Under `next dev` with Turbopack, a Playwright session reloaded the page in a loop (webpack did not); the cause was not found and it was not baselined against the old code. (7) A refused click in the browser (the 429 and 503 handling in `Studio.postJson` and the New project dialog) is covered by a script, not by a click-through, because the gates stop a click before it is sent.
- **Verified** (every real credential and proxy variable unset or overridden; `fetch` stubbed and counted so no provider, database or bucket was reached; a throwaway `redis-server` on a free port). `check:limits` (new; about 13 seconds; ends "limits-check: all passed"): pure rules, sentences and settings; both backends against one script; atomicity (parallel reservations racing a nearly full cap, the exact total asserted, on both backends); the 21st image of a free day refused before any provider call; a done job settled to its real cost; the meter equal to the enforcement at every step and warning at 80%; every ending releasing or settling, idempotently, and a crash between an ending and its settle repaired by the sweep; the kill switch pausing everyone with one message, a raised cap reopening at once, the cumulative cap, the 402 breaker; sliding windows with a moved clock through `requireUser`, with `Retry-After`; plans; text calls and projects held, settled and released; limits off leaving everything as before; `GET /api/usage` and the refusals through the real route handlers; the screens' half against the server's; Redis down; production with no Redis; the review's fixes. Also `typecheck`, `lint`, `npm run build` and **all 19 `check:*`** (store, cast, page, stages, bubble, repair, export, models, assets, llm, plan, demo-timeline, config, hardening, queue, activity, auth, ownership, limits). On a scratch dev server with `INKDESK_AUTH=test`, a scratch Redis and a scratch desk: at 8 of 10 images the meter read "Running low" with `warn` true; at 10 of 10 it read "Used up", the redraw and sheet buttons were disabled with the reset time, the text buttons stayed open, and the 11th image was a 429 with no provider call; with `GLOBAL_DAILY_USD_CAP=0.01` a fresh second account was paused too (new project, panel and synopsis all 503 `paused`, the New project button disabled, reading still worked); the studio, dashboard and Usage page were looked at in a browser at 1280 and 390 px (no horizontal overflow, touch targets 44 px or more). `kernel-test` is not a `check:*` and needs a real provider key, so it was not run.
- **Railway, for the learner** (the live checkpoint): on `web` set **`ALLOWLIST_EMAILS`** (your own address and your friends'; the worker only settles and needs none of it), **`GLOBAL_DAILY_USD_CAP`** (default 5; the learner's number) and **`GLOBAL_TOTAL_USD_CAP`** (the cumulative ceiling the learner chooses; unset means none, and the OpenRouter key's own credit limit is then the only backstop); on OpenRouter put a **credit limit on the key with auto top-up off**, which is the backstop beyond every cap here; check on the live domain whether the edge overwrites a client-sent `X-Real-IP` and, if so, set `CLIENT_IP_HEADER=x-real-ip`; leave `TRUSTED_PROXY_HOPS` at 1 unless something else sits in front of Railway; and last, **`GENERATION_ENABLED=true`**, which opens generation to everyone inside the free quota (it is off in production until then). `REDIS_URL` must already be on both services (slice 18): without it the production web service has no counters and every spend answers that the studio is busy. Then the checkpoint: spend a free test account's day and watch the meter warn at 80% and the buttons disable with the reset time; lower `GLOBAL_DAILY_USD_CAP` to `0.01` and see generation pause for everyone with the message; raise it and see it reopen at once; tag `v3-cp5`.

### As built — slice 21 (2026-10-16)

*Built and verified in the session; the slice's box stays open until its live checkpoint on Railway (the Clerk account panel, the admin allowlist, the worker's Clerk key, a real share opened on a phone and pasted into a chat app, an export and a throwaway account's deletion against the real Mongo and bucket).*

- **Sharing** (`lib/share/{snapshot,service,public,page,pins,url,report,report-copy,types}.ts`). A share is a snapshot taken when the owner presses *Share publicly* / *Update share*; one **active** share per project (create is idempotent), token = 128 random bits in base62. The snapshot allow-list is `kind, title, reading, cover {imageId, title}, pages[{index, panels[{imageId, dialogue, bubble, speaker, shot}]}], takenAt` for **complete pages only**, every string control-stripped and length-capped, each bubble resolved at snapshot time so the public reader needs neither camera notes nor cast. Every public output (JSON, page props, metadata, preview) re-applies the allow-list to what the store returns (`publicManga`), so even a dirty stored record leaks nothing. *Stale* means a snapshot taken now would differ from the published one, not that the project's timestamp moved. **Revoke** sets `revokedAt` and drops the snapshot; a revoked and an unknown token are byte-identical in status, body and relevant headers on the page, the JSON, the picture route and both preview images. A project can be shared again after unpublishing, with a **new** token. Video shares exist as a type only (`kind: 'video'`); no route makes one before slice 22.
- **Public surface.** `/s/[token]` (server page, `connection()`, `noindex`, `no-referrer`; a throttled address gets the bare head a dead link gets and reads no store), `/api/s/[token]` (snapshot JSON), `/api/s/[token]/image/[imageId]` (streams only ids in the snapshot, `no-store`, `nosniff`), `opengraph-image` and `twitter-image` (the cover cropped to 1200×630 with `sharp`, or a paper card; the strict `anon` window, 60 a minute, because a render costs CPU), `app/s/[token]/not-found.tsx` ("There is nothing at this link."). `/api/s/**` takes no session and takes an address window inline (`anon`, `anonMedia`, `report`); it is **not** in `PUBLIC_API_PREFIXES`, so the proxy's Origin check still covers its writes. `next.config.ts` sends `X-Robots-Tag: noindex, nofollow` on `/s/*` and `/api/s/*` and `Referrer-Policy: no-referrer` on `/s/*`. The reader's page rendering was extracted to `components/ReaderParts.tsx` and is shared by `ReaderStation` and `SharedReader`; the studio's markup is unchanged apart from the Share button, and `ScrollEntry` now starts "waiting" on both server and client (the shared page is server-rendered). The page-turning keys are a pure function (`turnKeyIndex`, `lib/reader.ts`) that ignores keys pressed inside any dialog.
- **Pinned pictures.** A redraw drops the old picture (CR-16), which would have broken a live share. `lib/share/pins.ts`: `landImage` skips deleting any dropped picture the project's active share lists (and keeps it if the share cannot be read), and the share lets go when it is refreshed, unpublished, taken down by the admin, or its account is deleted, deleting then the pictures neither the new snapshot nor the project holds. A damaged (unreadable) project keeps every picture its share listed. `createShare`/`refreshShare` re-take the snapshot once if a redraw landed between the read and the write. Replaced **character sheets** are now deleted too (`droppedSheets`, `lib/chapter.ts > update`), so account deletion has none to miss.
- **Reports and admin.** `POST /api/s/[token]/report` (public, `report` window 6 an hour per address, fails **closed** when the counter store is down; strict body `{reason: harmful|copyright|personal|spam|other, note ≤ 500}`; always the same 200 thanks for a live, a revoked and an unknown token, and only an existing share record stores a report; `ipHash` is the window's HMAC, no raw address). `components/ReportDialog.tsx`. `app/admin/reports` (non-admins and unknown ids get the unknown-page 404), `POST /api/admin/reports/[id]` `{action: 'unpublish' | 'handled'}` (unpublish also marks every report about that share handled). `ADMIN_EMAILS` is matched against the verified email in `users`, like `ALLOWLIST_EMAILS`; on a desk with sign-in off the one local owner is admin. No emails (no service is configured).
- **Settings** (`app/settings/*`, one layout and nav; `/settings` → Account). Account is Clerk's `<UserProfile>` (sign-in off or test: a sentence); the user menu's "Manage account" goes there. Defaults (`settings` record; default style preselected in New project, reading direction used by the studio's reader — a shared page always opens right to left and the reader can flip it; the `voices` field is reserved with no UI until slice 22). Sharing lists the active shares (copy, update, unpublish). Data and privacy has Export and Delete. Usage moved inside the layout.
- **Export** (`lib/account/export.ts`, `zip.ts`): a `export` job on the new `account` queue builds a yazl zip in a temp file (`account.json`, `settings.json`, `shares.json`, `projects/<slug>-<id>/project.json` with the owner removed and the pictures one at a time), caps it, uploads it to the outputs store at `exports/<owner>/<jobId>.zip` and keeps only the latest. `GET /api/settings/export` (state), `/download` (attachment, `no-store`). Refused for a tombstoned account.
- **Account deletion** (`lib/account/deletion.ts`, `clerk.ts`, `counters.ts`, `state.ts`). The `delete-account` job (also enqueued by the `user.deleted` webhook; dedupe key per owner) runs, every step idempotent: mark the account deleted and **revoke its public links at once** → cancel its other jobs through `endJob` (holds released) → delete its data (each project's pictures — `projectImageIds` plus every job's `resultImageId` — re-read until no new picture appears, then the project, unreadable ones included; shares and the reports about them; videos and the `exports/` and `videos/` prefixes; settings; job records, releasing any hold) → purge its Redis counters and windows (`quota:`, `spend:`, `rl:*:` for that id only, never `spend:global:*`) → verification sweep → **delete the Clerk user last** → one more sweep → its own job record. Clerk is last on purpose (first-round review): a failed deletion leaves the person signed in to see the sentence and press *Try again*, and the worker can refuse to start without the secret rather than fail after changing things. Before anything changes the job checks Clerk can be asked; without `CLERK_SECRET_KEY` it ends `failed` at once with a sentence. **The worker therefore needs `CLERK_SECRET_KEY`**, and refuses to boot in clerk mode without it. Refused on a desk with sign-in off (it would wipe the local desk). The Delete card names what goes and what stays (a tombstone with no email so a late event cannot revive the account, the studio's anonymous spend totals, logs). **Known limits, stated plainly:** (1) a picture in the bucket that no record names — a worker still drawing when its job was cancelled can land one inside a window of milliseconds, and sheets replaced before this slice — cannot be found by owner (blob ids carry none) and may remain until a bucket lifecycle rule; (2) a deletion started by the Clerk webhook that keeps failing past BullMQ's retries (3 attempts) is not re-run, and that person cannot sign in to retry; (3) a still-valid session token (about a minute) can create a record after the final sweep when Clerk deletes the user; the second sweep narrows this, nothing closes it.
- **The `account` queue** (`QUEUE_NAMES` gains `account`; `export` and `delete-account` run there, concurrency 1, a second `Worker` beside `image`; the inline queue runs them in the web process). `enqueueAccountJob` skips the limits reservation, `GENERATION_ENABLED`, the credit breaker and the in-flight caps (a person must always be able to leave) and still answers the studio-busy sentence when Redis is required and down.
- **Dashboard v3** (`app/page.tsx`, `components/Dashboard.tsx`, `VideoCard.tsx`, `dashboard.css`). Header: quota meter, **Settings**, image counter, New project, account menu. Projects (with a *Shared* tag), Videos (only when `VIDEO_ENABLED`; a `VideoSummary[]` from `store.videos`, always empty until slice 22), Library, an empty-state line for a new account.
- **CR-8 closed.** `GET /api/projects/[id]/status` returns `{rev, activity}` from `store.projectStamp` (a projection) and the job list; `ownedProjectStamp` checks ownership from the stamp without reading the project. The Studio polls it on a recursive timeout (`lib/poll.ts`: no overlap, 1.5 s while live, back-off to 30 s on errors and 429 honoring `Retry-After`, paused in hidden tabs, one read on return) and fetches the full desk only when `rev` changed or a job just ended. The status reply is about 2% of the desk's. `check:poll` holds it (a whole-project read in the status route fails it).
- **Store** (`lib/store/*`): `shares`, `reports`, `settings`, `videos`, `outputs` (local `data/outputs/`, git-ignored with the other new runtime dirs; cloud `<prefix>outputs/<key>` in the outputs bucket), `jobs.deleteJob/deleteJobsOf`, `deleteProject`, `projectStamp` (`ownerId` is always a string), `projectsOf` (damaged projects included). **Departure from the contract:** the one-active-share guarantee in Mongo is a unique **sparse** index on `activeProject` (present only while the share is active; revoke removes it in the same write), not a partial index on `revokedAt: null`, because equality-with-null in a partial filter could not be tried here. The connect-time probe now writes and reads both buckets and lists the outputs folder (`S3_BUCKET_COMPILE_OUTPUTS` keys need read, write **and list**); the S3 client sends no `Expect: 100-continue`; large uploads get a timeout sized to the file.
- **Settings added** (`lib/config.ts`, `.env.example`): `ADMIN_EMAILS` (empty), `VIDEO_ENABLED` (false), `RATE_REPORT_PER_HOUR` (6), `RATE_ANON_MEDIA_PER_MIN` (600).
- **Where the build departs from the spec's words.** (1) Clerk is deleted last, not first (above). (2) The unknown-link page says "There is nothing at this link." (3) `app/admin/admin.css` does not exist: Next attaches a page's stylesheet to the page and a non-admin 404 would have carried its name, so the admin screens' styles live with their components. (4) The sparse index (above). (5) Settings Defaults carries no voice picker. (6) `lib/singleton.ts` gained an `accountQueue` lane.
- **Reviews.** A two-round adversarial review (seven lenses, three skeptics per finding, fixers that reproduced each first) confirmed 29 findings (23 in the first round, 6 in the second) and fixed or reduced them, saying what is left in notFixed, among them: account deletion could not complete in production (the worker had no Clerk secret, and Clerk was deleted before the data); a redraw after sharing deleted pictures a live share listed; replaced sheet pictures survived deletion; the Privacy and Terms pages still said sharing and deletion did not exist; a damaged project lost its shared pictures; a failed deletion could later read as finished; arrow keys turned pages behind dialogs; large export uploads died at 30 s; the outputs bucket was never probed; three checks that would not have caught a regression (the status route reading the whole desk, orphan video objects, the claimed-project owner guards). Full list in `security-report.md > Slice 21`.
- **Verified** (every real credential unset, `fetch` stubbed, a throwaway `redis-server`): `typecheck`, `lint`, `next build --webpack` (Turbopack's font fetch needs the network the sandbox lacks) and **all 21 `check:*`**, new: `check:share` (about 20 s; 14 numbered sections — the store, the sharing, reports and settings scripts as child processes, export, deletion with a crash at every step, the cloud adapter against plain-HTTP and fake-collection stand-ins) and `check:poll`. Mutation tests showed the checks hold: removing the shares lock, the robots header, the admin 404, the status route's one-stamp read, the outputs sweep, an owner guard or the account filter each fails a check. In a browser on a scratch desk with test sign-in: the desk with a shared project and four videos, the Share dialog, the public page (paged and vertical), the report dialog, the admin list and its unpublish, the revoked and never-existed links (identical), every Settings page, a real export download and a throwaway account's deletion, at 390, 768 and 1280 px with no sideways scroll. **Not run:** the Mongo and S3 halves (no `mongod`/bucket here; the cloud sections are unrun and gated behind `INKDESK_CHECK_CLOUD=yes` with localhost-only guards), Clerk mode (the `UserProfile` panel, the webhook and the Clerk user deletion are exercised by stubs), a production `next start` comparison of the non-admin admin 404 against an unknown route (in dev the two differ by the error overlay's payload).
- **Railway, for the learner** (the live checkpoint): on `web` set **`ADMIN_EMAILS`** (your address; it is matched against the verified email Clerk's webhook delivers, so sign in once first); on **`worker`** add **`CLERK_SECRET_KEY`** (deleting an account deletes its Clerk user; the worker will not start without it); the outputs bucket's key needs list permission as well as read and write; run `INKDESK_STORAGE=cloud INKDESK_CHECK_CLOUD=yes npm run check:share` once against a local `mongod` and an S3 stand-in if you can; then the checkpoint — share a chapter, open the link signed out on your phone, paste it in a chat app and look at the preview, report it, find the report in `/admin/reports`, unpublish it and reload the link; export your data; delete a throwaway account; tag `v3-cp6`. **Open questions this slice leaves:** an email service for report emails (none configured); a bucket lifecycle rule for orphaned pictures; whether `/s/*` should ever be indexable.

### As built — slice 22 (2026-10-18)

- **The trailer** is one `trailer` job in the worker: a shot per panel on Seedance (`VIDEO_MODEL`, unset: `seedance-2.0` in production, `seedance-2.0-fast` in development; `VIDEO_RESOLUTION` 720p / 480p), one voice per character (`TTS_MODEL`), one Lyria clip (`MUSIC_MODEL`), assembled with ffmpeg into `final.mp4` (1280×720, 24 fps, H.264 + AAC, about 22 s for a four-panel page), `poster.jpg` and `captions.vtt`, stored under `videos/<owner>/<id>/` in the outputs bucket.
- **The motion method** is `VIDEO_MOTION_METHOD` = `A` (the panel as `first_frame`) or `B` (panel and locked sheet as `input_references`, no `frame_images`); **unset means B, provisional** until the learner's verdict on slice 17.
- **Where the build differs from the plan above:** the motion prompt is written from a fixed template over the panel's stored action, camera and dialogue, not by Claude; pictures go to the provider inside the request as JPEG data URIs, not as signed bucket URLs (so no address is ever user-supplied); there is **no OpenRouter webhook** — shots are polled; and OpenRouter's base URL is fixed in `lib/openrouter.ts` (tests stub `fetch`).
- **Money, as reviewed:** the hold is the estimate × 1.03, settled once to the provider's billed cost; a trailer that billed anything never gives its hold back at $0, whatever ends it (worker ceiling, restart, account deletion); a run whose job is no longer current sends no new paid call; a shot already sent survives transient poll errors until its own timeout and is never re-submitted after a crash (it is marked orphaned; only Try again pays again). `VIDEO_SHOT_PARALLEL` × `VIDEO_SHOT_TIMEOUT_MS` is bounded so a trailer always ends inside the worker's ceiling.
- **Measured cost:** a 5 s shot at 720p bills about $0.76 whether wide or square (a square renders 960×960); a four-panel trailer at 720p is held at about **$2.69**, at 480p on `-fast` about **$0.75**.
- **Open for the learner (policy, not built around):** the free plan's $1/day cap is below a 720p trailer, so **only allowlisted accounts can animate at 720p**; seconds spent on a trailer with a failed shot stay counted, so on the free plan's 20 s a day **Try again can be refused for quota**; and two refusal sentences in the limits layer are inexact ("used today's 20 seconds" at 17; "reached the $1.00 limit" before it is reached) — `check:limits` pins them word for word.
- **Checks:** `check:video` (cost against the slice-17 bills, every shot state and the crash/orphan rule, settle-once under a racing reconciler, the request bodies for A and B, real ffmpeg assembly with bubbles on time, ownership on the 5 video routes, shares, `VIDEO_FAIL_SHOT` ignored in production).

## Verified for v3 (2026-10-14)

**OpenRouter video** (docs at `openrouter.ai/docs` — video generation guides and API reference; `GET /api/v1/videos/models`, 30 models):
- `POST /api/v1/videos` → 202 `{id, polling_url, status: pending}`; `GET /api/v1/videos/{id}` → `pending | in_progress | completed | failed | cancelled | expired`, with `unsigned_urls` and `usage.cost`; `GET /api/v1/videos/{id}/content?index=0` with the bearer key; the result **expires** (`expires_at`) — download at once. No list endpoint, no idempotency key. Webhooks: per-request `callback_url` (HTTPS), `X-OpenRouter-Signature: t=…,v1=…` = HMAC-SHA256 of `"{t},{raw body}"`, 5-minute tolerance, de-duplicate on `X-OpenRouter-Idempotency-Key`. Video is not eligible for zero data retention.
- Fields: `model, prompt, duration, resolution, aspect_ratio | size, generate_audio, seed, callback_url, session_id, user, frame_images[{type:'image_url', image_url:{url}, frame_type:'first_frame'|'last_frame'}], input_references[]` (image; audio and video references on Seedance 2+). **`frame_images` and `input_references` are exclusive** — sent together, the references are dropped (OpenRouter docs and ByteDance ModelArk docs). Reference images: 1–9 on Seedance 2.0, 1–30 on 2.5. Seedance 2.x **refuses reference images with real human faces**.
- `bytedance/seedance-2.0`: 480p–4K, 4–15 s, ratios 1:1, 3:4, 9:16, 4:3, 16:9, 21:9, 9:21, first and last frame, `seed`, audio; **$7.0 per million video tokens** ($7.7/M at 1080p), audio at no extra cost. **Tokens = W × H × seconds × 24 / 1024** (OpenRouter's model page; checked against its own per-second prices). So 720p 16:9 (1280×720) = 21,600 tokens/s = **$0.151/s, $0.756 per 5 s**; **720p 1:1 renders at 960×960, not 720×720 (measured 2026-10-14), so it costs the same $0.151/s**, not $0.085/s; 480p 16:9 on `seedance-2.0-fast` ($4.2/M) = $0.040/s.
- The billed `usage.cost` with references attached is the one thing still to confirm by the first paid shot.

**Clerk** (`@clerk/nextjs` 7.9.15 unpacked; clerk.com docs): peer `next ^16`, `react ~19.3`; Node ≥ 20.9; `proxy.ts` on Next 16; `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is the name read; `CLERK_JWT_KEY` passed as `jwtKey`; `verifyWebhook` reads `CLERK_WEBHOOK_SIGNING_SECRET`; `createRouteMatcher` deprecated; Core 3 removed `SignedIn`/`SignedOut`/`Protect` in favour of `<Show>`; production needs own Google/GitHub OAuth credentials and DNS records; keyless mode exists for development only.

**Next 16.4** (`node_modules/next/dist/docs`): `middleware` deprecated and renamed `proxy`, Node runtime always, both files present is a build error; Proxy buffers request bodies up to `experimental.proxyClientMaxBodySize` (10 MB default); `after()` lasts only as long as the route's `maxDuration` — not a queue.

**Railway** (docs.railway.com): custom domain = `CNAME` + `TXT`; apex through CNAME flattening or ALIAS; Trial plan = one custom domain; health check path, 300 s default timeout, from `healthcheck.railway.app`; Redis exposes `REDIS_URL`; private networking at `<service>.railway.internal`.

**History scan:** all 80 commits searched for OpenRouter, Anthropic, Clerk, AWS/R2, Mongo-with-password, Redis-with-password, webhook-secret and PEM patterns — **no match**; `.env` was never committed (only `.env.example`). A `gitleaks` run is part of slice 16 to confirm with a maintained rule set.

## Production Models (v3) — proposed, each adopted only after a test

| Model (OpenRouter) | Purpose | Cost (verified listing) | Test before adopting |
|---|---|---|---|
| `bytedance/seedance-2.0` | **the trailer's shots** | $0.151/s at 720p 16:9 | the motion kernel test |
| `bytedance/seedance-2.0-fast` | development and previews at 480p | $0.040/s at 480p 16:9 | used for dev only; never the claim |
| `bytedance/seedance-2.0-mini` | cheapest 2.x; `return_last_frame` chains shots | $3.5/M tokens | continuity test across two shots |
| `bytedance/seedance-2.5` | 30 s shots, 30 references, extend a shot | $10.7/M tokens | motion kernel test |
| `black-forest-labs/flux-video-upscale` | a 1080p master from 720p | 7.5¢ per megapixel-second (input or output basis unstated) | one paid probe to read the bill |
| `black-forest-labs/flux-video-edit` | fix one detail without re-generating | listed per second | a before/after on a failed shot |
| `kwaivgi/kling-v3.0-std` / `-pro` | fallback image-to-video | $0.084 / $0.112 per s | the motion kernel test |
| `google/veo-3.1-lite` | cheap fallback with native audio | ≈ $0.05/s at 720p | the motion kernel test |
| `elevenlabs/eleven-v4` | one voice per character | $0.00004/char | already used (v2 narration) |
| `google/lyria-3-clip-preview` | the trailer's music | $0.04 per 30 s | already used (v2 music) |

Frame interpolation is not offered as a separate model on OpenRouter's listing; Seedance's own 24 fps output is used as is.

## Data Model (v3)

- `users {_id: clerkUserId, email, plan: 'free'|'allowlisted', admin: bool, createdAt, deletedAt?}`
- `projects` — v2's `Project` + `ownerId`; nothing else moves
- `jobs {_id, ownerId, projectId, kind: 'sheet'|'panel'|'cover'|'text'|'shot'|'speech'|'music'|'assemble'|'export'|'delete-account', status, attempts, reservedUsd, costUsd, reservation: 'none'|'held'|'settled' (slice 20), carriedUsd (slice 20: a stranded picture's cost already counted by an earlier job), error?, providerJobId?, createdAt, updatedAt}`
- `videos {_id, ownerId, projectId, page, status, shots: [{panel, method, state, providerJobId?, blobKey?, seconds, costUsd, error?}], finalKey?, posterKey?, captionsKey?, seconds, costUsd, createdAt}`
- `shares {_id: token, ownerId, kind, projectId?, videoId?, snapshot, createdAt, revokedAt?}`
- `reports {_id, token, reason, note, ipHash, at, handledAt?}`
- `settings {_id: userId, defaultStyle, readingDirection, voices: {lead, counterpart}}`
- Redis (all under `inkdesk:`; dollars are integer micro-dollars): `rl:<bucket>:<id>` (sliding windows; bucket is `text`, `image`, `upload`, `edit`, `read`, `media` or `anon`), `quota:<userId>:<YYYYMMDD>:<kind>` (`kind` is `image`, `project`, `videoSeconds` or `audioChars`), `spend:<userId>:<YYYYMMDD>`, `spend:<userId>:<YYYYMM>` (the month, as built in slice 20), `spend:global:<YYYYMMDD>`, `spend:global:total`, `resv:<id>` (a hold's marker: what one job, text call or new project raised, and on which day) and `resv:index` (the unsettled holds no job record backs, by sweep deadline), `breaker:credits`, `heartbeat:worker`, `lock:<key>`

## Failure Modes (v3)

| What fails | What the user sees | What the system does |
|---|---|---|
| Redis down | "The studio is busy — try again in a few minutes" on generate buttons | enqueue refused (503); reads, reader, shares work from Mongo and the bucket |
| Worker down | the status line; jobs stay *queued* | the reconciler re-enqueues on start; nothing paid is lost |
| Mongo down | an error page with a retry | health check fails; Railway holds the old deploy |
| A Seedance shot fails or is refused (real face, policy) | that shot's card: why, **Try again** | others continue; reservation released |
| OpenRouter 402 (credit) | "The studio has paused generation for today" | global switch trips; learner alerted in logs |
| Global daily cap reached | the same pause message for everyone | `reserve` refuses before any call |
| A user over quota | disabled buttons with reason and reset time | `reserve` refuses |
| Crash between a paid video POST and saving its job id | the shot shows *failed — not charged twice* | marked `orphaned`, never re-submitted; findable in OpenRouter's logs by `session_id` |
| Clerk webhook replay | nothing | de-duplicated on the message id |
| Share revoked | not found | same page as an unknown token |

## File Structure (v3)

```
proxy.ts                               # Clerk gate, www→apex, Origin check (the request windows are not here: requireUser takes them, lib/limits/requests.ts)
instrumentation.ts                     # boot: validate config (fail fast)
worker/index.ts                        # BullMQ processors: image, video, audio; reconciler; heartbeat
lib/config.ts                          # every env variable, zod-validated, server-only; the learner's names mapped
lib/auth/{session,access}.ts           # requireUser(); ownedProject/ownedVideo/ownedBlob → 404
lib/limits/                            # built in slice 20 (see As built): rules, clock, backend, memory, redis (Lua), plan, hold
                                       #   (reserve/preflight/settle/release), estimate, jobs (holdForJob, settleEnded, sweepUnsettled),
                                       #   text (spendText, spendProject), requests (windows, client address), usage (usageView), index;
                                       #   view.ts (the contract with the screens), button.ts and use-usage.ts (client)
lib/queue/ending.ts                    # endJob: the one door every job ending goes through, so its hold is settled or released
lib/queue/{queues,jobs,enqueue}.ts     # BullMQ queues; Mongo jobs as the record
lib/store/{cloud,local,index}.ts       # + users, jobs, videos, shares, reports, settings; two buckets; signed URLs
lib/video/{frames,prompt,shots,assemble,cost,models}.ts
lib/audio/{tts,music}.ts               # ported from video/narrate.mts and video/music/generate.mts
lib/share/snapshot.ts
lib/log.ts                             # pino with redaction
app/sign-in/[[...sign-in]]/page.tsx, app/sign-up/[[...sign-up]]/page.tsx
app/terms/page.tsx, app/privacy/page.tsx
app/settings/{layout,account,defaults,sharing,data,usage}   # built in slice 21 (usage was standalone in slice 20)
app/admin/reports/page.tsx
app/s/[token]/{page,opengraph-image}.tsx
app/api/health/route.ts
app/api/usage/route.ts
app/api/webhooks/clerk/route.ts
app/api/projects/[id]/image/[imageId]/route.ts     # replaces /api/image/[id]
app/api/projects/[id]/pages/[n]/animate/route.ts   # estimate (GET), confirm (POST)
app/api/videos/[videoId]/route.ts                  # status, retry a shot
app/api/projects/[id]/share/route.ts, app/api/videos/[videoId]/share/route.ts
app/api/s/[token]/{image/[imageId],video,report}/route.ts
app/api/settings/{export,delete}/route.ts
components/{QuotaMeter,SpendNote,UsagePanel,AnimateStation,ShotCard,ShareDialog,ReportDialog}.tsx   # the first three exist (slice 20)
scripts/{claim-projects,move-media-to-bucket}.mts
scripts/{auth,limits,queue,share,video,config}-check.mts
devpost/security-report.md
```

## Dependencies (v3)

Pinned exactly, each at least a few days old at install: `@clerk/nextjs` 7.9.14 (7.9.15 published 2026-10-13), `bullmq` 6.3.12 (2026-10-09), `ioredis` 5.11.1 (6.0.0 is two days old; BullMQ accepts ≥ 5), `sharp` 0.35.5, `yazl` 3.3.1, `pino` 10.4.0, `server-only`. Docs: clerk.com/docs, docs.bullmq.io, docs.railway.com, openrouter.ai/docs (video, audio), sharp.pixelplumbing.com.

## Quality, Cost and Budget (v3)

Development at `low` images and **480p `seedance-2.0-fast`** for trailer runs; the motion kernel test and the filmed trailer at **720p `seedance-2.0`**. The arithmetic and the over-budget finding are in `scope.md > Budget (v3)`: ≈ $8.50 needed, ≈ $7.70 left, plus the public kill switch. Proposed guard, the learner's to accept: `GLOBAL_DAILY_USD_CAP=5` **and** `GLOBAL_TOTAL_USD_CAP` (a cumulative ceiling across all days), **and** a credit limit on the OpenRouter key itself, with auto top-up off.

## Decisions and Open Issues (v3)

- **One useful unknown — the motion method.** The learner's first design put the panel as the first frame *and* the sheet as a reference in one call; the docs say that cannot be done. The motion kernel test (`scripts/kernel-test.mjs --motion`) answers which allowed method holds the face: A (first frame) or B (both as references, the panel named as the opening frame). The learner chooses from the frame strips; the choice is recorded here.
- **Whose variables are these?** (`Environment and Configuration (v3)`) — blocks slice 16.
- **The domain** — blocks the DNS work in slice 16 and Clerk production in slice 18.
- **Budget, kill switch, cumulative cap** — the learner's (`scope.md > Budget (v3)`).
- **Error tracking service, email service for reports** — the learner's; logs and the admin list work without them.
- **Tags** — this session's push of tag refs is refused (HTTP 403); the learner pushes each tag.
