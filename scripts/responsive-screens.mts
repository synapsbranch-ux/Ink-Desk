// Every screen `check:responsive` visits (slice 23), and how to reach each state.
// A screen is a path plus, for a dialog or a tapped state, the one action that
// opens it. Studio screens set the station (and the open page) through the
// project's own edit route before loading, so they never depend on the rail's
// markup — the shell is about to change it. `area` is who owns most of the
// screen; each violation is still assigned by the element's own file.
import type { APIRequestContext, Locator, Page } from 'playwright'
import type { Fixture } from './responsive-fixture.mjs'

export type Area = 'shell' | 'page' | 'planning' | 'reader' | 'surfaces'
export const AREAS: readonly Area[] = ['shell', 'page', 'planning', 'reader', 'surfaces']

/** Who is looking: the fixture's person, a brand-new account, or a signed-out stranger. */
export type Who = 'owner' | 'newcomer' | 'stranger'

export type ScreenCtx = {
  page: Page
  request: APIRequestContext
  base: string
  fx: Fixture
  width: number
  touch: boolean
  /** Headers that make a request the screen's person's. */
  headers: Record<string, string>
  goto(path: string): Promise<void>
  /** Tap on a touch device, click on the desktop; waits for the element first. `force` presses an aria-disabled control (Playwright counts it as disabled). */
  press(target: Locator, how?: { force?: boolean }): Promise<void>
  /** Open a project at a station (and page) — set through the edit route, then loaded. */
  studio(projectId: string, station: 'story' | 'cast' | 'director' | 'storyboard' | 'reader', page?: number): Promise<void>
}

export type Screen = {
  name: string
  area: Area
  what: string
  who: Who
  /** Changes a project's station: studio screens run one at a time. */
  studio?: boolean
  /** Count targets only inside this (the open dialog); the sideways test is always the whole page. */
  scope?: string
  /** Waited for before measuring. */
  ready?: string
  run?(ctx: ScreenCtx): Promise<void>
  /** After `run`: what a touch did wrong here, one sentence each (a `behaviour` violation); [] when all is well. */
  check?(ctx: ScreenCtx): Promise<string[]>
  /** Why this screen can't be reached on a check desk; it is listed, never measured. */
  unreachable?: string
}

const DIALOG = '[role="dialog"], [role="alertdialog"], dialog[open]'

async function openDialog(ctx: ScreenCtx, opener: Locator): Promise<void> {
  await ctx.press(opener)
  await ctx.page.locator(DIALOG).last().waitFor({ state: 'visible', timeout: 20_000 })
  await ctx.page.waitForTimeout(250)
}

const button = (page: Page, name: RegExp) => page.getByRole('button', { name }).first()

// --- The after-audit's pins: what a touch does, checked as well as measured ---------------------------
const SHEET = '.bubble-sheet'

/** Tap the first bubble on the open page and wait for its sheet (and the scroll that brings the panel up). */
async function openBubbleSheet(c: ScreenCtx): Promise<void> {
  await c.press(c.page.locator('.bubble-tap').first())
  await c.page.locator(SHEET).waitFor({ state: 'visible', timeout: 20_000 })
  await c.page.waitForTimeout(900)
}

async function cancelBubbleSheet(c: ScreenCtx): Promise<void> {
  await c.press(c.page.locator(SHEET).getByRole('button', { name: 'Cancel', exact: true }))
  await c.page.locator(SHEET).waitFor({ state: 'hidden', timeout: 10_000 })
}

/** Every POST the page sends from now on is held (answered 409 here, never reaching the desk) and listed. */
async function holdPosts(page: Page): Promise<{ posts: string[]; bodies: string[]; release: () => Promise<void> }> {
  const posts: string[] = []
  const bodies: string[] = []
  const handler = (route: import('playwright').Route) => {
    const r = route.request()
    if (r.method() !== 'POST') return route.continue()
    posts.push(`POST ${new URL(r.url()).pathname}`)
    bodies.push(r.postData() ?? '')
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Held by the check.' }) })
  }
  await page.route('**/api/**', handler)
  return { posts, bodies, release: () => page.unroute('**/api/**', handler) }
}

/**
 * A tap on the dim above the bubble sheet is Done, and nothing else: the overlay used to close on pointerdown, so the
 * same tap's click landed on the control now under the finger — a panel's Redraw, a paid call.
 */
