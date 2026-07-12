// pdf.js validates that its worker's version matches the main library's at
// runtime, so the worker file has to be copied fresh (not hand-pinned) on
// every install. Served as a plain static asset from /public — deliberately
// NOT bundled via webpack's `new URL(...)`, because Next's Terser pass can't
// minify the worker's ESM syntax a second time.
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = path.join(__dirname, "..", "public", "pdf.worker.min.mjs");

if (!fs.existsSync(src)) {
  console.warn("[copy-pdf-worker] pdfjs-dist worker not found, skipping (pdfjs-dist not installed?)");
  process.exit(0);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log("[copy-pdf-worker] copied pdf.worker.min.mjs -> public/");
