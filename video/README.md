# The Ink Desk demo video

The demo is code: a [Remotion](https://www.remotion.dev) project that cuts real
footage of the app together with motion-designed titles, a money shot, burned-in
captions and narration. Nothing in it is pre-baked — every generation on screen
happened, and the waits are time-lapsed in the edit (with the real time shown),
not faked.

```
video/
  narration.md         the script — the narration and the captions, one section per beat (drafted for you; rewrite any line)
  src/cut.ts           the edit: the beats, their shots and their budgets (≈ 2:57)
  music/compose.mts    composes the background music — an original track, synthesized by this code
  timeline.json        written by the capture: when each moment happened in the footage
  capture/record.mts   drives the real app with Playwright and records it
  narrate.mts          narration.md → one mp3 per beat (ElevenLabs through OpenRouter)
  prepare.mts          runs before every render: resolves the edit, lists what is still draft
  src/                 the compositions: Intro, Section, InkWipe, Footage, MoneyShot, Method, Outro, Captions; mix.ts ducks the music under the voice
  public/fonts/        Cormorant Garamond, Lora, Comic Neue (SIL Open Font License, licences beside them)
```

## Setup

```bash
cd video && npm install
```

The video has its own dependencies (`remotion`, `@remotion/cli`, `playwright`)
so the app's stay clean.

## The four commands

Run from the repository root.

**1. Capture** — start the app with the filming settings in `.env`
(`IMAGE_SHEET_QUALITY=high`, `IMAGE_PANEL_QUALITY=high`), on a fresh desk, then:

```bash
npm run dev                                   # in one terminal
npm run video:capture -- --quality high       # in another: the whole chapter and its cover
```

It writes `video/timeline.json` (when each moment happened), the footage at
`video/public/capture/footage.mp4` and the money shot's pictures. Before the
real recording, replace the stand-in picture named in `video/capture/seed.json`
with your own drawing of the lead — the point of the video is that *your*
picture becomes the locked sheet — and change the title, the bubble's words or
the panel to redraw there if you like. `--short` films page 1 only (a test,
≈ $0.10 at `low`); `--stop-after scenario-ready` films only the free part;
`--out <dir>` writes everything to another folder; `--url` points at another
port. A run replaces the previous capture only when it succeeds; a run that
fails or is stopped with Ctrl+C keeps what it filmed in
`video/public/capture/failed-<time>/` (with its own `timeline.json`) and
leaves the previous capture and `video/timeline.json` untouched — clear those
folders out by hand now and then. The capture also refuses to start paying if
`--quality` disagrees with what the app is drawing at. Ctrl+C once stops
cleanly; twice leaves at once.

The recorder is a Chromium screencast piped into ffmpeg (h264, 30 fps) on its
own clock, so a mark is the exact moment in the footage. Waits are real and
long at `high` — the edit time-lapses them and says so on screen.
`cd video && npx tsx capture/clock-check.mts --out /tmp/clock` re-proves the
clock at any time, for free.

**2. Narrate** — the words are in `video/narration.md`, one section per beat with its word budget; rewrite any line you like (the draft was written for you to change), pick a premade voice, then:

```bash
npm run video:narrate -- --samples              # hear all twelve voices first → video/out/voices/ (≈ $0.02)
npm run video:narrate -- --voice george --dry-run   # what would be sent, and the estimate; sends nothing
npm run video:narrate -- --voice george         # or set NARRATION_VOICE in .env
```

Only sections whose words, voice or model changed are sent again; bracketed
placeholders are never sent. `--only intro,pages` narrates just those;
`--model elevenlabs/eleven-flash-v2.5` is half the price of the default
`elevenlabs/eleven-v4` (≈ $0.08 for a 2 000-character script). After a run,
a "Runs long" line names any beat whose audio is longer than its slot in
`src/cut.ts`.

**3. Music** — the track is composed by code, so it is yours and royalty-free:

```bash
npm run video:music              # → video/public/music/track.mp3 (+ LICENSE.txt), the same bytes every run
```

An original ambient future-wave instrumental that follows the beats of the
edit — pads alone under the intro, the pulse from the second beat, fullest on
the pages and the money shot, resolved in the outro — and sits under the
voice: the render fades it in, ducks it while a narration clip plays, and
fades it out over the last three seconds (`src/mix.ts`). To change its
character, edit `music/compose.mts` (tempo, key, the chord cycle, the parts)
and run it again.

**4. Render**

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

Composed by `music/compose.mts` (command 3) and written with its `LICENSE.txt`
(CC0 — the repository's own work, no samples). The render refuses any
`public/music/track.mp3` without a licence file beside it, and plays none
when there is no track. Never a copyrighted track; if you swap in a
royalty-free one, put its licence in the same `LICENSE.txt`.

## Not committed

The captured footage, the stills copied from the desk, the narration mp3s, the
music track (its licence is committed; the command rebuilds the same bytes)
and the rendered mp4. The edit, the script, `timeline.json`, the capture,
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