async function tapOutsideSheet(c: ScreenCtx): Promise<string[]> {
  if (!c.touch) return []
  const held = await holdPosts(c.page)
  try {
    await openBubbleSheet(c)
    const target = (await c.page.evaluate(`(() => {
      const sheet = document.querySelector('${SHEET}').getBoundingClientRect()
      const open = document.querySelector('.bubble-tap[aria-expanded="true"]')
      // A panel's own button first (Redraw, Try again…); else a bubble, whose click would open a sheet again.
      const pick = (root, bubbles) => [...root.querySelectorAll('button:not(:disabled)')]
        .filter((b) => !b.closest('.bubble-sheet-overlay') && b.classList.contains('bubble-tap') === bubbles)
        .map((b) => ({ b, r: b.getBoundingClientRect() }))
        .find(({ r }) => r.width > 0 && r.top >= 0 && r.bottom <= sheet.top - 2)
      const hit = (open && pick(open.closest('.panel'), false)) || pick(document, false) || pick(document, true)
      if (!hit) return null
      const x = hit.r.left + hit.r.width / 2
      const y = hit.r.top + hit.r.height / 2
      const under = document.elementFromPoint(x, y)
      return { x, y, label: hit.b.getAttribute('aria-label') || hit.b.textContent.trim().slice(0, 40), dim: !!under && under.classList.contains('bubble-sheet-overlay') }
    })()`)) as { x: number; y: number; label: string; dim: boolean } | null
    if (!target) return ['no button shows above the open bubble sheet to tap through — the pin could not be set up']
    if (!target.dim) return [`the dim above the bubble sheet doesn't cover “${target.label}”, so a tap there presses it`]
    await c.page.touchscreen.tap(target.x, target.y)
    await c.page.waitForTimeout(1200)
    const problems: string[] = []
    if (await c.page.locator(SHEET).isVisible()) problems.push(`a tap on the dim over “${target.label}” left a bubble sheet open — it didn't close, or its click pressed the bubble under it`)
    if (held.posts.length) problems.push(`the tap that closed the bubble sheet also pressed “${target.label}” under it: ${held.posts.join(', ')}`)
    return problems
  } finally {
    await held.release()
  }
}

/** With a phone keyboard up (the visual viewport 300 px shorter, the layout viewport unchanged), Done and Cancel stay above the keys. */
async function sheetOverKeyboard(c: ScreenCtx): Promise<string[]> {
  if (!c.touch) return []
  const visible = (await c.page.evaluate(`(() => {
    const height = innerHeight - 300
    const vv = Object.assign(new EventTarget(), { height, width: innerWidth, offsetTop: 0, offsetLeft: 0, pageTop: scrollY, pageLeft: 0, scale: 1 })
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    return height
  })()`)) as number
  await openBubbleSheet(c)
  const bottoms = (await c.page.evaluate(`[...document.querySelectorAll('.bubble-sheet-actions button')].map((b) => ({ name: b.textContent.trim(), bottom: Math.round(b.getBoundingClientRect().bottom) }))`)) as { name: string; bottom: number }[]
  const problems = bottoms.filter((b) => b.bottom > visible + 1).map((b) => `with a keyboard leaving ${visible}px visible, the bubble sheet's ${b.name} sits at ${b.bottom}px — under the keys`)
  if (bottoms.length === 0) problems.push('the bubble sheet has no Cancel / Done row')
  await cancelBubbleSheet(c)
  return problems
}

/** The bubble moved to the panel's bottom edge stays above the sheet, so the live preview can be seen (a tablet in landscape too). */
async function bubbleAboveSheet(c: ScreenCtx): Promise<string[]> {
  if (!c.touch) return []
  const sizes = c.width < 600 ? [{ width: c.width, height: 844 }] : [{ width: c.width, height: 1024 }, { width: 1024, height: 768 }]
  const before = c.page.viewportSize()
  const problems: string[] = []
  try {
    for (const size of sizes) {
      await c.page.setViewportSize(size)
      await c.page.waitForTimeout(400)
      await openBubbleSheet(c)
      const down = c.page.locator(SHEET).getByRole('button', { name: /^Move the bubble down/ })
      for (let i = 0; i < 30 && (await down.isEnabled()); i++) await down.tap()
      await c.page.waitForTimeout(1200)
      const r = (await c.page.evaluate(`(() => {
        const b = document.querySelector('.bubble-tap[aria-expanded="true"]').getBoundingClientRect()
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), sheet: Math.round(document.querySelector('${SHEET}').getBoundingClientRect().top) }
      })()`)) as { top: number; bottom: number; sheet: number }
      if (r.bottom > r.sheet + 1 || r.top < 0) problems.push(`at ${size.width}×${size.height}, the bubble moved to the bottom edge is at ${r.top}–${r.bottom}px and the sheet starts at ${r.sheet}px: the live preview is hidden`)
      await cancelBubbleSheet(c)
    }
  } finally {
    if (before) await c.page.setViewportSize(before)
  }
  return problems
}

