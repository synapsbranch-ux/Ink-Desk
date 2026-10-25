// Stills of the real planning documents for the method beat (6-ship): the
// film shows how Ink Desk was built with the hackathon's Learn Skill Pack, so
// the documents on screen are the real ones in devpost/ and the record is the
// repository's own. Free and offline: Playwright's Chromium opens local files
// and pages this script writes itself; nothing is generated, nothing is sent.
//
//   cd video && npx tsx capture/docs.mts [--out <dir>]
//   npm run video:docs                       (from the repo root)
//
// Writes video/public/capture/docs/ (git-ignored with the rest of the capture):
//   scope-top.png, scope-full.png     devpost/scope.html — the top of the page at
//   prd-top.png,   prd-full.png       1440×900 (what the sheets in the film show),
//   spec-top.png,  spec-full.png      and the whole page (for the learner's eye)
//   checklist-slices.png              devpost/checklist.md › Slices: every slice and
//                                     its ticked box, rendered by the small
//                                     renderer below from the real file (the
//                                     whole list; the film shows its top)
//   checklist-v3.png                  the v3 slices (16–23) with their lines
//   checklist-review.png              devpost/checklist.md › Final Review
//   checklist-revisions.png           devpost/checklist.md › Revisions: three of the
//                                     entries whose learner quotes are English and
//                                     verbatim (pickRevisions), the quoted words
//                                     marked, long entries cut with an ellipsis
//   scope-changes.png                 devpost/scope.html scrolled to the v3
//                                     "Changes Since Approval" heading, items 1–7
//                                     (8–10 quote the learner naming products, and
//                                     a quote is shown verbatim or not at all)
//   log.png                           git log --oneline -30, terminal-styled; a
//                                     product's name is shown as its role (the
//                                     hackathon asks for no third-party names on
//                                     screen), and the header line says so
//   skills.png                        the six skills, as `ls .claude/skills`
//   docs.json                         the index prepare.mts reads (DocsStills)
//
// devpost/learner-profile.md is personal and is never rendered here.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium, type Page } from 'playwright'
import type { DocsStills } from '../src/props.ts'

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(VIDEO, '..')
const DEVPOST = join(ROOT, 'devpost')
const INVOKED_FROM = process.env.INIT_CWD ?? process.cwd()

/** The documents are shot at this size: the 900 px sheet of the HTML companions fills most of the frame, so the type stays legible once the film scales it down. */
const VW = 1440
const VH = 900
/** Chromium stitches a full-page shot; past this height it gets unreliable, and no sheet in the film needs more. */
const MAX_FULL_PAGE = 12_000

const { values: flags } = parseArgs({ options: { out: { type: 'string' } }, strict: true })
const OUT = flags.out ? resolve(INVOKED_FROM, flags.out) : join(VIDEO, 'public', 'capture', 'docs')
/** Paths in docs.json are under video/public; with --out they are still written that way so the index reads the same. */
const REL = 'capture/docs'

