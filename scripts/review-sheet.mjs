// node scripts/review-sheet.mjs "<lecture slug or title prefix>" [--content DIR] [--out DIR] [--shots DIR]
// H6a: the per-lecture review sheet. One self-contained HTML file, test-results/review/<slug>.html, that lists every
// item of a lecture (derivations, checks, predictions, goals, placements, planned placeholders) with its answers and
// feedback, the objective coverage and, when `npm run lesson` has run, a thumbnail of the step. Riskiest items come
// first, so a 10-minute read covers what is most likely wrong. All markdown and maths is rendered here with KaTeX, so
// the file needs no JS; its stylesheet and fonts are the repo's katex package, referenced by relative path.
// Item ids are the player's flag keys (`slug#stepId#block`, block = index inside the step), so a flag and a sheet
// entry name the same thing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import katex from "katex";
import MarkdownIt from "markdown-it";
import { CONTENT, REPO } from "./lib.mjs";

// ---- resolving the lecture (same rules as scripts/lesson.mjs) -----------------------------------------------

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const prefixOf = (q, s) => s === q || s.startsWith(`${q} `);

export function resolveLecture(index, text) {
  const lectures = Object.values(index.notes).filter((n) => n.type === "lecture");
  const q = norm(text);
  const names = (n) => [n.slug, n.name, n.title, [n.course, n.lecture != null ? `L${n.lecture}` : "", n.title].join(" ")].map(norm);
  const tiers = [
    (n) => names(n).includes(q),
    (n) => names(n).some((s) => prefixOf(q, s)),
    (n) => names(n).some((s) => s.includes(q)),
  ];
  for (const tier of tiers) {
    const hits = lectures.filter(tier);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new Error(`"${text}" matches ${hits.length} lectures; be more specific:\n${hits.map((n) => `  ${n.name}  (${n.slug})`).join("\n")}`);
  }
  throw new Error(`no lecture matches "${text}"; look in content/index.json for the lecture names.`);
}

// ---- markdown and maths -------------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A path with spaces made safe for an href/src. */
const url = (p) => p.split("/").map(encodeURIComponent).join("/");

// Same shape as src/content/markdown.ts (and vault_tool.py MATH_INLINE): math is claimed before emphasis can see it.
const INLINE_MATH = /\$(?!\$)((?:\\\$|[^$\n])+?)\$(?!\$)/y;
const DISPLAY_MATH = /\$\$([\s\S]+?)\$\$/y;
function mathRule(state, silent) {
  if (state.src.charCodeAt(state.pos) !== 0x24) return false;
  if (state.pos > 0 && state.src.charCodeAt(state.pos - 1) === 0x24) return false;
  for (const [re, display] of [[DISPLAY_MATH, true], [INLINE_MATH, false]]) {
    re.lastIndex = state.pos;
    const m = re.exec(state.src);
    if (!m || m.index + m[0].length > state.posMax) continue;
    if (!silent) {
      const token = state.push(display ? "math_display" : "math_inline", "math", 0);
      token.content = m[1].trim();
    }
    state.pos += m[0].length;
    return true;
  }
  return false;
}

const tex = (src, display = false) => katex.renderToString(src, { displayMode: display, throwOnError: false, strict: "ignore", output: "html" });