/** Done after a move AND new words sends ONE edit with both: two saves at once let the first reply put the old words back. */
async function doneSavesOnce(c: ScreenCtx): Promise<string[]> {
  if (!c.touch) return []
  const held = await holdPosts(c.page)
  try {
    await openBubbleSheet(c)
    const sheet = c.page.locator(SHEET)
    await sheet.locator('.bubble-sheet-text').fill('Held by the check')
    const right = sheet.getByRole('button', { name: /^Move the bubble right/ })
    await c.press((await right.isEnabled()) ? right : sheet.getByRole('button', { name: /^Move the bubble left/ }))
    await c.press(sheet.getByRole('button', { name: 'Done', exact: true }))
    await c.page.waitForTimeout(1200)
    const saves = held.bodies.filter((b) => b.includes('"panels"'))
    const one = saves.length === 1 && saves[0].includes('"bubble"') && saves[0].includes('"dialogue"')
    return one ? [] : [`Done after a move and new words sent ${saves.length} save(s), not one with both: ${saves.map((b) => b.slice(0, 90)).join(' · ')}`]
  } finally {
    await held.release()
  }
}

const HELD_ALL = 'The studio is busy right now — held by the check.'

/** Generate all refused while the plan's bar is stuck over the bottom of the page: the sentence shows on screen, not above it. */
async function refusalInView(c: ScreenCtx): Promise<string[]> {
  if (c.width > 960) return [] // the bar sticks at 960 px and under
  const page = c.page
  const all = page.getByRole('button', { name: 'Generate all', exact: true })
  const steps = page.locator('.count-stepper button')
  let added = false
  const problems: string[] = []
  const hold = (route: import('playwright').Route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: HELD_ALL }) })
  await page.route('**/pages/all/start', hold)
  try {
    // One page more than is on the board, so Generate all is open (taken off again below).
    if (await all.isDisabled()) {
      await c.press(steps.last())
      added = true
      await page.waitForTimeout(1500)
    }
    if (await all.isDisabled()) return ['Generate all could not be opened on the manhwa copy — the pin could not be set up']
    await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
    await page.waitForTimeout(500)
    await c.press(all)
    const alert = page.locator('[role="alert"]', { hasText: HELD_ALL }).first()
    await alert.waitFor({ state: 'attached', timeout: 15_000 })
    await page.waitForTimeout(300)
    const box = await alert.boundingBox()
    const { h, y } = (await page.evaluate('({ h: innerHeight, y: Math.round(scrollY) })')) as { h: number; y: number }
    if (!box || box.y + box.height <= 0 || box.y >= h) {
      problems.push(`Generate all refused from the bottom of the page (scrolled to ${y}px): its sentence is ${box ? `at ${Math.round(box.y)}–${Math.round(box.y + box.height)}px` : 'not shown'}, off the ${h}px screen`)
    }
  } finally {
    await page.unroute('**/pages/all/start', hold)
    if (added) {
      await c.press(steps.first())
      await page.waitForTimeout(1500)
    }
  }
  return problems
}

