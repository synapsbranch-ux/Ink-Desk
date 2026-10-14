# The Ink Desk demo video

The demo is code: a [Remotion](https://www.remotion.dev) project that cuts real
footage of the app together with motion-designed titles, a money shot, burned-in
captions and narration. Nothing in it is pre-baked — every generation on screen
happened, and the waits are time-lapsed in the edit (with the real time shown),
not faked.

```
video/
  narration.md         your script — the narration and the captions, one section per beat
  src/cut.ts           the edit: the beats, their shots and their budgets (≈ 2:50)
  timeline.json        written by the capture: when each moment happened in the footage
  capture/record.mts   drives the real app with Playwright and records it
  narrate.mts          narration.md → one mp3 per beat (ElevenLabs through OpenRouter)
  prepare.mts          runs before every render: resolves the edit, lists what is still draft
  src/                 the compositions: Intro, Section, InkWipe, Footage, MoneyShot, Outro, Captions
  public/fonts/        Cormorant Garamond, Lora, Comic Neue (SIL Open Font License, licences beside them)
```

## Setup

```bash
cd video && npm install
```

The video has its own dependencies (`remotion`, `@remotion/cli`, `playwright`)
so the app's stay clean.

## The three commands

Run from the repository root.

**1. Capture** — start the app with the filming settings in `.env`
(`IMAGE_SHEET_QUALITY=high`, `IMAGE_PANEL_QUALITY=high`), on a fresh desk, then:

```bash
npm run dev                      # in one terminal
npm run video:capture            # in another: drives the app, writes video/timeline.json
```

**2. Narrate** — write your words in `video/narration.md`, pick a premade voice, then:

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

**3. Render**

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

None by default. Royalty-free only, and only with its licence: put the track at
`video/public/music/track.mp3` and its licence at
`video/public/music/LICENSE.txt` — the render refuses a track without one.
Never a copyrighted track.

## Not committed

The captured footage, the stills copied from the desk, the narration mp3s and
the rendered mp4 (sizes). The edit, the script, `timeline.json`, the capture
and narration scripts and the licence notes are. The mp4 is uploaded to
YouTube, public, and linked from the submission.

## Licences

- **Remotion** is free under its Free License for an individual (this
  project) and for a for-profit organization with up to three employees;
  larger for-profit organizations need a Company License
  (`node_modules/remotion/LICENSE.md`,
  [remotion.dev/license](https://www.remotion.dev/license)).
- **Fonts**: Cormorant Garamond, Lora and Comic Neue, SIL Open Font License 1.1
  — `public/fonts/OFL-*.txt`.
- **The Ink Desk logo** (`public/brand/`) is the learner's own pre-existing work.
