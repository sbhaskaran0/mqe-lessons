import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FLAGS_FORMAT, handleFlagsRequest, MAX_BODY_BYTES, writeFlagsFile, type FlagsRequest } from "../../scripts/flags-plugin";

const flag = { slug: "solow", stepId: "def-1", block: 2, kind: "math", reason: "Typo", note: "", at: 1, excerpt: "k" };
const post = (body: unknown, extra: Partial<FlagsRequest> = {}): FlagsRequest => ({
  method: "POST",
  url: "/__flags",
  contentType: "application/json",
  body: typeof body === "string" ? body : JSON.stringify(body),
  ...extra,
});
const NOW = () => new Date("2026-10-15T12:00:00Z");

function run(req: FlagsRequest) {
  const written: string[] = [];
  const res = handleFlagsRequest(req, (t) => written.push(t), NOW);
  return { res, written };
}

describe("handleFlagsRequest", () => {
  it("answers the ping with 204 and leaves other URLs alone", () => {
    expect(run({ method: "GET", url: "/__flags/ping" }).res).toEqual({ status: 204 });
    expect(run({ method: "POST", url: "/__flags/ping" }).res).toEqual({ status: 405 });
    expect(run({ method: "GET", url: "/index.html" }).res).toBeNull();
    expect(run({ method: "POST", url: "/__flagsx" }).res).toBeNull();
  });

  it("writes the full list as pretty JSON and answers 204", () => {
    const { res, written } = run(post({ flags: [flag] }));
    expect(res).toEqual({ status: 204 });
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('\n  "flags": [');
    expect(JSON.parse(written[0]!)).toEqual({ format: FLAGS_FORMAT, updated: "2026-10-15T12:00:00.000Z", count: 1, flags: [flag] });
  });

  it("writes an empty list (the last flag was removed)", () => {
    const { res, written } = run(post({ flags: [] }));
    expect(res).toEqual({ status: 204 });
    expect(JSON.parse(written[0]!).flags).toEqual([]);
  });

  it("rejects the wrong method, content type, size and shape without writing", () => {
    const cases: [string, FlagsRequest, number][] = [
      ["PUT", post({ flags: [] }, { method: "PUT" }), 405],
      ["GET", post({ flags: [] }, { method: "GET" }), 405],
      ["text/plain", post({ flags: [] }, { contentType: "text/plain" }), 415],
      ["no content type", post({ flags: [] }, { contentType: undefined }), 415],
      ["over 1 MB", post("x".repeat(MAX_BODY_BYTES + 1)), 413],
      ["not JSON", post("{nope"), 400],
      ["no flags key", post({}), 422],
      ["flags not a list", post({ flags: "no" }), 422],
      ["unknown reason", post({ flags: [{ ...flag, reason: "Whatever" }] }), 422],
      ["negative block", post({ flags: [{ ...flag, block: -1 }] }), 422],
      ["missing excerpt", post({ flags: [{ ...flag, excerpt: undefined }] }), 422],
      ["null entry", post({ flags: [flag, null] }), 422],
    ];
    for (const [name, req, status] of cases) {
      const { res, written } = run(req);
      expect([name, res?.status]).toEqual([name, status]);
      expect(written).toEqual([]);
    }
  });
});

describe("writeFlagsFile", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("creates the directory, replaces the file in place and leaves no temp file behind", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mqe-flags-"));
    dirs.push(root);
    const file = path.join(root, "feedback", "flags.json");
    writeFlagsFile(file, "one\n");
    writeFlagsFile(file, "two\n");
    expect(readFileSync(file, "utf8")).toBe("two\n");
    expect(readdirSync(path.dirname(file))).toEqual(["flags.json"]);
  });
});
