// Runs once when the server starts, before it takes a request. One job: the
// studio's settings are validated here (`lib/config.ts`) and a server with a
// missing or malformed variable refuses to start, in one sentence that names
// every problem — never a value — rather than being discovered by the first
// click. Cloud storage switched on without its settings is refused the same
// way, and the studio never quietly falls back to the local desk
// (`devpost/spec.md > Config and Boot (v3)`). The store refuses every call
// with its own sentence too, so a server that comes up anyway still cannot
// write anywhere it was not told to.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { boot } = await import('./lib/boot')
    boot()
  }
}
