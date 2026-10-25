# The Ink Desk demo video

The demo is code: a [Remotion](https://www.remotion.dev) project that cuts real
footage of the app together with motion-designed titles, a money shot, burned-in
captions and narration. Nothing in it is pre-baked — every generation on screen
happened, and the waits are time-lapsed in the edit (with the real time shown),
not faked. The v3 film (6-ship) has three parts: the real app end to end on the
live studio, how it was built with the hackathon's Learn Skill Pack (the real
documents in `devpost/` on screen), and what the learner learned — in the
learner's own words.

```
video/
  narration.md         the script — the narration and the captions, one section per beat (placeholders only: the words are yours)
  src/cut.ts           the edit: the twelve beats, their shots and their budgets (2:48)
  music/generate.mts   generates the background music with a music model through OpenRouter (prompt.txt beside it)
  music/compose.mts    composes the background music in code — an original track, the same bytes every run
  timeline.json        written by the capture: when each moment happened in the footage
  capture/record.mts   drives the real app with Playwright and records it — the live studio or a local one
  capture/docs.mts     shoots the real planning documents and the build record for the how-it-was-built beat (free, offline)
  narrate.mts          narration.md → one mp3 per beat (ElevenLabs through OpenRouter)
  prepare.mts          runs before every render: resolves the edit, lists what is still draft
  src/                 the compositions: Intro, Section, InkWipe, Footage, MoneyShot, Method, Learned, Outro, Captions; mix.ts ducks the music under the voice
  public/fonts/        Cormorant Garamond, Lora, Comic Neue (SIL Open Font License, licences beside them)
```

The beats (`src/cut.ts`): intro 14 s · sign in 10 · the desk and a project 10 ·
the scenario, the library and the locked cast 20 · the Director's plan 16 ·
pages ink in and a bubble edit 22 · the money shot 12 · the reader and the PDF
12 · a public link, opened signed out 10 · how it was built 23 · what I learned
15 · a silent title card 4 = 168 s.

## Setup

```bash
cd video && npm install
```

The video has its own dependencies (`remotion`, `@remotion/cli`, `playwright`)
so the app's stay clean.

## The five commands

Run from the repository root.

**1. Capture** — two ways to film the real app; both end on the reader, the
PDF export, Share publicly and the public page opened in a signed-out window.

*The live studio, a finished chapter*: the studio is private, so put a
**filming account** the learner made (`npm run judge:account`) in `.env` as
`INKDESK_CAPTURE_EMAIL` and `INKDESK_CAPTURE_PASSWORD` — the email is typed on
camera, the password is filled and never typed, printed or written to any file.
Film a copy of the finished chapter on that account (`scripts/seed-judge.mts
--to <its id>`), never the judges' own chapter: the walk retypes page 1's first
bubble with the words in `capture/seed.json`, saves the station it leaves on,
and makes a public share that stays live until it is unpublished from the
reader. Then:

```bash
npm run video:capture -- --url https://<the studio> --project <id>
```

The capture signs in, opens the desk, then the chapter, and walks its finished
stations in order with pauses and pointer glides: Story (the saved scenario),
Library (the locked cards, the DNA beside the sheet), Director (the plan and
the estimate), the Pages (each inked page; the bubble on page 1 is retyped with
the words in `capture/seed.json` — app lettering, free), the reader, the
export, the share. Nothing is generated and nothing is spent; `--quality` and
`--short` mean nothing here and are ignored with a note. The money shot's
pictures are read from the project's record, like the fresh capture's.

*A fresh project, generated on camera* (the v3 film was made this way, on a
local desk with real sign-in — `INKDESK_AUTH=better`, a local MongoDB for the
accounts, generation on): start the app with the filming settings in `.env`
(`IMAGE_SHEET_QUALITY=high`, `IMAGE_PANEL_QUALITY=high`), on a fresh desk,
then:

