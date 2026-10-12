---
doc: checklist
status: approved
---

# Build Checklist

Build mode: fast

Generation quality: **`low` throughout development.** Only the kernel test
(`KERNEL_TEST_QUALITY=medium`) and the hands-on checkpoints run at `medium` or
higher — a checkpoint is where the learner judges the art, so it must not be
judged at build quality. Filming values (`max` sheets / `high` panels) stay in
`.env` comments until `6-ship`. Learner's call.

Design: **the mockup's look lands in slice 3, not at the end.** The studio shell
ships with the paper background, CSS halftone, Cormorant Garamond / Lora /
Comic Neue, the hanko red, and the station rail with its gating, hover hints,
"Saved to desk" label and image counter. Every later slice inherits that shell
rather than being styled afterwards. Learner's call.

## Slices

- [x] **1. Both providers answer, and nothing in the spec is a guess any more**
  Becomes usable: `node scripts/kernel-test.mjs --probe-only` prints a verdict on every provider assumption in the spec — the image model is listed, `input_references` is supported, the configured aspect ratios and quality are real enum values, `claude-sonnet-5-5` resolves with structured output, and one real low-cost generation comes back as `b64_json` with its actual `usage.cost`.
  Why now: `spec.md > Important Failure Modes` says a wrong model ID or a bad key fails identically and confusingly, and a dropped parameter fails silently with a 200. This is the one allowed single-layer slice: it proves critical risk for about a cent and leaves runnable evidence. The script already exists from `4-spec` and has never been executed, so every claim in it is still untested.
  PRD ref: `prd.md > Open Questions` (the carried-over provider verification)
  Spec ref: `spec.md > Where It Runs and How Someone Tries It`, `spec.md > Verified: Image Model and Reference-Image Support`, `spec.md > External Services and Dependencies`
  Build: Run the three probes in `scripts/kernel-test.mjs` (0a capability, 0b text + structured output, 0c one real `low` generation). Fix whatever reality disagrees with — the likely candidate is the shape of `supported_parameters` in OpenRouter's `/images/models` response, which the probe reads as an object of ranges and enums. Correct the script, not the measurement.
  Verify (mechanical): `node scripts/kernel-test.mjs --probe-only` exits 0 and prints `ok` for 0a, 0b and 0c, including a real `usage.cost` figure and the returned pixel dimensions and media type.
  Learner check: Covered by the slice 2 checkpoint — the probes are a terminal result, not a behavior to try.
  Commit: `Prove both providers with kernel-test probes`

- [x] **2. The kernel is proven or disproven, with the images side by side**
  Becomes usable: `data/kernel-test/index.html` shows Kaito's model sheet beside a square close-up and a landscape wide shot, both generated from that sheet as `input_references[0]` plus the locked DNA verbatim. One question, answerable by looking: same person, same scar, same scarf, from both distances?
  Why now: `scope.md > The Unique Kernel` is the whole product, and `spec.md > The Useful Unknown` is explicit that verification settled the mechanism but cannot settle the result. If one sheet plus verbatim DNA does not hold a face, that is worth knowing on day one rather than after five stations are built on top of it. It also returns the three numbers the spec is currently guessing at.
  PRD ref: `prd.md > The Core Journey` (step 13, the success criterion)
  Spec ref: `spec.md > Decisions and Open Issues > The Useful Unknown — does the lock actually hold?`, `spec.md > The Page Layout`, `spec.md > Quality, Cost, and the .env Switch`
  Build: Run the full kernel test at `KERNEL_TEST_QUALITY=medium` — deliberately not `low`, so a drifted face cannot be blamed on the quality. Then carry the three measured numbers back into `devpost/spec.md` and `.env.example`: the slowest call sets `GENERATION_TIMEOUT_MS`, the real `usage.cost` replaces the estimated cost table, and the returned pixel dimensions close the open item about resolution.
  Verify (mechanical): `node scripts/kernel-test.mjs` exits 0; `data/kernel-test/` holds the sheet, both panels, `index.html` and `manifest.json`; the generated files are non-trivially sized real images at the expected `3:2` and `1:1` shapes; `manifest.json` carries a per-image `usage.cost`, timings, and dimensions.
  Learner check: Open `data/kernel-test/index.html` and look at the three images yourself. Is Kaito recognizably the same person in the close-up and the wide shot as he is on the sheet — same face, same scar through the right eyebrow, same frayed scarf? Say what holds and what drifts.
  Commit: `Prove the kernel holds at medium quality`

