---
doc: spec
status: draft
---

# Ink Desk — Technical Spec

The blueprint for `prd.md`. One Next.js app, two AI providers called from the
server, one chapter of work kept on disk.

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
   code that sees your API keys, and the only code that talks to Claude or
   OpenAI. The browser asks them for things; it never calls a provider itself.
   This is what `scope.md > Model Providers` requires.
3. **The desk** — a folder on your laptop called `data/`. Every generated image
   is a `.png` file in `data/images/`, and everything else about the chapter —
   the synopsis, the cast, the locked DNA, the page script, which panel version
   is showing — is a single file, `data/chapter.json`.

**The two AI providers do different jobs.** Claude writes all the words:
synopsis, characters, each character's visual DNA, the four-panel script, the
dialogue. OpenAI's image model draws all the pictures: two model sheets and four
panels.

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
                                (b) DNA text → sheet image    ──▶  OpenAI
                                         /v1/images/generations
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
                                  sends sheet AS REFERENCE     ──▶  OpenAI
                                  + locked DNA verbatim             /v1/images/edits
                                  + Claude's action/angle/bg
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
| Text generation | **Anthropic — `claude-sonnet-5-5`** | https://docs.claude.com/en/api/messages |
| Image generation | **OpenAI — `gpt-image-2.5-sunburst-2026-09-08`** | https://developers.openai.com/api/docs/guides/image-generation |
| Structured JSON from Claude | `zod` + the SDK's `zodOutputFormat` helper | https://docs.claude.com/en/docs/build-with-claude/structured-outputs |
| Fonts | `next/font/google` — Cormorant Garamond, Lora, Comic Neue | https://nextjs.org/docs/app/api-reference/components/font |

Packages: `next`, `react`, `react-dom`, `typescript`,
`@anthropic-ai/sdk`, `openai`, `zod`.

**Why Next.js App Router** (learner's choice, from their named stack): one
process, and server-side route handlers hold both `ANTHROPIC_API_KEY` and
`OPENAI_API_KEY` so neither reaches the browser —
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
node scripts/kernel-test.mjs --probe-only   # ~$0.006 — both model IDs + structured output
node scripts/kernel-test.mjs                # ~$0.06 — proves the face holds
open data/kernel-test/index.html            # sheet, close-up and wide, side by side
```

`--probe-only` runs two probes. The **text probe** is one tiny
structured-output call that proves `ANTHROPIC_MODEL` resolves *and* that
`output_config.format` works on it — and, because it deliberately sends no
sampling parameters, it would also catch that mistake. The **image probe** is
one `low` generation proving `OPENAI_IMAGE_MODEL` resolves. Between them, every
provider assumption in this spec is checked for well under a cent.

**Run the app:**

```bash
npm run dev     # then open http://localhost:3000
```

**For the demo recording** — the shot is already written in
`scope.md > What "Working" Looks Like`:

1. Set `OPENAI_SHEET_QUALITY=max` and `OPENAI_PANEL_QUALITY=high` in `.env`,
   then restart `npm run dev`.
2. Delete `data/` for a clean first-use state.
3. Story → **"Try the sample"** → accept the synopsis.
4. Cast → **Draw sheet** on Kaito → **Lock**. *Film the stamp landing.*
5. Lock Mio, let the page script write, let the four panels ink in.
6. Split screen: Kaito's locked sheet beside panels 1 and 3.
7. Ink & Publish → the reveal replay, the right-to-left toggle, PNG export.

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
│  1   KAITO · wide establishing          │   1536×1024   landscape
│                                         │
├──────────────────────┬──────────────────┤
│  2   MIO             │  3   KAITO       │   1024×1024   square
│      medium          │      close-up    │   1024×1024   square
├──────────────────────┴──────────────────┤
│  4   MIO · reaction, wide               │   1536×1024   landscape
│                                         │
└─────────────────────────────────────────┘
```

| Panel | Character | Shot | Generated size | Page slot |
|---|---|---|---|---|
| 1 | Kaito | wide establishing | `1536×1024` | full width, top |
| 2 | Mio | medium | `1024×1024` | middle left |
| 3 | Kaito | **close-up** | `1024×1024` | middle right |
| 4 | Mio | reaction, wide | `1536×1024` | full width, bottom |

**Each panel's size is fixed, and passed in its own request.** The three sizes
the model offers are `1024×1024`, `1536×1024` and `1024×1536`; the two in use
here are chosen so the generated aspect ratio already matches the slot it will
sit in. Nothing is scaled to fit, which means **nothing is ever cropped through
a face** — the one failure that would undo the kernel after the model got it
right.

**The framing also goes in the prompt**, not just the request, so the model
composes for the shape it's drawing:

- Square close-up — *"Centre his face in frame with headroom above and below;
  keep his eyes on the upper third line and nothing important near the edges."*
- Wide landscape — *"Place him off-centre in the left third, full body inside
  the frame with clear margin on every side."*

**The model sheet is landscape, `1536×1024`** — it's a row of poses (front,
three-quarter, a few expressions in one frame, per
`scope.md > The POC Boundary`), so a square would either crowd them or waste
half the image.

