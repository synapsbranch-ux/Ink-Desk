---
doc: scope
status: approved
---

# Ink Desk

An AI manga creator studio: you pitch a story idea, and the app turns it into a real manga page with your own characters drawn consistently across every panel.

> **Revised 2026-10-13 — see [Revision — Ink Desk Studio (v2)](#revision--ink-desk-studio-v2) at the end.** The sections below are the approved v1 scope, kept intact as the record of what was built and tagged `v1-poc`. The revision restates the kernel, widens the boundary to a multi-page chapter studio, and names the demo video as a deliverable. Where v2 supersedes a v1 line, the revision says so; nothing below was edited in place.

## The Unique Kernel

**Locked appearance, free action.** Each character gets a model sheet that is generated once and then frozen. Locking freezes two things, and both travel with every single panel request:

1. **The sheet image itself**, sent as a visual reference — "so the face, hair and outfit come from a picture and not just from words."
2. **A locked "visual DNA" text** that Claude writes once at character creation (hair, eyes, face shape, outfit, colors, one or two distinguishing marks like a scar or a scarf), pasted word for word into every panel prompt and **never rewritten per panel**.

So every panel prompt is: `locked sheet image + locked DNA text + style rules + Claude's panel description`. Claude only ever authors the variable part — action, angle, expression, background.

Panel prompts also explicitly ask for **no text in the image**. Lettering is never the image model's job (see *Lettering* below).

"Locked" is a contract with teeth: the app can change what a character *does* in a panel, never what they *look like*.

This is the kernel because it's the thing most AI comic tools get wrong — the hero's face changes in every panel. Delete this and Ink Desk is a generic prompt-to-image toy.

## Lettering

**Speech bubbles are overlaid by the app, never drawn by the image model.** Panel prompts ask for no text in the image. Bubbles are positioned over the panel as app UI in Comic Neue, and PNG export composites the image and the bubbles together.

This keeps text crisp and editable, sidesteps the image model's unreliable typography, and means re-lettering never costs a generation.

## Who It's For

Storytellers and manga fans who have ideas but can't draw. They want to see their story as a real manga page, not a wall of text.

Today they either write prose nobody reads as manga, commission an artist they can't afford, or try a general image generator and get four pictures of four different-looking people.

## The Core Loop

Pitch a story → accept or rewrite Claude's synopsis → lock your cast's model sheets → **Claude writes the 4-panel page script** → generate the page panel by panel against the lock → redraw any panel that misses → read the finished page.

**The page-script step is load-bearing.** Once the synopsis is accepted, Claude writes the script for all four panels: for each panel, which character, the action, the camera angle, the background, and the dialogue — with exactly **one locked character per panel**. That script *is* the variable part of each panel prompt, the counterpart to the frozen sheet image and DNA text.

The loop that matters inside that: **generate a panel, check the face against the sheet, redraw if it's off.** Redraw reruns the same request with the same references, keeps the previous version so you can switch back, and never touches other panels.

When a redraw is still off, you accept the best one. That's deliberate: *"an honest proof of concept, not a guarantee."*

## Inspiration & Identity

A manga studio that stays beginner friendly. Paper background, ink-black lines, halftone textures, one red stamp accent like a hanko seal for primary actions. Generated panels "ink in" from pencil sketch to final art.

**Design reference: `reference/Ink Desk.html`** — a standalone mockup the learner made *before* this project. It is a visual and layout reference, **not code to reuse**, and is pre-existing work that must be disclosed in the README at ship time.

Extracted from it (the real design tokens, not guesses):

- **Palette:** paper `#f3f2f2`, surface `#eae9e9`, ink text `#201f1d`, hanko red accent `#b5382e` with a full 9-step ramp. Alternate accents available: `#b68235` gold, `#2d2b2b` ink-black.
- **Type:** Cormorant Garamond (headings), Lora (body), **Comic Neue (dialogue lettering)**.
- **Texture:** halftone built in pure CSS — `radial-gradient` dot screens and `repeating-linear-gradient` tone bands.
- **Four stations, with their subtitles:** Story *(the pitch desk)* · Cast *(model sheets)* · Storyboard *(the main studio)* · Ink & Publish *(the reader)*.
- **Tuning props:** `accent`, `inkSpeed` (0.5–3s, default 1.4s), `startStation`.
- **Worked sample story** to reuse for demos: Kaito Ren (rooftop courier), Mio Hasegawa (Postal Bureau agent), Old Tetsu (ink-maker); "The Unwritten Letter," neo-Osaka rooftops.
- **Logo:** `assets/svg/` holds the mark (rounded square, dark wedge, white ink-nib blot) and the wordmark, light and dark, plus PNG and WebP. **`#b5382e` is the single brand red** — the learner is regenerating the logo files in it, so brand and UI share one accent. No decision left for `4-spec`.

Important: the mockup **fakes all art with CSS**. The look is already solved; the build's real work is replacing dot-screen placeholders with generated images that hold a face steady.

## Why This Matters to the Learner

*"The moment you see your own characters on a page with speech bubbles."*

The part they find most interesting is the hard part: *"in most AI comic tools the hero's face changes in every panel. I want Ink Desk to solve that visibly."* Understanding how to keep character art consistent across panels is their stated learning goal for this hackathon.

It's also their hackathon entry, so it must work end to end and look good on camera.

## What "Working" Looks Like

**One full 4-panel manga page, with two characters.** The success criterion, stated precisely:

> **Each character is recognizably themselves in every panel they appear in.**

Stated that way because shot/reverse-shot means no character appears in all four panels — Kaito is in panels 1 and 3, Mio in 2 and 4. The claim is per-character continuity across *their* panels, not one face across the whole page.

The money shot, in the learner's words — this is the demo video:

> Split screen. On the left, Kaito's model sheet with the red "Locked" stamp landing on it. On the right, a 4-panel page inking in one panel at a time, from pencil sketch to final art. Kaito is recognizably the same person in every panel: same face, same scarf, from a close-up and from a wide shot. Then the speech bubbles pop in, in Comic Neue, with the actual dialogue Claude wrote.

("every panel" in the quote above means every panel Kaito is in — 1 and 3. The split screen compares his sheet against those.)

The "oh, that's cool" beat is **the sheet and the page side by side, showing the same face.** Everything in scope serves that shot.

Page structure, shot/reverse-shot: **Kaito → Mio → Kaito close-up → Mio reacting.**

## The POC Boundary

In, stated tightly:

- **Story** — one pitch box, genre and tone selection, Claude returns an editable synopsis you accept or rewrite.
- **Cast** — **two** characters. Each gets a DNA text from Claude and **one single generated image laid out as a real model sheet** (front, three-quarter, a few expressions in one frame). That one image is the canonical reference. The card shows it with name, traits, and the Locked stamp. No cropping it into separate frames.
- **Page script** — once the synopsis is accepted, Claude writes the 4-panel script: per panel, the character, action, camera angle, background, and dialogue.
- **Storyboard** — a 4-panel page generated against the locks. **One locked character per panel**, shot/reverse-shot, so each panel request carries only that character's sheet and DNA. Per-panel Redraw with version switching. Dialogue from Claude, overlaid as speech bubbles in Comic Neue.
- **Ink & Publish** — full-page read, the pencil-to-ink reveal, right-to-left toggle, PNG export compositing image and bubbles.

Three decisions that keep the cost and risk down, all deliberate:

- **The ink-in effect is theatrical, not real.** Each panel is generated **once**; the pencil-to-ink transition is a reveal animation over the finished image, as the mockup already does in CSS. Same look on camera, half the generations, no second consistency risk.
- **One reference image per request.** A single-character-per-panel page means the app never has to send two sheets at once.
- **No text in generated images.** Lettering is app-side overlay, so the image model is never asked to render type.

**Latency direction** (detail belongs to `3-prd`): panels generate **in the background with visible per-panel progress**, and the ink-in reveal plays once the page is ready. The demo video may trim the waiting, but *the generation itself has to be real* — no pre-baked images.

Budget implication: roughly **2 sheet generations + 4 panel generations = 6 images** per full run, plus redraws.

## Later

Worth doing, just not now:

- A panel with **both characters together** (requires multi-reference generation — the main reason it's deferred).
- **Director's Chair** chat for directing Claude on a selected panel.
- **Script Strip** for editing dialogue line by line.
- **Backgrounds and scenes shelf** as separately generated, reusable assets. For now, background is folded into the panel prompt.
- Multiple page layouts (the mockup has three: 5-panel, 3-panel splash, 4-panel with SFX insert).
- PDF export, share link.
- Unlocking and editing a sheet after it's locked.
- External comic APIs such as **LlamaGen**.
- Deployment (optional for this hackathon).

## Explicitly Cut

- **Real two-pass pencil→ink generation** — doubles image cost and adds a second chance for the face to drift, for an effect on screen for ~1.4 seconds. A CSS reveal is indistinguishable on camera.
- **Five-frame model sheets** (separate front / three-quarter / expression images) — five times the cost, five chances to drift, and no single canonical reference to send. One sheet image solves all three.
- **Manual panel touch-up or painting** — the only repair is Redraw. *"No manual painting."* Keeps the loop honest and the build small.
- **Three characters** (the mockup's full cast, including Old Tetsu) — two proves the lock isn't a fluke; a third adds cost without adding proof.
- **Reusing the mockup's code** — it's a design reference only, and it fakes art with CSS. The styling language carries over; the implementation does not.

## Model Providers

Explicit, so the build never has to guess:

| Concern | Provider | Key |
|---|---|---|
| Synopsis, visual DNA, page script, dialogue | **Anthropic API — Claude Sonnet** | `ANTHROPIC_API_KEY` |
| Model sheet images, panel images | **OpenAI API — GPT Image model family** (the same image generation as ChatGPT) | `OPENAI_API_KEY` |

Both are called **server side**. Both keys live in `.env` only — never in chat, never committed, never shipped to the browser.

The exact GPT Image model name and its reference-image support get confirmed in `4-spec`.

## Pre-Existing Work to Disclose in the README

Both made by the learner **before** this project. Neither is code to reuse; both are references.

- **`reference/Ink Desk.html`** — the standalone UI mockup (visual and layout reference).
- **The Ink Desk logo** — SVG mark and wordmark, in `assets/svg/` with PNG and WebP variants.

## Needs Verifying in `4-spec`

Flagged by the learner, carried forward deliberately:

- **Which GPT Image model and endpoint accept reference images, and how many per request.** The entire kernel depends on sending the locked sheet image with each panel request. This is the one assumption that could force a redesign, so verify it early — before building Cast.
- Image generation cost and rate limits at ~6 images per run plus redraws.

## Deferred to `3-prd`

- What the user sees while panels generate (per-panel progress, partial page reveal).
- **Generation failure handling** — not "the face is wrong," but hard failures: 429 rate limits, timeouts, refusals, malformed responses.

---

# Revision — Ink Desk Studio (v2)

**Date:** 2026-10-13, after the v1 final review. **Decided by:** the learner. **Recorded under** `5-build`'s plan-revision rule — a request that substantially changes the project pauses to revisit the planning decisions it touches and updates the affected documents with agreement; it does not restart the planning skills. `prd.md` and `spec.md` carry matching v2 sections; `checklist.md` carries the new slices and the reason under **Revisions**.

**What prompted it.** The learner's verdict on v1, in their words: *"our app has a direct, cumbersome flow — it is not really an AI manga creator with chapters and volumes, it is much more a single storyboard creator."* v1 is complete, reviewed and tagged **`v1-poc`**; it stays the fallback: *"If v2 isn't solid by Oct 20, I submit `v1-poc` with a polished video."*

**The constraint that shapes everything below.** The hackathon judges a *complete, coherent product experience* from a video under three minutes, and the submission closes **2026-10-26, 17:00 ET**. So v2 is not "everything"; it is the smallest studio that makes the video prove **"manga creator, not storyboard creator"**, with a feature freeze on **2026-10-20** and a cut line written down in advance.

## The Unique Kernel (v2)

**One contract, applied to three things: locked appearance, free action — for the character, the style, and the setting.** The app can change what *happens* in a panel, never how the character, the art style, or a locked place *looks*.

- **The character lock stays the anchor.** It is the only lock proven — slice 2's kernel test, then the real product at the slice 5, 5b and 7 checkpoints — and it stays the headline of the pitch and of the money shot. Its mechanism is unchanged: one sheet image sent as the attached reference plus the visual DNA pasted word for word, with Claude writing only the variable part.
- **Style and setting are locks too — but only once each passes its own kernel test:** one style reference image, and one setting reference image, each held across **three panels at `medium`**. Until a lock passes, the documents call it a **candidate lock**, and the video does not claim it. (A style *preset* is different and needs no test: it is frozen rules text, exactly like today's `STYLE_RULES`, chosen per project. What is a candidate is holding a *reference picture* of a style or a place steady.)
- **An imported reference is just another way to create a lock.** The learner's own image replaces the generated sheet; Claude writes the DNA *from the picture*; the same Lock, the same contract, the same panel request. Nothing about the kernel changes because the sheet came from a file instead of a prompt.

Delete the character lock and v2 is a generic page generator; delete pages, the Director and the library and it is v1. Both halves are load-bearing now.

## The Core Loop (v2)

Dashboard → **New project** (title, a locked style chosen from presets) → **Scenario mode** (paste a long scenario, attach references) *or* the v1 pitch → **Library** (two locked characters: one generated from DNA and a sheet, one **imported** from the learner's own reference image) → **The Director** (Claude plans a chapter of at least three pages plus a cover, shown as editable thumbnails with a **cost estimate before anything is generated**) → pages ink in, page by page, with the slice 5b loading states, editable bubbles, and the slice 6 repair logic (redraw, versions, Try again, Rewrite) → **Reader** (the whole chapter, page after page; right-to-left for manga, vertical scroll for manhwa) → **Export** (PNG per page, PDF of the chapter).

The v1 loop is the inner loop of every page. Nothing in it is removed.

## What "Working" Looks Like (v2)

**The v2 money shot is one character, one chapter, several pages.** The imported character's reference image beside panels from **page 1, page 2 and page 3, plus the cover** — close-up, medium and wide — same face, same outfit, same marks.

> **Success criterion:** each locked character is recognizably themselves in every panel they appear in, across every page of the chapter and on the cover; and an imported character recognizably matches the image the learner uploaded.

**Optional, only if there is time after the freeze:** the same story opened in a second style (manga black-and-white beside manhwa colour) as a short showcase in the video. **Not a success criterion** — a sheet is drawn in its style and would have to be re-locked, so a style switch is a new lock, not a test of the old one.

## The POC Boundary (v2) — "Studio v1", feature freeze 2026-10-20

Must be on screen in the submission, in the learner's words, numbered as they gave them:

1. **Dashboard:** project gallery with covers, "New project", a global library, and the budget.
2. **New project:** title + a locked style chosen from presets — **at least manga black-and-white and manhwa colour**, so the video shows two different looks.
3. **Full scenario mode:** paste a long scenario, with references.
4. **Library:** two locked characters — one **imported from the learner's own reference image**, one generated with DNA + sheet.
5. **The Director:** scenario → an editable chapter plan of **at least 3 pages + a cover**, shown as thumbnails **with a cost estimate before generating**.
6. **Generation:** pages ink in with the 5b loading states, editable bubbles, and redraw with versions — the slice 6 repair logic kept.
7. **Reader:** the full chapter page after page; **right-to-left for manga, vertical scroll for manhwa.**
8. **Export:** PNG per page + **PDF of the chapter.**
9. **Storage:** behind an interface, **local by default**. MongoDB + a bucket implemented and switchable in `.env`, but **the demo runs local**.
10. **Text fallback** to `openai/gpt-5.6-terra` through OpenRouter — not shown on screen, but in the code and the README.

Three rules on top, all the learner's:

- **Feature freeze 2026-10-20.** After it, only fixes, the video, and the README.
- **The character lock is the only claim the video makes about consistency.** Style and setting locks are candidates until tested (see the kernel).
- **The demo video is a deliverable in its own right**, fully produced — see below.

## Later (v2) — explicitly out of the submission

- **In-app video export** with camera motion, and **in-app ElevenLabs dubbing** — *only if items 1–9 are done by 2026-10-20; otherwise Later, no debate.*
- **Two characters in the same panel** — needs a new kernel test (the provider accepts several references; nothing proves the faces hold together).
- **Multiple volumes managed in the UI** — the data model supports it; the UI shows one volume.
- **Alternative image models in the app** — unless one passes the kernel test before **2026-10-18**. Candidates, all on OpenRouter's images endpoint as of 2026-10-13 and all unverified: `google/gemini-nano-banana-2.1`, `google/gemini-3-pro-image`, `bytedance-seed/seedream-5-0-*`, `black-forest-labs/flux-3-image`, `recraft/recraft-v4-styles`, `qwen/qwen-image-3`.
- **Style and setting as reference-image locks** past the candidate stage — each needs its 3-panel kernel test.
- **Accounts, public deployment, the loading mini-game, a library shared between projects.**

Still Later from v1, unchanged: Director's Chair chat on a selected panel, the Script Strip, external comic APIs such as LlamaGen.

## Explicitly Cut (v2 additions)

- **Claiming a candidate lock in the video** before its kernel test. Honesty rule.
- **A second panel layout in the submission.** One four-panel shot/reverse-shot layout per page, as v1; the plan's data shape leaves room for more, the build does not add them.
- **Three or more locked characters in the demo.** Two prove the lock; the imported one proves the import.
- **Shipping Mongo as a requirement.** The demo and the clone run on local files; cloud storage is a switch, never a prerequisite.
- **Any feature not on the numbered list after 2026-10-20.**

## Model Providers (v2)

| Concern | Provider | Status |
|---|---|---|
| Synopsis, cast, DNA, page script, dialogue, **the chapter plan**, **DNA from an imported picture** | **Anthropic API — `claude-sonnet-5-5`**, `ANTHROPIC_API_KEY` | proven in v1; the vision call is new |
| **Text fallback** when Claude cannot be used (no key, 402, or a 5xx/529/429 that survives the single retry) | **OpenRouter chat completions — `openai/gpt-5.6-terra`**, `OPENROUTER_API_KEY`, strict JSON-schema output validated by the same zod schemas | verified available with `structured_outputs` on 2026-10-13; not yet called |
| Model sheets, panels, **covers** | **OpenRouter images — `openai/gpt-image-2.5-sunburst`** | proven in v1 |
| Alternative image models per style | OpenRouter images endpoint, per-model capability list | candidates only, see Later |
| **Demo narration** (not the app) | **ElevenLabs through OpenRouter — `POST /api/v1/audio/speech`, `elevenlabs/eleven-v4`** (`eleven-flash-v2.5` at half price), premade voices by name | verified available on 2026-10-13; ≈ $0.04 per 1 000 characters |
| **Demo music** (not the app) | **Google Lyria 3 through OpenRouter — `google/lyria-3-pro-preview`**, a full song for a flat $0.08 (`lyria-3-clip-preview`, 30 s, $0.04), through chat completions with audio output; or the track composed by the repo's own code at $0 | verified with one live call on 2026-10-14 (a 175 s instrumental); the learner picks by ear |
| Chapter state and images | **Local files** (default) · **MongoDB + an S3-compatible bucket** (`INKDESK_STORAGE=cloud`) | local proven; cloud is new and optional |

All keys stay in `.env`, server-side only, as in v1.

## The Demo Video (v2) — a deliverable, fully produced

- **Motion-graphics intro and outro** with the logo, animated titles, transitions, and an animated **money shot** (the locked sheet beside its panels, same face).
- **Real usage footage** recorded with Playwright on the real app — waits trimmed, **every generation real**. The v1 rule stands: nothing pre-baked.
- **Narration** with ElevenLabs via OpenRouter, **from a script the learner writes**; royalty-free or generated music, never a copyrighted track.
  *Revised 2026-10-14, the learner's word:* the AI partner **drafts the script and produces the voice-over** (premade voice `george`, one `--voice` switch to change), and the learner rewrites any line before the final recording — `narration.md` stays the one source for voice and captions. The shipping skill's guidance that the narration is the learner's own is kept by that review step, not dropped.
- **Music: composed by the repository's own code** (`video/music/compose.mts`), an original ambient future-wave instrumental — slow pads, a soft pumping bass, an arpeggio, a lo-fi sheen — shaped to the beats of the edit and ducked under the voice. Generated, so royalty-free by construction (CC0, licence file beside the track); no sample, no third-party track.
  *Same day, the learner's question — "does OpenRouter have a model that can generate music?" — answered live:* yes, Google Lyria 3. So the video has **two generated tracks to choose from**, both royalty-free: one generated by Lyria 3 Pro through OpenRouter from a mood prompt (`video/music/prompt.txt`, $0.08 a piece, not deterministic, kept with a provenance note), one composed by code ($0, the same bytes every run). The review render uses the Lyria piece; the learner decides by ear which ships. Either way the track is ducked under the voice and never a third party's recording.
- **Built with Remotion**, so the edit is code, versioned in the repo under `video/`.
- **Structure (≈ 2:57, nine beats):** problem and audience (19 s) → dashboard, new project, style (20 s) → scenario and library, import + lock (28 s) → the Director plans the chapter (24 s) → pages ink in, bubble edit, redraw (33 s) → money shot (15 s) → reader + PDF export (14 s) → **how it was made: planned before built** (14 s — the scope, the PRD and the spec written with the hackathon's Learn Skill Pack before any code, then fifteen slices each verified and committed; added 2026-10-14 at the learner's word, so the video explains the method, not only the product) → what the learner learned + outro (10 s).
- **Rules it must satisfy:** under three minutes, public on YouTube, English subtitles, no third-party trademarks, no copyrighted music. *Applied to the words (2026-10-14):* the voice and the screen name no provider or brand — "the AI", "the image model", "the hackathon's Learn Skill Pack" — and claim only the character lock.
- **Schedule:** Oct 18–19 build the Remotion project (it does not depend on the Director) · Oct 21–22 record the real footage after the freeze · Oct 23–24 narration, music, final edit, export, upload · **Oct 25 submit; Oct 26 is buffer only.**

## Budget (v2)

**≈ $10 for every generation until the deadline**, the learner's cap: development at `low`; at most one alternative image model tried, by kernel test; the kernel tests for the two candidate locks; filming of two pages at `high`; narration ≈ $0.10. The project's budget readout (item 1) exists so this number is visible while building, not reconstructed afterwards.

## What v2 keeps from v1 unchanged

The lettering rule (bubbles are app UI, never drawn by the model), the no-text rule in every image prompt, one generation per panel with a CSS ink-in, DNA-first sheets, final locks, per-panel independence, the silent single retry, plain-language failures, and the pre-existing-work disclosure (the mockup and the logo) in the README.
