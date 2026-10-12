// Login, logout and /api/me (decision 39, §3): the server is the OIDC client (BFF). It redirects
// to the issuer, takes the callback, keeps the session server-side and sets one cookie. ID and
// access tokens never reach the browser and are dropped after the callback; only the claims
// `iss`, `sub`, `email` and `name` are kept. Nothing here logs: no token or claim is ever printed.
//
// Contract with index.mjs: authRoutes({ config, store }) => Array<{ method, path, handler }>,
// called once, accounts on or off (`config.accounts` null when off; `store` then null too).
//
// Routes, accounts off:
//   GET  /api/me        200 { enabled: false }, cache-control max-age=3600 (the one request the
//                       local-only app makes; /auth/* is not mounted, so index.mjs answers 404)
// Routes, accounts on:
//   GET  /api/me        200 { enabled: true, user: { name, email } } signed in (either may be
//                       null), { enabled: true } not; no-store; slides the session
//   GET  /auth/login    302 to the issuer; sets sdp_login (state, nonce, PKCE verifier, signed)
//                       502 { error } when the issuer cannot be discovered
//   GET  /auth/callback 303 to / with sdp_session set, sdp_login cleared
//                       303 to /?signin=denied on error=access_denied, /?signin=error on any
//                       other error the issuer sends back
//                       400 { error } on a missing login cookie or a state that does not match
//                       502 { error } when the code exchange or the ID token fails
//   POST /auth/logout   303 to the issuer's end_session_endpoint with post_logout_redirect_uri
//                       = APP_URL/ (and client_id) when it publishes one, else to /. Takes any
//                       body (a plain HTML form POST); always deletes the session and the cookie.
import * as oidc from "openid-client";
import { appendSetCookie, json, parseCookies, serializeCookie } from "./router.mjs";
import {
  LOGIN_COOKIE,
  LOGIN_COOKIE_SECONDS,
  SESSION_COOKIE,
  clearSessionCookie,
  readSession,
  setSessionCookie,
  signSessionId,
  verifySessionId,
} from "./session.mjs";

/** Discovery and token requests give up after this many seconds (openid-client's default is 30). */
const ISSUER_TIMEOUT_SECONDS = 10;
const SCOPE = "openid profile email";
/** sdp_login lives only where it is read. */
const LOGIN_COOKIE_PATH = "/auth";

function redirect(res, status, location) {
  res.writeHead(status, { location, "cache-control": "no-store" });
  res.end();
}

/**
 * The issuer's Configuration, discovered on first need and kept; a failed discovery is not kept,
 * so the next request tries again. `reset()` drops it (after a failed exchange: the issuer may
 * have rotated its keys or changed its metadata, and a fresh Configuration refetches both).
 */
function lazyDiscovery(accounts) {
  let pending = null;
  const issuerUrl = new URL(accounts.issuer);
  const options = {
    timeout: ISSUER_TIMEOUT_SECONDS,
    // openid-client refuses plain http unless told; loopbackOnly() has already refused it
    // anywhere but this machine.
    execute: issuerUrl.protocol === "http:" ? [oidc.allowInsecureRequests] : [],
  };
  return {
    get() {
      if (!pending) {
        pending = oidc
          .discovery(issuerUrl, accounts.clientId, accounts.clientSecret, undefined, options)
          .catch((err) => {
            pending = null;
            throw err;
          });
      }
      return pending;
    },
    reset() {
      pending = null;
    },
  };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The ID token arrives in the token endpoint's response and openid-client trusts that response's
 * TLS rather than checking the token's signature (OIDC Core 3.1.3.7; it uses the JWKS only with
 * enableNonRepudiationChecks, which is deliberately off: a key rotation or an HS256 issuer cannot
 * break sign-in). So a plain-http issuer would make the claims unauthenticated: allowed only on
 * this machine (the fake issuer, a local walk). This belongs in index.mjs's readConfig.
 */
function loopbackOnly(issuer) {
  const u = new URL(issuer);
  if (u.protocol === "http:" && !LOOPBACK.has(u.hostname) && !u.hostname.startsWith("127.")) {
    throw new Error(
      `OIDC_ISSUER must be https; plain http is accepted only on localhost or 127.0.0.1, got ${u.origin}`,
    );
  }
}

// The login cookie: base64url(JSON) signed with the session secret's HMAC (session.mjs's
// signer; base64url has no ".", which the signed form splits on). This private pair belongs in
// session.mjs beside signSessionId (as signLoginCookie / readLoginCookie).
function sealLogin(value, secret) {
  return signSessionId(Buffer.from(JSON.stringify(value)).toString("base64url"), secret);
}

function openLogin(sealed, secret) {
  const payload = verifySessionId(sealed, secret);
  if (!payload) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof v?.state === "string" &&
      typeof v.nonce === "string" &&
      typeof v.verifier === "string"
      ? v
      : null;
  } catch {
    return null;
  }
}