The two landscape panels bookending two squares is also just good manga page
design: a wide establishing shot to open, the tight shot/reverse-shot pair in
the middle, and a wide reaction to close.

> **Sizes live in `.env`** as `OPENAI_SHEET_SIZE`, `OPENAI_PANEL_SIZE_WIDE` and
> `OPENAI_PANEL_SIZE_SQUARE`, with the per-panel assignment in
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

Bubble placement is **derived, not authored**: a small lookup keyed on the
panel's camera angle picks a corner, so Claude never has to return coordinates
and there is nothing extra to get wrong.

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

Both OpenAI endpoints return **base64, never a URL**. This decodes once, writes
`data/images/<id>.png`, and returns only the id — which is why the browser only
ever sees `/api/image/<id>` and never carries image bytes around. Also bumps
`imageCount` for the header counter.

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
  action: string; camera: string; background: string; dialogue: string
  versions: PanelVersion[]      // newest last, max 3, oldest dropped
  currentVersion: number        // the one that counts: on the page and in the export
  status: 'empty' | 'inking' | 'done' | 'failed' | 'refused'
  startedAt: string | null      // for the timeout fallback
  startedByRun: string | null   // for the restart fallback
}

type PanelVersion = { imageId: string; createdAt: string }
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
│       ├── sheet/route.ts           # description → DNA → sheet image  (Claude + OpenAI)
│       ├── script/route.ts          # synopsis + locked DNA → 4 panels       (Claude)
│       ├── panels/start/route.ts    # queue all four panels
│       ├── panels/[index]/route.ts  # generate or redraw one panel           (OpenAI)
│       ├── panels/[index]/rewrite/route.ts  # rephrase visuals, then redraw  (Claude + OpenAI)
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
│   ├── openai-image.ts              # generations (sheets) + edits (panels)
│   ├── chapter.ts                   # serialized, atomic read/write of chapter.json
│   ├── singleton.ts                 # globalThis-pinned queue, lock, serverRunId
│   ├── images.ts                    # b64 → data/images/<id>.png
│   ├── queue.ts                     # concurrency-2 panel queue
│   └── gates.ts                     # which stations are unlocked, derived
├── scripts/
│   └── kernel-test.mjs              # slices 1 and 2 — probes both models, then the lock
├── data/                            # GITIGNORED — created at runtime
│   ├── chapter.json
│   ├── images/<id>.png
│   └── kernel-test/                 # sheet + two panels + index.html to compare
├── devpost/                         # the planning workspace
├── assets/{svg,png,webp}/           # the learner's logo, pre-existing, tracked
├── .env.example
├── .env                             # GITIGNORED
└── README.md                        # setup, run, and the pre-existing-work disclosure
```

**Not in the repo:** `reference/Ink Desk.html`, the pre-existing UI mockup, is
gitignored — it stays on the learner's disk as a visual reference and is
**still disclosed in the README at ship time** as pre-existing work, per
`scope.md > Pre-Existing Work to Disclose in the README`. Ignoring the file does
not remove the disclosure obligation; `6-ship` still has to write it. The logo
files under `assets/` are tracked, because the app actually loads them.

---

## External Services and Dependencies

### Anthropic — Claude (text)

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
  thinking: { type: 'disabled' },              // short calls; latency is on camera
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
- **Adaptive thinking is still on by default**, so `thinking: { type:
  'disabled' }` has to be set explicitly.

Four schemas in `lib/schemas.ts`: `SynopsisSchema`, `CastSchema`, `DnaSchema`,
`PageScriptSchema`. **The one-locked-character-per-panel rule from
`prd.md > Page Script` is expressed as a `z.enum([...])` of the two locked
character ids** — so a panel naming two characters, or a character who
isn't locked, is rejected by the API rather than caught later by a check
somebody has to remember to write.

Three constraints worth knowing before writing the schemas, because each is a
400 rather than a warning:

- Every object needs `additionalProperties: false` — `zodOutputFormat` handles
  this. No recursive schemas; no `min`/`max` on numbers or strings.
- **Do not send `temperature`, `top_p`, or `top_k`.** They are rejected on
  `claude-sonnet-5-5`. Prompt wording is the only steering lever.
- **No assistant-message prefills.** `output_config.format` is the replacement,
  which is what we're using anyway.

`thinking: { type: 'disabled' }` plus `effort: 'low'` is the starting point:
these calls are short, structured, and their latency is visible on camera.
Adaptive thinking is **on by default** on `claude-sonnet-5-5`, so this has to be
set explicitly. If the synopsis or dialogue reads flat, dropping `thinking` from
those two calls is a one-line change — try that before touching the prompts.

Prompt caching is **not** used: the minimum cacheable prefix on
`claude-sonnet-5-5` is 1024 tokens and these prompts are far shorter, so a
`cache_control` marker would pay the write premium and never be read.

### OpenAI — GPT Image (pictures)

- **Model:** `gpt-image-2.5-sunburst-2026-09-08`, pinned, for both sheets and
  panels. See **Verified: Image Model and Reference-Image Support** below.
- **Docs:** https://developers.openai.com/api/docs/guides/image-generation
- **Prompting guide:** https://developers.openai.com/api/docs/guides/image-prompting

**Sheet — `POST /v1/images/generations`.** Text to image, from the DNA.
Landscape, because a model sheet is a row of poses. JSON body; returns
`{ data: [{ b64_json }] }`.

```ts
{ model, prompt: sheetPrompt(dna), size: SHEET_SIZE,   // 1536x1024
  quality: SHEET_QUALITY, n: 1 }
