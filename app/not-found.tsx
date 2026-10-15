import { DeskNotice } from '@/components/DeskNotice'

// The one page a wrong URL lands on: a project id that isn't on the desk, a
// project that is someone else's (word for word the same — slice 19, so an id
// cannot be probed), or a path the studio doesn't have. Plain words, one way back.
export default function NotFound() {
  return <DeskNotice heading="There is no such page on the desk." />
}