- [x] **3. The studio opens, you can pitch a story, and it is saved to the desk**
  Becomes usable: `npm run dev` serves the real Ink Desk look — paper, ink, hanko red, the three fonts, CSS halftone — with the station rail showing four stations, three of them visibly locked and each showing its hover hint, plus the "Saved to desk" label and the "Images this chapter: N" counter in the header. Type a pitch or click "Try the sample", pick a genre and a tone, and Claude returns an editable synopsis. Accept it and Cast unlocks. Reload the page and everything is exactly where you left it.
  Why now: First usable slice, so it carries the bootstrapping — scaffold, dependencies, design tokens, the chapter store, the Claude client and the schemas. It is also where the lost-update lock and the atomic write get built and tested, before concurrency 2 can make the bug expensive in slice 5. **The full visual shell lands here on purpose**, so slices 4-7 inherit the look instead of being styled at the end.
  PRD ref: `prd.md > Story — The Pitch Desk`, `prd.md > Screens and Layout`, `prd.md > Look and Feel`, `prd.md > States and Boundaries`
  Spec ref: `spec.md > Stack`, `spec.md > File Structure`, `spec.md > Look and Feel`, `spec.md > Components > Station Rail`, `spec.md > Components > Story Station`, `spec.md > Components > Chapter Store`, `spec.md > Components > Singletons and the Dev Server`, `spec.md > Components > Prompts and Schemas`, `spec.md > Data Model`
  Build: Scaffold with `create-next-app@latest` (TypeScript, App Router) and add `@anthropic-ai/sdk` and `zod`. Port the design tokens and halftone from the mockup into `app/globals.css` and wire the three Google fonts via `next/font/google`. Build `lib/types.ts`, `lib/chapter.ts` (serialized `update()` through one promise chain, temp-file-then-rename), `lib/singleton.ts` (`globalThis`-pinned lock and `serverRunId`), `lib/gates.ts`, `lib/schemas.ts`, `lib/prompts.ts`, `lib/claude.ts`. Then `GET/POST/DELETE /api/chapter`, `POST /api/synopsis`, and the `StationRail` — carrying the mark, the gating, the locked-station hover hints, the "Saved to desk" label and the image counter — and the `StoryStation`. Every handler declares `runtime = 'nodejs'`.
  Verify (mechanical): `npx tsc --noEmit` passes. The dev server starts clean. A `POST /api/synopsis` returns a title and body, and `data/chapter.json` then contains them. `GET /api/chapter` restores the same chapter. The design tokens from `spec.md > Look and Feel` are present in `app/globals.css` and all three fonts resolve. The rail renders three locked stations with hints before a synopsis is accepted, and Cast becomes clickable after. The Chapter Store acceptance check from the spec: two `update()` calls fired in the same tick both land in `chapter.json`, neither erasing the other.
  Learner check: Open http://localhost:3000, click "Try the sample", pick a genre and tone, submit, edit the synopsis, accept it, then reload the page and confirm nothing was lost. Say whether the shell looks like your mockup.
  Commit: `Scaffold the studio with a working Story station`

- [x] **4. Two characters get locked model sheets, and the lock is real**
  Becomes usable: Cast proposes two characters from the accepted synopsis, all their text editable, with a per-character Reroll. **Draw sheet** writes that character's visual DNA and generates the sheet image from that DNA in one server action, then shows the DNA text beside the art so the words and the picture can be compared before committing. **Redraw sheet** reuses the same DNA; editing the description rewrites it. **Lock** lands the hanko stamp, makes the card read-only, and freezes the DNA/image pair. Both locked unlocks Storyboard. The header counter from slice 3 starts moving.
  Why now: `spec.md > Components > Cast Station and Character Card` says this is where the kernel is built. It also brings the whole image path into the app — `lib/image-provider.ts`, `lib/images.ts`, `/api/image/[id]` — which slice 5 then reuses unchanged, with `input_references` as the only addition.
  PRD ref: `prd.md > Cast — Model Sheets`
  Spec ref: `spec.md > Components > Cast Station and Character Card`, `spec.md > Components > Image Writer`, `spec.md > External Services and Dependencies > OpenRouter — GPT Image (pictures)`, `spec.md > Quality, Cost, and the .env Switch`
  Build: `lib/image-provider.ts` (one `fetch` to `POST /api/v1/images`, references optional) and `lib/images.ts` (b64 → `data/images/<id>.<ext>`, extension from `media_type`, bumps `imageCount`). Routes: `POST /api/cast`, `POST /api/cast/reroll`, `POST /api/sheet` (DNA then image, one handler, `reuseDna` flag), `GET /api/image/[id]`. Components: `CastStation`, `CharacterCard`, inheriting the slice-3 shell. Build at `IMAGE_SHEET_QUALITY=low`; draw one sheet at `medium` for the checkpoint so the art is judged at a fair quality.
  Verify (mechanical): `npx tsc --noEmit` passes. `POST /api/cast` returns exactly two characters. `POST /api/sheet` writes a real image file under `data/images/` and a non-null `dna` for that character in `chapter.json`, and `imageCount` increments by exactly one. `GET /api/image/<id>` serves the matching `Content-Type`. Reroll replaces one character and leaves the other byte-identical. A locked character is rejected by the server for edits, not just hidden in the UI.
  Learner check: Open Cast, reroll a character, edit a look description, then Draw sheet and read the DNA text beside the art — does the picture match the words? Lock it and watch the stamp land. Say whether the card, the DNA-beside-art layout and the Locked stamp are right *before* panels get built on top of them.
  Commit: `Add Cast station with locked sheets and DNA`

