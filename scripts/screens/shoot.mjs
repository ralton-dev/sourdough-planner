// Screenshots of the app in a seeded state, at a width and in a colour scheme: the whole page and
// each card on its own. See README.md in this folder for the flags; `--help` lists them.
import fsp from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  BEACON_TARGETS,
  DEFAULT_OUT,
  GUIDE_QUIET,
  VIEWS,
  cardRects,
  openState,
  serve,
} from "./app.mjs";
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
  --guide <g>          show the guide: tour:<n>, hint:<card>, show:<card>, beacons, beacon:<target>
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
    guide: { type: "string" },
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
const guide = parseGuide(flags.guide);

/**
 * `--guide`: what the guide shows in the shot, and what `sourdough.v1.guide` is seeded with for
 * it (left out, `GUIDE_QUIET`: no tour, no beacons). A popover (`tour`, `hint`, `show`, `beacon`)
 * is opened afresh for each width and scheme and shot as the screen shows it, not the whole page;
 * `beacons` shoots the whole page with the dots on it.
 */
function parseGuide(value) {
  if (!value) return undefined;
  const [kind, arg = ""] = value.split(":");
  const all = { seen: true, dismissed: [] };
  if (kind === "tour") {
    const step = Number(arg || 1);
    if (!Number.isInteger(step) || step < 1)
      throw new Error("--guide tour:<n> takes a step from 1");
    // A first visit: the walkthrough not seen, no beacon dismissed.
    return { kind, step, seed: { seen: false, dismissed: [] }, popover: true };
  }
  if (kind === "hint" || kind === "show") {
    if (!/^[a-z]+$/.test(arg)) throw new Error(`--guide ${kind}:<card>, as items or timeline`);
    // A returning visitor taps the ?: no tour in the way, no dot under the dim.
    return { kind, card: arg, seed: GUIDE_QUIET, popover: true };
  }
  if (kind === "beacons") return { kind, seed: all, popover: false };
  if (kind === "beacon") {
    if (!BEACON_TARGETS.includes(arg))
      throw new Error(`--guide beacon:<target>, one of ${BEACON_TARGETS.join(", ")}`);
    return { kind, target: arg, seed: all, popover: true };
  }
  throw new Error(`--guide: tour:<n>, hint:<card>, show:<card>, beacons or beacon:<target>`);
}

/** Waits up to `ms` for `selector`; true when it came. */
const waitFor = (page, selector, ms = 3000) =>
  page.eval(`new Promise((resolve) => {
    const end = Date.now() + ${ms};
    const tick = () => document.querySelector(${JSON.stringify(selector)}) ? resolve(true)
      : Date.now() > end ? resolve(false) : setTimeout(tick, 25);
    tick();
  })`);

