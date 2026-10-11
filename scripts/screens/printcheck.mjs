// The print check: every block that must print whole (a step, a lane, a track, a piece, a section,
// a sub-section, a callout, a card...) is found whole on one page of the PDF. The page says what
// each block's printed text is and whether its print rules keep it whole; the PDF says what each
// page holds; text is compared as letters and digits only, so line breaks, spacing, emoji and
// ligatures do not matter.
import { execFileSync } from "node:child_process";
import { PAGE } from "./browser.mjs";
import { skeleton } from "./pdftext.mjs";

/** What the check looks at: the plan's atomic blocks and the containers that hold them. */
export const BLOCKS = [
  ".step",
  ".lane",
  ".track",
  ".piece",
  ".subsection",
  ".section",
  ".mix",
  ".callout",
  ".window",
  ".folds",
  ".note-own",
  ".card-footer",
  ".card",
];

/** The page area in CSS pixels (96 to the inch): the page less its margins. */
const PX_PER_CM = 96 / 2.54;
export const PAGE_AREA = {
  width: (PAGE.width - PAGE.left - PAGE.right) * PX_PER_CM,
  height: (PAGE.height - PAGE.top - PAGE.bottom) * PX_PER_CM,
};

/**
 * Runs in the page (stringified). Switches the print rules on and the screen-only ones off in
 * every stylesheet, reads each block, then puts the rules back. A block's text is what prints:
 * text nodes and form values, nothing under display: none. It is cut into runs where the browser
 * draws out of document order (positioned, floated or composited descendants are drawn after the
 * rest), so each run can be looked for on a page as one string.
 */
export function readBlocks({ selectors }) {
  const flips = [];
  const flip = (media) => {
    const queries = [...media].map((q) => q.trim());
    const next = queries
      .filter((q) => !/\bscreen\b/.test(q) || /\bprint\b/.test(q))
      .map((q) => q.replace(/\bprint\b/g, "all"));
    const text = next.length ? next.join(", ") : "not all";
    if (text !== media.mediaText) {
      flips.push([media, media.mediaText]);
      media.mediaText = text;
    }
  };
  const walkRules = (rules) => {
    for (const rule of rules) {
      if (rule.media && rule.cssRules) flip(rule.media);
      if (rule.cssRules) walkRules(rule.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    if (sheet.media.length) flip(sheet.media);
    walkRules(sheet.cssRules);
  }
  try {
    const skel = (s) =>
      s
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "");
    const noText = new Set(["checkbox", "radio", "hidden", "file", "range", "color", "image"]);
    const apart = (cs) =>
      cs.position !== "static" ||
      cs.float !== "none" ||
      cs.opacity !== "1" ||
      cs.transform !== "none" ||
      cs.filter !== "none";
    const runsOf = (root) => {
      const runs = [""];
      const walk = (node, isRoot) => {
        if (node.nodeType === Node.TEXT_NODE) {
          if (getComputedStyle(node.parentElement).visibility === "visible") {
            runs[runs.length - 1] += node.data;
          }
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const cs = getComputedStyle(node);
        if (cs.display === "none") return;
        const own = !isRoot && apart(cs);
        if (own) runs.push("");
        const tag = node.tagName;
        if (tag === "INPUT") {
          if (!noText.has(node.type)) runs[runs.length - 1] += node.value;
        } else if (tag === "TEXTAREA") runs[runs.length - 1] += node.value;
        else if (tag === "SELECT") runs[runs.length - 1] += node.selectedOptions[0]?.text ?? "";
        else if (!["SCRIPT", "STYLE", "TEMPLATE"].includes(tag)) {
          for (const child of node.childNodes) walk(child, false);
        }
        if (own) runs.push("");
      };
      walk(root, true);
      return runs.map(skel).filter(Boolean);
    };
    const out = [];
    for (const el of document.querySelectorAll(selectors.join(","))) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      // An inline element is part of a line, not a block (an inline-block, a piece, is one).
      if (cs.display === "inline") continue;
      const runs = runsOf(el);
      if (!runs.length) continue;
      const kind = selectors.find((s) => el.matches(s)).slice(1);
      const label = el.innerText.replace(/\s+/g, " ").trim().slice(0, 70);
      out.push({
        kind,
        label,
        runs,
        height: Math.round(el.getBoundingClientRect().height),
        keep: cs.breakInside === "avoid" || cs.pageBreakInside === "avoid",
      });
    }
    return out;
  } finally {
    for (const [media, text] of flips.reverse()) media.mediaText = text;
  }
}

/**
 * Where each block landed. `whole`: every run of it on one page. A block its rules let break
 * (`breaks`: break-inside auto) or too tall for a page (`tall`) may span pages; any other is
 * `split`, or `unmatched` when some of its text is on no page and across no page break, which the
 * check cannot vouch for either way.
 */
export function placeBlocks(blocks, pages, { pageHeight = PAGE_AREA.height } = {}) {
  const skels = pages.map((p) => skeleton(p.text));
  const all = skels.join("");
  const starts = skels.map((_, i) => skels.slice(0, i).reduce((n, s) => n + s.length, 0));
  const pageAt = (offset) => starts.findLastIndex((s) => s <= offset) + 1;
  return blocks.map((b) => {
    const pagesOf = b.runs.map((r) => {
      const on = skels.flatMap((s, i) => (s.includes(r) ? [i + 1] : []));
      if (on.length) return on;
      const at = all.indexOf(r);
      return at < 0 ? [] : [`${pageAt(at)}–${pageAt(at + r.length - 1)}`];
    });
    const common = skels.map((_, i) => i + 1).filter((p) => pagesOf.every((on) => on.includes(p)));
    let verdict = "whole";
    if (!common.length) {
      if (!b.keep) verdict = "breaks";
      else if (b.height > pageHeight) verdict = "tall";
      else if (pagesOf.some((on) => !on.length)) verdict = "unmatched";
      else verdict = "split";
    }
    const where = pagesOf.map((on) => (on.length ? on.join("/") : "?"));
    return { ...b, verdict, page: common[0], where };
  });
}

/** Counts by verdict, and the blocks that fail (split or unmatched). */
export function summarise(placed) {
  const counts = {};
  for (const b of placed) counts[b.verdict] = (counts[b.verdict] ?? 0) + 1;
  const failed = placed.filter((b) => b.verdict === "split" || b.verdict === "unmatched");
  return { counts, failed };
}

/** Each page of a PDF as a PNG at `scale` (2 is 1190 × 1684), with macOS's PDFKit (osascript). */
export function rasterise(pdf, stem, scale = 2) {
  if (process.platform !== "darwin") return [];
  const script = `
    ObjC.import("Quartz");
    ObjC.import("AppKit");
    function run(argv) {
      const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
      if (doc.isNil()) throw new Error("cannot open " + argv[0]);
      const files = [];
      for (let i = 0; i < doc.pageCount; i++) {
        const page = doc.pageAtIndex(i);
        const box = page.boundsForBox(0);
        const size = $.NSMakeSize(box.size.width * Number(argv[2]), box.size.height * Number(argv[2]));
        const image = page.thumbnailOfSizeForBox(size, 0);
        const rep = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
        const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
        const file = argv[1] + "-p" + (i + 1) + ".png";
        png.writeToFileAtomically(file, true);
        files.push(file);
      }
      return files.join("\\n");
    }`;
  return execFileSync("osascript", ["-l", "JavaScript", "-e", script, pdf, stem, String(scale)])
    .toString()
    .trim()
    .split("\n");
}