/** Renderers for one sheet; `assets` is the relative path from the sheet to the content root. */
function makeRenderer(assets) {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  md.inline.ruler.before("escape", "math", mathRule);
  md.renderer.rules.math_inline = (t, i) => tex(t[i].content);
  md.renderer.rules.math_display = (t, i) => `<span class="math-display">${tex(t[i].content, true)}</span>`;
  // `note:` links have no meaning on a static sheet: keep the words, drop the link.
  const NOTE = /^note:/;
  md.validateLink = () => true;
  md.renderer.rules.link_open = (t, i, _o, env) => {
    const href = t[i].attrGet("href") ?? "";
    (env.links ??= []).push(NOTE.test(href));
    if (NOTE.test(href)) return '<span class="note-link">';
    return /^assets\//.test(href) ? `<a href="${esc(`${assets}/${url(href)}`)}">` : `<a href="${esc(href)}">`;
  };
  md.renderer.rules.link_close = (_t, _i, _o, env) => (env.links.pop() ? "</span>" : "</a>");
  md.renderer.rules.image = (t, i, o, env, self) => {
    const src = t[i].attrGet("src") ?? "";
    const alt = self.renderInlineAsText(t[i].children ?? [], o, env);
    return `<img class="md-img" src="${esc(/^assets\//.test(src) ? `${assets}/${url(src)}` : src)}" alt="${esc(alt)}" loading="lazy">`;
  };
  return {
    /** Markdown with paragraphs and lists. */
    block: (s) => (s ? md.render(s) : ""),
    /** One line of markdown, no wrapping <p>. */
    inline: (s) => (s ? md.renderInline(s) : ""),
    /** A bare TeX string. */
    tex: (s) => tex(s),
  };
}

// ---- the items ----------------------------------------------------------------------------------------------

/** Riskiest first: what the checker or the author is most likely to have got wrong, and what a learner sees
 *  graded. A derivation has several parts that must agree; a placeholder is a brief nobody has built yet. */
const KINDS = {
  derive: { rank: 0, label: "Derivation" },
  mcq: { rank: 1, label: "Multiple choice" },
  numeric: { rank: 2, label: "Numeric check" },
  predict: { rank: 3, label: "Prediction" },
  goal: { rank: 4, label: "Goal" },
  planned: { rank: 5, label: "Planned placeholder" },
  placement: { rank: 6, label: "Placement" },
};

const kindOf = (b) => {
  if (b.t === "derive") return "derive";
  if (b.t === "check") return b.kind;
  if (b.t !== "interactive") return null;
  if (b.status === "planned") return "planned";
  if (b.predict) return "predict";
  if (b.goal) return "goal";
  return "placement";
};

/** Every reviewable block of the note, in document order, with where it sits. */
export function collectItems(slug, body, shotsByStep) {
  const items = [];
  for (const section of body.sections) {
    for (const step of section.steps) {
      step.blocks.forEach((block, at) => {
        const kind = kindOf(block);
        if (!kind) return;
        items.push({
          id: `${slug}#${step.id}#${at}`,
          kind,
          block,
          section: section.heading,
          stepId: step.id,
          stepHeading: step.heading ?? null,
          objectives: block.objectives ?? [],
          shot: shotsByStep.get(step.id) ?? null,
          order: items.length,
        });
      });
    }
  }
  return items.sort((a, b) => KINDS[a.kind].rank - KINDS[b.kind].rank || a.order - b.order);
}

export function countItems(items) {
  const blocks = items.map((i) => i.block);
  return {
    checks: blocks.filter((b) => b.t === "check").length,
    derives: blocks.filter((b) => b.t === "derive").length,
    predictions: blocks.filter((b) => b.t === "interactive" && b.predict).length,
    goals: blocks.filter((b) => b.t === "interactive" && b.goal).length,
    placements: blocks.filter((b) => b.t === "interactive").length,
    planned: blocks.filter((b) => b.t === "interactive" && b.status === "planned").length,
  };
}

// ---- rendering one item -------------------------------------------------------------------------------------

const MISSING = '<span class="missing">no feedback</span>';

