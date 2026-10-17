// Dev-only write-through for the lesson player's flags (src/lesson/Flag.tsx). The browser posts the full current flag
// list to `/__flags`; this writes it to <repo>/feedback/flags.json so an agent can read the flags and fix the notes.
// The file lives outside the vault on purpose: the dev watcher re-exports on every vault change.
//
// The request handling is a pure function (`handleFlagsRequest`) so it can be tested without a server.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

export const FLAGS_PATH = "/__flags";
export const FLAGS_PING_PATH = "/__flags/ping";
export const FLAGS_FORMAT = "mqe-lessons-flags";
export const MAX_BODY_BYTES = 1_000_000;

export type FlagsRequest = { method: string; url: string; contentType?: string | undefined; body?: string | undefined };
export type FlagsResponse = { status: number; body?: string };

const REASONS = ["Wrong maths", "Unclear", "Typo", "Other"];

/** Whether `value` has the shape of a stored Flag (see src/progress/store.ts). */
function isFlag(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.slug === "string" &&
    typeof f.stepId === "string" &&
    typeof f.block === "number" && Number.isInteger(f.block) && f.block >= 0 &&
    typeof f.kind === "string" &&
    typeof f.reason === "string" && REASONS.includes(f.reason) &&
    typeof f.note === "string" &&
    typeof f.at === "number" && Number.isFinite(f.at) &&
    typeof f.excerpt === "string"
  );
}

/** Answers one request, or returns null when the URL is not ours. `write` receives the file text. */
export function handleFlagsRequest(req: FlagsRequest, write: (text: string) => void, now: () => Date = () => new Date()): FlagsResponse | null {
  const pathname = req.url.split("?")[0];
  if (pathname === FLAGS_PING_PATH) return req.method === "GET" || req.method === "HEAD" ? { status: 204 } : { status: 405 };
  if (pathname !== FLAGS_PATH) return null;
  if (req.method !== "POST") return { status: 405 };
  // A cross-site form can post text/plain without a preflight; JSON it cannot, so this keeps other pages out.
  if (!(req.contentType ?? "").toLowerCase().startsWith("application/json")) return { status: 415 };
  const body = req.body ?? "";
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return { status: 413 };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { status: 400, body: "not JSON" };
  }
  const flags = typeof json === "object" && json !== null ? (json as { flags?: unknown }).flags : undefined;
  if (!Array.isArray(flags) || !flags.every(isFlag)) return { status: 422, body: "expected {flags: Flag[]}" };
  write(JSON.stringify({ format: FLAGS_FORMAT, updated: now().toISOString(), count: flags.length, flags }, null, 2) + "\n");
  return { status: 204 };
}

/** Writes via a temp file in the same directory and a rename, so a reader never sees half a file. */
export function writeFlagsFile(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, file);
}

export function flagsPlugin(root: string): Plugin {
  const file = path.resolve(root, "feedback", "flags.json");
  return {
    name: "mqe-flags",
    apply: "serve",
    // The dev server watches the repo; a write to feedback/ must not look like a source change.
    config: () => ({ server: { watch: { ignored: ["**/feedback/**"] } } }),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        const method = req.method ?? "GET";
        const reply = (r: FlagsResponse) => {
          res.statusCode = r.status;
          res.end(r.body);
        };
        const handle = (body?: string) => {
          let out: FlagsResponse | null;
          try {
            out = handleFlagsRequest({ method, url, contentType: req.headers["content-type"], body }, (text) => writeFlagsFile(file, text));
          } catch (error) {
            return reply({ status: 500, body: error instanceof Error ? error.message : "write failed" });
          }
          if (out) reply(out);
          else next();
        };
        if (method !== "POST" || url.split("?")[0] !== FLAGS_PATH) return handle();
        // Stop reading at the limit instead of buffering whatever arrives.
        const chunks: Buffer[] = [];
        let size = 0;
        let tooBig = false;
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) tooBig = true;
          else chunks.push(chunk);
        });
        req.on("end", () => (tooBig ? reply({ status: 413 }) : handle(Buffer.concat(chunks).toString("utf8"))));
        req.on("error", () => reply({ status: 400 }));
      });
    },
  };
}
