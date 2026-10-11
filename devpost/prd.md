---
doc: prd
status: approved
---

# Ink Desk — Product Requirements

An AI manga creator studio for storytellers and manga fans who have ideas but can't draw: you pitch a story, and Ink Desk turns it into a real 4-panel manga page with your own characters drawn consistently across every panel.

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
- **Reload mid-generation** — panels that were in flight come back in the **failed state with "Try again."** Nothing spins forever; nothing finished is lost. *"A stray refresh during the demo never costs me six generations."*
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
8. One-chapter persistence with "Saved to desk" confirmation, restore-on-reload including version history and current station, mid-generation panels restored as failed, and New chapter with confirmation.
9. A visible "Images this chapter" counter in the header.

---

## Deferred From the POC

Named so none of them slip into the build unnoticed. From `scope.md > Later`:

- **A panel with both characters together** — needs multi-reference generation. The single-character-per-panel rule is what keeps every request simple.
- **Director's Chair** chat for directing Claude on a selected panel.
- **Script Strip** — line-by-line dialogue editing. Dialogue is display-only in this version.
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

## Open Questions

- **Does the page script get its own rail entry, or live inside Storyboard?** Drafted as a step inside Storyboard, since the user doesn't act on it. Cosmetic and reversible — does **not** block `4-spec`.
- **Should the genre and tone chip sets stay exactly as the mockup has them?** Assumed yes. Does not block `4-spec`.
- **How long the ink-in reveal should run in the reader** versus the mockup's ~1.4s per panel. A four-panel sequential reveal may want faster per-panel timing to stay watchable. Tune during build; does not block `4-spec`.
- **Panel generation concurrency.** The learner's preference going into `4-spec` is a **small concurrency limit — around two at a time** — so panels still fill out of order without firing four image requests at once. Firing all four is the most likely way to trip a rate limit, which would put the failure state on camera. **Final call in `4-spec`.**
- **A server-side safety limit on images per chapter.** The product shows a counter but enforces nothing. Whether to cap it technically is a `4-spec` decision.
- Carried from `scope.md > Needs Verifying in 4-spec`, still open and **does** need answering in `4-spec`: **which GPT Image model and endpoint accept reference images, and how many per request.** The entire kernel rests on it. Verify before building Cast.