- [ ] **5. The page inks in — four panels against the locks, out of order**
  Becomes usable: Both sheets locked, Claude writes the four-panel script — one locked character per panel, enforced by a `z.enum` of locked ids — and it appears as a step inside Storyboard. Four pencil-sketch placeholders shimmer with per-panel labels, two panels generate at a time, and each one inks in the moment it lands, in whatever order it finishes. Each carries only its own character's locked sheet as `input_references[0]` plus that DNA verbatim. Speech bubbles sit over the art in Comic Neue with Claude's dialogue. **This is the money shot from `scope.md > What "Working" Looks Like`.**
  Why now: The kernel proven in slice 2 and built in slice 4 now has to hold inside the product, at the real page's ratios, with real Claude-authored action and camera text rather than the test's hardcoded panels. Everything after this slice is reading and repairing a page that already exists.
  PRD ref: `prd.md > Page Script`, `prd.md > Storyboard — The Main Studio`, `prd.md > The Core Journey` (steps 9-10)
  Spec ref: `spec.md > Components > Page Script`, `spec.md > Components > Storyboard Station and Panel`, `spec.md > Components > Speech Bubble`, `spec.md > Components > Panel Queue`, `spec.md > The Page Layout`
  Build: `lib/queue.ts` at `PANEL_CONCURRENCY=2`, pinned to `globalThis`. Routes: `POST /api/script`, `POST /api/panels/start` (queues four, responds immediately), `POST /api/panels/[index]`. Components: `PageScript`, `StoryboardStation`, `Panel`, `PencilPlaceholder`, `SpeechBubble` with derived corner placement keyed on camera angle. Browser polls `GET /api/chapter` every ~1.5s while anything is inking. Per-panel ratios from The Page Layout, with the framing line in the prompt as well as the request.
  Verify (mechanical): `npx tsc --noEmit` passes. The script call returns four panels, each naming exactly one locked character, alternating. Four panel images land under `data/images/`, and `imageCount` reads 6 after two sheets and four panels — the lost-update canary from the spec's Chapter Store acceptance check. Panel statuses in `chapter.json` move `empty → inking → done` independently, and never more than two are `inking` at once. Every panel request body carries exactly one entry in `input_references`.
  Learner check: Run the whole journey — pitch, accept, lock both characters, watch the four panels ink in — then put Kaito's locked sheet beside panels 1 and 3 and say whether the lock held in the real app as well as it did in the kernel test. Note anything about the prompts, the framing, or the bubbles you want changed before the reader is built.
  Commit: `Generate the four-panel page against the locks`

