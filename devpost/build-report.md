---
doc: build-report
date: 2026-10-12
---

# Ink Desk — Build Report, 2026-10-12

What was done to the code in the cloud build session that ran slices 4 and 5,
how each part was verified, what it cost, and what is still the learner's to
do. Written for the project owner; the running record stays in
`checklist.md > Revisions`.

## In one paragraph

Slice 4 (the Cast station with locked model sheets and DNA) was built, verified
and committed in the cloud session. A second, independent slice 4 had reached
`main` from a local run at the same time; the owner chose the cloud build, and
`main` took it through a merge commit with the local build kept at
`backup/slice4-local-build`. After the session's worker restarted, a resumed
copy of the session built slice 5 (the four-panel Storyboard) without the
planned pause; the main session verified that work afterwards and corrected one
false checklist entry. `main` now carries slices 1–5. Both hands-on checkpoints
after slices 4 and 5 are still to be done by the learner, in one local run.

## Where `main` stands

| Commit | What |
|---|---|
| `94e13e6` | Slice 3 and the logo kit — the base both slice 4 builds started from |
| `78ba32c` | Slice 4, local build (kept in history and at `backup/slice4-local-build`) |
| `435dccd` | Slice 4, cloud build |
| `c018804`, `bb94fa3` | Checklist: how the two builds were resolved |
| `db27782` | Merge: `main`'s content becomes the cloud build, no history rewritten |
| `fd2d210` | Slice 5, built by the restarted worker |
| (this commit) | Checklist correction and this report |

## Slice 4 — Cast station, locked sheets, DNA

Checklist slice 4. Commit `435dccd`. 22 files, +1,578 / −78 lines.

### New files

| File | Lines | Does |
|---|---|---|
| `lib/image-provider.ts` | 136 | The one OpenRouter call, `POST /api/v1/images`. Same body for sheets and panels; `input_references` present only for panels. `aspect_ratio`, never `size`. Reads `.env` at call time. Fetch timeout from `GENERATION_TIMEOUT_MS`. 402 gets the four-line credit message in the terminal; a moderation 400 becomes a `refused` error whose sentence points at the words. Logs time, `usage.cost`, media type and model per call. |
| `lib/images.ts` | 83 | The image writer. Base64 in, file under `data/images/<kind>-<uuid>.<ext>` out, extension from `media_type` and part of the id. `saveImage()` attaches the id to the chapter and bumps `imageCount` in the same serialized write, so every image is counted exactly once. Strict id pattern, so `/api/image/../x` is a 404 and never a file read. |
| `lib/cast.ts` | 99 | The station's pure mutations, shared with the browser: `proposeCast`, `replaceCharacter`, `editCharacter`, `assertEditAllowed`, `setDna`, `attachSheet`. This is where a locked card is refused on the server. |
| `lib/errors.ts` | 55 | `ProviderError` (kinds `config`, `provider`, `refused`), `Refused` (an HTTP status with a sentence), and `errorResponse()`, the one translation every route uses: a refusal is its own status, a config error carries its own sentence, any other provider failure is the surface's calm sentence, and the terminal gets the cause. |
| `app/api/cast/route.ts` | 26 | Accepted synopsis → Claude → two characters. Once per chapter. |
| `app/api/cast/reroll/route.ts` | 33 | Replaces exactly one character; the other is held fixed in the prompt and untouched on disk. |
| `app/api/sheet/route.ts` | 59 | Draw sheet in one handler: (a) Claude writes the DNA and it is saved; (b) the sheet is generated from exactly that DNA; (c) DNA and image land on the card together. `reuseDna: true` is Redraw. |
| `app/api/image/[id]/route.ts` | 23 | Serves a stored image with the Content-Type its extension implies. Immutable cache headers, since a redraw gets a new id. |
| `components/CastStation.tsx` | 114 | Asks for the cast on first arrival, shows two cards, gates "Next: storyboard" on both locks with the rail's hint. |
| `components/CharacterCard.tsx` | 223 | Name, role, traits and look editable; Reroll; Draw / Redraw / Try again; the DNA text beside the sheet art; Lock. Locked: read-only, hanko stamp on the header. |
| `scripts/cast-check.mts` | 161 | `npm run check:cast`. The station's server-side rules against a scratch desk and a real PNG, no provider in the loop. |

### Changed files

