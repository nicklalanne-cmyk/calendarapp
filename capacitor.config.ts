import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Cadence wraps the live Vercel deployment (server.url) rather than
 * bundling a static export — the app is a full Next.js app with API
 * routes, auth cookies, and server-rendered pages, none of which work
 * as a static bundle. This means regular app updates (UI changes, bug
 * fixes, new features) ship the same way they always have — push to
 * main, Vercel deploys, and the next time the app is opened/reloaded
 * it's live. Only native-shell changes (icon, splash screen, new native
 * permissions/plugins) require a new Xcode build submitted to
 * TestFlight/App Store.
 */
const config: CapacitorConfig = {
  appId: "app.cadenceplanner.ios",
  appName: "Cadence",
  webDir: "public", // unused in server.url mode, but required by the CLI
  server: {
    url: "https://cadenceplanner.app",
    cleartext: false,
  },
  ios: {
    contentInset: "always",
  },
};

export default config;
