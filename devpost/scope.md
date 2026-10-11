---
doc: scope
status: approved
---

# Ink Desk

An AI manga creator studio: you pitch a story idea, and the app turns it into a real manga page with your own characters drawn consistently across every panel.

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