function renderItem(item, r, shotHref) {
  const b = item.block;
  const row = (label, html) => (html ? `<div class="row"><span class="lab">${label}</span><div class="val">${html}</div></div>` : "");
  /** Options of a choice, ✓ on the correct one, each with the message the learner sees for picking it. */
  const options = (opts) =>
    `<ul class="opts">${opts
      .map((o) => {
        // A wrong option with no message is a gap worth seeing; a correct one needs none (its verdict has "why").
        const silentOk = o.correct || o.noFeedbackOk;
        const fb = o.feedback ? `<div class="fb">${r.block(o.feedback)}</div>` : silentOk ? "" : `<div class="fb">${MISSING}</div>`;
        return `<li class="${o.correct ? "ok" : "no"}"><span class="mark">${o.correct ? "✓" : "✗"}</span><div>${r.inline(o.md)}${fb}</div></li>`;
      })
      .join("")}</ul>`;
  let html = "";

  if (b.t === "derive") {
    const chips = (xs, f) => (xs.length ? `<span class="chips">${xs.map((x) => `<span class="chip">${f(x)}</span>`).join("")}</span>` : "");
    html += row("Symbols", chips(b.symbols, r.tex));
    html += row("Inherited notation", chips(b.inherited, (x) => `${r.inline(x.tex)} <small>typ. ${esc(x.typical)} (${esc(x.from)})</small>`));
    for (const [label, key] of [["Unknowns", "unknowns"], ["Dimensions", "dims"], ["Data", "data"], ["Matrices", "matrices"]]) html += row(label, chips(b[key], r.inline));
    html += row("Define", chips(b.define, r.tex));
    html += row("Given", chips(b.given, r.tex));
    html += `<ol class="dsteps">${b.steps
      .map((s, n) => {
        const just = s.justify
          ? `<div class="just"><b>Justify:</b> ${r.inline(s.justify.prompt)}${options(s.justify.options.map((o) => ({ ...o, noFeedbackOk: true })))}</div>`
          : "";
        return `<li><div class="dstep">${r.inline(s.md)}</div>${s.hint ? `<div class="hint"><b>Hint:</b> ${r.inline(s.hint)}</div>` : ""}${just}</li>`;
      })
      .join("")}</ol>`;
    html += row("Accepted forms", b.accept.length ? `<ul class="forms">${b.accept.map((t) => `<li class="ok"><span class="mark">✓</span>${r.tex(t)}</li>`).join("")}</ul>` : "");
    html += row(
      "Rejected forms",
      b.reject.length ? `<ul class="forms">${b.reject.map((x) => `<li class="no"><span class="mark">✗</span><div>${r.tex(x.tex)}<div class="fb">${r.inline(x.md)}</div></div></li>`).join("")}</ul>` : "",
    );
    if (!b.accept.length && !b.reject.length) html += row("Accept / reject", '<span class="muted">none beyond the steps (the checker accepts equivalent forms of the target)</span>');
  } else if (b.t === "check" && b.kind === "mcq") {
    html += row("Prompt", r.block(b.prompt));
    html += row("Options", options(b.options));
    html += row("Why", r.block(b.why));
  } else if (b.t === "check") {
    html += row("Prompt", r.block(b.prompt));
    html += row("Answer", `<code>${esc(b.answer)}</code> ± <code>${esc(b.tol)}</code>`);
    html += row(
      "Wrong answers",
      b.wrong?.length ? `<ul class="forms">${b.wrong.map((w) => `<li class="no"><span class="mark">✗</span><div><code>${esc(w.answer)}</code> ± <code>${esc(w.tol)}</code><div class="fb">${r.inline(w.md)}</div></div></li>`).join("")}</ul>` : '<span class="muted">no diagnostics</span>',
    );
    html += row("Why", r.block(b.why));
  } else {
    html += row("Widget", `<code>${esc(b.widget)}</code>${b.status === "planned" ? ' <span class="tag plan">planned</span>' : ""}`);
    if (b.status === "planned") {
      html += row("Brief", r.block(b.purpose ?? b.prompt ?? ""));
      if (b.figure) html += row("Figure", `<code>${esc(b.figure)}</code><br><img class="md-img" src="${esc(`${item.assets}/${url(b.figure)}`)}" alt="" loading="lazy">`);
    } else if (b.prompt) {
      html += row("Prompt", r.block(b.prompt));
    }
    const p = b.predict;
    if (p) {
      html += row("Predict", r.block(p.ask));
      if (p.options) html += row("Options", options(p.options.map((md, n) => ({ md, correct: n === p.answer, feedback: p.feedback?.[n] ?? undefined }))));
      if (p.readout) html += row("Compute", `readout <code>${esc(p.readout)}</code>${p.tol != null ? ` within <code>${esc(p.tol)}</code>` : ""}`);
      html += row("Hidden until reveal", p.hide.length ? p.hide.map((h) => `<code>${esc(h)}</code>`).join(" ") : "");
      html += row("Why", r.block(p.why ?? ""));
      if (p.reflect) html += row("Reflect", '<span class="muted">offers an ungraded "why do you think so?" box</span>');
    }
    if (b.goal) {
      html += row("Goal when", `<code>${esc(b.goal.when)}</code>`);
      html += row("Success", r.block(b.goal.success));
      html += row("Hint", r.block(b.goal.hint ?? ""));
    }
  }

  const where = [item.section, item.stepHeading].filter(Boolean).map(esc).join(" › ");
  const objs = item.objectives.length
    ? item.objectives.map((n) => `<a class="tag obj" href="#obj-${n}">obj ${n}</a>`).join("")
    : '<span class="tag obj none">no objective</span>';
  const kind = b.t === "interactive" && b.predict && b.goal ? "Prediction + goal" : KINDS[item.kind].label;
  const shot = shotHref ? `<a class="shot" href="${esc(shotHref)}"><img src="${esc(shotHref)}" alt="screenshot of ${esc(item.stepId)}" loading="lazy"></a>` : "";
  const title = b.t === "derive" ? r.inline(b.title) : "";
  return `<article class="item k-${item.kind}${shot ? " has-shot" : ""}" id="${esc(item.id)}">
<div class="main"><header><span class="tag kind">${kind}</span><code class="id">${esc(item.id)}</code>${objs}</header>
${title ? `<h3>${title}</h3>` : ""}<div class="where">${where || esc(item.stepId)}</div>
<div class="body">${html}</div></div>${shot}
</article>`;
}

