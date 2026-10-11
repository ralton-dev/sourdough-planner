// The text of each page of a PDF, in plain Node: enough of the format to read what the browsers
// write when they print (Chrome through Skia; Firefox through Quartz on macOS and cairo elsewhere).
// Not a general reader: no encryption, and a font with neither a ToUnicode map nor a standard
// encoding reads as nothing. Usage: node scripts/screens/pdftext.mjs <file.pdf>
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const SPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isRegular = (c) => !SPACE.has(c) && !DELIMS.has(c);

class Ref {
  constructor(num) {
    this.num = num;
  }
}
/** A name, `/Font`, kept apart from strings and keywords. */
class Name {
  constructor(name) {
    this.name = name;
  }
}
/** An operator or keyword in a content stream (`Tj`, `BT`, `obj`, `true`). */
class Op {
  constructor(op) {
    this.op = op;
  }
}

/** Tokens and values of the PDF syntax over a byte buffer. */
class Lexer {
  constructor(buf, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }

  skipSpace() {
    const b = this.buf;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (SPACE.has(c)) this.pos++;
      else if (c === 0x25) {
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  /** The next value (a dict, array, string, name, number, ref or Op), or undefined at the end. */
  value() {
    this.skipSpace();
    const b = this.buf;
    if (this.pos >= b.length) return undefined;
    const c = b[this.pos];
    if (c === 0x2f) return this.name();
    if (c === 0x28) return this.literal();
    if (c === 0x5b) {
      this.pos++;
      const list = [];
      for (;;) {
        this.skipSpace();
        if (this.pos >= b.length) return list;
        if (b[this.pos] === 0x5d) {
          this.pos++;
          return list;
        }
        list.push(this.value());
      }
    }
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        const dict = new Map();
        for (;;) {
          this.skipSpace();
          if (this.pos >= b.length) return dict;
          if (b[this.pos] === 0x3e && b[this.pos + 1] === 0x3e) {
            this.pos += 2;
            return dict;
          }
          const key = this.value();
          dict.set(key instanceof Name ? key.name : String(key), this.value());
        }
      }
      return this.hex();
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      this.pos++;
      return new Op(String.fromCharCode(c));
    }
    let end = this.pos;
    while (end < b.length && isRegular(b[end])) end++;
    const word = b.toString("latin1", this.pos, end);
    this.pos = end;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      const n = Number(word);
      // "12 0 R" is a reference: look ahead without consuming anything else.
      if (/^\d+$/.test(word)) {
        const save = this.pos;
        this.skipSpace();
        const m = /^(\d+)\s+R(?![^\s/<>[\]()%])/.exec(
          b.toString("latin1", this.pos, this.pos + 24),
        );
        if (m) {
          this.pos += m[0].length;
          return new Ref(n);
        }
        this.pos = save;
      }
      return n;
    }
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    return new Op(word);
  }

  name() {
    const b = this.buf;
    let end = this.pos + 1;
    while (end < b.length && isRegular(b[end])) end++;
    const raw = b.toString("latin1", this.pos + 1, end);
    this.pos = end;
    return new Name(
      raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
    );
  }

  /** A literal string, `(…)`, as bytes: escapes undone, nested parentheses kept. */
  literal() {
    const b = this.buf;
    const out = [];
    let depth = 0;
    this.pos++;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 0x5c) {
        const e = b[this.pos++];
        const simple = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };
        if (e in simple) out.push(simple[e]);
        else if (e >= 0x30 && e <= 0x37) {
          let v = e - 0x30;
          for (let i = 0; i < 2 && b[this.pos] >= 0x30 && b[this.pos] <= 0x37; i++) {
            v = v * 8 + (b[this.pos++] - 0x30);
          }
          out.push(v & 0xff);
        } else if (e === 0x0d) {
          if (b[this.pos] === 0x0a) this.pos++;
        } else if (e !== 0x0a) out.push(e);
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        if (depth === 0) break;
        depth--;
        out.push(c);
      } else out.push(c);
    }
    return Buffer.from(out);
  }

  hex() {
    const b = this.buf;
    const end = b.indexOf(0x3e, this.pos);
    const digits = b.toString("latin1", this.pos + 1, end < 0 ? b.length : end).replace(/\s+/g, "");
    this.pos = end < 0 ? b.length : end + 1;
    return Buffer.from(digits.length % 2 ? `${digits}0` : digits, "hex");
  }
}

