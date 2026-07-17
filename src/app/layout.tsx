import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cadence — daily planner",
  description: "A calm daily planner: calendar, tasks, and notes in one place.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Cadence" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};

// Not typed against Next's `Viewport` export on purpose: `interactiveWidget` tells
// modern mobile browsers to resize the layout viewport around the software keyboard
// instead of overlaying it, which is half of the fix for the notes-editor freeze/jump
// when the keyboard opens. The other half is the --app-height JS fallback in AppShell
// for browsers that don't support this yet.
export const viewport = {
  themeColor: "#FAFAFC",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}",
          }}
        />
      </body>
    </html>
  );
}
