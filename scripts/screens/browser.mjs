// Headless Chrome over the DevTools protocol and headless Firefox over WebDriver BiDi, each behind
// the same small page API, in plain Node (its global WebSocket; no dependencies). Each browser
// gets a scratch profile and a port of its own choosing, both gone when it closes.
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The page's clock and language: the fixtures' times are local times in London, en-GB. */
const TIME_ZONE = "Europe/London";
const LOCALE = "en-GB";

/**
 * The printed page in centimetres: A4 with the app's `@page` margins (12 mm 14 mm, src/styles.css;
 * keep the two in step). Chrome reads them from the page; Firefox is told them.
 */
export const PAGE = { width: 21, height: 29.7, top: 1.2, bottom: 1.2, left: 1.4, right: 1.4 };

const WHERE = {
  chrome: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ],
  firefox: ["/Applications/Firefox.app/Contents/MacOS/firefox", "firefox"],
};

/** The browser's executable: $CHROME or $FIREFOX, else the macOS app, else one on the PATH. */
function executable(kind) {
  const env = process.env[kind.toUpperCase()];
  for (const name of [env, ...WHERE[kind]]) {
    if (!name) continue;
    const found = name.includes("/")
      ? [name]
      : (process.env.PATH ?? "").split(path.delimiter).map((dir) => path.join(dir, name));
    const hit = found.find((f) => fs.existsSync(f));
    if (hit) return hit;
  }
  throw new Error(`${kind} not found: set ${kind.toUpperCase()} to its executable`);
}

/** Polls for a file the browser writes once it listens, and returns its text. */
async function waitForFile(file, proc, what) {
  for (let i = 0; i < 300; i++) {
    if (proc.exitCode !== null) throw new Error(`${what} exited with code ${proc.exitCode}`);
    try {
      const text = await fsp.readFile(file, "utf8");
      if (text.trim()) return text;
    } catch {
      // Not written yet.
    }
    await sleep(100);
  }
  throw new Error(`${what} did not start within 30 s`);
}

/** Requests and replies by id over a WebSocket; anything else is an event for the listeners. */
class Connection {
  static async open(url) {
    for (let i = 0; ; i++) {
      try {
        const ws = new WebSocket(url);
        await new Promise((resolve, reject) => {
          ws.addEventListener("open", resolve, { once: true });
          ws.addEventListener("error", () => reject(new Error(`cannot connect to ${url}`)), {
            once: true,
          });
        });
        return new Connection(ws);
      } catch (err) {
        if (i >= 50) throw err;
        await sleep(100);
      }
    }
  }

  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (ev) => this.receive(JSON.parse(String(ev.data))));
    ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new Error(`${p.method}: connection closed`));
      this.pending.clear();
    });
  }

  receive(msg) {
    const p = msg.id === undefined ? undefined : this.pending.get(msg.id);
    if (p) {
      this.pending.delete(msg.id);
      // DevTools: { error: { code, message } }; BiDi: { type: "error", error, message }.
      if (msg.error) {
        const why =
          typeof msg.error === "string" ? `${msg.error}: ${msg.message}` : msg.error.message;
        p.reject(new Error(`${p.method}: ${why}`));
      } else p.resolve(msg.result);
    } else if (msg.method) {
      for (const listener of [...this.listeners]) listener(msg);
    }
  }

  send(method, params = {}, extra = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...extra }));
    });
  }

  /** The next event that `match` accepts. */
  event(match, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const listener = (msg) => {
        if (!match(msg)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(msg);
      };
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error("timed out waiting for the page"));
      }, timeout);
      this.listeners.add(listener);
    });
  }

  close() {
    this.ws.close();
  }
}

/**
 * Wraps an expression so both protocols hand back plain JSON: its value, awaited, through
 * JSON.stringify in the page.
 */
const asJson = (expression) =>
  `(async () => { const v = await (${expression}); return v === undefined ? "null" : JSON.stringify(v); })()`;