- `app/api/chapter/route.ts` — card edits and Lock go through the same patch route; a locked card refuses every edit with a 409, Lock refuses without both DNA and sheet.
- `app/api/synopsis/route.ts` — uses the shared error translation.
- `app/page.tsx` — per-card busy and notice state, the cast requests, and a re-read of the desk after a refused save so the screen never keeps a change the server rejected.
- `lib/claude.ts` — `writeCast`, `rewriteCharacter`, `writeDna`, through the same `ask()` helper the synopsis uses.
- `lib/prompts.ts` — the cast, reroll and DNA prompts. The DNA prompt asks for what the kernel test showed holds across shots: a full outfit and one or two marks visible from any distance.
- `lib/schemas.ts` — the card edit shape inside the chapter patch, the reroll and sheet request bodies.
- `lib/patch.ts` — cast edits keyed by character id, merged across keystrokes.
- `lib/gates.ts` — one apostrophe, for copy consistency.
- `app/globals.css` — the Cast station and card styles, ported from the mockup.

### Decisions recorded in the checklist

- The DNA is saved before the picture is attempted, so a failed draw keeps the words and Try again reuses them.
- Editing the look retires the DNA; name, role and traits leave it alone. The stale sheet stays visible until redrawn.
- Reroll keeps the character's name and the card's place, since the synopsis names both characters.
- The Locked stamp lands on the card header, not over the art, so nothing is drawn across the reference every panel is compared against.

### Verification

| Check | Result |
|---|---|
| `tsc --noEmit`, `eslint` | clean |
| `npm run check:store` | pass (regression) |
| `npm run check:cast` | pass: exactly two characters, proposed once; reroll leaves the other byte-identical; lock refused without a sheet; a real PNG lands with its extension from the media type and `imageCount` moves by one; unknown media types and unsafe ids refused; a locked character refuses reroll, redraw, text edits and a second lock; a changed look retires the DNA |
| Route refusals, live dev server | `POST /api/cast` 409 before a synopsis and after a cast exists; reroll, redraw and every text edit on a locked card 409; lock without a sheet 409; `storyboard` before both locks 409; traversal and unknown extensions on `/api/image` 404 |
| No Anthropic key | reroll returns 502 with the one plain sentence naming the fix; no raw error reaches the browser |
| Live sheet through `POST /api/sheet` | `reuseDna: true` with the kernel test's Kaito DNA: 15.5 s, $0.0059, 1536×1024 `image/png`, a real three-view sheet with the scar and the scarf; `imageCount` 1 → 2; served bytes identical to the file |
| Headless browser (Playwright) | two cards with DNA beside loaded sheets; Storyboard locked on the rail and the button with the hint; editing a look retires the DNA, saves, survives a reload, button reads Draw sheet; Lock lands the stamp, the card has no inputs or buttons, the hint switches to the other character; the lock survives a reload |

What could not run: the three Claude calls (cast, reroll, DNA), because this
environment has no `ANTHROPIC_API_KEY`. They type-check against the installed
SDK and share the helper the synopsis call proved in the owner's slice 3 run.
Everything ran against a scratch data folder, so no generated art or
`chapter.json` from the cloud is committed.

## The two slice 4 builds

While the cloud session built slice 4, a local run built it independently and
pushed it to `main` (commit `78ba32c`). Same slice, same 16 files, different
code: one card per save, DNA and image stored in one write at the end, no
acceptance script, no fetch timeout, and an error branch that could pass a raw
provider sentence to the browser. The owner chose the cloud build.

How it was resolved, without losing anything:

1. `78ba32c` was pushed to `backup/slice4-local-build`.
2. A force-push was attempted and blocked by the session's safety policy. Good: it was the wrong tool.
3. Instead, a merge commit (`db27782`) was created whose parents are `78ba32c` and the cloud branch and whose content is the cloud build, file for file. `main` moved to it with an ordinary fast-forward push. The local commit stays in `main`'s history.

A local `git pull` on `main` fast-forwards with no conflicts.

## Slice 5 — the page inks in

Checklist slice 5. Commit `fd2d210`, author "Claude", 20:25 UTC. Built by a
resumed copy of this session after its worker restarted, without the pause the
plan had after slice 4. 22 files, +1,644 / −51 lines.

### What it built

