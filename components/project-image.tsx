'use client'

// Which project the studio has open, for the components that show its
// pictures (slice 19). Every image is served under its project's address —
// `lib/image-url.ts` — so a card or a panel needs the project id as well as
// the image id. The studio provides it once; the cards ask for it here
// instead of threading it through every prop.
import { createContext, useContext } from 'react'
import { imageUrl } from '@/lib/image-url'

const ProjectContext = createContext<string | null>(null)

export const ProjectProvider = ProjectContext.Provider

/** `imageId → URL` for the open project. Throws outside the studio: a picture with no project has no address. */
export function useImageUrl(): (imageId: string) => string {
  const projectId = useContext(ProjectContext)
  if (projectId === null) throw new Error('useImageUrl needs a <ProjectProvider> — every image is served under its project.')
  return (imageId: string) => imageUrl(projectId, imageId)
}
