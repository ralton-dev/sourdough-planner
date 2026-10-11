// Prints the plan page to PDF, in Chrome or Firefox or both, and checks that every block that
// must print whole does (printcheck.mjs). Exits 1 when one does not. See README.md in this
// folder; `--help` lists the flags.
import fsp from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_OUT, openState, serve } from "./app.mjs";
import { PAGE, chrome, firefox, sleep } from "./browser.mjs";
import { pdfPages } from "./pdftext.mjs";
import { BLOCKS, PAGE_AREA, placeBlocks, rasterise, readBlocks, summarise } from "./printcheck.mjs";
import { STATES } from "./states.mjs";

const HELP = `node scripts/screens/print.mjs [flags]   (npm run screens:print -- [flags])
  --state <name>       ${Object.keys(STATES).join(", ")} (default: all)
  --scheme <s>         the screen's scheme when printing: light or dark (default: light)
  --timeline <v>       the Timeline card's view: order or dough (default: the app's)
  --firefox            print in Firefox (WebDriver BiDi) instead of Chrome
  --both               print in Chrome and in Firefox
  --png                also each page as a PNG, beside the PDF (macOS)
  --verbose            list every block checked and what each page holds
  --out <path>         a .pdf for one state in one browser, else a folder (default: ${DEFAULT_OUT})
  --dist <dir>         serve this build instead of building the working tree
  --port <n>           serve on this port (default: any free one)
Repeat a flag or give a comma list: --state lean,busy.`;

const { values: flags } = parseArgs({
  options: {
    state: { type: "string", multiple: true },
    scheme: { type: "string", multiple: true },
    timeline: { type: "string" },
    firefox: { type: "boolean" },
    both: { type: "boolean" },
    png: { type: "boolean" },
    verbose: { type: "boolean", short: "v" },
    out: { type: "string" },
    dist: { type: "string" },
    port: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
if (flags.help) {
  console.log(HELP);
  process.exit(0);
}

const list = (given, all) =>
  given?.length
    ? given
        .flatMap((v) => v.split(","))
        .map((v) => v.trim())
        .filter(Boolean)
    : all;
const states = list(flags.state, Object.keys(STATES));
const schemes = list(flags.scheme, ["light"]);
const browsers = flags.both ? ["chrome", "firefox"] : flags.firefox ? ["firefox"] : ["chrome"];
for (const s of states) if (!STATES[s]) throw new Error(`no state "${s}"`);
for (const s of schemes) if (s !== "light" && s !== "dark") throw new Error(`no scheme "${s}"`);
const single = states.length === 1 && schemes.length === 1 && browsers.length === 1;
const toFile = flags.out?.endsWith(".pdf");
if (toFile && !single) throw new Error("--out names a .pdf only for one state, scheme and browser");
const outDir = path.resolve(toFile ? path.dirname(flags.out) : (flags.out ?? DEFAULT_OUT));

/** How far down a page's area (inside its top and bottom margins) its text reaches, 0 to 1. */
const POINTS_PER_CM = 72 / 2.54;
const used = (page) =>
  page.bottom === undefined
    ? 0
    : (page.bottom - PAGE.top * POINTS_PER_CM) /
      (page.height - (PAGE.top + PAGE.bottom) * POINTS_PER_CM);

async function printOne(page, { state, scheme, browser, origin }) {
  await page.scheme(scheme);
  // Laid out at the page's width, so a block's height is about what it prints at.
  await page.viewport(Math.round(PAGE_AREA.width), 900);
  await openState(page, origin, state, { timeline: flags.timeline });
  await sleep(100);
  const blocks = await page.eval(`(${readBlocks})(${JSON.stringify({ selectors: BLOCKS })})`);
  await page.viewport(1200, 900);
  await sleep(100);
  const pdf = await page.pdf();
  const file = toFile
    ? path.resolve(flags.out)
    : path.join(outDir, `${state}-${browser}-${scheme}.pdf`);
  await fsp.writeFile(file, pdf);
  const pages = pdfPages(pdf);
  const placed = placeBlocks(blocks, pages);
  const { counts, failed } = summarise(placed);
  const tally = Object.entries(counts)
    .map(([k, n]) => `${n} ${k}`)
    .join(" · ");
  console.log(
    `${state} ${browser} ${scheme}: ${pages.length} pages · ${tally} · page 1 text to ` +
      `${Math.round(used(pages[0] ?? {}) * 100)} % · ${file}`,
  );
  const show = (b) =>
    `    ${b.verdict.padEnd(9)} ${b.kind.padEnd(11)} p${b.where.join(",")}  h=${b.height}  ${b.label}`;
  if (flags.verbose) {
    pages.forEach((p, i) => {
      const t = p.text.replace(/\s+/g, " ").trim();
      console.log(
        `  p${i + 1}: text to ${Math.round(used(p) * 100)} %  "${t.slice(0, 60)}" … "${t.slice(-50)}"`,
      );
    });
    for (const b of placed) console.log(show(b));
  } else {
    for (const b of placed.filter((b) => b.verdict !== "whole")) console.log(show(b));
  }
  if (flags.png) {
    const pngs = rasterise(file, file.replace(/\.pdf$/, ""));
    if (pngs.length)
      console.log(`  ${pngs.length} pages as PNG: ${pngs[0].replace(/-p1\.png$/, "-p*.png")}`);
    else console.log("  --png needs macOS (PDFKit through osascript)");
  }
  return failed.length;
}

const app = await serve({ dist: flags.dist, port: flags.port ? Number(flags.port) : 0 });
await fsp.mkdir(outDir, { recursive: true });
let failures = 0;
try {
  for (const browser of browsers) {
    // Firefox fixes its colour scheme when it starts: one start per scheme.
    for (const sessionSchemes of browser === "firefox" ? schemes.map((s) => [s]) : [schemes]) {
      const b =
        browser === "firefox" ? await firefox({ scheme: sessionSchemes[0] }) : await chrome();
      try {
        const page = await b.page();
        for (const state of states) {
          for (const scheme of sessionSchemes) {
            failures += await printOne(page, { state, scheme, browser, origin: app.origin });
          }
        }
      } finally {
        await b.close();
      }
    }
  }
} finally {
  await app.close();
}
if (failures) {
  console.log(`${failures} block(s) split or unmatched`);
  process.exitCode = 1;
}
