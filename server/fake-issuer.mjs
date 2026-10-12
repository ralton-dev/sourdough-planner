// A fake OIDC issuer on 127.0.0.1, for the tests and the local walk (PLAN-accounts §3, P2). Never
// shipped: .dockerignore keeps it out of the image. Dependency-free (node:crypto signs RS256).
//
// It answers everything a real issuer would for the Authorization Code + PKCE flow, and nothing
// else is checked beyond what catches a misconfigured app: the client id and secret, the
// redirect_uri, the PKCE verifier, a code used once.
//
//   discovery  <issuer>.well-known/openid-configuration
//   JWKS       <issuer>jwks             (one RSA key; rotateKeys() replaces it)
//   authorize  <issuer>authorize        (redirects straight back with code + state, or with
//                                        error=access_denied when ?deny=1, setDeny(true) or
//                                        FAKE_ISSUER_DENY=1)
//   token      <issuer>token            (an ID token signed for the code's nonce)
//   userinfo   <issuer>userinfo
//   end-session <issuer>end-session     (redirects to post_logout_redirect_uri)
//
// Standalone: `node server/fake-issuer.mjs [port]` prints the env to start the app against it.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Authentik's shape (a path with a trailing slash), so the app is tested against it. */
const ISSUER_PATH = "/application/o/sdp/";

const b64url = (v) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomBytes(8).toString("hex");
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  return { privateKey, kid, jwk };
}

function signJwt(payload, key) {
  const input = `${b64url({ alg: "RS256", typ: "JWT", kid: key.kid })}.${b64url(payload)}`;
  return `${input}.${sign("sha256", Buffer.from(input), key.privateKey).toString("base64url")}`;
}

