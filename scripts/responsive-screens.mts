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
    what: 'Clerk’s sign-in in the paper frame',
    unreachable: 'only rendered in INKDESK_AUTH=clerk; off and test redirect to /, and clerk needs real Clerk keys and Clerk’s network, which the check never touches',
  },
  { name: 'sign-up', area: 'surfaces', who: 'stranger', what: 'Clerk’s sign-up', unreachable: 'as sign-in: clerk mode only' },
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
