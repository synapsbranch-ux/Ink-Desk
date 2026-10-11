---
doc: spec
status: draft
---

# Ink Desk — Technical Spec

> **Draft in progress.** The image-model verification, the stack, and the
> generation contracts are settled and recorded below. Sections marked
> **_Pending_** are still being worked through in the `4-spec` conversation.

---

## Verified: Image Model and Reference-Image Support

This resolves `scope.md > Needs Verifying in 4-spec` and the carried-over item in
`prd.md > Open Questions` — *"which GPT Image model and endpoint accept reference
images, and how many per request."* The whole kernel rested on it.

**Reference images are supported, with room to spare.** `POST /v1/images/edits`
takes an `image` **array**, not a single file; OpenAI's own guide example passes
four reference images. Ink Desk sends exactly **one** per panel request, so the
limit is never in play. `scope.md > The Unique Kernel` is buildable as written.

**`gpt-image-1` shuts down 2026-10-23; `gpt-image-1.5` on 2026-12-01.** The
"GPT Image model family" named in `scope.md > Model Providers` would have gone
dark during the hackathon. Both are out.

**Chosen model — pinned:**

```
gpt-image-2.5-sunburst-2026-09-08
```

Used for **both** sheets and panels. `gpt-image-2.5-sunburst` is the current
most-capable model for generation *and* editing; `gpt-image-2.5-flare` is
generation-only, so it cannot carry a reference image.

Pinned to a dated snapshot rather than the floating alias so an upstream model
revision cannot change the art style mid-build — the thing the kernel is
measured on.

> **Unverified string, to prove in build step 1.** The snapshot ID
> `gpt-image-2.5-sunburst-2026-09-08` comes from the learner reading the official
> model page; it did not appear in the documentation pages fetched during
> verification. **Build slice 1 is a single `low`-quality call that proves the
> pinned ID resolves** before any UI depends on it. If it 404s, fall back to the
> floating `gpt-image-2.5-sunburst` alias and record the working ID here.

**Why the same model for both surfaces:** the sheet is the reference the panels
are judged against. A sheet drawn by one model and panels drawn by another would
differ in line weight and rendering style even with the face held steady —
introducing exactly the visual mismatch `scope.md > What "Working" Looks Like`
is testing for.

**`input_fidelity` does not apply and must not be sent.** It is a `gpt-image-1.x`
parameter. The docs state: *"Omit this parameter when migrating to GPT Image 2,
which always uses high input fidelity."* Face preservation is now default
behavior rather than a setting that can be misconfigured — a small, real win for
the kernel.

### Two Calls, Two Endpoints

| Surface | Endpoint | Reference image | PRD ref |
|---|---|---|---|
| **Model sheet** | `POST /v1/images/generations` | none — text→image from the visual DNA | `prd.md > Cast — Model Sheets` |
| **Panel** | `POST /v1/images/edits` | **one** — the locked sheet PNG | `prd.md > Storyboard — The Main Studio` |

The sheet is generated *from the DNA text*, which is what makes
`prd.md > Cast — Model Sheets` "DNA-first" true by construction. The panel call
then carries that sheet image plus the same DNA text verbatim.

### Quality, Cost, and the `.env` Switch

Five paid quality levels. Output cost per image at 1024×1024:

| Quality | Cost | Used for |
|---|---|---|
| `low` | ~$0.006 | **development builds** |
| `medium` | ~$0.013 | — |
| `high` | ~$0.053 | **panels**, filming |
| `xhigh` | ~$0.094 | — |
| `max` | ~$0.211 | **sheets**, filming |

**Quality plan:** sheets at `max` (only two per chapter, and each is the canonical
reference every panel is compared against — worth the spend), panels at `high`.

**Model and both quality levels are `.env`-configurable** so the build runs at
`low` and only filming pays for `max`/`high`:

```
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst-2026-09-08
OPENAI_SHEET_QUALITY=max
OPENAI_PANEL_QUALITY=high
```

A full filming run — 2 sheets at `max` + 4 panels at `high` — is about
**$0.63**, plus ~$0.05 per panel redraw. The same run at `low` throughout is
about **$0.04**. This is what makes iterating on prompts affordable.

`scope.md > The POC Boundary` budgeted "roughly 6 images per full run"; that
holds.

### Rate Limits and Concurrency

Published tiers are **Build 20 IPM / Launch 150 IPM / Grow 250 IPM**
(images per minute).

**Panel concurrency: 2.** This resolves the open call in
`prd.md > Open Questions`. At Build's 20 IPM even four-at-once would not trip the
limit, so this is margin rather than necessity — but it costs nothing, it keeps
panels filling out of order as `prd.md > Storyboard — The Main Studio` requires,
and it keeps a 429 off camera.