// ---- the page -----------------------------------------------------------------------------------------------

const CSS = `
:root{--ink:#1d2330;--mute:#5d6678;--line:#d9dde6;--bg:#f5f6f9;--card:#fff;--ok:#1a7f45;--no:#b3261e;--warn:#fff3cd;--warnline:#e0b100;--acc:#2b50aa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:32px 0 8px;border-bottom:2px solid var(--line);padding-bottom:4px}
h3{margin:4px 0;font-size:1.05rem}
.sub{color:var(--mute);margin:0 0 12px}
.counts{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.counts div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 12px;text-align:center}
.counts b{display:block;font-size:1.25rem}.counts span{color:var(--mute);font-size:.8rem}
table{border-collapse:collapse;width:100%;background:var(--card)}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{background:#eceff5;font-size:.85rem}tr.untested td{background:var(--warn);border-color:var(--warnline)}
td.n{width:2.5em;text-align:center}td.t{width:6em}
.ref{display:inline-block;margin:1px 4px 1px 0;font-size:.8rem;text-decoration:none;color:var(--acc);background:#eaf0ff;border-radius:4px;padding:0 6px}
.item{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--acc);border-radius:8px;padding:10px 14px;margin:12px 0;position:relative;overflow:hidden}
.k-derive{border-left-color:#7a3fb0}.k-mcq{border-left-color:#c2570c}.k-numeric{border-left-color:#b8860b}.k-predict{border-left-color:#1f7a8c}
.k-goal{border-left-color:#2f8f4e}.k-planned{border-left-color:#8a8f9a;border-style:dashed;border-left-style:solid}.k-placement{border-left-color:#aab}
.item header{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tag{font-size:.75rem;border-radius:4px;padding:1px 7px;background:#eceff5;text-decoration:none;color:var(--ink)}
.tag.kind{background:var(--ink);color:#fff}.tag.obj{background:#eaf0ff;color:var(--acc)}.tag.obj.none{background:var(--warn);color:#6b5400}.tag.plan{background:#e8e8ec}
code{font:.85em ui-monospace,Consolas,monospace;background:#f0f2f6;padding:0 4px;border-radius:3px}code.id{color:var(--mute);margin-left:auto;user-select:all}
.where{color:var(--mute);font-size:.82rem;margin:2px 0 6px}
.row{display:flex;gap:10px;padding:4px 0;border-top:1px solid #eef0f5}.lab{flex:0 0 7.5em;color:var(--mute);font-size:.8rem;padding-top:2px}.val{flex:1;min-width:0}
.val p{margin:0 0 6px}.val p:last-child{margin:0}
ul.opts,ul.forms{list-style:none;margin:0;padding:0}.opts li,.forms li{display:flex;gap:8px;padding:3px 0}
.mark{flex:0 0 1.2em;font-weight:700}li.ok .mark{color:var(--ok)}li.no .mark{color:var(--no)}
.fb{font-size:.88rem;color:var(--mute);margin:1px 0 2px}.fb p{margin:0}.missing{background:var(--warn);color:#6b5400;border-radius:3px;padding:0 5px;font-size:.78rem}
.muted{color:var(--mute)}.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:#f0f2f6;border-radius:12px;padding:1px 9px;font-size:.9rem}.chip small{color:var(--mute)}
ol.dsteps{margin:6px 0;padding-left:1.6em}ol.dsteps>li{margin:6px 0}.hint,.just{font-size:.9rem;margin-top:3px}.hint{color:var(--mute)}
.item.has-shot{display:flex;gap:14px}.main{flex:1;min-width:0}
.shot{flex:0 0 150px;align-self:flex-start;margin-top:26px;border:1px solid var(--line);border-radius:4px;overflow:hidden;background:#fff;box-shadow:0 1px 4px #0002}
.shot img{display:block;width:100%;height:auto}
.md-img{max-width:100%;max-height:260px}.math-display{display:block;text-align:center;overflow-x:auto}
.note-link{border-bottom:1px dotted var(--mute)}
.nav li{margin:2px 0}.nav a{color:var(--acc);text-decoration:none}.nav small{color:var(--mute)}
@media(max-width:640px){.item.has-shot{flex-direction:column}.shot{flex-basis:auto;width:140px;margin-top:0}.row{flex-direction:column;gap:2px}}
@media print{body{background:#fff}.item{break-inside:avoid}}
`;