- [ ] **6. Nothing is ever lost — redraw, versions, and honest failures**
  Becomes usable: **Redraw panel** reruns the same request with the same references while the current art stays on screen under an "Inking…" indicator, and a `‹ 2 / 2 ›` stepper appears once a panel has two versions, capping at three. A transient failure retries once silently, then shows a calm sentence with **Try again**; a refusal offers **Rewrite panel**, which rephrases only that panel's action, camera and background and never its dialogue. A reload mid-generation keeps generating, and a panel orphaned by a timeout or a dev-server restart comes back as failed with **Try again** rather than spinning forever.
  Why now: `prd.md > Storyboard — The Main Studio` has more acceptance criteria about repair than about generation, and `spec.md > Important Failure Modes` is where a demo actually breaks. Building it after the happy path means every failure state has real art to protect.
  PRD ref: `prd.md > Storyboard — The Main Studio` (the repair criteria), `prd.md > States and Boundaries`
  Spec ref: `spec.md > Important Failure Modes`, `spec.md > Data Model > Reload Mid-Generation`, `spec.md > Components > Storyboard Station and Panel`
  Build: Version history in `versions[]` with `currentVersion`, newest last, oldest dropped past three. One silent retry on 429 and timeout; no retry on 402, with the full four-line credit message in the terminal and the calm sentence in the browser. `POST /api/panels/[index]/rewrite`. The stale-`inking` demotion on read, on either `startedAt` age past `GENERATION_TIMEOUT_MS` or `startedByRun !== serverRunId`. The version stepper in the panel corner.
  Verify (mechanical): `npx tsc --noEmit` passes. One redraw produces a second version and a 2-of-2 stepper; a third redraw holds the count at three with the oldest dropped. A forced provider failure leaves the previous version displayed and the panel still `done`, so Ink & Publish stays open. Restarting the dev server mid-generation demotes the in-flight panel to `failed` on the next `GET /api/chapter`, and a `startedAt` backdated past the timeout does the same. No raw error code appears in any API response body sent to the browser.
  Learner check: Redraw a panel and step between versions; then restart the dev server while a panel is generating and confirm it comes back as failed with Try again rather than spinning.
  Commit: `Add panel repair, versions, and failure states`

- [ ] **7. The page reads as a finished manga page, and exports**
  Becomes usable: Ink & Publish unlocks once all four panels have art. Entering it replays the ink-in reveal panel by panel, a toggle flips the reading order right-to-left, and PNG export composites the art and the Comic Neue bubbles into one file via an off-screen canvas. Back-navigation works by the PRD's three rules, and **New chapter** clears everything behind a confirmation — as does accepting a new synopsis from Story.
  Why now: Last, because it reads a page the previous slices produce. It closes the loop the demo video needs end to end, and the New-chapter path is what makes a clean first-use state filmable.
  PRD ref: `prd.md > Ink & Publish — The Reader`, `prd.md > Screens and Layout` (back-navigation rules), `prd.md > States and Boundaries` (new chapter)
  Spec ref: `spec.md > Components > Reader Station`, `spec.md > Components > Station Rail`, `spec.md > The Page Layout`
  Build: `ReaderStation` with the sequential reveal, the RTL toggle, and canvas export via `toBlob()`. Wire the back-navigation rules: Cast is view-only once locked, Storyboard is fully reachable from the reader, and a new accepted synopsis confirms then clears. `DELETE /api/chapter` behind the New chapter confirmation.
  Verify (mechanical): `npx tsc --noEmit` passes and `npm run build` succeeds. The reader is unreachable until all four panels are `done`. The exported PNG opens as a real image, is sized from the page layout, and contains both art and bubbles. Redrawing a panel and returning to the reader shows the new version, and the export uses `currentVersion`. `DELETE /api/chapter` empties the chapter and returns the app to first-use state.
  Learner check: Read the finished page, flip the reading order, export the PNG and open it, then start a new chapter and confirm the studio is back to a clean first-use state.
  Commit: `Add Ink & Publish reader, export, and new chapter`

## Target Dates

Set by the learner at the plan review. Kept out of the slice fields above so the
field labels stay a clean contract.

| Slice | Target | Status |
|---|---|---|
| 1. Probes | 2026-10-12 (today) | done 2026-10-12 |
| 2. Kernel test | 2026-10-12 (today) | done 2026-10-12 |
| 3. Studio shell + Story | 2026-10-14 | done 2026-10-12 |
| 4. Cast + locked sheets | 2026-10-15 | — |
| 5. Page script + four panels | 2026-10-17 | — |
| 6. Repair, versions, failures | 2026-10-19 | — |
| 7. Reader, export, new chapter | 2026-10-20 | — |

**If a slice runs over, say what to cut — do not silently slip.** The learner's
rule. The cut list is prepared rather than improvised, in the order it would be
offered, and each item names what it costs:

1. **Slice 7 — the right-to-left toggle.** Cheapest cut: `prd.md` keeps it only
   because it is cheap and very manga. Costs one small toggle in the demo.
2. **Slice 6 — Rewrite panel.** Redraw plus Try again still covers every
   failure a demo realistically hits; a refusal would then only offer Try again,
   which is honest but less tailored.