function inflate(data) {
  try {
    return zlib.inflateSync(data);
  } catch {
    // A stream cut short or with trailing bytes: take what decompresses.
    return zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  }
}

/** Every object in the file, by number, read in file order (a later definition wins). */
class Doc {
  constructor(buf) {
    this.buf = buf;
    this.objects = new Map();
    const text = buf.toString("latin1");
    const head = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = head.exec(text))) {
      const lex = new Lexer(buf, m.index + m[0].length);
      const value = lex.value();
      const entry = { value };
      lex.skipSpace();
      if (value instanceof Map && buf.toString("latin1", lex.pos, lex.pos + 6) === "stream") {
        let start = lex.pos + 6;
        if (buf[start] === 0x0d) start++;
        if (buf[start] === 0x0a) start++;
        const len = value.get("Length");
        const end =
          typeof len === "number" &&
          buf.toString("latin1", start + len, start + len + 12).includes("endstream")
            ? start + len
            : text.indexOf("endstream", start);
        entry.start = start;
        entry.end = end < 0 ? buf.length : end;
        head.lastIndex = entry.end;
      } else {
        head.lastIndex = lex.pos;
      }
      this.objects.set(Number(m[1]), entry);
    }
    // Objects packed into object streams (PDF 1.5), where they are not already plain objects.
    for (const entry of [...this.objects.values()]) {
      const d = entry.value;
      if (!(d instanceof Map) || this.get(d.get("Type"))?.name !== "ObjStm") continue;
      const data = this.stream(entry);
      const lex = new Lexer(data);
      const pairs = [];
      for (let i = 0; i < this.get(d.get("N")); i++) pairs.push([lex.value(), lex.value()]);
      const first = this.get(d.get("First"));
      for (const [num, offset] of pairs) {
        if (!this.objects.has(num)) {
          this.objects.set(num, { value: new Lexer(data, first + offset).value() });
        }
      }
    }
  }

  /** A value with any reference followed. */
  get(v) {
    for (let i = 0; v instanceof Ref && i < 32; i++) v = this.objects.get(v.num)?.value;
    return v;
  }

  /** The object a reference points at, with its stream (if any). */
  entry(v) {
    return v instanceof Ref ? this.objects.get(v.num) : undefined;
  }

  /** A stream's bytes, decoded when it is Flate-compressed (or not compressed). */
  stream(entry) {
    if (!entry || entry.start === undefined) return Buffer.alloc(0);
    const dict = entry.value;
    let end = entry.end;
    const len = this.get(dict.get("Length"));
    if (typeof len === "number" && entry.start + len <= this.buf.length) end = entry.start + len;
    let data = this.buf.subarray(entry.start, end);
    const filter = this.get(dict.get("Filter"));
    const filters = (Array.isArray(filter) ? filter : filter ? [filter] : []).map(
      (f) => this.get(f).name,
    );
    for (const f of filters) {
      if (f === "FlateDecode" || f === "Fl") data = inflate(data);
      else return Buffer.alloc(0);
    }
    return data;
  }

  /** The pages in order, each with the attributes it inherits from the page tree. */
  pages() {
    const catalog = [...this.objects.values()]
      .map((e) => e.value)
      .filter((v) => v instanceof Map && this.get(v.get("Type"))?.name === "Catalog")
      .pop();
    const out = [];
    const walk = (node, inherited, depth) => {
      const d = this.get(node);
      if (!(d instanceof Map) || depth > 64) return;
      const attrs = { ...inherited };
      for (const k of ["Resources", "MediaBox"]) if (d.has(k)) attrs[k] = this.get(d.get(k));
      const kids = this.get(d.get("Kids"));
      if (Array.isArray(kids)) for (const k of kids) walk(k, attrs, depth + 1);
      else out.push({ dict: d, ...attrs });
    };
    if (catalog) walk(catalog.get("Pages"), {}, 0);
    return out;
  }
}