async function readForm(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain" : "application/json",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

const redirect = (res, to) => {
  res.writeHead(302, { location: String(to) });
  res.end();
};

/**
 * Starts the issuer. Resolves `{ issuer, url, close, rotateKeys, setDeny, hits }`: `issuer` is the
 * OIDC_ISSUER value (with the trailing slash), `url` the bare origin, `hits` counts requests per
 * endpoint (`hits.jwks` proves a refetch).
 */
export async function startFakeIssuer({
  port = 0,
  host = "127.0.0.1",
  clientId = "sdp-local",
  clientSecret = "sdp-local-secret",
  subject = "fake-user-1",
  email = "baker@example.test",
  name = "Test Baker",
  deny = process.env.FAKE_ISSUER_DENY === "1",
} = {}) {
  let key = newKey();
  let denying = deny;
  const codes = new Map(); // code -> { redirectUri, challenge, nonce, scope }
  const tokens = new Map(); // access token -> claims
  const hits = { discovery: 0, jwks: 0, authorize: 0, token: 0, userinfo: 0, endSession: 0 };
  let issuer = "";

  function clientOk(req, form) {
    let id = form.get("client_id");
    let secret = form.get("client_secret");
    const auth = String(req.headers.authorization ?? "");
    if (auth.startsWith("Basic ")) {
      const [u, p] = Buffer.from(auth.slice(6), "base64").toString("utf8").split(":");
      id = decodeURIComponent(u ?? "");
      secret = decodeURIComponent(p ?? "");
    }
    return id === clientId && secret === clientSecret;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    if (!url.pathname.startsWith(ISSUER_PATH)) return send(res, 404, "not found");
    const route = url.pathname.slice(ISSUER_PATH.length);
    const q = url.searchParams;

    if (req.method === "GET" && route === ".well-known/openid-configuration") {
      hits.discovery++;
      return send(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}authorize`,
        token_endpoint: `${issuer}token`,
        userinfo_endpoint: `${issuer}userinfo`,
        jwks_uri: `${issuer}jwks`,
        end_session_endpoint: `${issuer}end-session`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        scopes_supported: ["openid", "profile", "email"],
        claims_supported: ["iss", "sub", "aud", "exp", "iat", "nonce", "email", "name"],
      });
    }

    if (req.method === "GET" && route === "jwks") {
      hits.jwks++;
      return send(res, 200, { keys: [key.jwk] });
    }

    if (req.method === "GET" && route === "authorize") {
      hits.authorize++;
      const redirectUri = q.get("redirect_uri");
      if (q.get("client_id") !== clientId) return send(res, 400, "unknown client_id");
      if (!redirectUri) return send(res, 400, "redirect_uri missing");
      const back = new URL(redirectUri);
      const state = q.get("state");
      if (denying || q.get("deny") === "1") {
        back.searchParams.set("error", "access_denied");
        back.searchParams.set("error_description", "The user denied the request");
      } else {
        if (q.get("response_type") !== "code") return send(res, 400, "response_type must be code");
        if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) {
          return send(res, 400, "PKCE (S256) required");
        }
        const code = randomBytes(16).toString("base64url");
        codes.set(code, {
          redirectUri,
          challenge: q.get("code_challenge"),
          nonce: q.get("nonce"),
          scope: q.get("scope") ?? "openid",
        });
        back.searchParams.set("code", code);
      }
      if (state !== null) back.searchParams.set("state", state);
      return redirect(res, back);
    }

    if (req.method === "POST" && route === "token") {
      hits.token++;
      const form = await readForm(req);
      if (!clientOk(req, form)) return send(res, 401, { error: "invalid_client" });
      if (form.get("grant_type") !== "authorization_code") {
        return send(res, 400, { error: "unsupported_grant_type" });
      }
      const code = form.get("code") ?? "";
      const grant = codes.get(code);
      codes.delete(code);
      if (!grant || grant.redirectUri !== form.get("redirect_uri")) {
        return send(res, 400, { error: "invalid_grant" });
      }
      const verifier = form.get("code_verifier") ?? "";
      if (createHash("sha256").update(verifier).digest("base64url") !== grant.challenge) {
        return send(res, 400, { error: "invalid_grant", error_description: "PKCE mismatch" });
      }
      const now = Math.floor(Date.now() / 1000);
      const claims = { sub: subject, email, email_verified: true, name };
      const idToken = signJwt(
        {
          iss: issuer,
          aud: clientId,
          iat: now,
          exp: now + 300,
          ...(grant.nonce ? { nonce: grant.nonce } : {}),
          ...claims,
        },
        key,
      );
      const accessToken = randomBytes(24).toString("base64url");
      tokens.set(accessToken, claims);
      return send(res, 200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 300,
        scope: grant.scope,
        id_token: idToken,
      });
    }

    if (req.method === "GET" && route === "userinfo") {
      hits.userinfo++;
      const auth = String(req.headers.authorization ?? "");
      const claims = auth.startsWith("Bearer ") && tokens.get(auth.slice(7));
      if (!claims) return send(res, 401, { error: "invalid_token" });
      return send(res, 200, claims);
    }

    if (req.method === "GET" && route === "end-session") {
      hits.endSession++;
      const to = q.get("post_logout_redirect_uri");
      return to ? redirect(res, to) : send(res, 200, "signed out");
    }

    return send(res, 404, "not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const url = `http://${host}:${server.address().port}`;
  issuer = `${url}${ISSUER_PATH}`;

  return {
    issuer,
    url,
    clientId,
    clientSecret,
    hits,
    /** A new signing key; the old one leaves the JWKS at once (the hard case for a client). */
    rotateKeys() {
      key = newKey();
      return key.kid;
    },
    /** While on, /authorize answers error=access_denied. */
    setDeny(on = true) {
      denying = on;
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.argv[2] ?? "9400", 10);
  const fake = await startFakeIssuer({ port });
  const dataDir = path.join(os.tmpdir(), "sdp-local-data");
  console.log(`fake OIDC issuer at ${fake.issuer}`);
  console.log(
    `signs in as "Test Baker" <baker@example.test>; FAKE_ISSUER_DENY=1 (or ?deny=1 on the authorize URL) answers access_denied.`,
  );
  console.log("\nIn another terminal, after `npm run build`, start the app against it:\n");
  console.log(
    [
      `DATA_DIR=${dataDir}`,
      "APP_URL=http://127.0.0.1:8080",
      `OIDC_ISSUER=${fake.issuer}`,
      `OIDC_CLIENT_ID=${fake.clientId}`,
      `OIDC_CLIENT_SECRET=${fake.clientSecret}`,
      "SESSION_SECRET=insecure-local-only-session-secret-0123456789",
      "node server/index.mjs",
    ].join(" \\\n  "),
  );
  console.log(
    "\nthen open http://127.0.0.1:8080 (not localhost: the cookie is set for APP_URL's host).",
  );
  const stop = () => fake.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