3. **Slice 6 — the version stepper above two.** Keeping two versions instead of
   three still proves compare-and-revert. Touches a PRD acceptance criterion, so
   it needs the learner's agreement.
4. **Slice 5 — `PANEL_CONCURRENCY=1`.** Panels then land in order and the
   out-of-order reveal is lost, but the page still builds. This is margin
   rather than necessity per the spec, so it is a real fallback.

Nothing in `scope.md > The Unique Kernel` is on this list, and nothing on it is
cut without being recorded under **Revisions**.

## Hands-on Checkpoints

- [x] Early usable behavior explored — after slice 2, the learner opens `data/kernel-test/index.html` and judges whether the face held. This is the checkpoint that can still change the method, the prompts, or the quality setting before any UI exists, and the learner asked explicitly to stop here. **Done 2026-10-12 — the learner's verdict: the face held.** Method, prompts and quality setting unchanged going into slice 3.
- [ ] Cast and the lock explored — after slice 4, the learner reads the DNA beside the sheet in the real UI and locks a character, before any panel work is built on top of the card. Learner's addition, and the right place for it: the sheet is the reference every panel is judged against, so a layout or DNA-presentation problem is cheapest to fix here. One sheet drawn at `medium` for this.
- [ ] Core journey explored — after slice 5, the learner runs Story through to a finished inked page and compares a locked sheet against the panels in the real app. Distinct value: it is the first time the kernel appears in the product rather than in a script, and prompt or framing feedback is still cheap here.
- [ ] Final kick-the-tires exploration and feedback completed — after slice 7.

## Final Review

- [ ] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [ ] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: [pending]
Route and stops: [pending]
Edit outcome: [pending]
Reflection: [pending]
Activity mode: [pending]

## Revisions

