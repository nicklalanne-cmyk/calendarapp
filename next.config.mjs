/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // Surfaced as a faint "vXXXXXXX · updated ..." label in AppShell so it's
    // obvious whether a tab has picked up the latest deploy yet. Vercel injects
    // VERCEL_GIT_COMMIT_SHA into the build environment automatically; the
    // timestamp is baked in at build time (this file only runs during `next build`).
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};
export default nextConfig;
