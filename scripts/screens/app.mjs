// The app as the scripts see it: built from this checkout (or a build you name), served by
// server/index.mjs on a port of its own, and opened on a state seeded through localStorage.
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../server/index.mjs";
import { STATES } from "./states.mjs";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Where the scripts write when no --out is given. */
export const DEFAULT_OUT = path.join(os.tmpdir(), "sourdough-screens");

/**
 * Serves `dist`, or a fresh production build of the working tree in a scratch folder (vite's own
 * build, as `npm run build`, without the source maps). `port` 0 takes any free port.
 */
export async function serve({ dist, port = 0 } = {}) {
  let dir = dist && path.resolve(dist);
  let scratch;
  if (!dir) {
    scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "screens-dist-"));
    const { build } = await import("vite");
    await build({
      root: ROOT,
      configFile: path.join(ROOT, "vite.config.ts"),
      logLevel: "warn",
      build: { outDir: scratch, emptyOutDir: true, sourcemap: false },
    });
    dir = scratch;
  }
  const { server, loadIndex } = createApp({
    port,
    host: "127.0.0.1",
    version: "screens",
    staticDir: dir,
    logRequests: false,
  });
  await loadIndex();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}/`,
    dir,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      if (scratch) await fsp.rm(scratch, { recursive: true, force: true });
    },
  };
}

export const VIEWS = ["plan", "kitchen", "presets"];

/** The beacons the app draws (`BEACONS` in src/guide/copy.ts), by target. */
export const BEACON_TARGETS = ["items.addins", "timeline.view", "doughs.tangzhong"];

/**
 * `sourdough.v1.guide` as every state is seeded unless a shot asks for the guide: the walkthrough
 * seen and every beacon dismissed, so no picture or print has a tour or a dot in it by accident.
 */
export const GUIDE_QUIET = { seen: true, dismissed: BEACON_TARGETS };

/** Waits until `selector` matches in the page. */
const until = (page, selector) =>
  page.eval(`new Promise((resolve, reject) => {
    const end = Date.now() + 15000;
    const tick = () => document.querySelector(${JSON.stringify(selector)}) ? resolve(true)
      : Date.now() > end ? reject(new Error("no " + ${JSON.stringify(selector)})) : setTimeout(tick, 25);
    tick();
  })`);

/** Clicks the top bar's button with this label. */
const nav = (page, label) =>
  page.eval(`(() => {
    const b = [...document.querySelectorAll(".nav button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    if (!b) throw new Error("no " + ${JSON.stringify(label)} + " button");
    b.click();
    return true;
  })()`);

/**
 * Opens the app on a state: storage cleared and seeded, the page loaded, fonts in, then the view
 * (`plan`, `kitchen` or `presets`). `timeline` ("order" or "dough") seeds the Timeline card's view;
 * `open` (presets) opens the library entry whose header names it; `guide` is what the guide has
 * seen (default `GUIDE_QUIET`).
 */
export async function openState(
  page,
  origin,
  name,
  { view = "plan", timeline, open, guide = GUIDE_QUIET } = {},
) {
  const state = STATES[name];
  if (!state) throw new Error(`no state "${name}": ${Object.keys(STATES).join(", ")}`);
  if (!VIEWS.includes(view)) throw new Error(`no view "${view}": ${VIEWS.join(", ")}`);
  const stored = { plan: state.plan };
  if (state.doughs) stored.doughs = state.doughs;
  if (state.presets) stored.presets = state.presets;
  if (timeline) stored.timelineView = timeline;
  stored.guide = guide;
  await page.goto(origin);
  await page.eval(`(() => {
    localStorage.clear();
    for (const [k, v] of Object.entries(${JSON.stringify(stored)})) {
      localStorage.setItem("sourdough.v1." + k, JSON.stringify(v));
    }
    return true;
  })()`);
  await page.goto(origin);
  await until(page, ".card");
  await page.eval("document.fonts.ready.then(() => true)");
  if (view === "kitchen") {
    await nav(page, "Kitchen");
    await until(page, ".kitchen");
  } else if (view === "presets") {
    await nav(page, "Presets");
    await until(page, ".presets-card");
    if (open) {
      // By the entry's name (its <strong>), a dough's before a preset's that only mentions it.
      const found = await page.eval(`(() => {
        const want = ${JSON.stringify(open)};
        const buttons = [...document.querySelectorAll(".preset-card > header > button")];
        const name = (b) => (b.querySelector("strong")?.textContent ?? "").trim();
        const b = buttons.find((b) => name(b).endsWith(want)) ?? buttons.find((b) => name(b).includes(want));
        if (b) b.click();
        return !!b;
      })()`);
      if (!found) throw new Error(`no preset or dough is named "${open}"`);
    }
  }
  await page.eval(
    "new Promise((resolve) => requestAnimationFrame(() => setTimeout(() => resolve(true), 50)))",
  );
}

/** The plan page's cards by their heading, as file-name slugs, with where each one is. */
export const cardRects = (page) =>
  page.eval(`[...document.querySelectorAll("section.card")].flatMap((c) => {
    const title = c.querySelector(":scope > header h2")?.textContent.trim();
    const r = c.getBoundingClientRect();
    if (!title || r.height === 0) return [];
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return [{ title, slug, x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }];
  })`);