/** Export PNG on a touch screen whose share sheet is dismissed: the file can still be had ("Download instead"). */
async function exportAfterDismissedShare(c: ScreenCtx): Promise<string[]> {
  if (!c.touch) return []
  await c.page.evaluate(`navigator.canShare = () => true; navigator.share = async () => { throw new DOMException('dismissed', 'AbortError') }`)
  const downloads: string[] = []
  c.page.on('download', (d) => void downloads.push(d.suggestedFilename()))
  await c.press(c.page.getByRole('button', { name: /^Export PNG/ }).first())
  await c.page.waitForFunction(`!document.body.innerText.includes('Compositing')`, null, { timeout: 120_000 })
  await c.page.waitForTimeout(800)
  const instead = c.page.getByRole('button', { name: 'Download instead' }).first()
  if (!(await instead.isVisible())) return ['Export PNG with the share sheet dismissed: no download and no “Download instead” — the file can’t be had']
  await c.press(instead)
  await c.page.waitForTimeout(1500)
  return downloads.length ? [] : ['“Download instead” after a dismissed share sheet downloaded nothing']
}

export const SCREENS: readonly Screen[] = [
  // --- surfaces -------------------------------------------------------------------
  { name: 'dashboard', area: 'surfaces', who: 'owner', what: 'the desk: projects, videos, library', ready: '.project-grid', run: (c) => c.goto('/') },
  { name: 'dashboard-empty', area: 'surfaces', who: 'newcomer', what: 'a brand-new account’s desk', ready: 'main', run: (c) => c.goto('/') },
  { name: 'settings-account', area: 'surfaces', who: 'owner', what: 'Settings › Account', ready: '.settings main', run: (c) => c.goto('/settings/account') },
  { name: 'settings-defaults', area: 'surfaces', who: 'owner', what: 'Settings › Defaults', ready: '.settings main', run: (c) => c.goto('/settings/defaults') },
  { name: 'settings-sharing', area: 'surfaces', who: 'owner', what: 'Settings › Sharing, two links out', ready: '.settings main', run: (c) => c.goto('/settings/sharing') },
  { name: 'settings-data', area: 'surfaces', who: 'owner', what: 'Settings › Data and privacy', ready: '.settings main', run: (c) => c.goto('/settings/data') },
  { name: 'usage', area: 'surfaces', who: 'owner', what: 'Settings › Usage', ready: '.settings main', run: (c) => c.goto('/settings/usage') },
  { name: 'admin-reports', area: 'surfaces', who: 'owner', what: 'the reports queue (the person is on ADMIN_EMAILS)', ready: 'main', run: (c) => c.goto('/admin/reports') },
  { name: 'terms', area: 'surfaces', who: 'stranger', what: 'Terms', ready: 'main, article, h1', run: (c) => c.goto('/terms') },
  { name: 'privacy', area: 'surfaces', who: 'stranger', what: 'Privacy', ready: 'main, article, h1', run: (c) => c.goto('/privacy') },
  { name: 'not-found', area: 'surfaces', who: 'owner', what: 'an unknown address', ready: 'h1, main', run: (c) => c.goto('/no-such-page-here') },
  {
    name: 'sign-in',
    area: 'surfaces',
    who: 'stranger',
    what: 'the sign-in card in the paper frame',
    unreachable: 'only rendered in INKDESK_AUTH=better; off and test redirect to /, and better needs the accounts’ MongoDB, which the check never touches',
  },
  { name: 'sign-up', area: 'surfaces', who: 'stranger', what: 'the sign-up card', unreachable: 'as sign-in: better mode only' },
  { name: 'error', area: 'surfaces', who: 'owner', what: 'the error boundary (app/error.tsx)', unreachable: 'shown only when a page throws; the check has no way to make one throw without changing product code' },

  // --- shell ----------------------------------------------------------------------
  {
    name: 'new-project',
    area: 'shell',
    who: 'owner',
    what: 'the New project dialog (/?new=1)',
    scope: DIALOG,
    run: async (c) => {
      await c.goto('/?new=1')
      await c.page.locator(DIALOG).last().waitFor({ state: 'visible', timeout: 30_000 })
    },
  },
  {
    name: 'confirm-remove-video',
    area: 'shell',
    who: 'owner',
    what: 'a ConfirmDialog: Remove a trailer, over the player',
    scope: '[role="alertdialog"]',
    run: async (c) => {
      await c.goto('/')
      await openDialog(c, button(c.page, /^Play/))
      await openDialog(c, c.page.locator(DIALOG).last().getByRole('button', { name: /^Remove/ }).first())
    },
  },
  {
    name: 'admin-confirm',
    area: 'shell',
    who: 'owner',
    what: 'a ConfirmDialog: Unpublish from the reports queue',
    scope: '[role="alertdialog"]',
    run: async (c) => {
      await c.goto('/admin/reports')
      await openDialog(c, button(c.page, /^Unpublish/))
    },
  },
  {
    name: 'settings-unpublish-dialog',
    area: 'shell',
    who: 'owner',
    what: 'a SettingsDialog: Unpublish this link?',
    scope: '[role="alertdialog"]',
    run: async (c) => {
      await c.goto('/settings/sharing')
      await openDialog(c, button(c.page, /^Unpublish/))
    },
  },
  {
    name: 'settings-delete-dialog',
    area: 'shell',
    who: 'owner',
    what: 'a SettingsDialog: Delete your account?',
    scope: '[role="alertdialog"]',
    run: async (c) => {
      await c.goto('/settings/data')
      await openDialog(c, button(c.page, /Delete my account/))
    },
  },
  {
    name: 'studio-rail-locked',
    area: 'shell',
    who: 'owner',
    studio: true,
    what: 'a locked station tapped (the blank project’s Director)',
    run: async (c) => {
      await c.studio(c.fx.blankId, 'story')
      const station = c.page.locator('[data-station="director"]').first()
      const target = (await station.count()) > 0 ? station : c.page.getByRole('button', { name: /Director/ }).first()
      await c.press(target, { force: true })
      await c.page.waitForTimeout(400)
    },
  },

  // --- planning ---------------------------------------------------------------------
  { name: 'studio-story', area: 'planning', who: 'owner', studio: true, what: 'Story, the accepted synopsis', run: (c) => c.studio(c.fx.projectId, 'story') },
  { name: 'studio-story-blank', area: 'planning', who: 'owner', studio: true, what: 'Story on a blank project (pitch inputs)', run: (c) => c.studio(c.fx.blankId, 'story') },
  { name: 'studio-library', area: 'planning', who: 'owner', studio: true, what: 'Library: cast cards and the asset shelf', run: (c) => c.studio(c.fx.projectId, 'cast') },
  { name: 'studio-director', area: 'planning', who: 'owner', studio: true, what: 'Director: the plan, page cards, cover', run: (c) => c.studio(c.fx.projectId, 'director') },
  {
    name: 'director-refused-stuck',
    area: 'planning',
    who: 'owner',
    studio: true,
    what: 'Director (manhwa copy): Generate all refused from the bottom of the page — the sentence in view',
    run: (c) => c.studio(c.fx.manhwaId, 'director'),
    check: refusalInView,
  },

  // --- page -----------------------------------------------------------------------------
  { name: 'studio-page', area: 'page', who: 'owner', studio: true, what: 'Page 1: four panels, bubbles, the finished trailer below', ready: '.page-switcher', run: (c) => c.studio(c.fx.projectId, 'storyboard', 0) },
  {
    name: 'studio-page-bubble',
    area: 'page',
    who: 'owner',
    studio: true,
    what: 'Page 1 with the first bubble tapped (edit)',
    run: async (c) => {
      await c.studio(c.fx.projectId, 'storyboard', 0)
      await c.press(c.page.locator('.bubble-text').first())
      await c.page.waitForTimeout(400)
    },
  },
  {
    name: 'bubble-sheet-tap-outside',
    area: 'page',
    who: 'owner',
    studio: true,
    what: 'Page 2: the bubble sheet closed by a tap on the dim over a panel’s button — the tap presses nothing under it',
    run: (c) => c.studio(c.fx.projectId, 'storyboard', 1),
    check: tapOutsideSheet,
  },
  {
    name: 'bubble-sheet-keyboard',
    area: 'page',
    who: 'owner',
    studio: true,
    what: 'Page 1: the bubble sheet with a phone keyboard up — Done and Cancel above the keys; Done saves place and words as one edit',
    run: (c) => c.studio(c.fx.projectId, 'storyboard', 0),
    check: async (c) => [...(await sheetOverKeyboard(c)), ...(await doneSavesOnce(c))],
  },
  {
    name: 'bubble-sheet-preview',
    area: 'page',
    who: 'owner',
    studio: true,
    what: 'Page 1: the bubble moved to the bottom edge stays above the sheet (a tablet in landscape too)',
    run: (c) => c.studio(c.fx.projectId, 'storyboard', 0),
    check: bubbleAboveSheet,
  },

  // --- reader -----------------------------------------------------------------------------
  { name: 'studio-page-shots', area: 'reader', who: 'owner', studio: true, what: 'Page 2: the failed trailer’s shot cards', ready: '.shot-grid', run: (c) => c.studio(c.fx.projectId, 'storyboard', 1) },
  {
    name: 'studio-animate-estimate',
    area: 'reader',
    who: 'owner',
    studio: true,
    what: 'Page 3: Animate pressed — the estimate (a GET; nothing is spent)',
    ready: '.animate-estimate',
    run: async (c) => {
      await c.studio(c.fx.projectId, 'storyboard', 2)
      await c.press(button(c.page, /Animate this page/))
    },
  },
  { name: 'studio-reader-rtl', area: 'reader', who: 'owner', studio: true, what: 'Ink & Publish, right to left', ready: '.reader-sheet', run: (c) => c.studio(c.fx.projectId, 'reader') },
  {
    name: 'studio-reader-ltr',
    area: 'reader',
    who: 'owner',
    studio: true,
    what: 'Ink & Publish, left to right',
    ready: '.reader-sheet',
    run: async (c) => {
      await c.studio(c.fx.projectId, 'reader')
      await c.press(c.page.getByRole('radio', { name: /Left to right/ }).first())
    },
  },
  // A page turned to, not the cover: its bubbles are lettered at the panel's size (the
  // filming desk's page 3 holds the longest line in a square panel).
  {
    name: 'studio-reader-page',
    area: 'reader',
    who: 'owner',
    studio: true,
    what: 'Ink & Publish turned to page 3: the bubbles lettered to fit',
    ready: '.reader-page',
    run: async (c) => {
      await c.studio(c.fx.projectId, 'reader')
      await c.press(c.page.locator('.reader-tab', { hasText: /^3$/ }).first())
    },
  },
  { name: 'studio-reader-vertical', area: 'reader', who: 'owner', studio: true, what: 'Ink & Publish, the manhwa vertical scroll', ready: '.reader-sheet', run: (c) => c.studio(c.fx.manhwaId, 'reader') },
  {
    name: 'reader-export-dismissed',
    area: 'reader',
    who: 'owner',
    studio: true,
    what: 'Ink & Publish: Export PNG on a touch screen, the share sheet dismissed — “Download instead” is offered',
    ready: '.reader-sheet',
    run: (c) => c.studio(c.fx.projectId, 'reader'),
    check: exportAfterDismissedShare,
  },
  {
    name: 'share-dialog',
    area: 'reader',
    who: 'owner',
    studio: true,
    what: 'the Share dialog from the reader (already shared)',
    scope: DIALOG,
    run: async (c) => {
      await c.studio(c.fx.projectId, 'reader')
      await openDialog(c, button(c.page, /Share publicly/))
    },
  },
  {
    name: 'video-player',
    area: 'reader',
    who: 'owner',
    what: 'the trailer player dialog from the dashboard',
    scope: DIALOG,
    run: async (c) => {
      await c.goto('/')
      await openDialog(c, button(c.page, /^Play/))
    },
  },
  { name: 'share-manga', area: 'reader', who: 'stranger', what: 'the public manga share page', ready: '.share-page', run: (c) => c.goto(`/s/${c.fx.mangaToken}`) },
  {
    name: 'share-manga-page',
    area: 'reader',
    who: 'stranger',
    what: 'the public manga share turned to page 3: the bubbles lettered to fit',
    ready: '.reader-page',
    run: async (c) => {
      await c.goto(`/s/${c.fx.mangaToken}`)
      await c.press(c.page.locator('.reader-tab', { hasText: /^3$/ }).first())
    },
  },
  {
    name: 'report-dialog',
    area: 'reader',
    who: 'stranger',
    what: 'the Report dialog on the share page',
    scope: DIALOG,
    run: async (c) => {
      await c.goto(`/s/${c.fx.mangaToken}`)
      await openDialog(c, button(c.page, /^Report$/))
    },
  },
  { name: 'share-video', area: 'reader', who: 'stranger', what: 'the public trailer share page', ready: '.share-page', run: (c) => c.goto(`/s/${c.fx.videoToken}`) },
  { name: 'share-not-found', area: 'reader', who: 'stranger', what: 'a share link that never was', ready: 'h1, main', run: (c) => c.goto(`/s/${c.fx.missingToken}`) },
]
