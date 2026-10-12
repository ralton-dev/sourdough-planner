// GET and PUT /api/state (decision 43): one document per user, the export bundle, with an
// optimistic version so a push made from a stale copy is refused (409), never stored.
//
//   GET  /api/state  401 no session · 204 nothing stored · 200 { version, updatedAt, bundle }
//   PUT  /api/state  body { baseVersion, bundle }, Content-Type: application/json
//                    401 no session · 415 wrong content type · 413 body above 1 MiB
//                    400 not JSON, bad baseVersion, or not a bundle (isBundleShape)
//                    200 { version, updatedAt } when baseVersion is the stored version (0: none)
//                    409 { version, updatedAt, bundle } otherwise: the stored document, unchanged
//
// Every answer is `cache-control: no-store` (router.json's default; 204 and 401 set it here too).
// CSRF: a write must carry `Content-Type: application/json` (readJson answers 415 otherwise). A
// cross-site form can only send form or text types, and a cross-site fetch with JSON needs a CORS
// preflight this server never grants; with the session cookie SameSite=Lax that is the guard.
//
// With accounts off `store` is null and no route is mounted: index.mjs answers /api/state with its
// JSON 404.
import { HttpError, json, readJson } from "./router.mjs";
import { readSession } from "./session.mjs";

/** The largest PUT body, envelope included (decision 43). */
export const STATE_LIMIT_BYTES = 1024 * 1024;

const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isString = (v) => typeof v === "string";
/** Absent is `=== undefined`; present with the wrong type (null included) fails. */
const optional = (v, ok) => v === undefined || ok(v);

/**
 * The structural check, a line-by-line mirror of `isBundleShape` in src/lib/storage.ts (the server
 * cannot import TS; `state.test.mjs` proves both agree on every case in bundle.fixtures.ts):
 *
 *   1. The value is a plain object: not null, not an array.
 *   2. `app` is the string "sourdough-planner".
 *   3. `version` is the number 1, 2 or 3.
 *   4. `presets` is an array, `bulkTable` is an array, `plan` is a plain object.
 *   5. Version 3: `doughs` is an array, `savedPlans` is an array, `ui` is a plain object.
 *   6. Versions 1 and 2: `doughs` and `savedPlans` are each absent or an array; `ui` is absent or a
 *      plain object.
 *   7. `updatedAt` is absent, or a plain object every one of whose values is a string.
 *
 * Nothing else is looked at; content is the client's to judge with `parseBundle`.
 */
export function isBundleShape(v) {
  if (!isRecord(v)) return false; // 1
  if (v.app !== "sourdough-planner") return false; // 2
  if (v.version !== 1 && v.version !== 2 && v.version !== 3) return false; // 3
  if (!Array.isArray(v.presets) || !Array.isArray(v.bulkTable) || !isRecord(v.plan)) return false; // 4
  const v3 = v.version === 3;
  const list = (x) => (v3 ? Array.isArray(x) : optional(x, Array.isArray)); // 5, 6
  const object = (x) => (v3 ? isRecord(x) : optional(x, isRecord)); // 5, 6
  return (
    list(v.doughs) &&
    list(v.savedPlans) &&
    object(v.ui) &&
    optional(v.updatedAt, (x) => isRecord(x) && Object.values(x).every(isString)) // 7
  );
}

const NO_STORE = { "cache-control": "no-store" };

/** The signed-in user, sliding the session; otherwise answers 401 and returns null. */
function userOr401(req, res, config, store) {
  const found = readSession(req, { config, store, res });
  if (found) return found.user;
  req.resume(); // discard any body unread
  json(res, 401, { error: "not signed in" });
  return null;
}

export function stateRoutes({ config, store }) {
  if (!config.accounts || !store) return [];

  async function getState(req, res) {
    const user = userOr401(req, res, config, store);
    if (!user) return;
    const state = store.getState(user.id);
    if (!state) {
      res.writeHead(204, NO_STORE);
      return res.end();
    }
    json(res, 200, { version: state.version, updatedAt: state.updatedAt, bundle: state.bundle });
  }

  async function putState(req, res) {
    const user = userOr401(req, res, config, store);
    if (!user) return;
    const body = await readJson(req, STATE_LIMIT_BYTES); // 415, 413, 400
    if (!isRecord(body)) throw new HttpError(400, "expected { baseVersion, bundle }");
    const { baseVersion, bundle } = body;
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) {
      throw new HttpError(400, "baseVersion must be a non-negative integer");
    }
    if (!isBundleShape(bundle))
      throw new HttpError(400, "bundle is not a sourdough-planner bundle");
    // The compare and the write are one transaction in the store; a mismatch writes nothing.
    const result = store.putState(user.id, baseVersion, bundle);
    if (result.ok) return json(res, 200, { version: result.version, updatedAt: result.updatedAt });
    const { version, updatedAt, bundle: stored } = result.current;
    json(res, 409, { version, updatedAt, bundle: stored });
  }

  return [
    { method: "GET", path: "/api/state", handler: getState },
    { method: "PUT", path: "/api/state", handler: putState },
  ];
}