*Learner to confirm their own tier at Settings → Organization → Limits before
filming.* `gpt-image-2.5-sunburst` is the slower of the two current models;
the pencil-sketch placeholder states in `prd.md > Look and Feel` already cover
that latency.

---

## Stack

| Concern | Choice | Docs |
|---|---|---|
| Framework | **Next.js, App Router** | https://nextjs.org/docs/app |
| Language | TypeScript | https://www.typescriptlang.org/docs/ |
| Text generation | **Anthropic API — Claude Sonnet** | https://docs.claude.com/en/api/messages |
| Image generation | **OpenAI Images API** | https://developers.openai.com/api/docs/guides/image-generation |

**Why Next.js App Router** (learner's choice, from their named stack): one
process, and server-side route handlers hold both `ANTHROPIC_API_KEY` and
`OPENAI_API_KEY` so neither ever reaches the browser — required by
`scope.md > Model Providers`. No separate API server to start on camera.

Accepted tradeoff: React rather than Angular, and the mockup's CSS gets **ported
rather than reused** — consistent with `scope.md > Explicitly Cut`, which already
rules out reusing the mockup's code.

---

## Where It Runs and How Someone Tries It

**Local only.** Submission needs a short demo video and a public GitHub
repository; a locally-run app is sufficient to film, and deployment was already
optional in `prd.md > Deferred From the POC`.

**Deployment stays in Later.** The learner's reason, recorded because it is an
architecture constraint and not just a preference: *a public URL would expose the
image budget without a cap.* If there is time after the build, it gets revisited
**together with a server-side per-chapter image cap** — the enforcement that
`prd.md > States and Boundaries` deliberately left out of the product.

Startup and demo-recording steps: **_Pending_** — depends on the persistence
decision below.

---

## Persistence and Image Storage

**_Pending._** The open consequential decision: where the generated image bytes
live, given `/v1/images/edits` returns base64 (`b64_json`) rather than a URL, and
`prd.md > States and Boundaries` requires one chapter to survive a reload
including up to three versions per panel.

---

## Look and Feel

Carried forward from `prd.md > Look and Feel` and
`scope.md > Inspiration & Identity`. Already settled from the learner's
pre-existing mockup — not re-interviewed.

- **Palette:** paper `#f3f2f2`, surface `#eae9e9`, ink text `#201f1d`, hanko red
  `#b5382e` (single brand red, 9-step ramp).
- **Type:** Cormorant Garamond (headings), Lora (body), Comic Neue (dialogue
  lettering only).
- **Texture:** halftone in pure CSS — `radial-gradient` dot screens,
  `repeating-linear-gradient` tone bands.
- **Motion:** panels ink in from pencil sketch to final art, ~1.4s.
- **Reference:** `reference/Ink Desk.html` — visual and layout reference only,
  disclosed in the README at ship time.

---

## Components

**_Pending._**

## Data Model

**_Pending._**

## File Structure

**_Pending._**

## External Services and Dependencies

Image service contract recorded above under
**Verified: Image Model and Reference-Image Support**. Anthropic contract and
prompt shapes: **_Pending._**

## Important Failure Modes

**_Pending._** Behavior is specified in `prd.md > States and Boundaries`; the
technical mapping is still to be written.

## What Was Simplified and Why

**_Pending._**

## Decisions and Open Issues

### Decided

- **Image model `gpt-image-2.5-sunburst-2026-09-08`, pinned, for sheets and
  panels.** Learner's choice. Forced by the `gpt-image-1` shutdown; pinned so the
  art style cannot shift mid-build. Tradeoff accepted: it is the slower model.
- **Panels via `/v1/images/edits` with one reference image; sheets via
  `/v1/images/generations`.** Derived from the verification.
- **Sheets at `max`, panels at `high`, both `.env`-configurable.** Learner's
  choice, so development runs at `low` and only filming pays.
- **Next.js App Router, TypeScript, both keys in server route handlers.**
  Learner's choice.
- **Local only; deployment deferred, and tied to a server-side image cap if
  revisited.** Learner's choice.
- **Panel concurrency 2.** Learner's preference, carried from
  `prd.md > Open Questions`; margin rather than necessity at Build-tier limits.

### Open

- **Where generated image bytes and chapter state live.** See
  **Persistence and Image Storage** above.
- Carried from `prd.md > Open Questions`, none of which block the build: page
  script as its own rail entry vs. a step inside Storyboard; genre/tone chip sets;
  ink-in reveal timing in the reader.
- **A server-side safety limit on images per chapter** — left out for a local-only
  build; becomes required if deployment is revisited.