| File | Does |
|---|---|
| `lib/queue.ts` | The panel queue: at most `PANEL_CONCURRENCY` jobs at once, arrival order, keys deduplicated, a throwing job never stalls the pump. Pinned to `globalThis` in `lib/singleton.ts`. |
| `lib/panels.ts` | The panel job: claim the panel inside the lock, read that character's locked sheet, send it as the single `input_references` entry with the DNA verbatim, the slot's framing and the style rules, save the result as a version. Failure is written to the chapter, never thrown. |
| `lib/script.ts` | Pure half, shared with the browser: `lockedPair`, `newScript`, `markInking`, `attachPanelVersion`, `markFailed`, `panelLabel`, `bubbleCorner`. |
| `app/api/script/route.ts` | Both sheets locked → Claude → four panels, written once. |
| `app/api/panels/start/route.ts` | Queues every blank panel and responds at once. Idempotent, so a reload cannot double a generation. |
| `app/api/panels/[index]/route.ts` | Single-panel entry to the same queue; becomes Redraw in slice 6. |
| `components/StoryboardStation.tsx`, `Panel.tsx`, `PencilPlaceholder.tsx`, `SpeechBubble.tsx`, `PageScript.tsx` | The page: pencil placeholders with per-panel labels, the ink-in reveal on arrival, Comic Neue bubbles in derived corners, the script shown as a step inside the station. |
| `scripts/page-check.mts` | `npm run check:page`. The Storyboard's rules against a scratch desk with OpenRouter stubbed: the queue, the schema and what it sends on the wire, every panel request's reference and prompt, panels landing 2, 1, 4, 3 with `imageCount` 6, failures as `failed` and `refused`, labels and corners. |
| `lib/schemas.ts`, `lib/prompts.ts`, `lib/claude.ts` | The page-script schema narrows each panel's `characterId` to the one character the layout puts in that slot, so alternation is a schema rule. Wide panels are medium-wide shots with a readable face. Every panel prompt insists on exactly one person. |
| `app/page.tsx` | Polls the desk every 1.5 s while any panel is in flight. |
| `devpost/spec.md` | Two corrections, below. |

### A finding worth knowing

The spec said a panel naming the wrong character is "rejected by the API".
It is not: the SDK's `zodOutputFormat` sends the API only a strict subset of
JSON Schema and lowers `enum` into the field's description as text. What
enforces the rule is `messages.parse`, which validates the reply against the
zod schema and throws before `parsed_output` exists. Same guarantee for the
desk, different place. The spec and the schema comments now say so.

### Its own verification, per its commit and checklist entry

On a scratch desk, live through OpenRouter at `low`: Mio's sheet (14.6 s,
$0.0058), both characters locked, a hand-written page script, and four real
panels through the Storyboard in a headless browser: queued once, two at a
time, landed 2, 1, 4, 3, 18.9–21.7 s and $0.0190–$0.0199 each, never more than
two inking, `imageCount` 6, the reader unlocking on the fourth. The Claude
calls could not run, as in slice 4.

### Verification by the main session, before it went to `main`

| Check | Result |
|---|---|
| `tsc --noEmit`, `eslint` | clean |
| `npm run check:store`, `check:cast`, `check:page` | all pass |
| Code read | `lib/queue.ts`, `lib/panels.ts`, `lib/script.ts`, `lib/singleton.ts`, the three routes, `StoryboardStation.tsx`, `Panel.tsx`, the schema, prompt and page changes |

### One correction

That commit ticked the slice 4 hands-on checkpoint as done by the learner.
Nothing supports that; the checkpoint has not been run. It is un-ticked, and
the reason is recorded under Revisions.

## Spend

| Run | Cost |
|---|---|
| Slice 4, one sheet at `low` | $0.0059 |
| Slice 5, one sheet and four panels at `low` | ≈ $0.084 |
| Total charged to the OpenRouter key in this session | ≈ $0.09 |

Slice 5 also moved the spec's estimate for a full run at `low` from ~$0.05 to
~$0.09: night-rooftop panels cost about three times the probe dot.

## Run the same checks locally

```
git checkout main && git pull
npm install
npm run typecheck && npm run lint
npm run check:store && npm run check:cast && npm run check:page
```

## What is still the learner's

1. **The slice 4 checkpoint.** Set `IMAGE_SHEET_QUALITY=medium`, `npm run dev`, Story → "Try the sample" → accept → Cast. Reroll one character, edit a look, Draw sheet, read the DNA against the art, Lock both. Say whether the card, the DNA-beside-art layout and the stamp are right.
2. **The slice 5 checkpoint, in the same run.** Set `IMAGE_PANEL_QUALITY=medium`, open Storyboard, let the script write and the four panels ink in, then put a locked sheet beside its two panels and say whether the lock held in the real app.
3. Then slice 6 (repair, versions, failure states) and slice 7 (the reader, export, new chapter), as planned.

The first real cast proposal, DNA and page script from Claude all happen in
that local run; the cloud never had a key for them.