```

**Panel — `POST /v1/images/edits`.** This is the kernel. `multipart/form-data`,
with the locked sheet attached as the reference and the panel's own size from
**The Page Layout**:

```ts
const form = new FormData()
form.append('model', MODEL)
form.append('prompt', panelPrompt(dna, panel))   // locked DNA verbatim + framing + Claude's variable part
form.append('size', panel.size)                  // 1536x1024 or 1024x1024
form.append('quality', PANEL_QUALITY)
form.append('image', new Blob([sheetPng], { type: 'image/png' }), 'sheet.png')
```

- **`input_fidelity` must not be sent.** It is a `gpt-image-1.x` parameter. The
  docs say *"Omit this parameter when migrating to GPT Image 2, which always
  uses high input fidelity"* — face preservation is now the default rather than
  a setting that can be misconfigured.
- Responses are **base64 (`b64_json`), never a URL**, which is exactly why
  `lib/images.ts` exists: decode once, write to `data/images/<id>.png`, keep
  only the id.
- Every panel prompt ends with an explicit **no text, no speech bubbles, no
  sound effects** instruction — `scope.md > Lettering`.
- Both the model and the two quality levels are `.env`-configurable, so the
  build runs at `low` and only filming pays for `max`/`high`.

---

## Verified: Image Model and Reference-Image Support

This resolves `scope.md > Needs Verifying in 4-spec` and the carried-over item
in `prd.md > Open Questions` — *"which GPT Image model and endpoint accept
reference images, and how many per request."* The whole kernel rested on it.

**Reference images are supported, with room to spare.** `POST /v1/images/edits`
takes an `image` **array**, not a single file; OpenAI's own guide example passes
four reference images. Ink Desk sends exactly **one** per panel request, so the
limit is never in play. `scope.md > The Unique Kernel` is buildable as written.

**`gpt-image-1` shuts down 2026-10-23; `gpt-image-1.5` on 2026-12-01.** The
"GPT Image model family" named in `scope.md > Model Providers` would have gone
dark during the hackathon. Both are out.

**Chosen model — pinned:** `gpt-image-2.5-sunburst-2026-09-08`, for **both**
sheets and panels. `gpt-image-2.5-sunburst` is the current most-capable model
for generation *and* editing; `gpt-image-2.5-flare` is generation-only, so it
cannot carry a reference image. Pinned to a dated snapshot rather than the
floating alias so an upstream revision cannot change the art style mid-build —
the thing the kernel is measured on.

**Same model for both surfaces** because the sheet is the reference the panels
are judged against. A sheet drawn by one model and panels by another would
differ in line weight and rendering style even with the face held steady —
exactly the mismatch `scope.md > What "Working" Looks Like` is testing for.

> **Both pinned IDs are confirmed on the official model pages** — the image
> snapshot `gpt-image-2.5-sunburst-2026-09-08` and the text model
> `claude-sonnet-5-5`. Slice 1 still probes both, not because they're doubted
> but because a wrong ID or a bad key fails identically and confusingly, and
> `--probe-only` turns that into a two-second answer for about $0.006 instead
> of a confusing failure three stations into the build. If the image snapshot
> ever 404s, fall back to the floating `gpt-image-2.5-sunburst` alias and record
> the working ID here.

### Quality, Cost, and the `.env` Switch

Five paid quality levels. Verified output cost per image at **1024×1024**:

| Quality | `1024×1024` | `1536×1024` *(est.)* | Used for |
|---|---|---|---|
| `low` | ~$0.006 | ~$0.009 | **development builds** |
| `medium` | ~$0.013 | ~$0.020 | **the kernel test** |
| `high` | ~$0.053 | ~$0.080 | **panels**, filming |
| `xhigh` | ~$0.094 | ~$0.141 | — |
| `max` | ~$0.211 | ~$0.317 | **sheets**, filming |

> **The landscape column is an estimate, stated as one.** Image output is billed
> per output token and tokens scale with pixels, so `1536×1024` is ~1.5× the
> `1024×1024` figure. Only the square column is from the official model page.
> Confirm the real landscape cost from the usage dashboard after the kernel
> test, which generates two landscape images.

**Quality plan:** sheets at `max` (only two per chapter, and each is the
canonical reference every panel is compared against — worth the spend), panels
at `high`.

**A full filming run**, with the sizes from **The Page Layout**:

| Images | Size | Quality | Subtotal |
|---|---|---|---|
| 2 sheets | `1536×1024` | `max` | ~$0.63 |
| 2 panels (1, 4) | `1536×1024` | `high` | ~$0.16 |
| 2 panels (2, 3) | `1024×1024` | `high` | ~$0.11 |
| | | **total** | **~$0.90** |

Plus ~$0.05–$0.08 per panel redraw, depending on which slot. The same run at
`low` throughout is about **$0.05**. That ratio is what makes iterating on
prompts affordable. `scope.md > The POC Boundary` budgeted "roughly 6 images per
full run"; that holds — the sizes moved, the count didn't.

The full list lives in `.env.example`; these are the ones that change behavior:

```
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst-2026-09-08   # pinned
ANTHROPIC_MODEL=claude-sonnet-5-5                      # pinned

