---
doc: scope
status: approved
---

# Ink Desk

An AI manga creator studio: you pitch a story idea, and the app turns it into a real manga page with your own characters drawn consistently across every panel.

> **Revised again 2026-10-14 — v3, approved 2026-10-14: see [Revision — Ink Desk Studio v3](#revision--ink-desk-studio-v3-public-on-the-learners-domain) at the very end, with its *Changes Since Approval*.**
>
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
  *Revised 2026-10-14, the learner's word:* the AI partner **drafts the script and produces the voice-over** (premade voice `george`, one `--voice` switch to change). **This is a deviation from the shipping skill**, which says not to write the learner's narration; the learner was told why the skill says so and asked twice for it anyway, so it is recorded as their decision. Mitigation: every line in `narration.md` is theirs to rewrite before the final recording, only changed sections are recorded again, and the script names nothing the learner has not built.
- **Music: composed by the repository's own code** (`video/music/compose.mts`), an original ambient future-wave instrumental — slow pads, a soft pumping bass, an arpeggio, a lo-fi sheen — shaped to the beats of the edit and ducked under the voice. Generated, so royalty-free by construction (CC0, licence file beside the track); no sample, no third-party track.
  *Same day, the learner's question — "does OpenRouter have a model that can generate music?" — answered live:* yes, Google Lyria 3. So the video has **two generated tracks to choose from**, neither a third party's recording: one generated by Lyria 3 Pro through OpenRouter from a mood prompt (`video/music/prompt.txt`, $0.08 a piece, not deterministic, kept with a provenance note, used under the service's terms for generated output — the learner confirms those before publishing), one composed by code ($0, CC0, the same bytes every run). The review render uses the Lyria piece; the learner decides by ear which ships. Either way the track is ducked under the voice and never a third party's recording.
- **Built with Remotion**, so the edit is code, versioned in the repo under `video/`.
- **Structure (≈ 2:57, nine beats):** problem and audience (19 s) → dashboard, new project, style (20 s) → scenario and library, import + lock (28 s) → the Director plans the chapter (24 s) → pages ink in, bubble edit, redraw (32 s) → money shot (15 s) → reader + PDF export (14 s) → **how it was made: planned before built** (15 s — the scope, the PRD and the spec written with the hackathon's Learn Skill Pack before any code, then fifteen slices each verified and committed; added 2026-10-14 at the learner's word, so the video explains the method, not only the product) → what the learner learned + outro (10 s).
- **Rules it must satisfy:** under three minutes, public on YouTube, English subtitles, no third-party trademarks, no copyrighted music. *Applied to the words (2026-10-14):* the voice and the screen name no provider or brand — "the AI", "the image model", "the hackathon's Learn Skill Pack" — and claim only the character lock.
- **Schedule:** Oct 18–19 build the Remotion project (it does not depend on the Director) · Oct 21–22 record the real footage after the freeze · Oct 23–24 narration, music, final edit, export, upload · **Oct 25 submit; Oct 26 is buffer only.**

## Budget (v2)

**≈ $10 for every generation until the deadline**, the learner's cap: development at `low`; at most one alternative image model tried, by kernel test; the kernel tests for the two candidate locks; filming of two pages at `high`; narration ≈ $0.10. The project's budget readout (item 1) exists so this number is visible while building, not reconstructed afterwards.

## What v2 keeps from v1 unchanged

The lettering rule (bubbles are app UI, never drawn by the model), the no-text rule in every image prompt, one generation per panel with a CSS ink-in, DNA-first sheets, final locks, per-panel independence, the silent single retry, plain-language failures, and the pre-existing-work disclosure (the mockup and the logo) in the README.

---

# Revision — Ink Desk Studio v3 (public, on the learner's domain)

> **Approved 2026-10-14** — the learner's word: *"start with slice 16"*. Decided by the learner the same day, after the v2 build was filmed: *"v3 is part of the hackathon submission."* v1 and v2 above stay intact as the record of what was built (`v1-poc`, then the v2 slices 8–15). Where v3 supersedes a v2 line, the change is listed under **Changes Since Approval**.

## Changes Since Approval

What changed against the approved v2 scope, and why — the learner's decisions of 2026-10-14:

1. **Accounts and public deployment move from *Later* into the submission.** v2 listed "accounts, public deployment" under *Later (v2)*. v3 is a public app on the learner's own domain, used by the judges, a small invited group and anyone who signs up, *with strict limits — not a paid launch*. *(2026-10-24: no longer anyone who signs up — there is no sign-up; see item 10.)* *(2026-10-25: anyone who signs up again — sign-up is reopened, on the free plan and the same strict limits; see item 13.)*
2. **In-app video moves from *Later* into the submission, as one page.** v2 allowed "in-app video export … only if items 1–9 are done by 2026-10-20". Items 1–9 were done on 2026-10-14, so by the learner's own rule it is in. The unit is **one page**, animated as a 20–30 s trailer; full-chapter animation stays *Later*.
3. **The kernel gains a motion clause** (below). Until it passes its own kernel test it is a *candidate*, exactly as the style and setting locks were.
4. **The feature freeze moves from 2026-10-20 to 2026-10-22, end of day.** The demo video is **re-filmed on Oct 23–24** on the live domain. **Submission Oct 25; Oct 26 is buffer only.**
5. **The cut line is the learner's, verbatim:** *"Anything not working and checkpointed by Oct 22 goes to Later, no debate. If v3 is unstable on Oct 22, I submit the last stable tag with a polished video."*
6. **The narration returns to the learner's own words.** v2's drafted script (a recorded deviation from the shipping skill) stays a draft; the v3 film is narrated from a script the learner writes.
7. **Git workflow:** straight to `main`, no branches, small verified commits, never force-push or rewrite history, a pushed tag at every stable checkpoint (`v1-poc`, then `v3-cp1`, `v3-cp2`, …). Railway deploys `main` to the public domain, so half-done work stays behind a feature flag in the environment rather than on screen.
8. **The order is by risk, in the learner's words:** *"domain + storage + Redis/BullMQ worker + auth + ownership + rate limits first, then the Studio features, then video generation, then polish."*
9. **Sign-in moves from Clerk to Better Auth — 2026-10-24, the learner's word:** *"base on the devpost skill and also what the hackathon says i want you to remove clerk auth to betterauth … be careful to not leave stuff not implemented"* (and *"no there is no clerk account"*: nothing to migrate). Why: the hackathon rules ask for a repository that holds everything needed for the project to be functional, open source, with any third-party service used under its terms, and a judge login in the testing instructions. Better Auth is open source (MIT) and runs inside the app on the studio's own MongoDB — no vendor account, dashboard or DNS records to wait on — and the judge signs in with an ordinary email and password. **What it costs, stated plainly:** there is no email service, so no verified email for password accounts, no password reset and no email change; Clerk's bot protection is gone (no CAPTCHA — per-address sign-in and sign-up limits instead); the account screens are the studio's own. **The same day the learner cut Google and GitHub sign-in:** *"make sure only email and password sign in / up are there and no google and github"* — sign-in and sign-up are email and password only.
10. **No account creation for anyone else — the studio is private — 2026-10-24, the learner's word:** *"dans ce cas je veux que tu update scope and prd to remove account creation for other user"*. Why: the hackathon rule *"If Entrant's website is private, Entrant must include login credentials in its testing instructions"*. So the live studio has **no sign-up**: the learner makes every account with their own script (`npm run judge:account` — their own and the judges'), and the judges sign in with the credentials the learner puts in the Devpost testing instructions. The audience is the learner, the judges and anyone the learner makes an account for; a stranger sees only the sign-in page and any public share link. *(2026-10-25: reversed — sign-up is open again; see item 13. `npm run judge:account` and the judges' demo account stay.)*
11. **No custom domain — 2026-10-25 (6-ship).** The studio ships on Railway's generated domain, `https://web-production-a947d.up.railway.app`; the domain items above read as that address, and no DNS record was added.
12. **The v3 film is captured on a local desk with real sign-in, not on the live domain — 2026-10-25 (6-ship), the learner's decisions taken as theirs in the ship session:** open generation for the filming window (video stays closed), a throwaway filming account rather than the judges' password, and the learner profile stays public. The ship session could not reach the host's settings (its token was refused) and the live studio keeps generation closed, so the film was made on the same build running locally — sign-in through the studio's own sign-in library on a local database, generation on at `high`, a filming account made with `npm run judge:account`, the learner's own reference picture, the share link opened in a signed-out window. The live studio stays the judges' environment; the capture signs in to it with one command when generation is opened there (`video/README.md`).
13. **Sign-up reopened — anyone can make an account and use the studio on the free plan — 2026-10-25, after the submission on Devpost, the learner's words:** *"i got an issue i think we should let user to sign up and create account can we redo that in prd and scope while still make sure we dont have out of scope that gonna got us eliminated from the competition"*, then *"because i dont have way o submit credentials to the jugdes , a self made account should be able to use the app"*. **This reverses item 10** and restores item 1's *"anyone who signs up, with strict limits"*. Why: the Devpost submission form the learner actually has offers no private testing-instructions field, so the judges' credentials could only be published in the public project story; with sign-up open, a judge makes their own account instead. **What a self-made account is:** an email and a password (10–128 characters, the same rule as sign-in) on `/sign-up`, linked from the sign-in card; the person is signed in at once and lands on the dashboard. It is **unverified** — there is still no email service — so it can never match `ALLOWLIST_EMAILS` or `ADMIN_EMAILS` and stays on the existing **free plan** (1 project, 20 images, 20 s of video, 2,000 voice characters and $1 of spend a day), behind the global kill switch ($5 a day for the whole studio) and the rate limits, plus a new per-address sign-up limit (5 an hour) that refuses sign-up, rather than leaving it open, when its counter is unavailable. **What stays from items 9–10:** Better Auth; email and password only (no Google, no GitHub); no email service, so no verified email for a self-made account, no password reset and no email change; `npm run judge:account` still makes the verified accounts — the learner's own and the judges' demo account with the seeded chapter — and only those can be allowlisted. A CAPTCHA stays *Later*. **On the elimination question the learner raised, as fact:** the rules' Stage One is pass/fail on whether *"the Project reasonably fits the theme and was built using the Devpost Learn skill pack, as evidenced by the planning documents in the repository"*; a dated revision in the learner's words is part of that record, and what must still hold is that the app works as the video shows — the video shows sign-in, which is unchanged. *Decided by the learner 2026-10-25; the learner's word to finish it and ship it, the same evening: *"go head continue make sure scope , prd etc are updatec than push to main"*.*

## The Unique Kernel (v3)

**Locked appearance, free action — and now free motion.** The character lock stays the anchor and the only proven claim. v3 extends the same contract to motion: an animated shot starts from a panel that was drawn from the locked sheet, carries the locked appearance, and is free only in movement and camera.

- **The motion clause is a candidate lock** until its own kernel test passes: the imported character animated across **at least three shots (close-up, medium, wide)**, still the same face, outfit and marks **from the first frame to the last frame of each shot**. That is the money shot of the v3 demo video.
- **Verified 2026-10-14, and it changes the learner's first idea:** one Seedance request **cannot carry both a first frame and reference images** — first/last-frame mode and reference mode are exclusive (OpenRouter's video docs and ByteDance's own). So the motion kernel test compares the two allowed ways: **(A)** the panel as the first frame, the face carried by the panel alone; **(B)** the panel and the locked sheet both as references, with the prompt naming the panel as the opening frame. **Which one becomes the method is the learner's decision after seeing the test.** See `spec.md > Revision v3 > Verified for v3`.

## The Core Loop (v3)

Sign in *(or, since 2026-10-25, sign up first — Changes Since Approval, item 13)* → the dashboard (projects, manga, videos, library, a quota meter) → the v2 studio, unchanged → a finished chapter → **Animate a page**: see the estimate, confirm, watch each shot progress on its own → the trailer lands on the dashboard → **Share publicly**: an unguessable read-only link on the domain, revocable at any time.

## What "Working" Looks Like (v3)

In the learner's words: *"I open a finished chapter in the dashboard, click 'Animate', see the cost estimate and confirm. Each shot shows its own progress, and the other shots continue if one fails."* What comes back: a **20–30 s trailer of one page** — one Seedance shot per panel (3–5 s each, `bytedance/seedance-2.0` through OpenRouter), camera motion written from the panel's stored camera field, bubbles revealed on time, one ElevenLabs voice per character speaking the dialogue, music, assembled with ffmpeg in the worker. It lives in the dashboard, is stored in the bucket, and is shareable through a public link on the domain.

And the private app: the learner and the judges sign in with an email and a password the learner gave them (there is no sign-up), make a small chapter inside their quota, and cannot see, change or spend anyone else's work; a stranger sees only the sign-in page and public share links; when a limit is reached the buttons say why and when it resets; the whole thing works on a phone. *(2026-10-25: public again — anyone, a judge included, can make an email-and-password account on `/sign-up`, lands signed in on the dashboard and makes a small chapter inside the free plan; a stranger who has not signed up sees the sign-in and sign-up pages and public share links; the learner and the judges' demo account sign in as before. See Changes Since Approval, item 13.)*

## The POC Boundary (v3) — feature freeze 2026-10-22, end of day

In the order the learner set (risk first):

1. **Domain and hosting.** Railway, two services from `main`: the Next.js **web** app and a separate **worker**. Custom domain with HTTPS; the domain root goes straight into the app (signed-out → sign-in, signed-in → dashboard) — **no landing page**. One source of truth for the URL (`APP_URL`, `NEXT_PUBLIC_APP_URL`). A health check Railway deploys against, and a calm status message when the worker or Redis is down.
2. **Storage.** MongoDB is the source of truth for projects, users, jobs, videos, shares and reports; the bucket holds every image, video and audio file, **private**, served only through routes that check the owner first (as built, 2026-10-24: no signed URLs); public access only through share links. The local adapter stays for development. The generated art and media that git should not carry move to the bucket.
3. **Queue.** Redis + BullMQ on Railway: image and video queues (and, as built, an account queue for export and deletion; a trailer's speech and music run inside its video job) with retries, back-off, timeouts, stalled-job recovery and per-queue concurrency (2 for images, 1 for video). Mongo keeps job status and results, so progress and history survive a Redis flush.
4. **Auth and ownership.** Better Auth (open source, inside the app, accounts in the studio's own MongoDB) with **email and password only** (Google and GitHub cut at the learner's word, 2026-10-24); every route requires sign-in except sign-in, the public share pages, Terms and Privacy, and the health check. Each account is mirrored into the studio's own user record as it is made. **Every resource is checked against the signed-in user on the server** (no IDOR). **No sign-up** (2026-10-24, item 10): the only way an account exists is the learner's script `npm run judge:account`, which makes it with a verified address. No CAPTCHA (nothing to sign up for) and no email service; sign-in is rate-limited per address. *(Clerk until 2026-10-24 — see Changes Since Approval, item 9.)* *(2026-10-25: **sign-up is open again** — item 13. Sign-up joins sign-in among the pages open signed out; anyone can make an email-and-password account on `/sign-up`, mirrored into the studio's own user record as it is made — the same path as an account `judge:account` makes — unverified and on the free plan; sign-up is rate-limited per address (5 an hour) and refused when the counter is unavailable; `npm run judge:account` still makes the verified accounts. Still no CAPTCHA and no email service.)*
5. **Limits.** Per-user and per-IP rate limits on sign-in, generation and upload routes; daily per-user quotas (an account not on the allowlist gets a small free quota, e.g. 1 project, 20 images, 1 short video a day; higher limits only for allowlisted emails — the learner, testers, a judge demo account); a **global daily spend kill switch, starting at $5/day for all users**, that pauses generation with a clear message. The same counters drive the header meter, the Usage page and the enforcement. *(2026-10-25: rate limits on sign-up again too, per address — item 13; every self-made account is one not on the allowlist.)*
6. **Studio features.** The dashboard as home (projects, manga, videos, library, quota meter, New project); **Settings** (the account — email, how it signs in, change password, signed-in devices — studio defaults, my shared links with unpublish, export my data, delete my account and everything with it); **Usage** (today vs limit for images, video seconds, audio characters, reset time, spend today and this month from real `usage.cost`, the plan, an 80% warning); **public sharing** of manga and videos on `/s/<token>` with Open Graph previews, `noindex`, and a **Report** button whose reports reach the learner; **Terms and Privacy** pages linked from sign-in and Settings.
7. **Video generation** — the one-page trailer above, behind its estimate and the caps.
8. **Responsive and polish.** Every screen works on mobile, tablet and desktop, following the 5b rules (visible actions, explained disabled states, real loading states).
9. **Production readiness and security.** Environment validated at boot, HTTPS only, security headers and a CSP that allows only the studio's own origin (no outside script, frame or image host), structured logs with no secrets or personal data, error tracking, graceful failures, and a **security and stability audit before and after the build**, written to `devpost/security-report.md` with severity and fix status.
10. **The judge demo account** with a pre-made chapter and video; its credentials go in the Devpost testing instructions, which the learner writes. *(2026-10-25: still made — with `npm run judge:account`, verified, on `ALLOWLIST_EMAILS`, holding the seeded chapter — but its credentials are now optional for the judges: the submission form has no private field for them, so a judge can make their own account and test on the free plan instead; item 13.)*

The v2 studio scope stays as agreed: projects with a locked style, the library with imported references, the Director's chapter plan, the multi-page reader, PDF export, the text fallback to `openai/gpt-5.6-terra`.

## Later (v3)

- **Full-chapter animation** (one page is the unit for the submission).
- **Other production models** — upscaling (`black-forest-labs/flux-video-upscale`), video edit (`flux-video-edit`), alternative video models (Kling, Veo, Wan, Hailuo), sound effects — **each adopted only after a kernel-style test**, with cost and purpose stated first (`spec.md > Revision v3 > Production models`).
- **An email service** — and with it verified email for password accounts, password reset, changing the email address, and emailed notices. Not in v3: Better Auth would support them, but without a sender they would be features that do not work.
- **A CAPTCHA** (Clerk's bot protection did this until 2026-10-24) — moot while there is no sign-up; it returns only with public sign-up. *(2026-10-25: sign-up is public again — Changes Since Approval, item 13 — and a CAPTCHA stays Later: the per-address sign-up limit, the free plan's daily caps and the global kill switch bound abuse meanwhile.)*
- Lip-sync, interface languages, a paid plan, a public gallery, indexing of share pages (they are `noindex` until the learner decides otherwise).
- Everything still *Later* from v2 that v3 does not name.

## Explicitly Cut (v3 additions)

- **A landing page.** The domain root is the app.
- **Claiming "locked in motion"** — on screen, in the narration or in the submission — before the motion kernel test passes. The honesty rule, extended.
- **Unlimited anything for strangers.** No route that spends money is reachable without sign-in, a quota and the kill switch.
- **Google and GitHub sign-in** — cut 2026-10-24 at the learner's word: *"make sure only email and password sign in / up are there and no google and github"*. (Clerk offered them; the 2026-10-14 plan above listed them.)
- **Public sign-up / account creation by anyone but the learner** — cut 2026-10-24 at the learner's word: *"dans ce cas je veux que tu update scope and prd to remove account creation for other user"* (the hackathon's private-site rule). Accounts are made only with `npm run judge:account`. *(2026-10-25: reinstated — sign-up is open again at the learner's word; see Changes Since Approval, item 13. Kept here as the record of the cut.)*
- **Pushing a red build.** Typecheck, lint and every `check:*` pass before every push to `main`.

## Budget (v3) — the learner's cap meets the plan

The learner's line: *about $10 of provider credit for the whole build and demo; generations at `low` while building; the kill switch protects the budget once the domain is public.* Spent so far (v2, including the filming): **≈ $2.33**, so **≈ $7.70 remains**. The honest arithmetic for v3, from OpenRouter's published video-token formula (`spec.md > Revision v3 > Verified for v3`):

| Item | Estimate |
|---|---|
| Motion kernel test: 3 shots × 5 s at 720p on `seedance-2.0`, modes A and B | ≈ $3.20 planned; **$4.60 measured** (1:1 renders at 960×960, so it costs the same as 16:9) |
| Development runs of the trailer at 480p on `seedance-2.0-fast` (two pages) | ≈ $1.30 |
| The filmed trailer: 4 shots × 5 s at 720p on `seedance-2.0` | ≈ $2.40 |
| Re-filming the chapter's images at `high` | ≈ $1.00 |
| Voices, music, text, re-takes | ≈ $0.60 |
| **v3 total** | **≈ $8.50 — over the ≈ $7.70 left** |

And the public kill switch at **$5/day** could by itself spend **≈ $40** between the first public deploy (≈ Oct 16) and the end of judging (Oct 30). **Both are decisions for the learner** (open in `prd.md > Open Questions (v3)`): raise the cap, run the kernel test at 480p, or lower the kill switch — and add a *cumulative* cap and a credit limit on the OpenRouter key, so the domain can never spend past what the learner chose.