/** Build the sheet's HTML. `shots` maps stepId to a sheet-relative screenshot path. */
export function renderSheet({ meta, body, assets, katexCss, shots }) {
  const r = makeRenderer(assets);
  const items = collectItems(meta.slug, body, shots);
  for (const item of items) item.assets = assets;
  const counts = countItems(items);
  const objectives = meta.objectives ?? [];

  const itemsByObjective = new Map();
  for (const item of items) for (const n of item.objectives) (itemsByObjective.get(n) ?? itemsByObjective.set(n, []).get(n)).push(item);
  const ref = (item) => `<a class="ref" href="#${esc(item.id)}" title="${esc(item.id)}">${KINDS[item.kind].label.toLowerCase()} · ${esc(item.stepId)}#${item.id.split("#")[2]}</a>`;
  const coverage = objectives.length
    ? `<table><thead><tr><th>#</th><th>Objective</th><th>Items</th><th>Tested by</th></tr></thead><tbody>${objectives
        .map((o) => {
          const hits = itemsByObjective.get(o.n) ?? [];
          return `<tr class="${hits.length ? "" : "untested"}" id="obj-${o.n}"><td class="n">${o.n}</td><td>${r.inline(o.md)}</td><td class="t">${hits.length ? hits.length : "<b>untested</b>"}</td><td>${hits.map(ref).join("")}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : '<p class="muted">This lecture has no tagged objectives yet (the "What to be able to do" list is untagged).</p>';

  const nav = `<ol class="nav">${items.map((i) => `<li><a href="#${esc(i.id)}">${KINDS[i.kind].label}</a> <small>${esc(i.id)}</small></li>`).join("")}</ol>`;
  const cards = items.map((i) => renderItem(i, r, i.shot)).join("\n");
  const stat = (n, label) => `<div><b>${n}</b><span>${label}</span></div>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review: ${esc(meta.title)}</title>
<link rel="stylesheet" href="${esc(katexCss)}">
<style>${CSS}</style></head><body><main>
<h1>${esc(meta.title)}</h1>
<p class="sub">Review sheet for <code>${esc(meta.slug)}</code> · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · riskiest items first. Quote an item by its id when flagging.</p>
<div class="counts">${stat(counts.checks, "checks")}${stat(counts.derives, "derives")}${stat(counts.predictions, "predictions")}${stat(counts.goals, "goals")}${stat(counts.placements, "placements")}${stat(counts.planned, "planned")}</div>
<h2>Objective coverage</h2>
${coverage}
<h2>Items (${items.length})</h2>
${items.length ? nav : '<p class="muted">This lecture has no interactive items yet.</p>'}
<h2>Review</h2>
${cards}
</main></body></html>
`;
  return { html, counts, items: items.length };
}

