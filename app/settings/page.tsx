// /settings is just a door: Account is the first section.
import { redirect } from 'next/navigation'

export default function SettingsIndex() {
  redirect('/settings/account')
}
