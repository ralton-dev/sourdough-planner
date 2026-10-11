// Screenshots of the app in a seeded state, at a width and in a colour scheme: the whole page and
// each card on its own. See README.md in this folder for the flags; `--help` lists them.
import fsp from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_OUT, VIEWS, cardRects, openState, serve } from "./app.mjs";
import { chrome, firefox, sleep } from "./browser.mjs";
import { STATES } from "./states.mjs";

const HELP = `node scripts/screens/shoot.mjs [flags]   (npm run screens -- [flags])
  --state <name>       ${Object.keys(STATES).join(", ")} (default: all)
  --width <px>         viewport width (default: 1200 and 390)
  --scheme <s>         light or dark (default: both)
  --view <v>           plan, kitchen or presets (default: plan)
  --timeline <v>       the Timeline card's view: order or dough (default: the app's)
  --open <name>        presets view: open the preset or dough whose header names it
  --card <slug>        plan view: crop only these cards, or none (default: every card)
  --text               print each card's text instead of taking pictures
  --firefox            use Firefox (WebDriver BiDi) instead of Chrome
  --out <dir>          where the PNGs go (default: ${DEFAULT_OUT})
  --dist <dir>         serve this build instead of building the working tree
  --port <n>           serve on this port (default: any free one)
Repeat a flag or give a comma list: --width 1200,390.`;

const { values: flags } = parseArgs({
  options: {
    state: { type: "string", multiple: true },
    width: { type: "string", multiple: true },
    scheme: { type: "string", multiple: true },
    view: { type: "string", multiple: true },
    timeline: { type: "string" },
    open: { type: "string" },
    card: { type: "string", multiple: true },
    text: { type: "boolean" },
    firefox: { type: "boolean" },
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
// Text does not change with the scheme, and a width is enough for it unless asked for more.
const widths = list(flags.width, flags.text ? ["1200"] : ["1200", "390"]).map(Number);
const schemes = list(flags.scheme, flags.text ? ["light"] : ["light", "dark"]);
const views = list(flags.view, ["plan"]);
const cards = list(flags.card, ["all"]);
const out = path.resolve(flags.out ?? DEFAULT_OUT);
for (const s of states) if (!STATES[s]) throw new Error(`no state "${s}"`);
for (const v of views) if (!VIEWS.includes(v)) throw new Error(`no view "${v}"`);
for (const s of schemes) if (s !== "light" && s !== "dark") throw new Error(`no scheme "${s}"`);
if (widths.some((w) => !Number.isInteger(w) || w < 200)) throw new Error("--width takes pixels");

/** The page's height, the kitchen overlay's when it is open, and how far anything overflows. */
const measure = (page, view) =>
  page.eval(`(() => {
    const k = ${view === "kitchen"} && document.querySelector(".kitchen");
    const d = document.documentElement;
    return k
      ? { height: k.scrollHeight, overflow: k.scrollWidth - k.clientWidth }
      : { height: Math.max(d.scrollHeight, document.body.scrollHeight), overflow: d.scrollWidth - d.clientWidth };
  })()`);

async function shoot(page, { view, width, stem }) {
  await page.viewport(width, 900);
  await sleep(150);
  const { height, overflow } = await measure(page, view);
  // The viewport grown to the page, so one capture holds all of it.
  await page.viewport(width, Math.ceil(height));
  await sleep(150);
  await fsp.writeFile(`${stem}.png`, await page.screenshot());
  const cropped = [];
  if (view === "plan" && !cards.includes("none")) {
    for (const c of await cardRects(page)) {
      if (!cards.includes("all") && !cards.includes(c.slug)) continue;
      const pad = 6;
      const x = Math.max(0, Math.floor(c.x - pad));
      const y = Math.max(0, Math.floor(c.y - pad));
      const clip = {
        x,
        y,
        width: Math.min(width - x, Math.ceil(c.width + 2 * pad)),
        height: Math.min(Math.ceil(height) - y, Math.ceil(c.height + 2 * pad)),
      };
      await fsp.writeFile(`${stem}-${c.slug}.png`, await page.screenshot(clip));
      cropped.push(c.slug);
    }
  }
  const crops = cropped.length ? ` + ${cropped.join(", ")}` : "";
  console.log(`${stem}.png  ${width}×${Math.ceil(height)}  overflow ${overflow} px${crops}`);
}

async function text(page, { view, label }) {
  const body = await page.eval(
    view === "kitchen"
      ? `document.querySelector(".kitchen").innerText`
      : `[...document.querySelectorAll("section.card")]
          .filter((c) => c.getClientRects().length)
          .map((c) => "=== " + (c.querySelector(":scope > header h2")?.textContent ?? "?") + " ===\\n" + c.innerText)
          .join("\\n\\n")`,
  );
  console.log(`##### ${label}\n${body}\n`);
}

const app = await serve({ dist: flags.dist, port: flags.port ? Number(flags.port) : 0 });
await fsp.mkdir(out, { recursive: true });
const browserName = flags.firefox ? "firefox" : "chrome";
// Chrome switches scheme per page; Firefox fixes it at start, so it starts once per scheme.
const sessions = flags.firefox ? schemes.map((s) => [s]) : [schemes];
let shots = 0;
try {
  for (const sessionSchemes of sessions) {
    const browser = flags.firefox ? await firefox({ scheme: sessionSchemes[0] }) : await chrome();
    try {
      const page = await browser.page();
      for (const state of states) {
        for (const view of views) {
          await page.viewport(widths[0], 900);
          await openState(page, app.origin, state, {
            view,
            timeline: flags.timeline,
            open: flags.open,
          });
          const opened = flags.open && view === "presets" ? `-${slug(flags.open)}` : "";
          for (const scheme of sessionSchemes) {
            await page.scheme(scheme);
            for (const width of widths) {
              const name = `${state}-${view}${opened}-${width}-${scheme}`;
              const tag = browserName === "chrome" ? "" : `-${browserName}`;
              if (flags.text) {
                await page.viewport(width, 900);
                await text(page, { view, label: `${name}${tag}` });
              } else {
                await shoot(page, { view, width, stem: path.join(out, `${name}${tag}`) });
                shots++;
              }
            }
          }
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await app.close();
}
if (shots) console.log(`${shots} pages shot in ${browserName}, in ${out}`);

function slug(s) {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