/** Clicks the first element matching `selector`; false when there is none. */
const click = (page, selector) =>
  page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el) el.click();
    return !!el;
  })()`);

/** Opens what `--guide` asks for on the page as it is; throws saying why it could not. */
async function openGuide(page) {
  const popover = ".driver-popover";
  if (guide.kind === "tour") {
    // The first-run tour starts itself once the app mounts it (C2); else the footer's button.
    if (!(await waitFor(page, popover, 2000)) && (await click(page, ".guide-around"))) {
      await waitFor(page, popover);
    }
    if (!(await waitFor(page, popover, 100))) {
      throw new Error("the tour did not start: nothing mounts firstRun() or Show me around here");
    }
    for (let i = 1; i < guide.step; i++) {
      if (!(await click(page, `${popover} .driver-popover-next-btn`))) {
        throw new Error(`the tour has fewer than ${guide.step} steps on this page`);
      }
      await sleep(350);
    }
  } else if (guide.kind === "hint" || guide.kind === "show") {
    const q = `[data-guide="${guide.card}"] .guide-q`;
    if (!(await click(page, q))) throw new Error(`no ? on a card [data-guide="${guide.card}"]`);
    if (!(await waitFor(page, popover))) throw new Error(`the ${guide.card} hint did not open`);
    if (guide.kind === "show") {
      await sleep(200);
      if (!(await click(page, `${popover} .guide-show`))) {
        throw new Error(`the ${guide.card} hint has no "show me" for what is on this page`);
      }
    }
  } else {
    const dot =
      guide.kind === "beacon" ? `.guide-beacon[data-beacon="${guide.target}"]` : ".guide-beacon";
    const there = await waitFor(page, dot, guide.kind === "beacon" ? 3000 : 1000);
    if (!there && guide.kind === "beacon") {
      throw new Error(`no beacon ${guide.target} on this page (mounted? its control shown?)`);
    }
    // The dots on the page: none is right where none of their controls is shown.
    const dots = await page.eval(
      `[...document.querySelectorAll(".guide-beacon")].map((b) => b.dataset.beacon)`,
    );
    console.log(`beacons: ${dots.length ? dots.join(", ") : "none"}`);
    if (guide.kind === "beacon") {
      await click(page, dot);
      if (!(await waitFor(page, popover)))
        throw new Error(`the ${guide.target} beacon did not open`);
    }
  }
  await sleep(450); // driver.js scrolls and fades in
}

/** Where the open popover sits: in the screen or not, and how much of what it lights it covers. */
const popoverFacts = (page) =>
  page.eval(`(() => {
    const d = document.documentElement;
    const p = document.querySelector(".driver-popover")?.getBoundingClientRect();
    const l = document.querySelector(".driver-active-element")?.getBoundingClientRect();
    const across = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const down = (a, b) => Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const seen = l && { top: Math.max(0, l.top), bottom: Math.min(innerHeight, l.bottom), left: l.left, right: l.right };
    const area = seen ? (seen.right - seen.left) * Math.max(0, seen.bottom - seen.top) : 0;
    return {
      overflow: d.scrollWidth - d.clientWidth,
      inside: !!p && p.left >= 0 && p.right <= innerWidth && p.top >= 0 && p.bottom <= innerHeight,
      covers: p && area ? Math.round((100 * across(p, seen) * down(p, seen)) / area) : 0,
      title: document.querySelector(".driver-popover-title")?.textContent ?? "",
    };
  })()`);

/** A guide popover as the screen shows it: one viewport, a phone's height under 600 px. */
async function shootGuide(page, { width, stem }) {
  const facts = await popoverFacts(page);
  await fsp.writeFile(`${stem}.png`, await page.screenshot());
  console.log(
    `${stem}.png  "${facts.title}"  popover ${facts.inside ? "in the screen" : "OUTSIDE the screen"}, covers ${facts.covers}% of what it lights (as seen)  overflow ${facts.overflow} px  ${width} px`,
  );
}

const guideHeight = (width) => (width < 600 ? 844 : 900);

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
          const opening = {
            view,
            timeline: flags.timeline,
            open: flags.open,
            ...(guide && { guide: guide.seed }),
          };
          await openState(page, app.origin, state, opening);
          const opened = flags.open && view === "presets" ? `-${slug(flags.open)}` : "";
          const shown = guide ? `-guide-${flags.guide.replace(/[^a-z0-9]+/gi, "-")}` : "";
          for (const scheme of sessionSchemes) {
            await page.scheme(scheme);
            for (const width of widths) {
              const name = `${state}-${view}${opened}-${width}-${scheme}${shown}`;
              const tag = browserName === "chrome" ? "" : `-${browserName}`;
              if (guide?.popover) {
                // Opened at this size, on a fresh page: driver.js places it for the screen it has.
                await page.viewport(width, guideHeight(width));
                await openState(page, app.origin, state, opening);
                await openGuide(page);
                await shootGuide(page, { width, stem: path.join(out, `${name}${tag}`) });
                shots++;
              } else if (flags.text) {
                await page.viewport(width, 900);
                await text(page, { view, label: `${name}${tag}` });
              } else {
                if (guide) await openGuide(page);
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
