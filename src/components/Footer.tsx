export const REPO_URL = "https://github.com/ralton-dev/sourdough-planner";
export const KOFI_URL = "https://ko-fi.com/bralton";

// Plain links only. Ko-fi's widget would load third-party script on every
// page view; a link keeps the bundle self-contained and visitors untracked.
export function Footer() {
  return (
    <footer className="footer">
      <p>
        Percentages are of total flour, starter included. Bulk times are a guide; the dough decides.
      </p>
      <p className="footer-links">
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
          Everything you enter stays in this browser. Nothing is sent to a server, and there are no
          accounts, cookies or analytics. The site is served through Cloudflare, which sees your IP
          address as any web host does. The two links above go to GitHub and Ko-fi, whose own
          privacy policies apply there.
        </p>
      </details>
    </footer>
  );
}