OPENAI_SHEET_SIZE=1536x1024         # a model sheet is a row of poses
OPENAI_PANEL_SIZE_WIDE=1536x1024    # panels 1 and 4
OPENAI_PANEL_SIZE_SQUARE=1024x1024  # panels 2 and 3

OPENAI_SHEET_QUALITY=low      # filming: max
OPENAI_PANEL_QUALITY=low      # filming: high
KERNEL_TEST_QUALITY=medium    # deliberately not low — see The Useful Unknown

PANEL_CONCURRENCY=2
GENERATION_TIMEOUT_MS=180000  # placeholder; set from the kernel test
```

`.env.example` ships with the **development** values, so a fresh clone builds
cheaply and only filming opts into the expensive ones.

### Rate Limits and Concurrency

Published tiers are **Build 20 IPM / Launch 150 IPM / Grow 250 IPM** (images per
minute).

**Panel concurrency: 2.** This resolves the open call in
`prd.md > Open Questions`. At Build's 20 IPM even four-at-once wouldn't trip the
limit, so this is margin rather than necessity — but it costs nothing, it keeps
panels filling out of order as `prd.md > Storyboard — The Main Studio` requires,
and it keeps a 429 off camera.

*Learner to confirm their own tier at Settings → Organization → Limits before
filming.* `gpt-image-2.5-sunburst` is the slower of the two current models; the
pencil-sketch placeholder states already cover that latency.

---

## Important Failure Modes

The places this will realistically break in front of someone. Behavior is
specified in `prd.md > States and Boundaries`; this is the mapping.

- **A panel request is rate-limited or times out (429 / timeout)** → the handler
  **retries once, silently**. If that also fails, the panel's status becomes
  `failed` and the frame shows *"Panel 3 didn't come back, the studio is busy"*
  with **Try again**. The other three panels are untouched.
- **The image model refuses a panel** → status `refused`, and the frame offers
  **Rewrite panel**, which asks Claude to rephrase **only** that panel's action,
  camera angle and background — never the dialogue, never the DNA — and retries.
  A refusal is a wording problem, not a waiting problem, so it gets a different
  button than a timeout.
- **A redraw fails** → the panel's **previous version stays on screen** and the
  message offers **Try again**. The status only leaves `done` once a replacement
  exists, so **Ink & Publish stays open** throughout. A failed redraw never
  leaves a panel empty, and the page is never less finished than it was.
- **The dev server restarts mid-generation** (the common one — every code change
  does it) → in-flight panels are orphaned, and the `startedByRun !==
  serverRunId` check demotes them to `failed` with **Try again** on the next
  read. See **Reload Mid-Generation**.
- **A pinned model ID or a key is wrong** → every image call fails identically
  and confusingly. This is why build slice 1 is a single `--probe-only` call
  before any UI exists.
- **Claude returns a panel naming an unlocked or second character** → rejected
  by the `z.enum` of locked ids at the API boundary, surfaced as a retry of the
  script call rather than a broken page.

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
  `GET /api/chapter` every ~1.5s while any panel is inking. Server-sent events
  would be tidier and are invisible on camera; a poll is a few lines and cannot
  get stuck half-open.
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

## Decisions and Open Issues

### Decided

- **Image model `gpt-image-2.5-sunburst-2026-09-08`, pinned, for sheets and
  panels.** Learner's choice. Forced by the `gpt-image-1` shutdown; pinned so
  the art style cannot shift mid-build. Tradeoff accepted: it is the slower
  model, which the placeholder states already cover.
- **Panels via `/v1/images/edits` with one reference image; sheets via
  `/v1/images/generations`.** Derived from the verification.
- **Sheets at `max`, panels at `high`, both `.env`-configurable.** Learner's
  choice, so development runs at `low` and only filming pays.
- **Text model `claude-sonnet-5-5`, pinned and `.env`-configurable.** The
  learner caught that `claude-sonnet-5` was superseded on 2026-09-28; the ID was
  corrected from the official models page, and structured-output support plus
  the sampling-parameter rejection were re-verified against the 5.5 family
  rather than inherited. Slice 1 now probes the text model too.
- **One 4-panel page layout with fixed per-panel sizes** — wide / two squares /
  wide, passed in each request and echoed as a framing line in each prompt.
  Learner's call. Chosen so a generated panel never has to be scaled into its
  slot, which is the one way to lose a face *after* the model got it right.
- **The model sheet is landscape `1536×1024`.** Learner's call: a sheet is a row
  of poses, so a square would crowd them or waste half the image.
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
Verification settled the **mechanism** — a reference image plus frozen DNA text
is supported, and `gpt-image-2.5-sunburst` always runs at high input fidelity.
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
would prove nothing. About **$0.06** for all four images, at the same sizes the
real page uses.

**This runs before any UI exists.** If the kernel doesn't hold, that is worth
knowing on day one rather than after five stations are built on top of it. It
also produces a second useful number — the slowest call's duration, which is
what `GENERATION_TIMEOUT_MS` should be set from.

### Open

- **The generation timeout value.** Needs a real number, measured by the kernel
  test. Placeholder `180000` in `.env.example`; set it in `5-build`.
- **The learner's OpenAI tier.** Build / Launch / Grow changes the IPM ceiling.
  Concurrency 2 is safe on all three, so this does not block the build — confirm
  at Settings → Organization → Limits before filming.
- **The exact Next.js version.** Whatever `create-next-app@latest` installs.
  Nothing here depends on a specific major.
- Carried from `prd.md > Open Questions`, none blocking: page script as its own
  rail entry vs. a step inside Storyboard (drafted as a step); genre and tone
  chip sets (assumed as the mockup has them); ink-in reveal timing in the reader
  (tune during build).
- **A server-side image cap** — not built, since the app stays local-only.
  Becomes required if deployment is revisited.
