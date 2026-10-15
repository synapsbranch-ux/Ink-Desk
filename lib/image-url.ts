// Where the browser asks for a stored image (v3, slice 19). Every image lives
// under the address of the project that holds it, so the route can check the
// caller owns that project and that the picture is one of its own before a
// byte is read (SEC-01, SEC-06). Pure and client-safe: the components build
// every <img> source with it.

/** `/api/projects/<projectId>/image/<imageId>` — the owner-checked image route. */
export function imageUrl(projectId: string, imageId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/image/${encodeURIComponent(imageId)}`
}
