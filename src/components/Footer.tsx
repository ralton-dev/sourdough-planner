import type { ReactNode } from "react";

export const REPO_URL = "https://github.com/ralton-dev/sourdough-planner";
export const KOFI_URL = "https://ko-fi.com/bralton";

/** Accounts off on this server, on and signed out, or on and signed in (`GET /api/me`). */
export type AccountMode = "off" | "out" | "in";

const ELSEWHERE =
  "The site is served through Cloudflare, which sees your IP address as any web host does. The two links above go to GitHub and Ko-fi, whose own privacy policies apply there.";

/** What is kept where, in each mode (decision 37): the sentence switches, it is never dropped. */
const PRIVACY: Record<AccountMode, string> = {
  off: "Everything you enter stays in this browser. The page asks the server once whether accounts are on; nothing you enter is sent, and there are no accounts, cookies or analytics.",
  out: "Signed out, everything stays in this browser, and there are no cookies or analytics. Signing in keeps your presets, doughs and plans on this server under your account, with one cookie that keeps you signed in.",
  in: "Signed in, your presets, doughs and plans are stored on this server under your account so every device sees them, with the name and email your sign-in service gives and one cookie that keeps you signed in. Nothing else is collected.",
};

// Plain links only. Ko-fi's widget would load third-party script on every
// page view; a link keeps the bundle self-contained and visitors untracked.
export function Footer({ account = "off", guide }: { account?: AccountMode; guide?: ReactNode }) {
  return (
    <footer className="footer">
      <p>
        Percentages are of total flour, starter included. Bulk times are a guide; the dough decides.
      </p>
      <p className="footer-links">
        {guide}
        {guide && <span aria-hidden="true">·</span>}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          Host it yourself
        </a>
        <span aria-hidden="true">·</span>
        <a href={KOFI_URL} target="_blank" rel="noopener noreferrer">
          Buy me a coffee
        </a>
      </p>
      <details className="footer-privacy">
        <summary>Privacy</summary>
        <p>
          {PRIVACY[account]} {ELSEWHERE}
        </p>
      </details>
    </footer>
  );
}