async function stop(proc, profile) {
  if (proc.exitCode === null) {
    const exited = new Promise((resolve) => proc.once("exit", resolve));
    proc.kill("SIGTERM");
    await Promise.race([exited, sleep(3000)]);
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }
  await fsp.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Headless Chrome. `scheme` can change per page at any time. */
export async function chrome() {
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), "screens-chrome-"));
  const proc = spawn(
    executable("chrome"),
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--mute-audio",
      `--lang=${LOCALE}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const [port, wsPath] = (
    await waitForFile(path.join(profile, "DevToolsActivePort"), proc, "Chrome")
  ).split("\n");
  const cdp = await Connection.open(`ws://127.0.0.1:${port}${wsPath}`);

  async function page() {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, { sessionId });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setTimezoneOverride", { timezoneId: TIME_ZONE });
    await send("Emulation.setLocaleOverride", { locale: LOCALE });
    return {
      browser: "chrome",
      async goto(url) {
        const loaded = cdp.event(
          (m) => m.method === "Page.loadEventFired" && m.sessionId === sessionId,
        );
        await send("Page.navigate", { url });
        await loaded;
      },
      async eval(expression) {
        const r = await send("Runtime.evaluate", {
          expression: asJson(expression),
          awaitPromise: true,
          returnByValue: true,
        });
        if (r.exceptionDetails) {
          const d = r.exceptionDetails;
          throw new Error(`in the page: ${d.exception?.description ?? d.text}`);
        }
        return JSON.parse(r.result.value);
      },
      async viewport(width, height) {
        await send("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: width < 600,
        });
      },
      async scheme(value) {
        await send("Emulation.setEmulatedMedia", {
          media: "",
          features: [{ name: "prefers-color-scheme", value }],
        });
      },
      /** A PNG of the viewport, or of `clip` ({ x, y, width, height } in page pixels). */
      async screenshot(clip) {
        const r = await send("Page.captureScreenshot", {
          format: "png",
          ...(clip && { clip: { ...clip, scale: 1 } }),
        });
        return Buffer.from(r.data, "base64");
      },
      /** The page printed as the app asks (`@page`: A4, its margins), backgrounds off. */
      async pdf() {
        const r = await send("Page.printToPDF", {
          printBackground: false,
          preferCSSPageSize: true,
          displayHeaderFooter: false,
        });
        return Buffer.from(r.data, "base64");
      },
    };
  }

  return {
    name: "chrome",
    page,
    async close() {
      try {
        await cdp.send("Browser.close");
      } catch {
        // Already gone.
      }
      cdp.close();
      await stop(proc, profile);
    },
  };
}

/**
 * Headless Firefox. Its colour scheme is a preference, so it is fixed when it starts: start one
 * per scheme. Time zone from the environment, language from the profile.
 */
export async function firefox({ scheme = "light" } = {}) {
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), "screens-firefox-"));
  const prefs = {
    "browser.shell.checkDefaultBrowser": false,
    "browser.aboutwelcome.enabled": false,
    "datareporting.policy.dataSubmissionEnabled": false,
    "toolkit.telemetry.reportingpolicy.firstRun": false,
    "intl.locale.requested": LOCALE,
    "intl.accept_languages": LOCALE,
    "intl.regional_prefs.use_os_locales": false,
    // 0 dark, 1 light: what `prefers-color-scheme` reports to pages.
    "layout.css.prefers-color-scheme.content-override": scheme === "dark" ? 0 : 1,
  };
  await fsp.writeFile(
    path.join(profile, "user.js"),
    Object.entries(prefs)
      .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});\n`)
      .join(""),
  );
  const proc = spawn(
    executable("firefox"),
    ["--headless", "--no-remote", "--profile", profile, "--remote-debugging-port", "0"],
    { stdio: "ignore", env: { ...process.env, TZ: TIME_ZONE, MOZ_HEADLESS: "1" } },
  );
  const server = JSON.parse(
    await waitForFile(path.join(profile, "WebDriverBiDiServer.json"), proc, "Firefox"),
  );
  const bidi = await Connection.open(`ws://${server.ws_host}:${server.ws_port}/session`);
  await bidi.send("session.new", { capabilities: {} });

  async function page() {
    const { context } = await bidi.send("browsingContext.create", { type: "tab" });
    const target = { context };
    // Newer Firefoxes emulate these per page; the profile and TZ above cover older ones.
    await bidi
      .send("emulation.setTimezoneOverride", { timezone: TIME_ZONE, contexts: [context] })
      .catch(() => {});
    await bidi
      .send("emulation.setLocaleOverride", { locale: LOCALE, contexts: [context] })
      .catch(() => {});
    return {
      browser: "firefox",
      async goto(url) {
        await bidi.send("browsingContext.navigate", { context, url, wait: "complete" });
      },
      async eval(expression) {
        const r = await bidi.send("script.evaluate", {
          expression: asJson(expression),
          target,
          awaitPromise: true,
          resultOwnership: "none",
        });
        if (r.type === "exception") {
          throw new Error(`in the page: ${r.exceptionDetails?.text ?? JSON.stringify(r)}`);
        }
        return JSON.parse(r.result.value);
      },
      async viewport(width, height) {
        await bidi.send("browsingContext.setViewport", {
          context,
          viewport: { width, height },
          devicePixelRatio: 1,
        });
      },
      async scheme(value) {
        if (value !== scheme)
          throw new Error(`this Firefox was started for ${scheme}, not ${value}`);
      },
      async screenshot(clip) {
        const r = await bidi.send("browsingContext.captureScreenshot", {
          context,
          origin: "viewport",
          ...(clip && { clip: { type: "box", ...clip } }),
        });
        return Buffer.from(r.data, "base64");
      },
      async pdf() {
        const r = await bidi.send("browsingContext.print", {
          context,
          background: false,
          shrinkToFit: false,
          orientation: "portrait",
          page: { width: PAGE.width, height: PAGE.height },
          margin: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.left, right: PAGE.right },
        });
        return Buffer.from(r.data, "base64");
      },
    };
  }

  return {
    name: "firefox",
    scheme,
    page,
    async close() {
      try {
        await bidi.send("session.end");
      } catch {
        // Already gone.
      }
      bidi.close();
      await stop(proc, profile);
    },
  };
}