function setLoginCookie(res, value, accounts) {
  appendSetCookie(
    res,
    serializeCookie(LOGIN_COOKIE, value, {
      maxAge: value ? LOGIN_COOKIE_SECONDS : 0,
      path: LOGIN_COOKIE_PATH,
      secure: accounts.secureCookies,
    }),
  );
}

export function authRoutes({ config, store }) {
  const accounts = config.accounts;
  if (!accounts) {
    return [
      {
        method: "GET",
        path: "/api/me",
        handler: async (_req, res) =>
          json(res, 200, { enabled: false }, { "cache-control": "max-age=3600" }),
      },
    ];
  }

  loopbackOnly(accounts.issuer);
  const issuer = lazyDiscovery(accounts);
  const redirectUri = `${accounts.appUrl}/auth/callback`;
  const unreachable = { error: "the sign-in service could not be reached; try again shortly" };

  async function me(req, res) {
    const found = readSession(req, { config, store, res });
    if (!found) return json(res, 200, { enabled: true });
    return json(res, 200, {
      enabled: true,
      user: { name: found.user.name ?? null, email: found.user.email ?? null },
    });
  }

  async function login(_req, res) {
    let oidcConfig;
    try {
      oidcConfig = await issuer.get();
    } catch {
      return json(res, 502, unreachable);
    }
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const verifier = oidc.randomPKCECodeVerifier();
    const target = oidc.buildAuthorizationUrl(oidcConfig, {
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPE,
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    });
    setLoginCookie(res, sealLogin({ state, nonce, verifier }, accounts.sessionSecret), accounts);
    return redirect(res, 302, target.href);
  }

  async function callback(req, res, url) {
    const login = openLogin(parseCookies(req.headers.cookie)[LOGIN_COOKIE], accounts.sessionSecret);
    const error = url.searchParams.get("error");
    if (error) {
      // The issuer said no (the user cancelled, or a policy refused them). Nothing to exchange.
      setLoginCookie(res, "", accounts);
      return redirect(res, 303, error === "access_denied" ? "/?signin=denied" : "/?signin=error");
    }
    if (!login)
      return json(res, 400, { error: "sign-in expired or was not started here; try again" });
    if (url.searchParams.get("state") !== login.state) {
      return json(res, 400, { error: "sign-in state does not match; try again" });
    }

    let claims;
    try {
      const oidcConfig = await issuer.get();
      // The URL the issuer redirected to, on the public origin: openid-client sends it (without
      // the query) as redirect_uri, which must equal the one /auth/login sent.
      const current = new URL(`/auth/callback${url.search}`, accounts.appUrl);
      const tokens = await oidc.authorizationCodeGrant(oidcConfig, current, {
        pkceCodeVerifier: login.verifier,
        expectedState: login.state,
        expectedNonce: login.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims();
    } catch {
      // Down, timed out, refused the code, or an ID token that fails its claim checks: drop the
      // cached Configuration so the next attempt rediscovers (the issuer may have moved its
      // endpoints) rather than repeating against stale metadata.
      issuer.reset();
      return json(res, 502, { error: "sign-in could not be completed with the issuer; try again" });
    }
    if (!claims?.iss || !claims.sub) {
      return json(res, 502, { error: "the issuer's ID token has no subject" });
    }

    const user = store.upsertUser({
      issuer: claims.iss,
      subject: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      name:
        typeof claims.name === "string"
          ? claims.name
          : typeof claims.preferred_username === "string"
            ? claims.preferred_username
            : null,
    });
    // A new id on every sign-in (no fixation); a session this browser already had goes.
    const old = verifySessionId(
      parseCookies(req.headers.cookie)[SESSION_COOKIE],
      accounts.sessionSecret,
    );
    if (old) store.deleteSession(old);
    const session = store.createSession(user.id);
    setSessionCookie(res, signSessionId(session.id, accounts.sessionSecret), config);
    setLoginCookie(res, "", accounts);
    return redirect(res, 303, "/");
  }

  async function logout(req, res) {
    req.resume(); // any form body is ignored
    const id = verifySessionId(
      parseCookies(req.headers.cookie)[SESSION_COOKIE],
      accounts.sessionSecret,
    );
    if (id) store.deleteSession(id);
    clearSessionCookie(res, config);
    let to = "/";
    try {
      const oidcConfig = await issuer.get();
      if (oidcConfig.serverMetadata().end_session_endpoint) {
        to = oidc.buildEndSessionUrl(oidcConfig, {
          post_logout_redirect_uri: `${accounts.appUrl}/`,
        }).href;
      }
    } catch {
      // The issuer is unreachable: the local session is gone, which is what signing out means here.
    }
    return redirect(res, 303, to);
  }

  return [
    { method: "GET", path: "/api/me", handler: me },
    { method: "GET", path: "/auth/login", handler: login },
    { method: "GET", path: "/auth/callback", handler: callback },
    { method: "POST", path: "/auth/logout", handler: logout },
  ];
}
