// Remotion CLI configuration for the Ink Desk demo video.
// Remotion needs a Chromium to render. On a machine with Remotion's own
// headless shell (it downloads one on first render) nothing is needed; in a
// sandbox with a pre-installed browser, point INKDESK_BROWSER at it, e.g.
//   INKDESK_BROWSER=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setJpegQuality(92)
Config.setOverwriteOutput(true)
Config.setPixelFormat('yuv420p')
if (process.env.INKDESK_BROWSER) Config.setBrowserExecutable(process.env.INKDESK_BROWSER)