/** Glyph names a /Differences array may use, for the letters and digits that matter here. */
const GLYPHS = {
  space: " ",
  hyphen: "-",
  period: ".",
  comma: ",",
  colon: ":",
  endash: "–",
  emdash: "—",
  bullet: "•",
  periodcentered: "·",
  multiply: "×",
  degree: "°",
  percent: "%",
  fi: "fi",
  fl: "fl",
  ff: "ff",
  ffi: "ffi",
  ffl: "ffl",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};
const LATIN = {
  grave: "̀",
  acute: "́",
  circumflex: "̂",
  tilde: "̃",
  dieresis: "̈",
  ring: "̊",
  cedilla: "̧",
};
function glyphToText(name) {
  if (name in GLYPHS) return GLYPHS[name];
  if (/^[A-Za-z]$/.test(name)) return name;
  let m = /^uni([0-9A-Fa-f]{4})+$/.exec(name);
  if (m) {
    const hex = name.slice(3);
    let s = "";
    for (let i = 0; i < hex.length; i += 4)
      s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return s;
  }
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  // eacute, Ntilde, ccedilla...: a letter and an accent.
  m = /^([A-Za-z])(grave|acute|circumflex|tilde|dieresis|ring|cedilla)$/.exec(name);
  if (m) return (m[1] + LATIN[m[2]]).normalize("NFC");
  return "";
}

/** ToUnicode: source codes (with their byte length) to text. */
function parseCMap(data) {
  const text = data.toString("latin1");
  const map = new Map();
  const lengths = new Set();
  const utf16 = (hex) => Buffer.from(hex, "hex").swap16().toString("utf16le");
  const key = (hex) => `${hex.length / 2}:${parseInt(hex, 16)}`;
  for (const block of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>/g)) lengths.add(m[1].length / 2);
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      map.set(key(m[1]), m[2].length % 4 === 0 ? utf16(m[2]) : "");
      lengths.add(m[1].length / 2);
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g;
    for (const m of block[1].matchAll(re)) {
      const bytes = m[1].length / 2;
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      lengths.add(bytes);
      if (m[3] !== undefined) {
        // Consecutive codes: the destination's last unit counts up with them.
        const units = Buffer.from(m[3], "hex").swap16();
        for (let c = lo; c <= hi && c - lo < 65536; c++) {
          const u = Buffer.from(units);
          if (u.length >= 2) u.writeUInt16LE(u.readUInt16LE(u.length - 2) + (c - lo), u.length - 2);
          map.set(`${bytes}:${c}`, u.toString("utf16le"));
        }
      } else {
        const dests = [...m[4].matchAll(/<([0-9a-fA-F]*)>/g)].map((d) => utf16(d[1]));
        dests.forEach((d, i) => map.set(`${bytes}:${lo + i}`, d));
      }
    }
  }
  return { map, lengths: [...lengths].sort((a, b) => b - a) };
}

const DECODERS = {
  WinAnsiEncoding: new TextDecoder("windows-1252"),
  MacRomanEncoding: new TextDecoder("macintosh"),
};

