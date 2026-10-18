// The reports queue's screen (v3, slice 21): the header, the heading and the
// list, loaded from the store. It is rendered by `app/admin/reports/page.tsx`
// only AFTER the admin gate has passed, and it is imported there lazily, so
// nothing of it — not its stylesheet, not its client component — is part of the
// page a non-admin is refused. Its stylesheet is `admin-styles.ts`, written
// into a <style> tag here for the same reason (see that file).
import Image from 'next/image'
import Link from 'next/link'
import { AuthControls } from '@/components/AuthControls'
import { DeskNotice } from '@/components/DeskNotice'
import { ADMIN_CSS } from '@/components/admin/admin-styles'
import { ReportsQueue } from '@/components/admin/ReportsQueue'
import { adminReportView, type AdminReportView } from '@/lib/share/report'
import { store } from '@/lib/store'

/** How many reports the screen lists at most; the store never returns more than 1000. */
const LIST = 200

export async function ReportsScreen() {
  let reports: AdminReportView[]
  try {
    const found = await store.reports.list({ limit: LIST })
    const tokens = [...new Set(found.map((report) => report.token))]
    const shares = new Map(await Promise.all(tokens.map(async (token) => [token, await store.shares.get(token)] as const)))
    reports = found.map((report) => adminReportView(report, shares.get(report.token) ?? null))
  } catch (err) {
    console.error('[admin] could not read the reports:', err instanceof Error ? err.message : err)
    return <DeskNotice heading="The reports couldn’t be read just now." sentence="Try again in a moment." />
  }

  return (
    <div className="studio">
      <style dangerouslySetInnerHTML={{ __html: ADMIN_CSS }} />
      <header className="studio-header admin-head">
        <Link className="brand" href="/" title="Back to the desk — every project">
          <Image className="brand-mark" src="/brand/inkdesk-mark.svg" alt="" width={30} height={30} priority />
          <span className="brand-name">Ink Desk</span>
        </Link>
        <div className="header-spacer" />
        <div className="header-meta">
          <Link className="btn btn-secondary admin-back" href="/">
            ← Back to the desk
          </Link>
          <AuthControls />
        </div>
      </header>
      <main className="station">
        <div className="station-inner">
          <div className="station-head">
            <div className="eyebrow">Admin</div>
            <h1 className="station-title">Reports</h1>
            <p className="station-lede">
              What visitors have reported about shared pages. Unpublishing a share makes its link show the same page as
              one that never existed. Reporters are never told what happened.
            </p>
          </div>
          <ReportsQueue initial={reports} capped={reports.length >= LIST} />
        </div>
      </main>
    </div>
  )
}
