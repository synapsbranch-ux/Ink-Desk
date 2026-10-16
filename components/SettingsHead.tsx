// The head of a Settings page: the section's eyebrow, one title and a line on
// what it is for, in the studio's chapter-head frame (`.station-head`). The
// title is the page's one <h1>. Used by every page under `app/settings`.
export function SettingsHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: React.ReactNode }) {
  return (
    <div className="station-head">
      <div className="eyebrow">{eyebrow}</div>
      <h1 className="station-title">{title}</h1>
      <p className="station-lede">{lede}</p>
    </div>
  )
}
