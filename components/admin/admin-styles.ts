// The admin pages' stylesheet (v3, slice 21), as a string the admin screen
// writes into a <style> tag ONLY after the admin gate has passed.
//
// Why not a .css file: Next attaches a page's stylesheets to the page itself,
// so a CSS import anywhere under `app/admin/reports/page.tsx` — however lazily
// it is loaded — adds a stylesheet (in development its name, `admin/reports/
// page.css`) to the page a refused visitor gets, and that is the one thing that
// would tell a stranger this page is there. A string rendered after the gate
// leaves the refused page byte-for-byte what any unknown page is. (The CSP
// already allows inline styles: `style-src 'self' 'unsafe-inline'`.)
//
// Built from the paper classes in globals.css (.studio, .station, .card, .btn,
// .chip, .tag, .notice); only what the queue needs of its own is here. Every
// control is at least 44 px tall, and nothing is wider than the screen: long
// notes and titles wrap.
export const ADMIN_CSS = `
.admin-queue {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}
.admin-queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.admin-queue-title {
  font-size: 26px;
  font-weight: 500;
}
.admin-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.admin-chip {
  min-height: 44px;
  padding-inline: var(--space-4);
}
.admin-chip:focus-visible,
.admin-btn:focus-visible,
.admin-report:focus-visible {
  outline: 2px solid var(--hanko);
  outline-offset: 2px;
}

/* A status line that takes no room until it has something to say. */
.admin-status {
  margin: 0;
  min-height: 0;
  font-size: 15px;
  color: var(--neutral-800);
}
.admin-status:empty {
  display: none;
}

.admin-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.admin-report {
  gap: var(--space-3);
  min-width: 0;
}
.admin-report.is-handled {
  background: var(--surface);
  border-color: var(--neutral-500);
  box-shadow: none;
}
.admin-report-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.admin-time {
  margin-left: auto;
  font-size: 13px;
  color: var(--neutral-700);
  font-variant-numeric: tabular-nums;
}
.admin-report-title {
  font-size: 24px;
  line-height: 1.2;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.admin-note {
  margin: 0;
  font-size: 15px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.admin-note.is-empty {
  color: var(--neutral-600);
  font-style: italic;
}
.admin-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
}
.admin-btn,
.admin-back {
  min-height: 44px;
}

.admin-empty {
  align-items: flex-start;
  padding: var(--space-6);
  max-width: 560px;
}
.admin-empty p {
  margin: 0;
}
.admin-empty-title {
  font-family: var(--font-heading), Georgia, serif;
  font-size: 22px;
}
.admin-foot {
  margin: 0;
  font-size: 14px;
  color: var(--neutral-700);
}

@media (max-width: 720px) {
  .admin-queue-title {
    font-size: 22px;
  }
  .admin-time {
    margin-left: 0;
    flex-basis: 100%;
  }
  .admin-actions .admin-btn {
    flex: 1 1 100%;
  }
}
`