```bash
npm run dev                                   # in one terminal
npm run video:capture -- --quality high       # in another: the whole chapter and its cover
```

On a finished chapter nothing inks in — a finished panel appears whole — so
the pages beat is filmed on the fresh path, or from the reader's replay.
Before a real fresh recording, replace the stand-in picture named in
`video/capture/seed.json` with your own drawing of the lead — the point is that
*your* picture becomes the locked sheet — and change the title, the bubble's
words or the panel to redraw there if you like. `--short` films page 1 only (a
test, ≈ $0.10 at `low`); `--stop-after scenario-ready` films only the free
part. Against a private studio the fresh capture signs in the same way.

Either way it writes `video/timeline.json` (when each moment happened, which
path was filmed, and the public share page's path — a public link by design),
the footage at `video/public/capture/footage.mp4` and the money shot's
pictures. `--out <dir>` writes everything to another folder; `--url` points at
another address. A run replaces the previous capture only when it succeeds; a
run that fails or is stopped with Ctrl+C keeps what it filmed in
`video/public/capture/failed-<time>/` (with its own `timeline.json`) and leaves
the previous capture and `video/timeline.json` untouched — clear those folders
out by hand now and then. The fresh capture also refuses to start paying if
`--quality` disagrees with what the app is drawing at. Ctrl+C once stops
cleanly; twice leaves at once. Every read of the app (the project, the stills)
goes through the signed-in browser session, so a private studio answers them.

The recorder is a Chromium screencast piped into ffmpeg (h264, 30 fps) on its
own clock, so a mark is the exact moment in the footage. Waits are real and
long at `high` — the edit time-lapses them and says so on screen.
`cd video && npx tsx capture/clock-check.mts --out /tmp/clock` re-proves the
clock at any time, for free. The share beat opens the public page in a second
browser window with no cookies — a stranger with the link — and the recorder
follows that window from there (`screencast.mts` `follow`), on the same clock.

**2. Documents** — the how-it-was-built beat shows the real planning
documents and the build record. Free and offline:

```bash
npm run video:docs
```

It opens `devpost/scope.html`, `prd.html` and `spec.html` in Playwright's
Chromium and shoots the top of each page (what the sheets in the film show) and
the whole page, and `scope.html` once more scrolled to the v3 *Changes Since
Approval* heading (its items 1–7); renders `devpost/checklist.md`'s Slices
(every slice with its ticked box, the v3 slices with their lines), Final Review
and three of its Revisions entries (the learner's quoted words marked) from the
real file with a small renderer of its own; and renders `git log --oneline -30`
and the six skills of the Learn Skill Pack terminal-style. In every still a
third-party product's name is shown as its role (the hackathon asks for no
third-party names on screen) and the page says so — but never inside the
learner's own words: a quote that names a product is left out of the shot
rather than rewritten (the capture refuses a viewport with a rewritten quote
in it); `devpost/learner-profile.md` is
personal and never rendered. Everything lands in `video/public/capture/docs/`
(13 pictures) with a `docs.json` index; until it exists the render says DRAFT,
and an older index without the Revisions and Changes stills gets a draft sheet
in their place and a draft line.

**3. Narrate** — the words are in `video/narration.md`, one section per beat with its word budget. They are yours: the file holds a bracketed placeholder per beat and no drafted lines (the shipping skill's rule), so write each beat in your own words, pick a premade voice, then:

```bash
npm run video:narrate -- --samples              # hear all twelve voices first → video/out/voices/ (≈ $0.02)
npm run video:narrate -- --voice george --dry-run   # what would be sent, and the estimate; sends nothing
npm run video:narrate -- --voice george         # or set NARRATION_VOICE in .env
```

Only sections whose words, voice or model changed are sent again; bracketed
placeholders are never sent. `--only intro,pages` narrates just those;
`--model elevenlabs/eleven-flash-v2.5` is half the price of the default
`elevenlabs/eleven-v4` (≈ $0.08 for a 2 000-character script). Every clip is
leveled to −16 LUFS as it is saved (needs ffmpeg), so the voice sits at the
same loudness on every beat. After a run, a "Runs long" line names any beat
whose audio is longer than its slot in `src/cut.ts`.

**4. Music** — two ways to a royalty-free track, both generated, both yours to
pick by ear:

```bash
npm run video:music:generate     # a music model through OpenRouter (Lyria 3 Pro, $0.08 a piece) → track.mp3 + LICENSE.txt
npm run video:music              # composed by code, $0, the same bytes every run → track.mp3 + LICENSE.txt
```

The generated piece follows `music/prompt.txt` (edit the mood there; the
current brief asks for a soft, jazzy future-wave instrumental — Rhodes chords,
brushed drums, a warm bass over a synth-pad bed, 84 BPM, about three minutes,
sparse opening, fullest in the middle, a gentle end); every generation is kept
under `video/out/music/` with a note of where it came from, and the one in use
is installed as `public/music/track.mp3` — reinstall an earlier one with
`npx tsx music/generate.mts --install out/music/<file>.mp3` from `video/`.
`--dry-run` sends nothing (from the repo root, flags go after `--`, as above). A
generated piece may carry its own ending; the install step says so when its last
seconds sit far under its body. The composed piece (`music/compose.mts`) follows the
beats of the edit — pads alone under the intro, the pulse from the second beat,
fullest on the pages and the money shot, resolved in the outro — and needs no
account; change its tempo, key, chord cycle or parts in the file and run it
again. Either way the render fades the music in, ducks it while a narration
clip plays, and fades it out over the last three seconds (`src/mix.ts`).

**5. Render**

```bash
npm run video:render             # → video/out/inkdesk-demo.mp4, 1920×1080, h264 + aac
```

`prepare.mts` prints what is still a draft — a placeholder line, a slate where
footage will go, a test capture at `low` — and the render carries a red DRAFT
stamp until nothing is. A quick look at only the motion design:
`npm run video:render:motion`. To scrub through the edit in a browser:
`cd video && npm run studio`.

### The browser flag

Remotion renders in a headless Chromium and downloads its own on the first
render. Where a browser is already installed and downloads are not wanted (a
sandbox), point `INKDESK_BROWSER` at it:

```bash
INKDESK_BROWSER=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell npm run video:render
```

The capture uses Playwright's Chromium (`npx playwright install chromium` once,
from `video/`, on a new machine).

## Music

Generated (command 4): by a music model through OpenRouter, with a
`LICENSE.txt` that records the model, the date and the prompt, or composed by
`music/compose.mts` with a CC0 note (the repository's own work, no samples).
The render refuses any `public/music/track.mp3` without a licence file beside
it, and plays none when there is no track. Never a copyrighted track; if you
swap in a royalty-free one, put its licence in the same `LICENSE.txt`.

## Not committed

The captured footage, the stills copied from the desk, the document stills
(`public/capture/docs/`), the narration mp3s, the music track and the rendered
mp4. The track's `LICENSE.txt` is committed and
describes the piece in the published video: a composed track rebuilds byte for
byte with `npm run video:music`; a generated one cannot be rebuilt — regenerate
(a new piece) or reinstall it from `video/out/music/`. The edit, the script, `timeline.json`, the capture,
narration and music scripts and the licence notes are. The mp4 is uploaded to YouTube, public, and linked from the
submission.

## Licences

- **Remotion** is free under its Free License for an individual (this
  project) and for a for-profit organization with up to three employees;
  larger for-profit organizations need a Company License
  (`node_modules/remotion/LICENSE.md`,
  [remotion.dev/license](https://www.remotion.dev/license)).
- **Fonts**: Cormorant Garamond, Lora and Comic Neue, SIL Open Font License 1.1
  — `public/fonts/OFL-*.txt`.
- **The Ink Desk logo** (`public/brand/`) is the learner's own pre-existing work.