function quit(sentence: string): never {
  console.error(`\n${sentence}\n`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// A small markdown renderer: enough for checklist.md — headings, bold, italic,
// inline code, blockquotes, task lists with their ticked boxes, and the
// indented "Field: words" lines under a slice. Everything else is a paragraph.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Third-party products named in commit subjects and slice titles, shown as
 * their roles: the hackathon asks for no third-party names or logos in the
 * film. Each render that does it says so on its face, so a still never passes
 * for the raw file.
 *
 * The learner's quoted words are never rewritten: a still shows a quote
 * verbatim or not at all (pickRevisions leaves out an entry whose quote names
 * a product; the scope's Changes still hides the items whose quotes do; and
 * shoot() refuses a viewport shot with a rewritten quote in it).
 */
const ROLES: [RegExp, string][] = [
  [/Devpost Learn · Build With AI: Basics/g, 'the hackathon'],
  [/https?:\/\/[\w.-]*\.railway\.app[\w\/.-]*/g, 'the live address'],
  // Not a product: the judge account's login, which the film has no reason to print.
  [/\bjudge@[\w.-]+/g, 'the judge’s address'],
  // The old environment variables (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_…`): \bClerk\b stops at the underscore.
  [/CLERK_/g, 'SIGNIN_'],
  [/\bRailway\b/g, 'the host'],
  [/\bNext\.js\b/g, 'the web framework'],
  [/\bApp Router\b/g, 'the app router'],
  [/\bclaude-[\w.-]+/g, 'the AI model'],
  [/\bopenai\/gpt-image[\w.-]*/g, 'an image model'],
  [/\bgpt-image[\w.-]*/g, 'an image model'],
  [/\bopenai\/[\w.-]+/g, 'the fallback text model'],
  [/\bAnthropic\b/g, 'the AI’s maker'],
  [/\bOpenAI\b/g, 'an image provider'],
  [/\bGoogle\b/gi, 'a provider'],
  [/\bCloudflare\b|\bR2\b/g, 'the bucket host'],
  [/\ban S3-compatible\b/g, 'a cloud'],
  [/\bS3-compatible\b/g, 'cloud'],
  [/\bS3\b/g, 'the object store'],
  [/\bTerra\b/g, 'the fallback text model'],
  [/\bByteDance\b/g, 'the video model’s maker'],
  [/\bRemotion\b/g, 'the video toolkit'],
  [/\bAtlas\b/g, 'the hosted database'],
  [/\bMongoDB\b|\bMongo\b/g, 'the database'],
  [/\bRedis\b/g, 'the queue store'],
  [/\bBullMQ\b/g, 'the queue'],
  [/\bBetter ?Auth\b/gi, 'the sign-in library'],
  [/\bClerk\b/gi, 'the earlier sign-in service'],
  [/\bSeedance\b/g, 'the video model'],
  [/\bClaude\b/g, 'the AI'],
  [/\bOpenRouter\b/g, 'the model gateway'],
  [/\bElevenLabs\b/g, 'the voice model'],
  [/\bLyria\b/g, 'the music model'],
  [/\bGPT(?:-[\w.]+)?(?: Terra)?\b/g, 'the fallback text model'],
  [/\bTurbopack\b/g, 'the bundler'],
  [/\bZod\b/g, 'the schema library'],
  [/\bPlaywright\b/g, 'the browser driver'],
  [/\bffmpeg\b/gi, 'the media tool'],
  [/\bGitHub\b/gi, 'the code host'],
  [/\bDevpost\b/g, 'the hackathon'],
  // In lower case it is the learner's word for the hackathon ("the devpost skill"); the folder devpost/ keeps its name.
  [/\bdevpost\b(?!\/)/g, 'hackathon'],
  [/\bYouTube\b/g, 'the video site'],
]
const roles = (s: string) => ROLES.reduce((t, [re, role]) => t.replace(re, role), s)


/**
 * Inline marks, on text already escaped. `said` marks the learner's quoted
 * words (the italic quotes of the Revisions entries) so a still can show
 * them: 'all' takes every italic run (an entry's bold lead quotes nothing
 * else), 'introduced' only a quote that follows "the learner's word:" or
 * "in their words, that".
 */
function inline(s: string, said?: 'all' | 'introduced'): string {
  let t = esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')
  if (said === 'all') t = t.replace(/\*([^*\n]+)\*/g, '<em class="said">$1</em>')
  if (said === 'introduced') t = t.replace(/(the learner[’']s words?:\s*|in their words, that\s*)\*([^*\n]+)\*/g, '$1<em class="said">$2</em>')
  return t
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
}

type Task = { done: boolean; title: string; fields: { name: string; text: string }[] }

/** The task items of a markdown section, with their indented lines. */
function tasks(section: string): Task[] {
  const out: Task[] = []
  for (const line of section.split(/\r?\n/)) {
    const task = /^- \[( |x|X)\] (.*)$/.exec(line)
    if (task) {
      out.push({ done: task[1] !== ' ', title: task[2], fields: [] })
      continue
    }
    const field = /^ {2,}([A-Z][A-Za-z ]*(?: \([a-z]+\))?):\s*(.*)$/.exec(line)
    const last = out.at(-1)
    if (field && last) last.fields.push({ name: field[1], text: field[2] })
    else if (last && /^ {2,}\S/.test(line) && last.fields.length) last.fields.at(-1)!.text += ` ${line.trim()}`
  }
  return out
}

/** One section of a markdown file: from its heading line to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() === heading)
  if (start < 0) quit(`devpost/checklist.md has no "${heading}" heading.`)
  const level = heading.match(/^#+/)![0].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+)\s/.exec(lines[i])
    if (m && m[1].length <= level) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n')
}

/** A task's title line as it reads: "**16. Foundation on …**" → number and words. */
function splitTitle(title: string): { number: string; words: string } {
  const m = /^\*\*(\d+[a-z]?)\.\s*(.*?)\*\*$/.exec(title.trim())
  return m ? { number: m[1], words: m[2] } : { number: '', words: title.replace(/\*\*/g, '') }
}

const taskLi = (t: Task, clamp?: number) => {
  const { number, words } = splitTitle(roles(t.title))
  return `<li class="task${t.done ? ' done' : ''}">
  <span class="box" aria-hidden="true">${t.done ? '✓' : ''}</span>
  <span class="text${clamp ? ` clamp-${clamp}` : ''}">${number ? `<span class="num">${esc(number)}.</span> ` : ''}${inline(words)}</span>
</li>`
}

// ---------------------------------------------------------------------------
// The pages this script writes: the paper of the app for the checklist, a
// terminal for the log and the skills. Fonts are the system's serif and
// monospace — these pages are stills, not the film, and must render offline.

const PAPER_CSS = `
  :root { --paper:#f3f2f2; --ink:#201f1d; --hanko:#b5382e; --n300:#d7d3d3; --n600:#7d7979; --n700:#605d5d; }
  * { margin:0; padding:0; box-sizing:border-box }
  body { width:${VW}px; min-height:${VH}px; background:var(--paper); color:var(--ink);
    font-family:"Cormorant Garamond", Garamond, Georgia, "Times New Roman", serif; font-size:22px; line-height:1.4;
    background-image:radial-gradient(circle, rgba(32,31,29,.13) 1px, transparent 1.5px); background-size:7px 7px; padding:36px 48px }
  .sheet { background:var(--paper); border:1.5px solid var(--ink); box-shadow:6px 6px 0 rgba(32,31,29,.15); padding:34px 44px 38px; min-height:${VH - 72}px }
  .eyebrow { font-family: Georgia, "Times New Roman", serif; font-size:15px; letter-spacing:.3em; text-transform:uppercase; color:var(--n700) }
  h1 { font-size:46px; font-weight:600; line-height:1.05; margin:6px 0 4px }
  h2 { font-size:34px; font-weight:600; margin:18px 0 6px }
  h3 { font-size:26px; font-weight:600; margin:14px 0 4px; color:var(--n700) }
  .rule { height:1.5px; background:var(--ink); margin:14px 0 18px }
  .lede { font-family: Georgia, serif; font-size:17px; color:var(--n700); margin-bottom:10px }
  ul { list-style:none }
  .task { display:flex; gap:14px; align-items:flex-start; padding:5px 0 }
  .box { flex:none; width:26px; height:26px; margin-top:3px; border:2px solid var(--ink); border-radius:4px; display:flex; align-items:center; justify-content:center;
    font:700 20px/1 Georgia, serif; color:var(--hanko) }
  .task.done .box { background:#fcecea; border-color:var(--hanko) }
  .num { color:var(--n600); font-variant-numeric:tabular-nums; margin-right:2px }
  .text { font-size:22px; line-height:1.3 }
  .compact .text { font-size:19px; line-height:1.25 } .compact .task { padding:3px 0 } .compact .box { width:23px; height:23px; font-size:17px; margin-top:2px }
  .text strong { font-weight:600 }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size:.82em; background:rgba(32,31,29,.07); padding:0 .3em; border-radius:3px }
  .clamp-3 { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden }
  .clamp-4 { display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden }
  .columns { display:grid; grid-template-columns: 1fr 1fr; gap:0 44px }
  .fields { margin:2px 0 14px 40px; font-family: Georgia, serif; font-size:15px; line-height:1.45; color:var(--n700) }
  .fields div { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden }
  .fields b { color:var(--ink); font-weight:600 }
  .stamp { display:inline-block; margin-left:14px; padding:2px 10px 1px; border:2.5px solid var(--hanko); border-radius:5px; color:var(--hanko);
    font-size:18px; letter-spacing:.2em; text-transform:uppercase; transform:rotate(-5deg); vertical-align:middle }
  blockquote { border-left:3px solid var(--n300); padding-left:14px; color:var(--n700); font-family: Georgia, serif; font-size:16px; margin:8px 0 }
  .foot { margin-top:18px; font-family: Georgia, serif; font-size:14px; color:var(--n600) }
  .rev { padding:16px 0 18px; border-bottom:1px solid var(--n300) }
  .rev:last-of-type { border-bottom:0 }
  .rev .lead { font-size:25px; line-height:1.3; font-weight:600 }
  .rev .body { margin-top:8px; font-family: Georgia, serif; font-size:17px; line-height:1.5; color:var(--n700) }
  .rev .body strong { color:var(--ink); font-weight:600 }
  .said { font-style:italic; font-weight:500; color:var(--ink); background:#fcecea; box-shadow:inset 0 -3px 0 var(--hanko);
    padding:0 .2em; border-radius:2px; -webkit-box-decoration-break:clone; box-decoration-break:clone }
`

const TERMINAL_CSS = `
  * { margin:0; padding:0; box-sizing:border-box }
  body { width:${VW}px; height:${VH}px; background:#2d2b2b; padding:70px 90px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace }
  .window { background:#201f1d; border-radius:12px; box-shadow:0 24px 60px rgba(0,0,0,.45); height:100%; overflow:hidden; color:#f3f2f2 }
  .bar { height:46px; display:flex; align-items:center; gap:10px; padding:0 18px; background:#2d2b2b; border-bottom:1px solid #444141 }
  .bar i { width:13px; height:13px; border-radius:50%; background:#605d5d; display:block }
  .bar span { margin-left:auto; margin-right:auto; font-size:15px; color:#9b9797 }
  pre { padding:26px 30px; font-size:19px; line-height:1.55; white-space:pre-wrap }
  .prompt { color:#9b9797 } .cmd { color:#f3f2f2; font-weight:700 } .hash { color:#eba49d } .dim { color:#9b9797 } .mark { color:#f6d0cc }
  .big { font-size:30px; line-height:1.9 }
`

const paper = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>${PAPER_CSS}</style><body><div class="sheet">${body}</div></body>`

const terminal = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>${TERMINAL_CSS}</style><body><div class="window"><div class="bar"><i></i><i></i><i></i><span>${esc(title)}</span></div><pre>${body}</pre></div></body>`

// ---------------------------------------------------------------------------
// The checklist's three pages.

function checklistPages(markdown: string): { slices: string; v3: string; review: string } {
  const slices = tasks(section(markdown, '## Slices'))
  if (slices.length === 0) quit('devpost/checklist.md › Slices has no task items.')
  const review = tasks(section(markdown, '## Final Review'))
  const first = slices.findIndex((t) => /^\*\*16\./.test(t.title.trim()))
  const earlier = first < 0 ? slices : slices.slice(0, first)
  const v3 = first < 0 ? [] : slices.slice(first)
  const whole = slices.filter((t) => /^\*\*\d+\./.test(t.title.trim()))
  const ticked = whole.filter((t) => t.done).length

  const slicesPage = paper(
    'Build Checklist — Slices',
    `<div class="eyebrow">checklist.md</div>
<h1>Build Checklist <span class="stamp">${ticked} of ${whole.length} slices ticked</span></h1>
<div class="rule"></div>
<div class="columns compact">
  <div><h3>v1 · v2</h3><ul>${earlier.map((t) => taskLi(t)).join('')}</ul></div>
  <div><h3>v3 — the studio, live</h3><ul>${v3.map((t) => taskLi(t)).join('')}</ul><p class="foot">Product names shown as their roles.</p></div>
</div>`,
  )

  const FIELDS = ['Becomes usable', 'Verify (mechanical)', 'Learner check', 'Commit']
  const v3Page = paper(
    'Build Checklist — v3 slices',
    `<div class="eyebrow">checklist.md › Slices › v3</div>
<h1>Slices 16–23, each verified and checked by hand</h1>
<div class="rule"></div>
<ul>${v3
      .map(
        (t) =>
          `${taskLi(t)}<div class="fields">${t.fields
            .filter((f) => FIELDS.includes(f.name))
            .map((f) => `<div><b>${esc(f.name)}:</b> ${inline(roles(f.text))}</div>`)
            .join('')}</div>`,
      )
      .join('')}</ul>`,
  )

  const reviewPage = paper(
    'Build Checklist — Final Review',
    `<div class="eyebrow">checklist.md</div>
<h1>Final Review</h1>
<div class="rule"></div>
<ul>${review.map((t) => taskLi(t, 4)).join('')}</ul>`,
  )
  return { slices: slicesPage, v3: v3Page, review: reviewPage }
}

// ---------------------------------------------------------------------------
// The checklist's Revisions: every mid-build change, dated, with the learner's
// words. Three entries fit a legible sheet: the v3 plan revision and the first
// two entries whose marked quote is English and verbatim (today Slice 23 and
// Slice 22 — the 2026-10-24 entries quote the learner in French or naming
// products, so they stay off); never the ship entry (it is this film). Long
// entries end in an ellipsis.

type Revision = { lead: string; body: string }

/** The entries of the Revisions section: each a "- **lead** body" item, its continuation lines folded in. */
function revisions(section: string): Revision[] {
  const items: string[] = []
  for (const line of section.split(/\r?\n/)) {
    if (/^- /.test(line)) items.push(line.slice(2))
    else if (items.length && /^\s+\S/.test(line)) items[items.length - 1] += ` ${line.trim()}`
  }
  return items.map((item) => {
    // The bold lead may hold an italic quote (*"…"*), so its closing ** is found past any italic run…
    const m = /^\*\*((?:[^*]|\*[^*]+\*)+?)\*\*\s*/.exec(item)
    if (m) return { lead: m[1], body: item.slice(m[0].length) }
    // …and a lone * inside a code span (`S3_*`) throws that off: then the first ** after the opening one closes the lead.
    const close = item.startsWith('**') ? item.indexOf('**', 2) : -1
    return close > 0 ? { lead: item.slice(2, close), body: item.slice(close + 2).trim() } : { lead: '', body: item }
  })
}

/** The learner's quoted words in an entry, as the still marks them: every italic run of the lead, the introduced ones of the body. */
function quoted(r: Revision): string[] {
  const lead = [...r.lead.matchAll(/\*([^*\n]+)\*/g)].map((m) => m[1])
  const body = [...r.body.matchAll(/(?:the learner[’']s words?:\s*|in their words, that\s*)\*([^*\n]+)\*/g)].map((m) => m[1])
  return [...lead, ...body]
}

/** A quote the roles table would rewrite is not the learner's words any more; such an entry stays off the still. */
const verbatim = (r: Revision) => quoted(r).every((q) => roles(q) === q)

/**
 * The film is English, so a quote the learner typed in French (its function
 * words, or any accented letter) stays off the still — the words are shown
 * verbatim or not at all, never translated.
 */
const FRENCH = /[àâäçéèêëîïôöùûüÿœ]|\b(?:je|tu|il|elle|nous|vous|ils|elles|oui|tout|tous|toute|dans|veux|veut|est|que|qui|pas|les|des|une|ce|cette|sur|mais|ou|et|avec|être|etre|dois|doit)\b/i
const english = (r: Revision) => quoted(r).every((q) => !FRENCH.test(q))

/**
 * The three entries the still shows, in the file's order: the v3 plan
 * revision, then the first entries with a marked quote, then any — never the
 * ship entry (this film), a rewritten quote or a French one.
 */
function pickRevisions(all: Revision[]): Revision[] {
  const rest = all.filter((r) => !/^6-ship\b/.test(r.lead) && verbatim(r) && english(r))
  const plan = rest.find((r) => /^v3 — .*a plan revision after the v2 film/.test(r.lead))
  const chosen = plan ? [plan] : []
  for (const r of [...rest.filter((r) => quoted(r).length > 0), ...rest]) {
    if (chosen.length >= 3) break
    if (!chosen.includes(r)) chosen.push(r)
  }
  return chosen.sort((a, b) => all.indexOf(a) - all.indexOf(b))
}

function revisionsPage(markdown: string): string {
  const all = revisions(section(markdown, '## Revisions'))
  if (all.length === 0) quit('devpost/checklist.md › Revisions has no entries.')
  const shown = pickRevisions(all)
  return paper(
    'Build Checklist — Revisions',
    `<div class="eyebrow">checklist.md › Revisions</div>
<h1>Revisions <span class="stamp">${all.length} entries</span></h1>
<div class="lede">${shown.length} of ${all.length} · the learner’s quoted words marked</div>
<div class="rule"></div>
${shown
      .map(
        (r) => `<div class="rev">
  <div class="lead">${inline(roles(r.lead), 'all')}</div>
  <div class="body clamp-4">${inline(roles(r.body), 'introduced')}</div>
</div>`,
      )
      .join('')}
<p class="foot">Product names shown as their roles.</p>`,
  )
}

// ---------------------------------------------------------------------------
// The record: the commits, and the skills.


function logPage(): string {
  const r = spawnSync('git', ['log', '--format=%h%x09%s', '-30'], { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) quit(`git log failed in ${ROOT}: ${r.stderr.trim()}`)
  const rows = r.stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [hash, ...rest] = line.split('\t')
      const subject = roles(rest.join('\t'))
      // The slice commits are the record the film points at: their tail is lit.
      const tail = /\(slice \S+ checked by the learner\)$/.exec(subject)
      const body = tail ? `${esc(subject.slice(0, tail.index))}<span class="mark">${esc(tail[0])}</span>` : esc(subject)
      return `<span class="hash">${esc(hash)}</span>  ${body}`
    })
  return terminal(
    'the repository — git log',
    `<span class="prompt">$</span> <span class="cmd">git log --oneline -30</span>   <span class="dim"># product names shown as their roles</span>\n${rows.join('\n')}`,
  )
}

function skillsPage(): string {
  const dir = join(ROOT, '.claude', 'skills')
  if (!existsSync(dir)) quit(`There is no ${dir}: the skills are expected at .claude/skills/<n>.`)
  const names = readdirSync(dir)
    .filter((n) => existsSync(join(dir, n, 'SKILL.md')))
    .sort()
  if (names.length === 0) quit(`No skill with a SKILL.md under ${dir}.`)
  return terminal(
    'the hackathon’s Learn Skill Pack',
    `<span class="prompt">$</span> <span class="cmd">ls skills</span>   <span class="dim"># the Learn Skill Pack, in the project's skills folder</span>\n<span class="big">${names.map(esc).join('   ')}</span>\n\n<span class="prompt">$</span> <span class="cmd">ls skills/*/SKILL.md | wc -l</span>\n${names.length}\n\n<span class="dim"># one skill per step: ${names.join(' → ')}</span>`,
  )
}

// ---------------------------------------------------------------------------

/**
 * In a real document on screen, a product's name becomes its role — the same
 * table, over every text node — and the page says so. A quote it rewrote (an
 * <em> that opens with a quote mark: how the HTML companions set the
 * learner's words) is marked, so shoot() can refuse to show it.
 */
async function showRoles(page: Page): Promise<void> {
  const table = ROLES.map(([re, role]) => [re.source, re.flags, role] as const)
  await page.evaluate((rows) => {
    const res = rows.map(([source, flags, role]) => [new RegExp(source, flags), role] as const)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
    for (const t of nodes) {
      const before = t.data
      const after = res.reduce((s, [re, role]) => s.replace(re, role), before)
      if (after === before) continue
      t.data = after
      const em = t.parentElement?.closest('em')
      if (em && /^\s*[“"]/.test(em.textContent ?? '')) em.setAttribute('data-rewritten-quote', '')
    }
    const note = document.createElement('div')
    note.textContent = 'Product names shown as their roles.'
    Object.assign(note.style, {
      position: 'fixed', right: '18px', bottom: '14px', font: '13px/1.4 Georgia, serif', color: '#6b6767',
      background: 'rgba(255,255,255,.85)', padding: '4px 8px', border: '1px solid #d9d5d5', zIndex: '2147483647',
    })
    document.body.appendChild(note)
  }, table)
}

type Shot = {
  /** The whole page, stitched (for the learner's eye); otherwise the viewport, what the film shows. */
  fullPage?: boolean
  /** A selector to scroll to the top of the viewport first. */
  scrollTo?: string
  /** CSS added before the shot — to keep something out of it (`visibility: hidden` holds the layout). */
  hide?: string
}

async function shoot(page: Page, html: string | URL, file: string, { fullPage = false, scrollTo, hide }: Shot = {}): Promise<string> {
  if (html instanceof URL) {
    await page.goto(html.href, { waitUntil: 'load' })
    await showRoles(page)
  } else await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  if (hide) await page.addStyleTag({ content: hide })
  if (scrollTo) {
    // The named element sits at the top of the viewport, a breath under the edge.
    const found = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return false
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 14)
      return true
    }, scrollTo)
    if (!found) quit(`${file}: nothing matches "${scrollTo}" in ${html instanceof URL ? html.pathname : 'the page'}.`)
  }
  await page.waitForTimeout(150) // a frame for the layout to settle
  if (!fullPage) {
    // What the film shows must quote the learner verbatim: a rewritten quote in the viewport stops the capture.
    const rewritten = await page.evaluate((vh) => {
      const out: string[] = []
      for (const em of document.querySelectorAll('em[data-rewritten-quote]')) {
        const r = em.getBoundingClientRect()
        if (r.height === 0 || r.bottom <= 0 || r.top >= vh) continue
        if (getComputedStyle(em).visibility === 'hidden') continue
        out.push((em.textContent ?? '').trim().slice(0, 60))
      }
      return out
    }, VH)
    if (rewritten.length) quit(`${file}: the roles table rewrote a learner's quote that would be on screen — keep it out of the shot (hide) or leave the name alone:\n  ${rewritten.join('\n  ')}`)
  }
  const path = join(OUT, file)
  if (!fullPage) await page.screenshot({ path })
  else {
    const height = Math.min(MAX_FULL_PAGE, await page.evaluate(() => document.documentElement.scrollHeight))
    await page.screenshot({ path, fullPage: true, clip: { x: 0, y: 0, width: VW, height } })
  }
  return `${REL}/${file}`
}

async function main(): Promise<void> {
  for (const f of ['scope.html', 'prd.html', 'spec.html', 'checklist.md']) {
    if (!existsSync(join(DEVPOST, f))) quit(`devpost/${f} is missing; the method beat shows the real documents.`)
  }
  mkdirSync(OUT, { recursive: true })
  const checklistMd = readFileSync(join(DEVPOST, 'checklist.md'), 'utf8')
  const checklist = checklistPages(checklistMd)
  const revisionsHtml = revisionsPage(checklistMd)
  const log = logPage()
  const skills = skillsPage()

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    const doc = async (name: 'scope' | 'prd' | 'spec') => {
      const url = pathToFileURL(join(DEVPOST, `${name}.html`))
      return { top: await shoot(page, url, `${name}-top.png`), full: await shoot(page, url, `${name}-full.png`, { fullPage: true }) }
    }
    const index: DocsStills = {
      capturedAt: new Date().toISOString(),
      scope: {
        ...(await doc('scope')),
        // Items 1–7 of the v3 changes: 8–10 quote the learner naming products (the queue, the sign-in services), which the
        // roles table would rewrite, and a quote is shown verbatim or not at all. Item 5, the cut line, stays — verbatim.
        changes: await shoot(page, pathToFileURL(join(DEVPOST, 'scope.html')), 'scope-changes.png', {
          scrollTo: '#v3-changes',
          hide: '#v3-changes .reasons li:nth-child(n+8) { visibility: hidden }',
        }),
      },
      prd: await doc('prd'),
      spec: await doc('spec'),
      checklist: {
        slices: await shoot(page, checklist.slices, 'checklist-slices.png', { fullPage: true }),
        v3: await shoot(page, checklist.v3, 'checklist-v3.png', { fullPage: true }),
        review: await shoot(page, checklist.review, 'checklist-review.png'),
        revisions: await shoot(page, revisionsHtml, 'checklist-revisions.png'),
      },
      log: await shoot(page, log, 'log.png'),
      skills: await shoot(page, skills, 'skills.png'),
    }
    writeFileSync(join(OUT, 'docs.json'), `${JSON.stringify(index, null, 2)}\n`)
    // Every picture the index names: the three documents' top, whole page and (scope) changes, the checklist's four, the log and the skills.
    const count = JSON.stringify(index).match(/\.png"/g)?.length ?? 0
    console.log(`Document stills: ${count} pictures in ${OUT === join(VIDEO, 'public', 'capture', 'docs') ? 'video/public/capture/docs' : OUT} · docs.json written.`)
    console.log('Next: npm run video:render — the method beat shows them; prepare.mts says DRAFT until they exist.')
  } finally {
    await browser.close()
  }
}

await main()
