---
doc: prd
status: approved
---

# Ink Desk — Product Requirements

An AI manga creator studio for storytellers and manga fans who have ideas but can't draw: you pitch a story, and Ink Desk turns it into a real 4-panel manga page with your own characters drawn consistently across every panel.

> **Revised again 2026-10-14 — v3, approved 2026-10-14: see [Revision — Ink Desk Studio v3](#revision--ink-desk-studio-v3-public-on-the-learners-domain) at the very end, with its *Changes Since Approval*.**
>
> **Revised 2026-10-13 — see [Revision — Ink Desk Studio (v2)](#revision--ink-desk-studio-v2) at the end.** Everything below is the approved v1 PRD, built and tagged `v1-poc`, kept intact. The v2 section adds the dashboard, projects with a locked style, scenario mode, the library with imported references, the Director's chapter plan, the chapter reader and the PDF export; the v1 page journey becomes the inner loop of every page. Source: `scope.md > Revision — Ink Desk Studio (v2)`.

Source: `scope.md > The Unique Kernel`, `scope.md > Who It's For`. Scope headings are cited beside each major requirement below.

---

## The Core Journey

Develops `scope.md > The Core Loop`. The whole path, end to end:

1. **Arrive.** The Story station is open. A single pitch box, genre and tone chips, and a **"Try the sample"** link. The rail shows all five stations; the four ahead are visibly locked.
2. **Pitch.** Type a story idea (or click "Try the sample" to fill the pitch text) and pick a genre and tone. Submit.
3. **Read the synopsis.** Claude returns a synopsis in an editable field. Rewrite it, regenerate it, or **accept** it.
4. **Accepting unlocks Cast.** Claude proposes two characters — name, role, personality traits, and a short look description each.
5. **Shape the cast.** Edit any character's text freely. **Reroll** an individual character to get a fresh proposal. This is text only, so it's cheap to iterate.
6. **Draw a sheet.** Click **Draw sheet** on a character. Claude writes that character's **visual DNA** from the edited description, then one model-sheet image is generated **from that DNA**.
7. **Check the picture against the words.** The card shows the DNA text beside the sheet image. If the art missed something, **Redraw sheet** reuses the same DNA. Editing the description instead rewrites the DNA and redraws.
8. **Lock.** When the words and the picture agree, lock the character. The Locked stamp lands. The DNA/image pair is now frozen and final.
9. **Both sheets locked unlocks Storyboard.** Claude writes the 4-panel page script: per panel, the character, action, camera angle, background, and dialogue — exactly one locked character per panel.
10. **The page inks in.** Four panels generate in the background, each carrying only its own character's locked sheet and DNA. Panels fill in as they finish, in whatever order they land, each playing the ink-in reveal as it arrives.
11. **Fix what missed.** Compare each face to its sheet. **Redraw panel** reruns the same request; the last three versions stay available behind a per-panel stepper.
12. **All four panels have art, which unlocks Ink & Publish.** Full-page reading, the ink-in reveal replaying panel by panel, a right-to-left toggle, and PNG export.
13. **Success:** `scope.md > What "Working" Looks Like` — **each character is recognizably themselves in every panel they appear in.** Kaito in panels 1 and 3, Mio in 2 and 4.

---

## Screens and Layout

Five stations on one persistent **station rail**, carried from `scope.md > Inspiration & Identity`.

| # | Station | Subtitle | Unlocks when |
|---|---|---|---|
| 1 | **Story** | the pitch desk | always available |
| 2 | **Cast** | model sheets | a synopsis is accepted |
| 3 | **Page script** | the breakdown | both sheets are locked |
| 4 | **Storyboard** | the main studio | the page script exists |
| 5 | **Ink & Publish** | the reader | all four panels have art |

> **Assumption, easily changed:** the page script is presented as part of the Storyboard station rather than a separate rail entry, since the user does not act on it directly — Claude writes it and the panels follow. The rail shows four clickable stations; the script is a visible step inside Storyboard. Flagged in **Open Questions**.

**Rail behavior:**

- The rail is **both a progress indicator and navigation**.
- A station is clickable **only once its prerequisite is met**. No jumping to Storyboard on first load.
- A locked station shows a short hint on hover — e.g. *"Accept a synopsis first."*
- The header carries the Ink Desk mark, a **"Saved to desk"** confirmation label, and a small **"Images this chapter: 8"** counter.

**Back-navigation is always allowed**, with three rules:

- **Back to Cast** — **view only.** Locked sheets cannot be edited; unlocking is deferred.
- **Back to Storyboard from Ink & Publish** — **fully allowed**, so a panel can be redrawn and the reader returned to.
- **Back to Story and accepting a *new* synopsis** — starts a **new chapter.** A confirmation warns that the cast and page will be cleared.

---

## Look and Feel

Carried forward from `scope.md > Inspiration & Identity` — already established from the learner's pre-existing mockup, not re-interviewed.

- **Palette:** paper `#f3f2f2`, surface `#eae9e9`, ink text `#201f1d`, hanko red `#b5382e` with a 9-step ramp. **`#b5382e` is the single brand red**, shared by logo and UI.
- **Type:** Cormorant Garamond (headings), Lora (body), **Comic Neue (dialogue lettering only)**.
- **Texture:** halftone in pure CSS — `radial-gradient` dot screens, `repeating-linear-gradient` tone bands.
- **Motion:** panels "ink in" from pencil sketch to final art. Reference timing from the mockup: ~1.4s.
- **The red stamp** is reserved for primary actions and the Locked badge — it should feel like a hanko seal landing.

New visual states this PRD introduces:

- **Pencil-sketch placeholder** — an empty panel frame renders a dotted silhouette in the mockup's halftone style, with a subtle shimmer and a small label (*"Inking panel 2…"*).
- **Failure state** — a calm, plain-language message inside the panel frame. No raw error codes on screen, ever.
- **Version stepper** — a small `‹ 2 / 2 ›` / `‹ 3 / 3 ›` control in a panel's corner, appearing once a panel has two versions.
- **Image counter** — a small *"Images this chapter: 8"* readout beside the "Saved to desk" label.

---

## Features and Behavior

### Story — The Pitch Desk

Develops `scope.md > The POC Boundary`.

What the user can do: write a pitch, pick a genre and a tone, read Claude's synopsis, edit or regenerate it, accept it.

- **"Try the sample"** fills the **pitch text only** — the Kaito rooftop-courier pitch. Everything after that point is generated for real. This exists so the demo doesn't require typing a pitch on camera while keeping `scope.md`'s rule that generation must be real.
- The synopsis lands in an **editable field** — *"editable, never final."*
- **Accepting** is the gate that unlocks Cast.

> **Assumption:** genre and tone chips reuse the mockup's sets — genres *Shonen, Romance, Horror, Slice of Life*; tones *Hopeful, Fast-paced, Melancholy, Comedic, Eerie*. Trivial to change.

- [ ] Typing a pitch and submitting returns a synopsis with a title and body
- [ ] The synopsis text can be edited in place
- [ ] "Try the sample" populates the pitch box and nothing else
- [ ] Cast is unclickable before a synopsis is accepted, and shows a hint on hover
- [ ] Accepting a synopsis makes Cast clickable

### Cast — Model Sheets

**This is where the kernel is built.** Develops `scope.md > The Unique Kernel`.

Claude proposes, the user edits, then locks. Nothing about a character is final until the user has approved **both the words and the picture.**

**The sequence, in order — this ordering is load-bearing:**

1. Claude reads the accepted synopsis and proposes **two characters**: name, role, personality traits, short look description.
2. The user edits any of that text freely. **Reroll** replaces one character with a fresh proposal. Text only, so iteration is cheap.
3. On **Draw sheet**: Claude writes the character's **visual DNA** from the edited description, and the **sheet image is generated from that DNA**.
4. The card shows the **DNA text beside the image** so the user can verify the picture matches the words before locking.
5. **Redraw sheet** reuses the **same DNA**. **Editing the description** rewrites the DNA and redraws.
6. **Lock** freezes the approved DNA/image pair. Locking is **final** in this version.

**Why DNA-first:** the sheet is a picture of the DNA *by construction*, so the two frozen artifacts cannot contradict each other. A contradiction here would be sent to the image model on every panel — the exact drift the kernel exists to prevent. The human check before locking catches whatever the image model missed.

- **One single image per sheet**, laid out as a real model sheet (front, three-quarter, a few expressions in one frame). Never cropped into separate frames. `scope.md > Explicitly Cut`
- **Sheets have no version history** — a sheet is only final once locked, so there is nothing to revert to.

- [ ] Accepting a synopsis produces two character proposals with name, role, traits, and look description
- [ ] All proposed text is editable
- [ ] Reroll replaces exactly one character and leaves the other untouched
- [ ] Draw sheet produces one image and displays DNA text next to it
- [ ] Redraw sheet produces a different image from the same visible DNA text
- [ ] Editing the description and redrawing changes the DNA text on screen
- [ ] Locking shows the Locked stamp and makes the card read-only
- [ ] Storyboard is unclickable until **both** characters are locked

### Page Script

Develops `scope.md > The Core Loop` — "the page-script step is load-bearing."

Once both sheets are locked, Claude writes the script for all four panels. Per panel: **which character, the action, the camera angle, the background, and the dialogue.**

- **Hard constraint: exactly one locked character per panel.** This is what keeps every image request single-reference. `scope.md > The POC Boundary`
- The script is the **variable part** of each panel prompt; the sheet image, DNA, and style rules are the frozen part.
- Panels alternate characters, shot/reverse-shot. For the sample: Kaito → Mio → Kaito close-up → Mio reacting.
- **Dialogue is not editable in this version** — line-by-line editing is the deferred Script Strip.
  - *Changed from the approved version — bubble text is now editable in place; see **Changes Since Approval**.*

- [ ] The script names one character per panel, and no panel names two
- [ ] Each panel has an action, a camera angle, a background, and dialogue
- [ ] Characters alternate across the four panels

### Storyboard — The Main Studio

Develops `scope.md > The POC Boundary` and the latency direction in `scope.md`.

Four panels generate **in the background**, each request carrying only that panel's character sheet and DNA, plus fixed style rules and an instruction that the image contain **no text**.

**Per-panel independence is the governing rule.** Each panel has its own status. Panels fill in as they finish, **not necessarily in order.** Each plays the ink-in reveal as it lands. A failure in one panel never affects another.

**Generating:** the panel frame shows a pencil-sketch placeholder — dotted silhouette in halftone style — with a subtle shimmer and a label like *"Inking panel 2…"*

**Redraw panel:** reruns the same request with the same references. Never touches other panels.

**Version stepper:** the stepper appears as soon as a panel has **two** versions. Hovering or selecting the panel reveals it in the corner.

- **A panel keeps at most three versions.** The first redraw reads `‹ 2 / 2 ›`, the second `‹ 3 / 3 ›`. Further redraws hold the count at three, dropping the oldest. It never goes above 3. *"Five versions of the same panel isn't a real need, and three keeps it simple."*
- **The displayed version is the one that counts** — it's what appears on the page, in Ink & Publish, and in the PNG export.

**Redraw in progress:** the panel's **current art stays visible** with a small *"Inking…"* indicator, and **Ink & Publish stays open** — the panel still has art, so the gate is not re-closed. If the redraw fails, the **previous version stays displayed** and the failure message offers **Try again**. *A failed redraw never leaves a panel empty.*

**Lettering** — `scope.md > Lettering`: speech bubbles are **overlaid by the app** in Comic Neue, never drawn by the image model.

- *Changed from the approved version — bubbles are now editable SVG lettering (shape, text, position, size, tail), stored per panel; see **Changes Since Approval**.*

- [ ] All four panels show pencil placeholders with per-panel labels before art arrives
- [ ] A panel that finishes first displays its art while others are still generating
- [ ] Each panel plays the ink-in reveal as it lands
- [ ] Every panel prompt asks for no text; if a panel comes back with text in it, Redraw is the fix
- [ ] Speech bubbles appear over the art in Comic Neue with Claude's dialogue
- [ ] Redrawing one panel leaves the other three untouched
- [ ] One redraw makes a `‹ 2 / 2 ›` stepper appear; a second makes it `‹ 3 / 3 ›`
- [ ] Further redraws never push the stepper above 3
- [ ] During a redraw the panel keeps showing its current art with an "Inking…" indicator
- [ ] A failed redraw leaves the previous version on screen, not an empty frame
- [ ] Ink & Publish stays clickable while a panel is being redrawn
- [ ] Ink & Publish is unclickable until all four panels have art, with a hint such as *"Finish panel 3 first"*

### Ink & Publish — The Reader

Develops `scope.md > The POC Boundary`.

- **Full-page reading**, with the ink-in reveal replaying **panel by panel** on entry. *This is the shot that gets filmed.*
- **Right-to-left toggle** — manga reading order. Kept because it's cheap and it's very manga.
- **PNG export** composites the panel images **and** the overlaid bubbles into one file.

- [ ] Entering the station replays the ink-in reveal panel by panel
- [ ] The right-to-left toggle visibly changes panel reading order
- [ ] Exported PNG contains both the art and the speech bubbles
- [ ] The exported page uses each panel's currently displayed version
- [ ] Returning to Storyboard, redrawing a panel, and coming back shows the new art

---

## States and Boundaries

- **First use** — Story station open, pitch box empty, four stations locked on the rail with hover hints. No chapter in progress.
- **Generating (text)** — synopsis, cast proposals, DNA, and page script are text-only and fast; a simple in-place pending indication is enough.
- **Generating (image), first time** — pencil-sketch placeholder, shimmer, per-panel label. Per-panel, independent.
- **Redraw in progress** — different from first generation: the panel's **current art stays visible** with a small *"Inking…"* indicator. **Ink & Publish stays open**, because the panel still has art. If the redraw fails, the **previous version stays displayed** and the message offers **Try again**. *A failed redraw never leaves a panel empty.*
- **Transient failure (rate limit, timeout)** — the app **quietly retries once.** If that also fails, the panel frame shows a calm plain-language message — *"Panel 3 didn't come back, the studio is busy"* — with a **"Try again"** button. Other panels are unaffected.
- **Refusal by the image model** — the frame says the panel couldn't be drawn as written and offers **"Rewrite panel"**, which asks Claude to rephrase **only that panel's visual description** — action, camera angle, background — and retries. **The dialogue stays exactly the same**, since dialogue editing is deferred. A refusal is a *wording* problem, not a *waiting* problem, so it gets a different button.
- **No raw error codes on screen, ever.** And a failure never wipes panels that already succeeded.
- **Persistence — one chapter, same browser.** Everything generated comes back exactly where it was left: synopsis, cast proposals, locked sheets with their DNA, page script, finished panels **and their version history**, and which station the user was on. Closing the tab and returning tomorrow on the same browser restores the same chapter. Each save is confirmed by the **"Saved to desk"** label.
- **Reload mid-generation** — **generation survives the reload.** Because panels are generated server-side (`spec.md > Persistence and Image Storage`), a reload shows each in-flight panel either **finished** or **still inking**, and it keeps going. *"A stray refresh during the demo never costs me six generations."*
  - **Safety net:** a panel still marked inking after a **generation timeout**, or after the **server restarted**, falls back to the original **failed state with "Try again."** In development Next.js restarts the server on every code change, which kills in-flight requests — without this, such a panel would spin forever. **Nothing spins forever; nothing finished is lost.**
  - *Changed from the approved version — see **Changes Since Approval**.*
- **New chapter** — an explicit action, with a confirmation, that clears everything and starts fresh.
- **Accepting a new synopsis from Story** — same effect as New chapter, with a confirmation warning that the cast and page will be cleared.
- **No accounts, no list of saved chapters.** One chapter at a time.
- **Image counter** — a small **"Images this chapter: 8"** readout sits beside "Saved to desk". **No hard cap in the product**; it exists for the learner's own awareness while testing and filming. A server-side safety limit is a `4-spec` decision.

---

## Product Decisions

- **Guided with free back-navigation, prerequisite-gated rail.** The dependency chain is real, so gating teaches it; hover hints explain rather than error.
- **Claude proposes the cast, the user edits and locks.** *"The studio does the work, but the user keeps authorship."* Text iteration is cheap, so Reroll is free to use.
- **DNA first — the DNA is the sheet prompt.** Chosen over writing DNA from the description after the fact, so the two locked artifacts cannot contradict each other. *"The picture is the DNA made visible by construction."* Claude checking the image automatically was explicitly judged a nice Later.
- **Locking is final; no unlock.** Keeps the contract simple and the build small.
- **"Try the sample" fills the pitch text only.** Seeds the demo without faking any generation.
- **Retry once silently, then ask.** One quiet retry absorbs ordinary flakiness without making the user watch a spinner twice.
- **Retry versus Rewrite as distinct repairs**, because transient failures and refusals have different causes.
- **Three versions per panel.** Enough to compare and revert, few enough to stay simple.
- **Sheets get no version history**, since a sheet isn't final until it's locked.
- **One chapter persists, no chapter library.** Protects the demo against a stray refresh without building an account system.
- **Panels fill out of order.** Per-panel independence beats a synchronized page reveal, because one slow request shouldn't hold the other three hostage.
- **A redraw never blanks a panel.** The current art stays up while redrawing and stays up if the redraw fails, so the page is never less finished than it was.
- **Rewrite only touches the visuals.** Action, camera angle, and background get rephrased; dialogue is untouched, consistent with dialogue editing being deferred.
- **A visible image counter, but no hard cap in the product.** Awareness beats enforcement at this size — a server-side safety limit is a technical decision, not a product one.
- **A reload does not cancel generation, but nothing may spin forever.** Added in `4-spec`. Server-side generation makes surviving a reload nearly free, which is strictly better for the demo than discarding work in flight. The timeout-and-restart fallback exists because the dev server kills in-flight requests on every code change, so "keeps generating" needs a floor. See **Changes Since Approval**.

---

## What We're Building

Everything the proof of concept must do to be complete:

1. Story station: pitch box, genre and tone chips, "Try the sample", Claude synopsis, editable, acceptable.
2. Cast station: two Claude-proposed characters, editable text, per-character Reroll, Draw sheet (DNA then image), DNA shown beside art, Redraw sheet, Lock with stamp.
3. Page script: Claude's four-panel breakdown with one locked character per panel.
4. Storyboard: four background generations with pencil placeholders and per-panel status, ink-in on arrival, overlaid Comic Neue bubbles, Redraw panel that keeps the current art visible while it runs, three-deep version stepper.
5. Ink & Publish: full-page reveal, right-to-left toggle, PNG export compositing art and bubbles.
6. Station rail with prerequisite gating, hover hints, and the back-navigation rules.
7. Failure handling: silent single retry, "Try again" for transient failures, "Rewrite panel" for refusals, plain language only.
8. One-chapter persistence with "Saved to desk" confirmation, restore-on-reload including version history and current station, **in-flight panels that keep generating across a reload** with a timeout/restart fallback to the failed state, and New chapter with confirmation.
9. A visible "Images this chapter" counter in the header.

---

## Deferred From the POC

Named so none of them slip into the build unnoticed. From `scope.md > Later`:

- **A panel with both characters together** — needs multi-reference generation. The single-character-per-panel rule is what keeps every request simple.
- **Director's Chair** chat for directing Claude on a selected panel.
- **Script Strip** — line-by-line dialogue editing. Dialogue is display-only in this version. *The bubble half was un-deferred at the slice 4–5 checkpoint — text edits in place, in the bubble; see **Changes Since Approval**. The strip itself stays deferred.*
- **Backgrounds and scenes shelf** as separately generated, reusable assets. Background folds into the panel prompt for now.
- **Unlocking and editing a locked sheet.** Back-to-Cast is view-only because of this.
- **Claude automatically checking the sheet image against the DNA** — the human does this check before locking.
- **Multiple page layouts.** The mockup has three; this builds one 4-panel layout.
- **Accounts and a saved-chapter library.** One chapter, one browser.
- **PDF export and share link.** PNG only.
- **Deployment** — optional for this hackathon.

---

## Possible Later Enhancements

- Claude reading the generated sheet and reporting whether the art matches the DNA, so the consistency check is automatic.
- More than two characters, and group panels once multi-reference generation is in.
- A chapter library with multiple saved stories.
- External comic APIs such as **LlamaGen** — `scope.md > Later`.
- Longer stories: multiple pages, multiple layouts, chapter continuity.

---

## Non-Goals

From `scope.md > Explicitly Cut`, plus what will tempt during the build:

- **Real two-pass pencil→ink generation.** The ink-in is a reveal animation over the finished image. One generation per panel, always.
- **Five-frame model sheets.** One image, or there is no single canonical reference to send.
- **Manual panel touch-up or painting.** The only repairs are Redraw and Rewrite. If a redraw is still off, accept the best one — *"an honest proof of concept, not a guarantee."*
- **A third character.** Two prove the lock isn't a fluke.
- **Text rendered by the image model.** Every panel prompt asks for no text; all lettering is app-side overlay.
- **Reusing the mockup's code.** Visual reference only.
- **Raw error codes or stack traces shown to the user.**

---

## Changes Since Approval

Behavior changes after approval are recorded here rather than edited in
silently. The first came from `4-spec`; the second from the slice 4–5
checkpoint in `5-build`.

### Reload mid-generation — generation now survives the reload

| | |
|---|---|
| **Was (approved)** | In-flight panels come back in the **failed state with "Try again."** |
| **Now** | Generation **continues server-side** across a reload; the panel shows as **finished** or **still inking**. A panel still inking after a **generation timeout**, or after a **server restart**, falls back to the failed state with "Try again." |
| **Why** | `spec.md > Persistence and Image Storage` puts generation and chapter state on the server, which makes surviving a reload nearly free — and losing four panels to a stray refresh is the worse demo. |
| **Why the fallback** | In development Next.js restarts the server on every code change, killing in-flight requests. Without a floor, such a panel would spin forever — violating the original rule, which is kept. |
| **Decided by** | The learner, in `4-spec`. |

### Speech bubbles — from derived overlay to editable lettering

| | |
|---|---|
| **Was (approved)** | Bubbles are app-overlaid Comic Neue at a **derived corner**, and **dialogue is not editable** — line-by-line editing is the deferred **Script Strip**. |
| **Now** | Bubbles are **proper manga bubbles drawn as SVG paths** — a clean rounded oval with a smooth tail, ink outline, white fill — not CSS boxes. **Click edits the text in place** in Comic Neue; **drag moves** the bubble, **handles resize** it, and **dragging the tail tip** points it at the speaker. Each panel's bubble **position, size, and tail are stored in `chapter.json` as percentages of the panel**, so they survive a reload and the slice 7 PNG export composites **exactly the same layout**. Claude's dialogue is the starting text; the user's edits replace it. The derived corner stays as the default until a bubble is first touched. |
| **Why** | The slice 4–5 checkpoint: the CSS bubbles read as a broken, generic approximation of manga lettering, and the user wants the same authorship over the lettering they have over the cast. |
| **What this un-defers** | Only the **bubble half** of the Script Strip. A line-by-line script-editing strip stays deferred, and **Rewrite panel** (slice 6) still never touches dialogue. |
| **Decided by** | The learner, 2026-10-12, at the slice 4–5 checkpoint. |

Everything else in this document stands as approved.

---

## Open Questions

**Resolved in `4-spec`** — kept for the record rather than deleted:

- ~~**Which GPT Image model and endpoint accept reference images, and how many per request.**~~ **Verified.** `POST /v1/images/edits` accepts an array of reference images; Ink Desk needs one. Model pinned to `gpt-image-2.5-sunburst-2026-09-08`, because `gpt-image-1` shuts down 2026-10-23. See `spec.md > Verified: Image Model and Reference-Image Support`.
- ~~**Panel generation concurrency.**~~ **Resolved: 2**, as the learner preferred. See `spec.md > Rate Limits and Concurrency`.
- ~~**A server-side safety limit on images per chapter.**~~ **Resolved: not built**, since the app stays local-only. It becomes a requirement if deployment is ever revisited. See `spec.md > Where It Runs and How Someone Tries It`.

**Still open, none blocking:**

- **Does the page script get its own rail entry, or live inside Storyboard?** Drafted as a step inside Storyboard, since the user doesn't act on it. Cosmetic and reversible — does **not** block `4-spec`.
- **Should the genre and tone chip sets stay exactly as the mockup has them?** Assumed yes. Does not block `4-spec`.
- **How long the ink-in reveal should run in the reader** versus the mockup's ~1.4s per panel. A four-panel sequential reveal may want faster per-panel timing to stay watchable. Tune during build; does not block `4-spec`.
- **The generation timeout that trips the "still inking" fallback.** Needs a real number, which depends on how slow `gpt-image-2.5-sunburst` actually is at `high`. Measured in the kernel test and set in `5-build`.

---

# Revision — Ink Desk Studio (v2)

**Date:** 2026-10-13. **Decided by:** the learner, after the v1 final review. **Source:** `scope.md > Revision — Ink Desk Studio (v2)` — the kernel restated as one contract on three things, the v2 boundary (ten numbered items, feature freeze 2026-10-20), the v2 money shot, and the demo video as a deliverable. This section pins those down as behavior. **The v1 page journey above is unchanged and becomes the inner loop of every page.**

## The Core Journey (v2)

1. **Arrive at the dashboard.** Project cards (cover or first-page thumbnail, title, style, images used), **New project**, the global library (every locked character across projects, read-only), and the budget readout. A v1 desk shows up as one project.
2. **New project.** Title, and a **style preset** chosen from a list — at least **Manga (black and white)** and **Manhwa (colour)**. The style is locked with the project; it is frozen rules text sent with every image request, exactly as v1's style rules were.
3. **Tell the story.** Either the v1 pitch (pitch, genre, tone → synopsis → accept), or **Scenario mode**: paste a long scenario, with notes, and attach references from the project's assets. Accepting the story (v1) or saving the scenario (v2) unlocks the Library.
4. **Build the library.** Claude proposes the cast as in v1. A character gets its sheet one of two ways: **Draw sheet** (DNA, then the picture, as v1) or **Import reference** — pick an uploaded image; it becomes the sheet and Claude writes the DNA *from the picture*. The card shows the DNA beside the art either way. **Lock** is the same stamp and the same contract.
5. **Both characters locked unlocks the Director.** Claude reads the scenario (or the synopsis), the locked cast and the style, and writes a **chapter plan**: at least three pages, each the four-shot page of v1 (who is in which slot, action, camera, background, dialogue), plus a **cover brief**. The plan appears as pencil thumbnails with the **cost estimate** for the whole chapter at the configured quality, **before any image is generated.**
6. **Edit the plan.** Any line on any page, the page count within the allowed range, the cover brief.
7. **Generate.** **Generate page** inks one page exactly as v1 did — placeholders, stage lines, two at a time, ink-in on arrival. **Generate all** queues the pages in order. The **cover** is one image carrying the locked characters, with the title lettered by the app, never by the model.
8. **Fix what missed.** Per panel: editable bubbles, Redraw with up to three versions, Try again, Rewrite — the slice 5b and 6 behavior, unchanged, now per page.
9. **Read the chapter.** Ink & Publish opens on the first complete page: cover first, then every page that has art, in sequence — **right-to-left for manga, vertical scroll for manhwa** — with the ink-in replay per page.
10. **Export.** **PNG** of any page (v1) and **PDF** of the chapter: cover plus pages, bubbles composited.
11. **Success:** `scope.md > What "Working" Looks Like (v2)` — the imported character's upload beside their panels on pages 1, 2 and 3 and the cover, same face, same outfit, same marks; every locked character recognizably themselves in every panel they appear in, on every page and on the cover.

## Screens and Layout (v2)

Two surfaces, one rail.

| Surface | Route | What it holds |
|---|---|---|
| **Dashboard** | `/` | Project cards · New project · global library · budget readout |
| **Studio** | `/p/<project>` | The station rail for one project |

**The rail inside a project**, in order, each gated like v1:

| # | Station | Unlocks when |
|---|---|---|
| 1 | **Story** (pitch *or* scenario) | always |
| 2 | **Library** (cast + assets) | a synopsis is accepted, or a scenario is saved |
| 3 | **Director** (the chapter plan) | both characters are locked |
| 4 | **Page** (the v1 storyboard, one page at a time, with a page switcher) | a plan exists |
| 5 | **Ink & Publish** (the chapter) | at least one page has all four panels inked |

**Rail behavior and back-navigation** keep the v1 rules. Two additions: the header shows **which page** is open and **"Images this project: N · ≈ $X"**; and *Back to Story* once a plan exists is view-only — rewriting the story is a new chapter, with the v1 confirmation.

## Features and Behavior (v2)

### Dashboard

- [ ] A fresh install shows an empty dashboard with New project and an empty library
- [ ] A v1 desk (`data/chapter.json`) appears as one project card, with its page and images intact, the first time the dashboard loads
- [ ] A project card shows the cover when one exists, otherwise the first inked page, otherwise a pencil placeholder
- [ ] The global library lists every locked character across projects with its sheet, read-only
- [ ] The budget readout shows images generated and the running cost from the providers' reported `usage.cost`, per project and in total

### New Project and Style Presets

- [ ] New project asks for a title and a style preset, and nothing else
- [ ] At least two presets exist: **Manga — black and white** (today's rules) and **Manhwa — colour** (full colour, clean line, vertical reading)
- [ ] The chosen preset is **locked with the project** and shown on the card and in the rail; it cannot be changed afterwards (a new style is a new project)
- [ ] Every sheet, panel and cover request for the project carries that preset's rules text verbatim
- [ ] Presets never name a real work, artist or publisher — they describe a look

### Scenario Mode and References

- [ ] The Story station offers **Pitch** (v1) and **Scenario**; Scenario takes a long text (the sample scenario is provided) and optional notes
- [ ] Assets can be uploaded to the project (PNG, JPEG, WebP, with a size cap) and appear on a shelf with a name and a thumbnail
- [ ] The upload control carries a rights notice: the user must own or have permission for anything uploaded
- [ ] A saved scenario unlocks the Library exactly as an accepted synopsis does
- [ ] A scenario longer than the planner's comfortable size is summarized first, and the plan says so in plain language

### Library — Characters, Imported or Generated

Keeps every v1 Cast criterion. Adds:

- [ ] A character card offers **Import reference** beside Draw sheet, listing the project's assets
- [ ] Importing sets the asset as the sheet, and Claude writes the DNA **from the picture**; the DNA shows beside the art before Lock, exactly as a drawn sheet
- [ ] Lock on an imported card is refused until the DNA exists, the same rule as a drawn card
- [ ] A locked imported character sends **the imported bytes** as the single reference in every panel request
- [ ] Redraw sheet on an imported card is unavailable (there is nothing to redraw; re-import or edit the look instead)

### The Director — Chapter Plan and Cover

- [ ] With both characters locked, the Director writes a plan of **at least three pages** and a cover brief, from the scenario (or the synopsis), the cast and the style
- [ ] Each page is the v1 four-shot page: one locked character per slot, alternating, with action, camera, background and dialogue — enforced by schema, as v1
- [ ] The plan shows as pencil thumbnails per page, every line editable, the page count adjustable within the allowed range
- [ ] The **cost estimate** for the whole chapter at the configured quality is shown **before** any generation, and updates when the page count changes; it is labelled an estimate
- [ ] **Generate page** inks one page; **Generate all** queues every un-inked page in order; both are idempotent
- [ ] A page's failure never touches another page; per-panel repair works on any page
- [ ] The cover is one image with the locked characters in the project's style; the title is lettered by the app over it, editable, never requested from the model

### Pages — Generation, Lettering, Repair

Every v1 Storyboard criterion holds per page: placeholders with labels, two at a time, ink-in on arrival, editable SVG bubbles stored as percentages, Redraw with three versions, a redraw never blanks a panel, Try again, Rewrite panel. Adds:

- [ ] A page switcher moves between the chapter's pages without leaving the station
- [ ] The header's page-level progress reads "N of 4 panels inked" for the open page and "P of Q pages complete" for the chapter

### Reader (v2) — The Chapter

- [ ] Ink & Publish unlocks on the first page with four inked panels, not after the whole chapter
- [ ] The chapter reads cover first, then every complete page in order; incomplete pages show as pencil placeholders with their number
- [ ] Manga presets read **right-to-left** with a toggle (v1); Manhwa presets read as one **vertical scroll**
- [ ] The ink-in replay plays per page on entry

### Export (v2) — PNG and PDF

- [ ] Export PNG works on any complete page, as v1
- [ ] Export PDF produces one file: cover, then every complete page at the page size, bubbles and lettering composited, using each panel's current version
- [ ] Both exports run in the browser; no server round trip and no secrets involved

## States and Boundaries (v2)

- **Projects persist on the desk**, each in its own folder (local mode): `data/projects/<id>/project.json` plus its images. The v1 desk migrates once, on first read, and the original `chapter.json` is left in place untouched.
- **Storage modes.** `INKDESK_STORAGE=local` (default; a clone runs with no account) or `cloud` (MongoDB for project state, an S3-compatible bucket for images). Same behavior, same checks; the demo and the video run local.
- **Text fallback.** When Claude cannot be used — no `ANTHROPIC_API_KEY`, a 402, or a server error that survives the single retry — every text call falls back to `openai/gpt-5.6-terra` through OpenRouter with the same schemas. The terminal names the provider that answered; the screen does not change. `LLM_FALLBACK=never` disables it.
- **Budget.** The readout is informational, as v1's counter was; **no hard cap in the product**. The Director's estimate exists so spending is a decision, not a surprise.
- **Generation survives a reload**, per page, with the v1 timeout-and-restart floor.
- **New chapter** and **New project** are explicit, confirmed actions; nothing is deleted silently.
- **Feature freeze 2026-10-20.** After it: fixes, the video, the README.
- **The demo video, as a product in its own right (2026-10-14).** Nine beats under three minutes; the voice never runs past its beat (a clip is cut at the beat's end, and a clip that would is reported before the render); the music sits under the voice (ducked while a clip plays, faded in at the start and out at the end) and is generated — composed by the repo's own code, or by a music model through OpenRouter from a mood prompt, the learner choosing by ear — so no third party's recording is in the soundtrack; the captions are the narration's own words; and one beat, "Planned before built", shows how the project was made — scope, PRD and spec before code, slices verified and committed — because the hackathon judges the planning as much as the product.

## Product Decisions (v2)

- **One contract on three things.** The character lock is the anchor; style and setting locks are candidates until each passes its own kernel test. The video claims only what is proven.
- **Style is locked per project, not per page.** A sheet is drawn in its style; switching styles mid-chapter would break the lock. A second style is a second project.
- **Imported references join the lock, not bypass it.** DNA is written from the picture so the frozen pair still cannot contradict itself.
- **The plan is editable and priced before a single image.** The cost of a chapter is the main thing that changed between one page and many.
- **The v1 page engine is reused unchanged**, per page. Every repair behavior, every check, every stage line.
- **Local files stay the default.** Cloud storage is a switch, never a prerequisite — the clone must run.
- **The text fallback is silent on screen, loud in the terminal.** Same calm sentences; the provider is an implementation detail the user never has to think about.
- **One layout per page.** The four-shot page proved the lock; more layouts are Later.

## What We're Building (v2)

The ten numbered items of `scope.md > The POC Boundary (v2)`, as behavior above: 1 Dashboard · 2 New project with a locked style preset (manga B&W, manhwa colour) · 3 Scenario mode with references · 4 Library with one imported and one generated locked character · 5 The Director's editable plan of ≥ 3 pages + cover with the cost estimate · 6 Page generation with the 5b states, editable bubbles and the slice 6 repair logic · 7 Chapter reader, RTL for manga, vertical for manhwa · 8 PNG per page + PDF of the chapter · 9 Storage behind an interface, local by default, Mongo + bucket switchable · 10 GPT Terra text fallback.

## Deferred From the POC (v2)

- In-app video export and in-app dubbing — only if items 1–9 are done by 2026-10-20; otherwise Later, no debate.
- Two characters in one panel — needs a kernel test.
- Multiple volumes in the UI.
- Alternative image models in the app — unless one passes the kernel test before 2026-10-18.
- Style and setting as reference-image locks beyond the candidate stage.
- Accounts, deployment, the loading mini-game, a shared library between projects.
- Everything on v1's Deferred list that v2 did not pull in (Director's Chair chat, Script Strip, LlamaGen).

## Non-Goals (v2)

- Claiming a candidate lock in the video before its kernel test.
- A second page layout in the submission.
- A hard image cap, accounts, or public deployment.
- Any feature not on the numbered list after 2026-10-20.

## Open Questions (v2)

- **The page-count range the Director accepts** — drafted as 3 to 6; tune at the slice 11 checkpoint.
- **Vertical reading for manhwa in the export** — the PDF keeps one page per sheet; a single tall strip is a possible later export. Does not block.
- **Whether the global library should allow re-using a locked character in a new project** — read-only for now; copying a lock into a second project is Later.
- **Which premade voice narrates the video** — the learner's choice when the script exists. *2026-10-14:* the learner asked for the voice-over to be produced now; recorded in `george` (the voice the plan named first), one `--voice` switch and ≈ $0.10 to change. Still open: whether the learner keeps it.
- **Which generated track ships** — the piece composed by code (reproducible, CC0) or the Lyria 3 piece generated through OpenRouter (used under the service's terms for generated output, which the learner confirms before publishing). The review render carries the Lyria piece; the learner decides by ear.

---

# Revision — Ink Desk Studio v3 (public, on the learner's domain)

> **Approved 2026-10-14** — the learner's word: *"start with slice 16"*. Source: `scope.md > Revision — Ink Desk Studio v3`, decided by the learner the same day. The v2 studio journey above is unchanged and becomes what a signed-in user does inside their own projects; v3 adds who they are, what they may spend, how they share, and the animated page. Product behavior only — the how is `spec.md > Revision v3`.

## Changes Since Approval

Against the approved v2 PRD:

1. **There are users now.** v2 had one desk for whoever opened the app. v3 has accounts (email and password), and every project, image, video, share and quota belongs to one user. *Supersedes* v2's "Accounts" under *Deferred From the POC (v2)*.
2. **The app is public on the learner's domain**, with no landing page: the domain root is the sign-in screen or the dashboard. *Supersedes* v2's "the demo and the video run local". *(2026-10-24: private — no sign-up; see item 11.)*
3. **Spending has limits a user can see.** A quota meter in the header, a Usage page, disabled buttons with a reason and a reset time, and a global kill switch. *Supersedes* v2's "Budget … no hard cap in the product".
4. **Animate a page** is new: a 20–30 s trailer of one finished page. *Supersedes* v2's "In-app video export and in-app dubbing — Later".
5. **Share publicly** is new, for a manga and for a video, with a Report button on every public page.
6. **Settings, Usage, Terms and Privacy** are new screens.
7. **Every screen works on a phone.** v2 was designed for a desktop studio.
8. **The demo video is re-filmed on the live domain on Oct 23–24**, narrated from the learner's own script. *Supersedes* v2's "narration drafted by the AI partner".
9. **Freeze moves to 2026-10-22, end of day**; the cut line is the learner's: not working and checkpointed by Oct 22 → *Later*, no debate; if v3 is unstable, the last stable tag ships.
10. **Sign-in is the studio's own (Better Auth), not Clerk's — 2026-10-24, the learner's decision** (see *Product Decisions (v3)*). Email and password only — Google and GitHub sign-in were cut the same day at the learner's word: *"make sure only email and password sign in / up are there and no google and github"*. There is no email service, so the studio sends no email: there is no password reset and the email cannot be changed. No CAPTCHA. The account screens in Settings are the studio's own.
11. **No sign-up — the studio is private — 2026-10-24, the learner's decision** (see *Product Decisions (v3)*). Nobody makes their own account: the learner makes each one (their own, the judges') with their script, already verified; the judges sign in with the credentials in the Devpost testing instructions. Strangers see the sign-in page and public share links only.

## Core Journey (v3)

1. **Open the domain.** Signed out: the studio's sign-in card (email and password), with links to Terms and Privacy and the sentence that there is no sign-up — accounts are given by the studio. Signed in: the dashboard.
2. **Dashboard.** My projects (manga), my videos, the library, **New project**, and a compact **quota meter** in the header (today's images, video seconds and audio characters against the limit).
3. **The studio, as v2** — style preset, scenario, library with an imported reference and locks, the Director's plan with its estimate, pages ink in, the reader, PNG and PDF. Now inside the user's own project, inside their quota.
4. **Animate a page.** From a finished page (any page whose four panels are inked): **Animate** → the estimate (shots, seconds, dollars, and what it takes from today's quota) → **Confirm**. The page's shots appear as cards, each with its own progress; a failed shot says why and offers **Try again** while the others carry on. When every shot is done the trailer is assembled, and it appears under **My videos**.
5. **Share.** On a manga or a video: **Share publicly** → a link on the domain (`/s/<token>`) to copy; **Unpublish** at any time.
6. **Someone opens the link.** Signed in or not, they see a read-only reader or player — title, cover, pages or the video — and nothing else of the owner's. A **Report** button lets them flag it.
7. **Settings and Usage**, from the dashboard and the header's account menu (**Account**, **Sign out**).

## Features and Behavior (v3)

### Accounts and Sign-in (v3)

- [ ] Signed out, every page except sign-in, Terms, Privacy, share pages and the health check sends the visitor to sign-in; after signing in they land where they were going, or on the dashboard
- [ ] Sign-in is **email and password only** (10–128 characters) — no Google, GitHub or other outside sign-in. **There is no sign-up**: no sign-up page, no "make an account" link, and the server refuses any attempt to create an account; an account exists only when the learner makes it with `npm run judge:account`, and it is in the app's own records the moment it is made
- [ ] The sign-in card says plainly: "There is no sign-up: accounts are given by the studio. There is no password reset either — the studio sends no email."
- [ ] Too many sign-in attempts from one address in a minute are refused with a calm sentence; if the counter is unavailable, sign-in is refused rather than left open
- [ ] Only a **verified** email counts for the allowlist and the admin list; every account the learner's script makes is verified (given an existing account's email, it marks it verified again). An account not on `ALLOWLIST_EMAILS` is on the free plan
- [ ] The header has **Account** (Settings › Account) and **Sign out**; signing out returns to sign-in; "Sign out of other devices" is available in Settings
- [ ] Edge cases: **a visitor with no account** — sees the sign-in card and the no-sign-up sentence, and can still open any public share link; **someone trying to create an account anyway** (calling the server directly) — refused; **Forgot password** — not available, and the card says so (no email service); **wrong password** — one sentence, no hint which half was wrong

### Ownership and Privacy (v3)

- [ ] A user sees only their own projects, images, videos, shares and usage — in the dashboard, the studio, every image and every download
- [ ] Opening another user's project by its address shows the same "There is no such project" page as an address that never existed
- [ ] Nothing a user did is visible to anyone else unless they shared it

### Dashboard (v3)

- [ ] Sections: **Projects** (covers, as v2), **Videos** (poster, length, status, date), **Library**, **New project**
- [ ] The header shows the quota meter and the account menu (Account, Sign out) on every signed-in screen
- [ ] A video still being made shows its progress on the dashboard; a finished one plays from there
- [ ] Empty states: a new account sees a short line on what to do first, not a blank page

### Limits and Usage (v3)

- [ ] Every action that costs money is counted against today's quota **before** it starts; the estimate says what it will take
- [ ] At 80% of a limit the meter warns; at 100% the buttons that would spend are **disabled with the reason and the reset time** — never a raw error
- [ ] Too many requests in a short time are refused with a calm sentence and when to try again
- [ ] When the global daily spend cap is reached, generation pauses for everyone with one clear message; reading, the reader, exports and shares keep working
- [ ] **Usage** in Settings shows, for today: images, video seconds and audio characters used vs the limit, the reset time; spend today and this month from the providers' real costs; the user's plan (free or allowlisted) and each limit
- [ ] What the meter shows is exactly what is enforced
- [ ] A free account starts with a small quota (the learner's example: 1 project, 20 images, 1 short video a day); allowlisted emails get higher limits

### Animate a Page (v3)

Source: `scope.md > What "Working" Looks Like (v3)`.

- [ ] **Animate** appears on a page whose four panels are inked; otherwise it is disabled with "Finish this page first"
- [ ] The estimate before anything is spent: number of shots, total seconds, dollars, and the share of today's quota; **Confirm** or **Cancel**
- [ ] One shot per panel, 3–5 s each, in the panel's own framing; the camera motion follows the panel's stored camera line
- [ ] Each shot has its own card and progress (queued, animating, done, failed); a failed shot shows why and **Try again**; the other shots continue
- [ ] Dialogue is spoken by **one voice per character**, chosen once and kept; the line plays while its bubble is on screen
- [ ] Bubbles appear on time over the shots, lettered by the app as in the reader — never drawn by the model
- [ ] Music sits under the voices
- [ ] The finished trailer (20–30 s) plays in the studio and on the dashboard, with a poster image
- [ ] Leaving the page, closing the tab or a server restart never loses a shot that was paid for: progress continues and is still there on return
- [ ] **The motion proof** (`scope.md > The Unique Kernel (v3)`): the imported character, across a close-up, a medium and a wide shot, keeps the same face, outfit and marks from the first frame to the last — judged by the learner on the motion kernel test before the app may claim it

### Sharing (v3)

- [ ] **Share publicly** on a manga or a video gives a link on the domain; copying it is one tap
- [ ] The link opens a read-only page: the manga in the reader (reading direction by style) or the video in a player — title and cover, nothing else of the owner's (no scenario, DNA, plan, costs, account)
- [ ] Shared links look right when pasted elsewhere: title and cover image as the preview
- [ ] Share pages are not indexed by search engines until the learner decides otherwise
- [ ] **Unpublish** makes the link show the same "not found" page as a link that never existed, at once
- [ ] Later edits to a project do not change what an existing link shows until the owner updates the share

### Report (v3)

- [ ] Every public page has **Report**: a reason and an optional note; the visitor is thanked, never told the outcome
- [ ] Reports reach the learner — an admin list visible only to allowlisted admin emails, and (if an email service is configured) an email
- [ ] The learner can unpublish a reported share from that list

### Settings (v3)

- [ ] **Account** (the studio's own page): the email, whether it is verified (and why not), a note that the email cannot be changed (no way to prove a new one — export your data and make a new account); **Change password** with the current password, and an option to sign out the other devices too; **Where you are signed in** — each session's browser, system and last activity, with **Sign out of other devices**
- [ ] **Studio defaults**: default style for new projects, default reading direction, default voice per character type
- [ ] **Sharing**: everything this user has shared, with its link and **Unpublish**
- [ ] **Data and privacy**: **Export my data** (projects as JSON plus their images, as one download) and **Delete my account** — with a confirmation that names what goes: projects, images, videos, shares, queued work; after it, nothing of theirs remains
- [ ] **Usage** (above)

### Terms and Privacy (v3)

- [ ] Two short text pages, linked from sign-in and Settings: what content is allowed, what is stored and where, which outside services see it, how to delete it

### Status and Health (v3)

- [ ] If the queue or its store is down, buttons that would generate say "The studio is busy — try again in a few minutes"; reading existing work keeps working
- [ ] A health address answers for the host's deploy checks

### Responsive (v3)

- [ ] Every screen — sign-in, dashboard, studio stations, reader, animate, share pages, settings, usage — works at phone (≈ 390 px), tablet (≈ 768 px) and desktop widths with no sideways scrolling
- [ ] Every action is reachable by touch with a comfortably sized target; a locked station explains itself when tapped, not only on hover
- [ ] Bubble text is never cut off on a small panel
- [ ] The 5b rules hold everywhere: visible actions, explained disabled states, real loading states

### Safety (v3)

- [ ] Uploads are checked for real type and size, re-encoded, and stripped of hidden metadata (such as GPS) before anyone else could see them
- [ ] Nothing a user types — bubble text, scenario, titles — can run as code in anyone's browser, including on share pages
- [ ] A failure anywhere ends in a sentence and a way forward, never a blank screen or a technical message

## States and Boundaries (v3)

- **Who can do what.** Signed out: sign-in (no sign-up), Terms, Privacy, share pages, Report, health. Accounts: only those the learner makes. Signed in: their own work only. Allowlisted: higher limits; admin emails also see the report list.
- **Spending is always behind sign-in, a quota and the kill switch.** No exception for any route.
- **One page is the unit of animation.** Full-chapter animation is *Later*.
- **Work survives restarts and deploys.** A shot or panel that was paid for is never lost or paid for twice because the app restarted.
- **Deleting an account is complete** — records, files, queued work, public links.
- **Share pages are a snapshot**, read-only, revocable, `noindex`.
- **Feature freeze 2026-10-22, end of day.** After it: fixes, the video, the README, the submission.

## Product Decisions (v3)

All the learner's, 2026-10-14: v3 is in the submission; Railway web + worker; the domain root is the app (no landing page); Clerk with email, Google and GitHub *(replaced 2026-10-24, below)*; Redis + BullMQ for the queue, the limits and the counters, with Mongo as the source of truth; a private bucket with signed URLs *(as built: no signed URLs — files stream through owner-checked routes)*; small free quotas, an allowlist, a $5/day global kill switch; Settings with account, defaults, sharing, export and delete; a Report button reaching the learner; Terms and Privacy; one page animated per trailer with `seedance-2.0`, one ElevenLabs voice per character, music, ffmpeg assembly in the worker; other production models only after a test; straight to `main` with tags; re-film on the live domain on Oct 23–24 with the learner's own narration.

**Better Auth replaces Clerk — the learner's, 2026-10-24:** *"base on the devpost skill and also what the hackathon says i want you to remove clerk auth to betterauth . update all scope and prd be careful to not leave stuff not implemented"*; and *"no there is no clerk account"* — nothing to migrate. Why: the hackathon asks for a repository with everything needed for the project to work, open source, third-party services used under their terms, and a judge login in the testing instructions; Better Auth is MIT-licensed and runs in the app on the studio's own database, with no vendor account. The build session recommended, and the learner proceeded with: **email and password; no email service** (so no verification email and no password reset); **no CAPTCHA**; the studio's own per-address limits on sign-in and sign-up *(sign-up itself removed later the same day, below)*. The session first kept Google and GitHub as optional (shown only when their keys were set); **the learner cut them the same day:** *"make sure only email and password sign in / up are there and no google and github"* — sign-in and sign-up are email and password only.

**No sign-up — the studio is private — the learner's, 2026-10-24:** *"dans ce cas je veux que tu update scope and prd to remove account creation for other user"*, after reading the hackathon rule *"If Entrant's website is private, Entrant must include login credentials in its testing instructions"*. So nobody but the learner creates an account: `npm run judge:account` makes each one already verified (the learner's own and the judges' — the judge account holds the seeded chapter and is on `ALLOWLIST_EMAILS`), and its credentials go in the Devpost testing instructions, which the learner writes. Public share pages and Report stay open to anyone holding a link.

## Deferred From the POC (v3)

Full-chapter animation; upscaling, frame interpolation and alternative video models (each only after its own test); lip-sync; interface languages; a paid plan; a public gallery; indexing of share pages; emailed reports if no email service is configured; **email verification, password reset and changing the email address** (each needs an email service — none is configured, so none is offered); **public sign-up** (cut 2026-10-24 — the studio is private; accounts are made by the learner); **a CAPTCHA** (Clerk's bot protection, dropped with Clerk on 2026-10-24; moot without sign-up); **Google and GitHub sign-in** (cut at the learner's word on 2026-10-24 — not offered).

## Open Questions (v3)

The decisions below are the learner's; the build stops at each one when it comes up.

- **The domain.** The plan says `<your-domain>`; the DNS records Railway needs are listed in `spec.md > Revision v3 > Domain and DNS` and can only be added once the domain is known. — **Answered 2026-10-25 (6-ship):** no custom domain; the studio runs at `https://web-production-a947d.up.railway.app` (Railway's generated domain), so no DNS record was added.
- **The variables in this environment look like another app's.** `APP_URL`, `ADMIN_URL` and `COMPILE_WORKER_URL` point at another app's domain, `DB_PORT` is an unresolved Railway reference to a **Postgres** service, the buckets are named for "project files" and "compile outputs", and `DB_URL` is a MongoDB URL on Railway's public proxy with `DB_SSL=false`. If these belong to another project, Ink Desk would share its users (Clerk), its files (bucket) and its database with it. **Are these Ink Desk's own, or do they need their own Clerk application, bucket and database?** There is **no Redis URL** yet. *(2026-10-24: the Clerk half no longer applies — accounts now live in the studio's own MongoDB through Better Auth.)*
- **The budget.** v3's honest total (≈ $8.50) is over what remains of the $10 cap (≈ $7.70), and the $5/day kill switch alone could spend ≈ $40 by the end of judging. Raise the cap, run the motion kernel test at 480p, or lower the kill switch? Add a cumulative cap?
- **The motion method** — A (panel as first frame) or B (panel + sheet as references) — chosen by the learner after the motion kernel test.
- **Error tracking.** No error-tracking service is configured; structured logs on Railway work without one. Add one (it needs an account and a key), or keep logs only?
- **Emailed reports** need an email service; without one, reports reach the learner through the admin list.
- **Tags.** This build session cannot push tags (the push is refused); the learner pushes each `v3-cp*` tag from their machine, starting with `v1-poc`.
