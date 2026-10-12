// The account in the top bar (PLAN-accounts §4): nothing with accounts off, "Sign in" signed out,
// and signed in the name with a dot for where sync stands, opening a small panel with the status
// sentence and "Sign out". Plain elements only: `<details>` opens it from the keyboard, the
// sign-in is a link and the sign-out a form, so neither needs script to work.
import { useEffect, useRef } from "react";
import { displayName, type Me, type SyncStatus } from "../sync/logic";

interface Props {
  /** `GET /api/me`; null while it is on its way (nothing is drawn, so nothing flickers). */
  me: Me | null;
  status: SyncStatus;
  /** The status sentence, for the dot's tooltip and the panel. */
  line: string;
}

export function AccountMenu({ me, status, line }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);

  // An open panel closes on Escape or a click elsewhere, as a menu does.
  useEffect(() => {
    const close = (e: Event) => {
      const el = menu.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        el.open = false;
        el.querySelector("summary")?.focus();
      } else if (!el.contains(e.target as Node)) {
        el.open = false;
      }
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  if (!me?.enabled) return null;

  if (!me.user) {
    return (
      <div className="account no-print" data-guide="account">
        <a className="account-signin" href="/auth/login">
          Sign in
        </a>
      </div>
    );
  }

  const name = displayName(me.user);
  return (
    <details className="account no-print" data-guide="account" ref={menu}>
      <summary className="account-button" title={line} aria-label={`${name}: ${line}`}>
        <span className={`sync-dot sync-${status.kind}`} title={line} aria-hidden="true" />
        <span className="account-initial" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="account-name">{name}</span>
        <span className="account-caret" aria-hidden="true" />
      </summary>
      <div className="account-panel">
        {me.user.email && me.user.email !== name && <p className="account-who">{me.user.email}</p>}
        <p className="account-status" role="status">
          {line}
        </p>
        {status.kind === "signin" && (
          <a className="btn primary" href="/auth/login">
            Sign in again
          </a>
        )}
        <form method="post" action="/auth/logout">
          <button type="submit" className="btn">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
