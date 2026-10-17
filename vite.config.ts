// The player is a static site. `base: "./"` makes every URL relative, and the vault export (content/) is the
// public dir, so index.json, notes/ and assets/ sit next to index.html in dist/ and load relative to the page.
// MQE_CONTENT / MQE_OUT point a build at another export (the e2e fixture) without touching content/ or dist/.
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { flagsPlugin } from "./scripts/flags-plugin.js";

const root = import.meta.dirname;

// Vendor chunks, so the entry holds app code and React only, and each library caches on its own. The order
// matters: the first match wins. mathjs and its dependencies get a chunk of their own that only the widget
// runtime imports, so no page without a widget ever downloads it; KaTeX and markdown-it are needed by every
// lesson but are not part of the first paint of the home page's code.
const VENDOR_CHUNKS: [name: string, pattern: RegExp][] = [
  ["mathjs", /node_modules\/(mathjs|complex\.js|decimal\.js|fraction\.js|javascript-natural-sort|seedrandom|tiny-emitter|typed-function|escape-latex)\//],
  ["katex", /node_modules\/katex\//],
  ["markdown-it", /node_modules\/(markdown-it|mdurl|linkify-it|uc\.micro|entities|punycode\.js)\//],
  ["minisearch", /node_modules\/minisearch\//],
  ["zod", /node_modules\/zod\//],
  ["react", /node_modules\/(react|react-dom|scheduler)\//],
];

function vendorChunk(id: string): string | null {
  const normalized = id.replaceAll("\\", "/");
  return VENDOR_CHUNKS.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

export default defineConfig({
  base: "./",
  root,
  publicDir: path.resolve(root, process.env.MQE_CONTENT ?? "content"),
  // flagsPlugin is dev-server only (apply: "serve"): builds and previews never see /__flags.
  plugins: [react(), flagsPlugin(root)],
  build: {
    outDir: path.resolve(root, process.env.MQE_OUT ?? "dist"),
    emptyOutDir: true,
    // content/ already owns assets/ (figures and data); the bundle goes beside it, not into it.
    assetsDir: "app",
    // mathjs alone is about 650 kB minified; it is the one chunk allowed past the default 500 kB, and it loads
    // only with the first widget. Everything else is far below this.
    chunkSizeWarningLimit: 700,
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: vendorChunk, debugName: "vendors" }] } } },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