/** Write the sheet for `slug`; returns the file path and a one-line summary. */
export function writeSheet(slug, { content = CONTENT, out = path.join(REPO, "test-results", "review"), shots = path.join(REPO, "test-results", "lesson") } = {}) {
  const index = JSON.parse(readFileSync(path.join(content, "index.json"), "utf8"));
  const meta = index.notes[slug];
  if (!meta) throw new Error(`no note "${slug}" in ${content}`);
  const body = JSON.parse(readFileSync(path.join(content, "notes", `${slug}.json`), "utf8"));
  mkdirSync(out, { recursive: true });
  const rel = (to) => path.relative(out, to).split(path.sep).join("/");

  const shotMap = new Map();
  const manifest = path.join(shots, slug, "manifest.json");
  if (existsSync(manifest)) {
    for (const s of JSON.parse(readFileSync(manifest, "utf8")).shots ?? []) {
      const file = path.join(shots, slug, path.basename(s.screenshot));
      if (existsSync(file)) shotMap.set(s.stepId, rel(file));
    }
  }
  const katexCss = rel(path.join(REPO, "node_modules", "katex", "dist", "katex.min.css"));
  const { html, counts, items } = renderSheet({ meta, body, assets: rel(content), katexCss, shots: shotMap });
  const file = path.join(out, `${slug}.html`);
  writeFileSync(file, html, "utf8");
  return { file, items, counts, screenshots: shotMap.size };
}

// ---- command line -------------------------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? path.resolve(argv[at + 1] ?? "") : undefined;
  };
  const dirs = { content: opt("--content"), out: opt("--out"), shots: opt("--shots") };
  const flagged = new Set(["--content", "--out", "--shots"].flatMap((f) => (argv.includes(f) ? [argv.indexOf(f), argv.indexOf(f) + 1] : [])));
  const query = argv.filter((_, i) => !flagged.has(i)).join(" ").trim();
  if (!query) {
    console.error('usage: node scripts/review-sheet.mjs "<lecture slug or title prefix>" [--content DIR] [--out DIR] [--shots DIR]');
    process.exit(2);
  }
  try {
    const content = dirs.content ?? CONTENT;
    const meta = resolveLecture(JSON.parse(readFileSync(path.join(content, "index.json"), "utf8")), query);
    const r = writeSheet(meta.slug, Object.fromEntries(Object.entries({ ...dirs, content }).filter(([, v]) => v)));
    const kb = Math.round(readFileSync(r.file).length / 1024);
    console.log(`review sheet: ${path.relative(REPO, r.file).split(path.sep).join("/")}  (${r.items} items, ${r.screenshots} screenshots, ${kb} KB)`);
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
