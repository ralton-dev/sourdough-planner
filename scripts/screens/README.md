# scripts/screens

See the app in a given state without writing a driver: screenshots at any width and scheme, and
print-to-PDF with a check that nothing that must print whole is split across pages. Plain Node
(22+, its global `WebSocket`), no dependencies beyond `npm ci`: each run builds the working tree
with vite into a scratch folder, serves it with `server/index.mjs` on a free port, drives headless
Chrome over the DevTools protocol or headless Firefox over WebDriver BiDi, seeds `localStorage`
with a state, and stops everything when it is done.

```
npm run screens -- --state busy --width 390 --scheme light --out /tmp/shots
npm run screens:print -- --state busy --both --png --out /tmp/print
```

Needs Google Chrome (and Firefox for `--firefox`/`--both`): the macOS apps, else `google-chrome`,
`chromium` or `firefox` on the `PATH`, else `$CHROME` / `$FIREFOX`.

## Screenshots: `shoot.mjs` (`npm run screens`)

Every flag can repeat or take a comma list; left out, a flag takes every value in parentheses.

- `--state <name>`: which fixture to open (`lean`, `ben`, `roll`, `b`, `b3`, `busy`, `stress`).
- `--width <px>`: viewport width (1200, 390); a width under 600 is shot as a phone.
- `--scheme <s>`: `prefers-color-scheme` (light, dark).
- `--view <v>`: `plan` (default), `kitchen` (the overlay, its whole scroll) or `presets`.
- `--timeline <v>`: the Timeline card's view, `order` or `dough` (default: the app's own choice).
- `--open <name>`: on the presets view, open the dough or preset of that name.
- `--card <slug>`: on the plan view, crop only these cards (`ingredients`, `division`, `timeline`,
  `items`, `batch`, `notes`, `saved-plans`), or `none` (default: every card shown).
- `--text`: print each card's text to the terminal instead of taking pictures (1200, light).
- `--firefox`: Firefox instead of Chrome (one start per scheme: its scheme is a preference).
- `--out <dir>`: where the PNGs go (default: `$TMPDIR/sourdough-screens`).
- `--dist <dir>`: serve this build instead of building the working tree (to compare two builds).
- `--port <n>`: serve on this port (default: any free one).

Files are `<state>-<view>-<width>-<scheme>.png` (the whole page) and, on the plan view,
`<state>-plan-<width>-<scheme>-<card>.png`; Firefox's end in `-firefox`. Each line printed gives
the page's height and how far anything overflows the viewport sideways (0 px is right).

## Print: `print.mjs` (`npm run screens:print`)

- `--state <name>`: as above (default: every state).
- `--scheme <s>`: the screen's scheme while printing (default light; dark checks the print palette).
- `--timeline <v>`: print the Timeline card In order (`order`) or By dough (`dough`).
- `--firefox`: print in Firefox instead of Chrome; `--both`: in each.
- `--png`: also every page as a PNG beside the PDF (`<pdf>-p1.png` …; macOS: PDFKit via osascript).
- `--verbose`: list every block checked and what each page holds.
- `--out <path>`: a `.pdf` for one state, scheme and browser; else a folder (PDFs are named
  `<state>-<browser>-<scheme>.pdf`).
- `--dist <dir>`, `--port <n>`: as above.

Each PDF gets one line: its pages, its blocks by verdict, and how far down page 1 its text reaches.
The check (`printcheck.mjs`) reads, with the print rules switched on in the page, every `.step`,
`.lane`, `.track`, `.piece`, `.section`, `.subsection`, `.mix`, `.callout`, `.window`, `.folds`,
`.note-own`, `.card-footer` and `.card`, and looks for each one's text, as letters and digits, on a
single page of the PDF (`pdftext.mjs`). Verdicts: `whole`; `breaks` (its print rules let it span
pages: `break-inside: auto`); `tall` (taller than a page, so it must); `split` (it should not have);
`unmatched` (its text is on no page, so the check cannot vouch for it). Any `split` or `unmatched`
is listed and the script exits 1. `node scripts/screens/pdftext.mjs <file.pdf>` prints a PDF's
text page by page.

## Adding a state

Add an entry to `STATES` in `states.mjs`: `plan` (a `Plan` as `src/lib/types.ts` has it; start from
the `plan()` helper there), and `doughs` or `presets` only to replace a library (left out, the
app's defaults load), plus a line of `about`. Each key is written to `localStorage` as
`sourdough.v1.<key>` before the app loads, so a value the app's validators refuse (`isPlan`,
`isDoughList` in `src/lib/storage.ts`) is ignored and the app falls back to its defaults; check the
first screenshot. Times are local to Europe/London, the browsers run en-GB.