/** A function from a shown string's bytes to text, for one font. */
function fontDecoder(doc, fontRef, cache) {
  const entryKey = fontRef instanceof Ref ? fontRef.num : fontRef;
  if (cache.has(entryKey)) return cache.get(entryKey);
  const font = doc.get(fontRef);
  let decode = () => "";
  if (font instanceof Map) {
    const subtype = doc.get(font.get("Subtype"))?.name;
    const toUnicode = doc.entry(font.get("ToUnicode"));
    const cmap = toUnicode ? parseCMap(doc.stream(toUnicode)) : undefined;
    if (subtype === "Type0") {
      // Identity-H and kin: two-byte codes, read through the ToUnicode map.
      decode = (bytes) => {
        let s = "";
        for (let i = 0; i + 1 < bytes.length; i += 2)
          s += cmap?.map.get(`2:${bytes.readUInt16BE(i)}`) ?? "";
        return s;
      };
    } else {
      const enc = doc.get(font.get("Encoding"));
      const base = enc instanceof Name ? enc.name : doc.get(enc?.get?.("BaseEncoding"))?.name;
      const diffs = new Map();
      const list = enc instanceof Map ? doc.get(enc.get("Differences")) : undefined;
      if (Array.isArray(list)) {
        let code = 0;
        for (const item of list) {
          if (typeof item === "number") code = item;
          else if (item instanceof Name) diffs.set(code++, glyphToText(item.name));
        }
      }
      const decoder = DECODERS[base];
      decode = (bytes) => {
        let s = "";
        for (const b of bytes) {
          const mapped = cmap?.map.get(`1:${b}`);
          if (mapped !== undefined) s += mapped;
          else if (diffs.has(b)) s += diffs.get(b);
          else if (decoder) s += decoder.decode(Uint8Array.of(b));
          else if (!cmap && b >= 0x20 && b < 0x7f) s += String.fromCharCode(b);
        }
        return s;
      };
    }
  }
  cache.set(entryKey, decode);
  return decode;
}

const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const IDENTITY = [1, 0, 0, 1, 0, 0];

/**
 * Runs a content stream for its text: the strings shown, in the order they are drawn, a newline
 * where the text moves to a new line, and the lowest and highest baselines (page units, y up).
 */