- **Slice 4: `newCharacter` moved out of a route and into `lib/claude.ts`** — `app/api/cast/reroll/route.ts` first imported it from `app/api/cast/route.ts`, and a route importing another route gave a partially-initialised module at runtime: `proposeCast is not a function`, then `castPrompt is not a function` once the first was fixed. Internal correction, no behavior change. The second failure was a different cause worth knowing: Turbopack's dev server does not pick up *new named exports* added to a module it has already compiled, so the running server has to be restarted when a slice adds exports to existing `lib/` files — a hot reload is not enough. Cost ~15 minutes of chasing a phantom circular import.
- **The logo kit was regenerated in the hanko red `#B5382E`** — the original kit was `#E5432D`, an orange-red that did not match `--hanko` in `spec.md > Look and Feel`, so the mark in the station rail and the browser tab sat slightly off the one brand red the design reserves for primary actions and the Locked badge. The learner regenerated the kit; all 19 files in `assets/` were replaced, and the three derived copies the app actually loads were re-derived from them: `app/icon.png` and `app/apple-icon.png` (Next.js file-convention favicons, from the 32px and 180px PNGs) and `public/brand/inkdesk-mark.svg` (the rail mark). `#E5432D` no longer appears anywhere in `assets/`, `app/`, `public/` or `components/`. Artwork only — no code or token changed, since `--hanko` was already `#b5382e`.
- **`GENERATION_TIMEOUT_MS` raised from 180000 to 360000** — the kernel test's slowest call took **118.7s** at `medium`, leaving the placeholder only 1.5× headroom on a tier *below* filming quality, with `PANEL_CONCURRENCY=2` adding contention. A panel that finished normally could have been demoted to `failed` on camera. Updated in `spec.md` and `.env.example`; the open item is closed.
- **The cost table's shape was wrong, not just its numbers** — it assumed aspect ratio drives cost. Two `3:2` images at the same quality measured **$0.0114 and $0.0242** (2.1× apart), and the `1:1` close-up ($0.0270) cost *more* than either, inverting the assumption. What actually drives cost is scene density: a plain-background model sheet is cheap, a neon-lit skyline is not. Measured values recorded for `low` and `medium`; `high`/`xhigh`/`max` remain estimates, and the filming-run budget is revised from ~$1.25 to **~$2**. The open item is replaced by a sharper one rather than closed.
- **Returned dimensions are `1536×1024` at `3:2` and `1024×1024` at `1:1`** — exactly the pixel sizes the pre-OpenRouter revision used to request explicitly, so losing the `size` parameter cost nothing in practice. Open item closed.
- **Only `.env` stays local now — the learner profile and `data/` are tracked too** — the learner is working across machines and wants the whole project to travel with the clone. `devpost/learner-profile.md` (professional background, learning goals, communication preferences, and the calibration notes written about them) and `data/` (8.8 MB of kernel-test PNGs, plus all generated art from here on) are now public. Both were scanned: no credentials, no third-party data. `.gitignore` and `spec.md > File Structure` updated to match. Two consequences recorded rather than argued: the profile's assessment of the learner is publicly readable, and tracking `data/` means every generated panel image is committed, so the repo grows with each run. Learner's call.
- **The UI mockup is tracked now, not gitignored** — the learner is working across more than one machine, and `reference/Ink Desk.html` is the visual reference slice 3 ports its look from. Left out of the repo, a remote clone would have the five colour tokens from `spec.md > Look and Feel` but not the halftone values, the rail layout or anything to compare the built shell against. Scanned before committing: no keys, no emails, no personal identifiers, no absolute paths — a bundled HTML with embedded JS, 958 KB, on a public repo. `spec.md > File Structure` updated, which previously said "Not in the repo". The code is still not reused and the README disclosure in `6-ship` is unchanged — tracking the file makes that obligation more visible, not less. Learner's call.
- **Turning Claude's thinking off is `{ type: 'between_tools' }`, not `{ type: 'disabled' }`** — slice 1's text probe got a 400 on the value `spec.md` specified, with the API itself naming the replacement; `GET /v1/models/claude-sonnet-5-5` then confirmed `thinking.types.disabled.supported === false` (and `enabled` false, `adaptive` true). Corrected in `scripts/kernel-test.mjs` and in three places in `spec.md > External Services and Dependencies > Anthropic — Claude (text)`. The learner's decision is unchanged — thinking off, `effort: 'low'`, for short calls whose latency is on camera — only the wire value moved. This is exactly the failure slice 1 exists to catch: it would otherwise have surfaced in slice 3 as every Claude call 400ing at once.
- **Slice 3 was built in a cloud session with no `ANTHROPIC_API_KEY`** — the live `POST /api/synopsis` round-trip is the one item in the slice's Verify list that could not run there. Everything else did and passed: `tsc`, `eslint`, the dev server, `GET`/`POST`/`DELETE /api/chapter` with persistence and server-side gating (409 with the hint), the Chapter Store acceptance check, the design tokens and all three fonts, and the rail gating, hover hints, accept, stamp and navigation in a real headless browser. The Claude call shape was re-checked against the installed SDK's types rather than assumed: `messages.parse`, `thinking: { type: 'between_tools' }`, `output_config.effort` + `format`, `zodOutputFormat` on zod 4. Without a key the pitch desk shows one plain sentence naming the fix and the terminal logs the cause. **The first real synopsis is the learner's local run.**
- **An accepted synopsis is read-only; Rewrite is how the words change** — once accepted, title and body render as text rather than inputs. Cast is proposed from the accepted text, so editing it silently afterwards would make the cast disagree with its source. One conditional in `components/StoryStation.tsx`; the learner can overrule it.
- **"Saved to desk" says "Saving…" from the first keystroke** — found by the browser check: during the 600 ms typing debounce the label used to claim a save that had not happened yet.
- **`lib/patch.ts` added** beside the spec's file list — the one edit shape the browser sends (`station`, `pitch`, `synopsis`) and the pure function that applies it, shared by the client (so typing is instant) and the server (which adds the gate checks on top). Internal; no document changed.
- **`tsx` as a devDependency, `npm run check:store`** — `scripts/chapter-store-check.mts` is the Chapter Store acceptance check the spec asks for, runnable any time: two same-tick `update()` calls both land, four concurrent increments read back as 4, a failing update neither wedges the chain nor corrupts the file, no temp file is left behind. The store takes an `INKDESK_DATA_DIR` override so the check runs against a scratch folder.
- **`AGENTS.md` at the root is written by Next 16 itself** on every `next dev`. Committed rather than fought — it points at the Next 16 docs inside `node_modules`, which is useful to any agent continuing this build. `agentRules: false` in `next.config.ts` removes it.
- **The logo mark still carries `#E5432D`** — `scope.md` says the logo files are being regenerated in the single brand red `#b5382e`; the files in `assets/` have not been yet. The header loads `assets/svg/inkdesk-mark.svg` as is (copied to `public/brand/`), so the mark and the hanko red differ slightly until the asset is regenerated. Flagged, not changed — the logo is the learner's.
