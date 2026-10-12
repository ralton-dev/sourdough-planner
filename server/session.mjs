// The session cookie, in one place for login (auth.mjs) and the state API (state.mjs).
// `sdp_session` carries `<id>.<HMAC-SHA256(id, SESSION_SECRET), base64url>`, so a forged id is
// rejected before the database is asked (§3). Flags are decision 39's; Secure follows APP_URL.
import { createHmac, timingSafeEqual } from "node:crypto";
import { appendSetCookie, parseCookies, serializeCookie } from "./router.mjs";

export const SESSION_COOKIE = "sdp_session";
/** The short-lived login cookie (state, nonce, PKCE verifier) that auth.mjs sets; 10 minutes. */
export const LOGIN_COOKIE = "sdp_login";
export const LOGIN_COOKIE_SECONDS = 10 * 60;

const mac = (id, secret) => createHmac("sha256", secret).update(id).digest("base64url");

export function signSessionId(id, secret) {
  return `${id}.${mac(id, secret)}`;
}

/** The session id when the signature is good, else null. Constant-time compare. */
export function verifySessionId(signed, secret) {
  if (typeof signed !== "string") return null;
  const dot = signed.lastIndexOf(".");
  if (dot < 1) return null;
  const id = signed.slice(0, dot);
  const given = Buffer.from(signed.slice(dot + 1));
  const expected = Buffer.from(mac(id, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}

/**
 * The signed-in `{ session, user }` for this request, or null (no cookie, bad signature, unknown
 * or expired session, or accounts off). Slides the session (store.touchSession); when `res` is
 * given it also re-sets the cookie so the browser's copy slides with it.
 */
export function readSession(req, { config, store, res }) {
  if (!config.accounts || !store) return null;
  const signed = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const id = verifySessionId(signed, config.accounts.sessionSecret);
  if (!id) return null;
  const found = store.touchSession(id);
  if (found && res) setSessionCookie(res, signed, config);
  return found;
}

/** Path=/, HttpOnly, SameSite=Lax, Max-Age = SESSION_DAYS, Secure when APP_URL is https. */
export function setSessionCookie(res, signedId, config) {
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE, signedId, {
      maxAge: config.accounts.sessionDays * 24 * 60 * 60,
      secure: config.accounts.secureCookies,
    }),
  );
}

export function clearSessionCookie(res, config) {
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure: config.accounts?.secureCookies }),
  );
}