function runContent(doc, data, resources, ctm, out, fonts, depth = 0) {
  const lex = new Lexer(data);
  const stack = [];
  const saved = [];
  const actual = [];
  let tm = IDENTITY;
  let tlm = IDENTITY;
  let leading = 0;
  let decode = () => "";
  let lastY;
  const fontDict = doc.get(resources?.get?.("Font"));
  const xobjects = doc.get(resources?.get?.("XObject"));
  const show = (bytes) => {
    if (!(bytes instanceof Buffer)) return;
    const y = mul(tm, ctm)[5];
    if (lastY !== undefined && Math.abs(y - lastY) > 1) out.text += "\n";
    lastY = y;
    out.minY = Math.min(out.minY, y);
    out.maxY = Math.max(out.maxY, y);
    if (!actual.some((a) => a !== null)) out.text += decode(bytes);
  };
  const newLine = (tx, ty) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };
  for (;;) {
    const v = lex.value();
    if (v === undefined) break;
    if (!(v instanceof Op)) {
      stack.push(v);
      continue;
    }
    const args = stack.splice(0);
    const n = (i) => (typeof args[i] === "number" ? args[i] : 0);
    switch (v.op) {
      case "q":
        saved.push(ctm);
        break;
      case "Q":
        ctm = saved.pop() ?? ctm;
        break;
      case "cm":
        ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], ctm);
        break;
      case "BT":
        tm = tlm = IDENTITY;
        break;
      case "Tf": {
        const ref =
          fontDict instanceof Map && args[0] instanceof Name
            ? fontDict.get(args[0].name)
            : undefined;
        decode = ref ? fontDecoder(doc, ref, fonts) : () => "";
        break;
      }
      case "TL":
        leading = n(0);
        break;
      case "Td":
        newLine(n(0), n(1));
        break;
      case "TD":
        leading = -n(1);
        newLine(n(0), n(1));
        break;
      case "Tm":
        tm = tlm = [n(0), n(1), n(2), n(3), n(4), n(5)];
        break;
      case "T*":
        newLine(0, -leading);
        break;
      case "Tj":
        show(args[0]);
        break;
      case "'":
        newLine(0, -leading);
        show(args[0]);
        break;
      case '"':
        newLine(0, -leading);
        show(args[2]);
        break;
      case "TJ":
        if (Array.isArray(args[0])) for (const part of args[0]) show(part);
        break;
      case "BMC":
        actual.push(null);
        break;
      case "BDC": {
        // Marked content may carry the text it stands for (/ActualText): that, not its glyphs.
        const props = args[1] instanceof Map ? args[1] : undefined;
        const text = props?.get("ActualText");
        if (text instanceof Buffer) {
          out.text +=
            text[0] === 0xfe && text[1] === 0xff
              ? Buffer.from(text.subarray(2)).swap16().toString("utf16le")
              : text.toString("latin1");
        }
        actual.push(text instanceof Buffer ? text : null);
        break;
      }
      case "EMC":
        actual.pop();
        break;
      case "Do": {
        const ref =
          xobjects instanceof Map && args[0] instanceof Name
            ? xobjects.get(args[0].name)
            : undefined;
        const entry = doc.entry(ref);
        const dict = entry?.value;
        if (dict instanceof Map && doc.get(dict.get("Subtype"))?.name === "Form" && depth < 12) {
          const matrix = doc.get(dict.get("Matrix"));
          const m = Array.isArray(matrix) && matrix.length === 6 ? matrix.map(Number) : IDENTITY;
          const res = doc.get(dict.get("Resources")) ?? resources;
          runContent(doc, doc.stream(entry), res, mul(m, ctm), out, fonts, depth + 1);
          lastY = undefined;
        }
        break;
      }
      case "BI": {
        // An inline image: skip its bytes, from ID to the EI that ends them.
        const at = data.indexOf("ID", lex.pos, "latin1");
        let end = at < 0 ? data.length : at + 3;
        while (end < data.length) {
          const e = data.indexOf("EI", end, "latin1");
          if (e < 0) {
            end = data.length;
            break;
          }
          end = e + 2;
          if (SPACE.has(data[e - 1]) && (e + 2 >= data.length || SPACE.has(data[e + 2]))) break;
        }
        lex.pos = end;
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Each page's text in drawing order, with where its text runs: `top` and `bottom` are the highest
 * and lowest baselines in points from the top of the page, `height` the page's.
 */
export function pdfPages(buf) {
  const doc = new Doc(buf);
  const fonts = new Map();
  return doc.pages().map((page) => {
    const box = Array.isArray(page.MediaBox)
      ? page.MediaBox.map((v) => Number(doc.get(v)))
      : [0, 0, 595, 842];
    const height = box[3] - box[1];
    const contents = doc.get(page.dict.get("Contents"));
    const refs = Array.isArray(contents) ? contents : [page.dict.get("Contents")];
    const data = Buffer.concat(refs.flatMap((r) => [doc.stream(doc.entry(r)), Buffer.from("\n")]));
    const out = { text: "", minY: Infinity, maxY: -Infinity };
    runContent(doc, data, page.Resources, IDENTITY, out, fonts);
    return {
      text: out.text,
      height,
      top: out.maxY === -Infinity ? undefined : box[3] - out.maxY,
      bottom: out.minY === Infinity ? undefined : box[3] - out.minY,
    };
  });
}

/** Letters and digits only, lower case, ligatures unfolded: text as two renderings can agree on. */
export const skeleton = (s) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/screens/pdftext.mjs <file.pdf>");
    process.exit(2);
  }
  pdfPages(fs.readFileSync(file)).forEach((p, i) => {
    console.log(
      `--- page ${i + 1} (text from ${p.top?.toFixed(0)} to ${p.bottom?.toFixed(0)} of ${p.height.toFixed(0)} pt)`,
    );
    console.log(p.text);
  });
}
